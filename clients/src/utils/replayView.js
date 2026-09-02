// Client-side mirror of server/utils/replay.js's reconstructState, for read-only scrubbing only — keep in sync with the server copy.
function buildVisibleStrokes(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  let startIndex = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'clear-canvas') {
      startIndex = i + 1;
      break;
    }
  }
  const visible = events.slice(startIndex);

  const clearedAtIndex = new Map(); // authorId -> last clear-user index
  const activeStacks = new Map(); // authorId -> undoable opIds
  const redoStacks = new Map(); // authorId -> redoable opIds
  const hiddenOpIds = new Set(); // opIds hidden by an undo

  visible.forEach((item, idx) => {
    if (item.type === 'clear-user') {
      const targetAuthorId = item.data && item.data.targetAuthorId;
      if (targetAuthorId) clearedAtIndex.set(targetAuthorId, idx);
      return;
    }
    if (item.type === 'stroke') {
      const stack = activeStacks.get(item.authorId) || [];
      stack.push(item.opId);
      activeStacks.set(item.authorId, stack);
      redoStacks.set(item.authorId, []);
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
      }
      return;
    }
  });

  return visible.filter((item, idx) => {
    if (item.type !== 'stroke') return false;
    const clearIdx = clearedAtIndex.get(item.authorId);
    if (clearIdx !== undefined && idx <= clearIdx) return false;
    return !hiddenOpIds.has(item.opId);
  });
}

// The strokes visible after replaying events[0..index] inclusive.
export function reconstructStateUpTo(events, index) {
  return buildVisibleStrokes(events.slice(0, index + 1));
}
