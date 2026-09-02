// describe/it/expect come from vitest's globals (see vitest.config.mjs) —
// the vitest package itself is ESM-only and can't be require()'d here.
const { reconstructState, getUndoRedoDepth, getLastUndoRedoTarget } = require('./replay');

// Minimal stroke event builder — only the fields replay.js actually reads.
function stroke(authorId, opId, extra = {}) {
  return { type: 'stroke', authorId, opId, data: { x0: 0, y0: 0, x1: 1, y1: 1 }, ...extra };
}

function undo(authorId) {
  return { type: 'undo', authorId };
}

function redo(authorId) {
  return { type: 'redo', authorId };
}

function clearCanvas() {
  return { type: 'clear-canvas' };
}

function clearUser(targetAuthorId) {
  return { type: 'clear-user', data: { targetAuthorId } };
}

describe('reconstructState', () => {
  it('returns an empty list for an empty log', () => {
    expect(reconstructState([])).toEqual([]);
  });

  it('shows a single stroke as visible', () => {
    const log = [stroke('a1', 'op1')];
    expect(reconstructState(log)).toHaveLength(1);
  });

  it('hides a stroke after it is undone', () => {
    const log = [stroke('a1', 'op1'), undo('a1')];
    expect(reconstructState(log)).toEqual([]);
  });

  it('shows a stroke again after undo then redo', () => {
    const log = [stroke('a1', 'op1'), undo('a1'), redo('a1')];
    const visible = reconstructState(log);
    expect(visible).toHaveLength(1);
    expect(visible[0].opId).toBe('op1');
  });

  it('keeps undo/redo scoped per author', () => {
    const log = [stroke('a1', 'op1'), stroke('a2', 'op2'), undo('a1')];
    const visible = reconstructState(log);
    expect(visible.map(v => v.opId)).toEqual(['op2']);
  });

  it('hides everything before a clear-canvas but keeps strokes drawn after it', () => {
    const log = [stroke('a1', 'op1'), clearCanvas(), stroke('a1', 'op2')];
    const visible = reconstructState(log);
    expect(visible.map(v => v.opId)).toEqual(['op2']);
  });

  it('clear-user only hides that author\'s earlier strokes, not others\'', () => {
    const log = [stroke('a1', 'op1'), stroke('a2', 'op2'), clearUser('a1')];
    const visible = reconstructState(log);
    expect(visible.map(v => v.opId)).toEqual(['op2']);
  });

  it('clear-user does not hide that author\'s later strokes', () => {
    const log = [stroke('a1', 'op1'), clearUser('a1'), stroke('a1', 'op2')];
    const visible = reconstructState(log);
    expect(visible.map(v => v.opId)).toEqual(['op2']);
  });

  it('a new stroke invalidates a pending redo for that author', () => {
    const log = [stroke('a1', 'op1'), undo('a1'), stroke('a1', 'op2'), redo('a1')];
    // The redo has nothing left to restore (op1 was dropped from the redo
    // stack when op2 was drawn), so only op2 should end up visible.
    const visible = reconstructState(log);
    expect(visible.map(v => v.opId)).toEqual(['op2']);
  });

  it('an undo with nothing to undo is a no-op', () => {
    const log = [undo('a1')];
    expect(reconstructState(log)).toEqual([]);
  });
});

describe('getUndoRedoDepth', () => {
  it('reports no undo/redo available for an author with no strokes', () => {
    expect(getUndoRedoDepth([], 'a1')).toEqual({ canUndo: false, canRedo: false });
  });

  it('reports canUndo true right after drawing', () => {
    const log = [stroke('a1', 'op1')];
    expect(getUndoRedoDepth(log, 'a1')).toEqual({ canUndo: true, canRedo: false });
  });

  it('reports canRedo true right after undoing', () => {
    const log = [stroke('a1', 'op1'), undo('a1')];
    expect(getUndoRedoDepth(log, 'a1')).toEqual({ canUndo: false, canRedo: true });
  });

  it('does not leak one author\'s depth into another\'s', () => {
    const log = [stroke('a1', 'op1')];
    expect(getUndoRedoDepth(log, 'a2')).toEqual({ canUndo: false, canRedo: false });
  });
});

describe('getLastUndoRedoTarget', () => {
  it('reports the undone opId when the last event is an undo', () => {
    const log = [stroke('a1', 'op1'), undo('a1')];
    expect(getLastUndoRedoTarget(log)).toEqual({ type: 'undo', opId: 'op1' });
  });

  it('reports the redone opId when the last event is a redo', () => {
    const log = [stroke('a1', 'op1'), undo('a1'), redo('a1')];
    expect(getLastUndoRedoTarget(log)).toEqual({ type: 'redo', opId: 'op1' });
  });

  it('reports null for a no-op undo (nothing to undo)', () => {
    const log = [undo('a1')];
    expect(getLastUndoRedoTarget(log)).toBeNull();
  });

  it('reports null when the last event is a plain stroke', () => {
    const log = [stroke('a1', 'op1')];
    expect(getLastUndoRedoTarget(log)).toBeNull();
  });
});
