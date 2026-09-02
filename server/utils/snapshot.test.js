// describe/it/expect/vi/beforeEach come from vitest's globals (see
// vitest.config.mjs) — the vitest package itself is ESM-only.
const mongoose = require('mongoose');

// Set before requiring snapshot.js — the module reads this once at load time.
process.env.SNAPSHOT_INTERVAL_EVENTS = '3';

const Room = require('../models/Room');
const Snapshot = require('../models/Snapshot');
const {
  maybeCreateSnapshot,
  loadFullState,
  isValidSnapshotShape,
  SNAPSHOT_SCHEMA_VERSION
} = require('./snapshot');

const validObjectId = () => new mongoose.Types.ObjectId().toString();

// vi.mock() only intercepts ES `import` statements, not CommonJS require()
// — these files use require() throughout, so vi.mock silently never took
// effect. spyOn instead replaces the methods in place on the real Model
// objects; since require() caches by path, snapshot.js's Room/Snapshot are
// the exact same instances the test file holds, so this works regardless.
vi.spyOn(Room, 'findOne');
vi.spyOn(Room, 'aggregate');
vi.spyOn(Snapshot, 'findOne');
vi.spyOn(Snapshot, 'findOneAndUpdate');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('isValidSnapshotShape', () => {
  it('rejects a missing snapshot', () => {
    expect(isValidSnapshotShape(null, 'room1')).toBe(false);
  });

  it('rejects a snapshot belonging to a different room', () => {
    const snap = { roomId: 'other', snapshotVersion: SNAPSHOT_SCHEMA_VERSION, lastAppliedEventId: validObjectId(), state: [] };
    expect(isValidSnapshotShape(snap, 'room1')).toBe(false);
  });

  it('rejects a mismatched schema version', () => {
    const snap = { roomId: 'room1', snapshotVersion: SNAPSHOT_SCHEMA_VERSION + 1, lastAppliedEventId: validObjectId(), state: [] };
    expect(isValidSnapshotShape(snap, 'room1')).toBe(false);
  });

  it('rejects an invalid lastAppliedEventId', () => {
    const snap = { roomId: 'room1', snapshotVersion: SNAPSHOT_SCHEMA_VERSION, lastAppliedEventId: 'not-an-object-id', state: [] };
    expect(isValidSnapshotShape(snap, 'room1')).toBe(false);
  });

  it('rejects a non-array state', () => {
    const snap = { roomId: 'room1', snapshotVersion: SNAPSHOT_SCHEMA_VERSION, lastAppliedEventId: validObjectId(), state: 'nope' };
    expect(isValidSnapshotShape(snap, 'room1')).toBe(false);
  });

  it('accepts a fully valid snapshot shape', () => {
    const snap = { roomId: 'room1', snapshotVersion: SNAPSHOT_SCHEMA_VERSION, lastAppliedEventId: validObjectId(), state: [] };
    expect(isValidSnapshotShape(snap, 'room1')).toBe(true);
  });
});

