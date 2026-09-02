// Reconstructs state from the append-only drawingData log in one forward pass, shared by the exports below.
function buildState(drawingData) {
  if (!Array.isArray(drawingData) || drawingData.length === 0) {
    return { visibleStrokes: [], activeStacks: new Map(), redoStacks: new Map(), lastEffect: null };
  }

  let startIndex = 0;
  for (let i = drawingData.length - 1; i >= 0; i--) {
    if (drawingData[i].type === 'clear-canvas') {
      startIndex = i + 1;
      break;
    }
  }
  const visible = drawingData.slice(startIndex);
  const lastIdx = visible.length - 1;

  const clearedAtIndex = new Map(); // authorId -> last clear-user index
  const activeStacks = new Map(); // authorId -> undoable opIds
  const redoStacks = new Map(); // authorId -> redoable opIds
  const hiddenOpIds = new Set(); // opIds hidden by an undo
  let lastEffect = null; // effect of the last entry, if undo/redo

  visible.forEach((item, idx) => {
    const isLast = idx === lastIdx;

    if (item.type === 'clear-user') {
      const targetAuthorId = item.data && item.data.targetAuthorId;
      if (targetAuthorId) {
        clearedAtIndex.set(targetAuthorId, idx);
        // Their earlier strokes are gone — nothing left to undo/redo.
        activeStacks.set(targetAuthorId, []);
        redoStacks.set(targetAuthorId, []);
      }
      if (isLast) lastEffect = null;
      return;
    }

    if (item.type === 'stroke') {
      const stack = activeStacks.get(item.authorId) || [];
      stack.push(item.opId);
      activeStacks.set(item.authorId, stack);
      // Drawing a new stroke invalidates any pending redo for this author.
      redoStacks.set(item.authorId, []);
      if (isLast) lastEffect = null;
      return;
    }

    if (item.type === 'undo') {
      const stack = activeStacks.get(item.authorId) || [];
      if (stack.length > 0) {
        const targetOpId = stack.pop();
        const redo = redoStacks.get(item.authorId) || [];
        redo.push(targetOpId);
        redoStacks.set(item.authorId, redo);
        hiddenOpIds.add(targetOpId);
        if (isLast) lastEffect = { type: 'undo', opId: targetOpId };
      } else if (isLast) {
        lastEffect = null; // nothing to undo — no-op
      }
      return;
    }

    if (item.type === 'redo') {
      const redo = redoStacks.get(item.authorId) || [];
      if (redo.length > 0) {
        const targetOpId = redo.pop();
        const stack = activeStacks.get(item.authorId) || [];
        stack.push(targetOpId);
        activeStacks.set(item.authorId, stack);
        hiddenOpIds.delete(targetOpId);
        if (isLast) lastEffect = { type: 'redo', opId: targetOpId };
      } else if (isLast) {
        lastEffect = null; // nothing to redo — no-op
      }
      return;
    }

    if (isLast) lastEffect = null;
  });

  const visibleStrokes = visible.filter((item, idx) => {
    if (item.type !== 'stroke') return false;
    const clearIdx = clearedAtIndex.get(item.authorId);
    if (clearIdx !== undefined && idx <= clearIdx) return false;
    return !hiddenOpIds.has(item.opId);
  });

  return { visibleStrokes, activeStacks, redoStacks, lastEffect };
}

function reconstructState(drawingData) {
  return buildState(drawingData).visibleStrokes;
}

function getUndoRedoDepth(drawingData, authorId) {
  const { activeStacks, redoStacks } = buildState(drawingData);
  const activeStack = activeStacks.get(authorId) || [];
  const redoStack = redoStacks.get(authorId) || [];
  return { canUndo: activeStack.length > 0, canRedo: redoStack.length > 0 };
}

// Call right after appending an undo/redo event; reports its effect.
function getLastUndoRedoTarget(drawingData) {
  return buildState(drawingData).lastEffect;
}

module.exports = { reconstructState, getUndoRedoDepth, getLastUndoRedoTarget };
