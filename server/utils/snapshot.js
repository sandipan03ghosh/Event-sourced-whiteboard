const mongoose = require('mongoose');
const Room = require('../models/Room');
const Snapshot = require('../models/Snapshot');
const { reconstructState } = require('./replay');

// Bumped if `state`'s shape ever changes.
const SNAPSHOT_SCHEMA_VERSION = 1;

const parsedInterval = parseInt(process.env.SNAPSHOT_INTERVAL_EVENTS, 10);
const SNAPSHOT_INTERVAL_EVENTS = Number.isNaN(parsedInterval) ? 5000 : parsedInterval;

// Event types that can hide previously-visible strokes, not just add new ones.
const RESHAPING_TYPES = new Set(['clear-canvas', 'clear-user', 'undo', 'redo']);

function isValidSnapshotShape(snapshot, roomId) {
  if (!snapshot) return false;
  if (snapshot.roomId !== roomId) return false;
  if (snapshot.snapshotVersion !== SNAPSHOT_SCHEMA_VERSION) return false;
  if (typeof snapshot.lastAppliedEventId !== 'string' || !mongoose.Types.ObjectId.isValid(snapshot.lastAppliedEventId)) {
    return false;
  }
  return Array.isArray(snapshot.state);
}

// Fire-and-forget; errors are caught/logged, never thrown to the caller.
async function maybeCreateSnapshot(roomId, drawingData) {
  const length = drawingData.length;
  if (length === 0) return;

  try {
    const existing = await Snapshot.findOne({ roomId }, { eventCountAtSnapshot: 1 });
    const coveredCount = (existing && typeof existing.eventCountAtSnapshot === 'number')
      ? existing.eventCountAtSnapshot
      : 0;

    if (length - coveredCount < SNAPSHOT_INTERVAL_EVENTS) return;

    const state = reconstructState(drawingData);
    const lastEvent = drawingData[length - 1];

    // $setOnInsert keeps createdAt from being clobbered on later updates.
    await Snapshot.findOneAndUpdate(
      { roomId },
      {
        $set: {
          roomId,
          snapshotVersion: SNAPSHOT_SCHEMA_VERSION,
          lastAppliedEventId: lastEvent._id.toString(),
          eventCountAtSnapshot: length,
          state,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`Created snapshot for room ${roomId} at ${length} events`);
  } catch (err) {
    console.error(`Snapshot creation failed for room ${roomId} (non-fatal, collaboration unaffected):`, err);
  }
}

// Uses a valid snapshot as a checkpoint when possible, else does a full replay.
async function loadFullState(roomId) {
  try {
    const snapshot = await Snapshot.findOne({ roomId });

    if (isValidSnapshotShape(snapshot, roomId)) {
      const sinceObjectId = new mongoose.Types.ObjectId(snapshot.lastAppliedEventId);
      const tailAgg = await Room.aggregate([
        { $match: { roomId } },
        {
          $project: {
            drawingData: {
              $filter: {
                input: '$drawingData',
                as: 'item',
                cond: { $gt: ['$$item._id', sinceObjectId] }
              }
            }
          }
        }
      ]);

      if (tailAgg.length > 0) {
        const tail = tailAgg[0].drawingData;
        const hasReshapingEvent = tail.some(item => RESHAPING_TYPES.has(item.type));
        if (!hasReshapingEvent) {
          const newStrokes = tail.filter(item => item.type === 'stroke');
          console.log(`Using snapshot for room ${roomId}: ${snapshot.state.length} cached + ${newStrokes.length} new`);
          return snapshot.state.concat(newStrokes);
        }
      }
      // Falls through to full replay below.
    }
  } catch (err) {
    console.error(`Error loading snapshot for room ${roomId} (falling back to full replay):`, err);
  }

  const room = await Room.findOne({ roomId });
  return room ? reconstructState(room.drawingData) : [];
}

module.exports = {
  maybeCreateSnapshot,
  loadFullState,
  isValidSnapshotShape,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_INTERVAL_EVENTS,
  RESHAPING_TYPES
};