describe('maybeCreateSnapshot', () => {
  it('does nothing for an empty drawingData log', async () => {
    await maybeCreateSnapshot('room1', []);
    expect(Snapshot.findOne).not.toHaveBeenCalled();
  });

  it('skips creating a snapshot when under the event-count threshold', async () => {
    Snapshot.findOne.mockResolvedValue(null);
    await maybeCreateSnapshot('room1', [{ _id: '1' }, { _id: '2' }]); // threshold is 3
    expect(Snapshot.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accounts for an existing snapshot\'s coverage, not just the raw log length', async () => {
    Snapshot.findOne.mockResolvedValue({ eventCountAtSnapshot: 2 });
    const drawingData = [{ _id: '1' }, { _id: '2' }, { _id: '3' }, { _id: '4' }]; // 4 - 2 = 2, still < 3
    await maybeCreateSnapshot('room1', drawingData);
    expect(Snapshot.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('creates a snapshot once the event count crosses the threshold', async () => {
    Snapshot.findOne.mockResolvedValue(null);
    Snapshot.findOneAndUpdate.mockResolvedValue({});
    const drawingData = [
      { type: 'stroke', authorId: 'a1', opId: 'op1', data: {}, _id: 'evt1' },
      { type: 'stroke', authorId: 'a1', opId: 'op2', data: {}, _id: 'evt2' },
      { type: 'stroke', authorId: 'a1', opId: 'op3', data: {}, _id: 'evt3' }
    ];

    await maybeCreateSnapshot('room1', drawingData);

    expect(Snapshot.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = Snapshot.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ roomId: 'room1' });
    expect(update.$set.roomId).toBe('room1');
    expect(update.$set.snapshotVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(update.$set.lastAppliedEventId).toBe('evt3');
    expect(update.$set.eventCountAtSnapshot).toBe(3);
    expect(update.$set.state).toHaveLength(3);
  });

  it('swallows errors instead of throwing (fire-and-forget contract)', async () => {
    Snapshot.findOne.mockRejectedValue(new Error('db down'));
    const drawingData = [{ _id: '1' }, { _id: '2' }, { _id: '3' }];
    await expect(maybeCreateSnapshot('room1', drawingData)).resolves.toBeUndefined();
  });
});

describe('loadFullState', () => {
  it('falls back to a full replay when no snapshot exists', async () => {
    Snapshot.findOne.mockResolvedValue(null);
    Room.findOne.mockResolvedValue({ drawingData: [{ type: 'stroke', authorId: 'a1', opId: 'op1', data: {} }] });

    const result = await loadFullState('room1');
    expect(result).toHaveLength(1);
    expect(Room.aggregate).not.toHaveBeenCalled();
  });

  it('uses a valid snapshot plus new strokes when the tail has no reshaping events', async () => {
    Snapshot.findOne.mockResolvedValue({
      roomId: 'room1',
      snapshotVersion: SNAPSHOT_SCHEMA_VERSION,
      lastAppliedEventId: validObjectId(),
      state: [{ opId: 'cached1' }]
    });
    Room.aggregate.mockResolvedValue([{ drawingData: [{ type: 'stroke', opId: 'new1' }] }]);

    const result = await loadFullState('room1');
    expect(result).toEqual([{ opId: 'cached1' }, { type: 'stroke', opId: 'new1' }]);
    expect(Room.findOne).not.toHaveBeenCalled();
  });

  it('falls back to a full replay when the tail contains a reshaping event', async () => {
    Snapshot.findOne.mockResolvedValue({
      roomId: 'room1',
      snapshotVersion: SNAPSHOT_SCHEMA_VERSION,
      lastAppliedEventId: validObjectId(),
      state: [{ opId: 'cached1' }]
    });
    Room.aggregate.mockResolvedValue([{ drawingData: [{ type: 'undo', authorId: 'a1' }] }]);
    Room.findOne.mockResolvedValue({ drawingData: [{ type: 'stroke', authorId: 'a1', opId: 'op1', data: {} }] });

    const result = await loadFullState('room1');
    expect(result).toHaveLength(1);
    expect(result[0].opId).toBe('op1');
  });

  it('ignores a snapshot belonging to a different room', async () => {
    Snapshot.findOne.mockResolvedValue({
      roomId: 'other-room',
      snapshotVersion: SNAPSHOT_SCHEMA_VERSION,
      lastAppliedEventId: validObjectId(),
      state: [{ opId: 'cached1' }]
    });
    Room.findOne.mockResolvedValue({ drawingData: [] });

    const result = await loadFullState('room1');
    expect(result).toEqual([]);
    expect(Room.aggregate).not.toHaveBeenCalled();
  });

  it('returns an empty list when the room does not exist', async () => {
    Snapshot.findOne.mockResolvedValue(null);
    Room.findOne.mockResolvedValue(null);
    const result = await loadFullState('nonexistent');
    expect(result).toEqual([]);
  });

  it('falls back to a full replay if reading the snapshot throws', async () => {
    Snapshot.findOne.mockRejectedValue(new Error('db down'));
    Room.findOne.mockResolvedValue({ drawingData: [{ type: 'stroke', authorId: 'a1', opId: 'op1', data: {} }] });
    const result = await loadFullState('room1');
    expect(result).toHaveLength(1);
  });
});
