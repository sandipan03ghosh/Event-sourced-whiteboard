// Pure screen<->world coordinate helpers for the infinite canvas.
export function screenToWorld(screenX, screenY, viewport) {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    y: (screenY - viewport.offsetY) / viewport.scale
  };
}

export function worldToScreen(worldX, worldY, viewport) {
  return {
    x: worldX * viewport.scale + viewport.offsetX,
    y: worldY * viewport.scale + viewport.offsetY
  };
}

// The world-space rectangle currently visible in the viewport.
export function getVisibleWorldRect(canvasWidth, canvasHeight, viewport) {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(canvasWidth, canvasHeight, viewport);
  return {
    minX: topLeft.x,
    minY: topLeft.y,
    maxX: bottomRight.x,
    maxY: bottomRight.y
  };
}

// A stroke's world-space bounding box, padded by a safety margin.
export function getStrokeBounds({ x0, y0, x1, y1 }, padding = 0) {
  return {
    minX: Math.min(x0, x1) - padding,
    minY: Math.min(y0, y1) - padding,
    maxX: Math.max(x0, x1) + padding,
    maxY: Math.max(y0, y1) + padding
  };
}
