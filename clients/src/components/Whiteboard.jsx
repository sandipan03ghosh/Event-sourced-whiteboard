import React, { useRef, useEffect, useState, useCallback } from 'react';
import socket from '../socket';
import UserCursors from './UserCursors';
import UsersPanel from './UsersPanel';
import WhiteboardToolbar from './WhiteboardToolbar';
import RoomPasswordGate from './RoomPasswordGate';
import HistoryScrubber from './HistoryScrubber';
import useSocketSync from '../hooks/useSocketSync';
import { useToast } from '../context/ToastContext';
import { getIdentity } from '../identity';
import { screenToWorld, getVisibleWorldRect, getStrokeBounds } from '../utils/viewport';
import { throttle } from '../utils/throttle';
import { reconstructStateUpTo } from '../utils/replayView';
import SpatialGrid from '../utils/spatialGrid';
import styles from './Whiteboard.module.css';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_INTENSITY = 0.001;
const MAX_WHEEL_ZOOM_FACTOR = 1.5; // clamps a single wheel event against trackpad deltaY spikes
const CULL_PADDING = 5; // half of the max line width (10), a safety margin for culling

function isStrokeVisible(data, rect) {
  const bounds = getStrokeBounds(data, CULL_PADDING);
  return bounds.maxX >= rect.minX && bounds.minX <= rect.maxX &&
    bounds.maxY >= rect.minY && bounds.minY <= rect.maxY;
}

function Whiteboard({ roomId, roomPassword }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 }); // world coordinates
  const [strokeStyle, setStrokeStyle] = useState('black');
  const [lineWidth, setLineWidth] = useState(3);
  const containerRef = useRef(null);

  // opsRef: visible strokes; hiddenOpsRef: undone ones cached for redo; myUndoOrderRef: per-author LIFO for optimistic redo.
  const opsRef = useRef([]); // [{opId, authorId, data, seq}], data in world coords
  const hiddenOpsRef = useRef(new Map()); // opId -> {opId, authorId, data, seq}
  const myUndoOrderRef = useRef([]); // my own opIds, most-recently-hidden last

  // Spatial index over opsRef, narrowing redraws to near-viewport strokes.
  const gridRef = useRef(new SpatialGrid());
  const nextSeqRef = useRef(0);

  // History scrubbing: read-only overlay — when scrubStrokesRef is set, redrawAll paints it instead of the live grid, so opsRef/gridRef stay untouched.
  const { showToast } = useToast();
  const [historyMode, setHistoryMode] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState(null);
  const [scrubIndex, setScrubIndex] = useState(0);
  const historyModeRef = useRef(false); // mirrors historyMode for stable-identity handlers
  const scrubStrokesRef = useRef(null); // null = live rendering; array = frozen history view
  useEffect(() => { historyModeRef.current = historyMode; }, [historyMode]);

  // Infinite-canvas viewport; pan/zoom batched via requestAnimationFrame.
  const [viewport, setViewport] = useState({ offsetX: 0, offsetY: 0, scale: 1 });
  const viewportRef = useRef(viewport);
  const pendingViewportRef = useRef(viewport);
  const rafScheduledRef = useRef(false);

  const isSpaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ screenX: 0, screenY: 0, offsetX: 0, offsetY: 0 });
  // State, not a direct DOM mutation — JSX's inline style would stomp it.
  const [cursorStyle, setCursorStyle] = useState('crosshair');

  const throttledCursorMove = useCallback(
    throttle((roomId, position) => {
      const identity = getIdentity();
      socket.emit('cursor-move', { roomId, position, authorId: identity.authorId });
    }, 10),
    [roomId]
  );

  const drawFromData = useCallback(({ x0, y0, x1, y1, color = 'black', width = 3 }) => {
    const ctx = ctxRef.current;
    const originalStyle = ctx.strokeStyle;
    const originalWidth = ctx.lineWidth;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();

    ctx.strokeStyle = originalStyle;
    ctx.lineWidth = originalWidth;
  }, []);

  // Reads viewport from the ref so this function's identity stays stable on pan/zoom.
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !canvas) return;

    const vp = viewportRef.current;

    // Clear in screen space before applying the world transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);

    const visibleRect = getVisibleWorldRect(canvas.width, canvas.height, vp);

    if (scrubStrokesRef.current) {
      // History view: a frozen, precomputed stroke list — bypasses the live spatial grid entirely.
      scrubStrokesRef.current.forEach(data => {
        if (isStrokeVisible(data, visibleRect)) {
          drawFromData(data);
        }
      });
    } else {
      // Coarse grid pre-filter; isStrokeVisible is the precise final gate.
      const candidates = gridRef.current.query(visibleRect);
      candidates.sort((a, b) => a.seq - b.seq);
      candidates.forEach(item => {
        if (isStrokeVisible(item.data, visibleRect)) {
          drawFromData(item.data);
        }
      });
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
  }, [drawFromData, strokeStyle, lineWidth]);

  // Batches viewport updates to at most once per animation frame.
  const commitViewport = useCallback((next) => {
    pendingViewportRef.current = next;
    if (!rafScheduledRef.current) {
      rafScheduledRef.current = true;
      requestAnimationFrame(() => {
        rafScheduledRef.current = false;
        viewportRef.current = pendingViewportRef.current;
        redrawAll();
        setViewport(pendingViewportRef.current);
      });
    }
  }, [redrawAll]);

  // Full syncs replace the ops list wholesale; delta syncs append on top.
  const applySyncOps = useCallback((ops, full) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !canvas) return;

    if (full) {
      opsRef.current = ops.map((item, idx) => ({ opId: item.opId, authorId: item.authorId, data: item.data, seq: idx }));
      gridRef.current.clear();
      opsRef.current.forEach(entry => {
        gridRef.current.insert(entry, getStrokeBounds(entry.data, CULL_PADDING));
      });
      nextSeqRef.current = opsRef.current.length;
      hiddenOpsRef.current.clear();
      myUndoOrderRef.current = [];
      redrawAll();
      return;
    }

    const visibleRect = getVisibleWorldRect(canvas.width, canvas.height, viewportRef.current);
    ops.forEach(item => {
      if (item.type === 'stroke' && item.data) {
        const entry = { opId: item.opId, authorId: item.authorId, data: item.data, seq: nextSeqRef.current++ };
        opsRef.current.push(entry);
        gridRef.current.insert(entry, getStrokeBounds(entry.data, CULL_PADDING));
        if (isStrokeVisible(entry.data, visibleRect)) {
          drawFromData(entry.data);
        }
      }
    });

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
  }, [drawFromData, redrawAll, strokeStyle, lineWidth]);

  const {
    isConnected, isSyncing, pendingCount, sendDrawing, presence, renamePresence,
    setDrawingActivity, canUndo, canRedo, sendUndo, sendRedo, joinError, retryJoin
  } = useSocketSync(roomId, roomPassword, applySyncOps);

  const applyCanvasDefaults = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
  }, [strokeStyle, lineWidth]);

  const updateCursorStyle = useCallback(() => {
    if (isPanningRef.current) {
      setCursorStyle('grabbing');
    } else if (isSpaceDownRef.current) {
      setCursorStyle('grab');
    } else {
      setCursorStyle('crosshair');
    }
  }, []);

  // Resizing resets 2D context state; also re-runs on joinError clearing since the canvas unmounts while the password gate shows.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return; // not mounted while the password gate is showing
    canvas.width = window.innerWidth * 0.8;
    canvas.height = window.innerHeight * 0.8;
    ctxRef.current = canvas.getContext('2d');
    applyCanvasDefaults();
    redrawAll();

    const handleResize = () => {
      canvas.width = window.innerWidth * 0.8;
      canvas.height = window.innerHeight * 0.8;
      applyCanvasDefaults();
      redrawAll();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, joinError]);

  // Cursor-centered zoom; native non-passive listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const vp = viewportRef.current;
      const worldBefore = screenToWorld(screenX, screenY, vp);

      let zoomFactor = Math.exp(-e.deltaY * ZOOM_INTENSITY);
      zoomFactor = Math.min(Math.max(zoomFactor, 1 / MAX_WHEEL_ZOOM_FACTOR), MAX_WHEEL_ZOOM_FACTOR);

      // Clamp scale before solving offset, or the cursor anchor drifts at the bounds.
      const newScale = Math.min(Math.max(vp.scale * zoomFactor, MIN_SCALE), MAX_SCALE);
      const newOffsetX = screenX - worldBefore.x * newScale;
      const newOffsetY = screenY - worldBefore.y * newScale;

      commitViewport({ offsetX: newOffsetX, offsetY: newOffsetY, scale: newScale });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [commitViewport]);

  // Space-bar pan modifier.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      isSpaceDownRef.current = true;
      updateCursorStyle();
    };
    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return;
      isSpaceDownRef.current = false;
      updateCursorStyle();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [updateCursorStyle]);

  // Remote drawing + clear-canvas + undo/redo listeners.
  useEffect(() => {
    const handleDrawing = (payload) => {
      const entry = { opId: payload.opId, authorId: payload.authorId, data: payload, seq: nextSeqRef.current++ };
      opsRef.current.push(entry);
      gridRef.current.insert(entry, getStrokeBounds(entry.data, CULL_PADDING));
      // Keeps accumulating live state in the background, but doesn't paint over a frozen history view.
      if (scrubStrokesRef.current) return;
      const canvas = canvasRef.current;
      if (canvas && isStrokeVisible(payload, getVisibleWorldRect(canvas.width, canvas.height, viewportRef.current))) {
        drawFromData(payload);
      }
    };

    const handleClearCanvas = () => {
      opsRef.current = [];
      gridRef.current.clear();
      hiddenOpsRef.current.clear();
      myUndoOrderRef.current = [];
      redrawAll();
    };

    const handleUndoRedoApplied = ({ type, opId }) => {
      if (type === 'undo') {
        const idx = opsRef.current.findIndex(item => item.opId === opId);
        if (idx !== -1) {
          const [hidden] = opsRef.current.splice(idx, 1);
          gridRef.current.remove(opId);
          hiddenOpsRef.current.set(opId, hidden);
          redrawAll();
        }
        // else: already hidden (e.g. our own optimistic undo) — no-op.
      } else if (type === 'redo') {
        const alreadyVisible = opsRef.current.some(item => item.opId === opId);
        if (!alreadyVisible && hiddenOpsRef.current.has(opId)) {
          const restored = hiddenOpsRef.current.get(opId);
          hiddenOpsRef.current.delete(opId);
          restored.seq = nextSeqRef.current++;
          opsRef.current.push(restored);
          gridRef.current.insert(restored, getStrokeBounds(restored.data, CULL_PADDING));
          redrawAll();
        }
        // else: already visible, or we never cached it — self-heals on next resync.
      }
    };

    socket.on('drawing', handleDrawing);
    socket.on('clear-canvas', handleClearCanvas);
    socket.on('undo-redo-applied', handleUndoRedoApplied);

    return () => {
      socket.off('drawing', handleDrawing);
      socket.off('clear-canvas', handleClearCanvas);
      socket.off('undo-redo-applied', handleUndoRedoApplied);
    };
  }, [drawFromData, redrawAll]);

  const startDrawing = ({ nativeEvent }) => {
    if (historyModeRef.current) return; // read-only while scrubbing history
    const isMiddleMouse = nativeEvent.button === 1;
    const isSpacePan = nativeEvent.button === 0 && isSpaceDownRef.current;

    if (isMiddleMouse || isSpacePan) {
      // Prevents the browser's own middle-click autoscroll gesture.
      if (isMiddleMouse) nativeEvent.preventDefault();
      isPanningRef.current = true;
      const vp = viewportRef.current;
      panStartRef.current = {
        screenX: nativeEvent.clientX,
        screenY: nativeEvent.clientY,
        offsetX: vp.offsetX,
        offsetY: vp.offsetY
      };
      updateCursorStyle();
      return;
    }

    drawing.current = true;
    const { offsetX, offsetY } = nativeEvent;
    lastPos.current = screenToWorld(offsetX, offsetY, viewportRef.current);
    setDrawingActivity(true);
  };

  const draw = ({ nativeEvent }) => {
    if (isPanningRef.current) {
      const dx = nativeEvent.clientX - panStartRef.current.screenX;
      const dy = nativeEvent.clientY - panStartRef.current.screenY;
      commitViewport({
        offsetX: panStartRef.current.offsetX + dx,
        offsetY: panStartRef.current.offsetY + dy,
        scale: viewportRef.current.scale
      });
      return;
    }

    if (!drawing.current || historyModeRef.current) return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = ctxRef.current;
    const world = screenToWorld(offsetX, offsetY, viewportRef.current);

    // Context already carries the world transform; drawn in world coords.
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(world.x, world.y);
    ctx.stroke();
    ctx.closePath();

    const drawingData = {
      x0: lastPos.current.x,
      y0: lastPos.current.y,
      x1: world.x,
      y1: world.y,
      color: strokeStyle,
      width: lineWidth
    };

    const { opId, authorId } = sendDrawing(roomId, drawingData);
    const entry = { opId, authorId, data: drawingData, seq: nextSeqRef.current++ };
    opsRef.current.push(entry);
    gridRef.current.insert(entry, getStrokeBounds(entry.data, CULL_PADDING));
    lastPos.current = world;
  };

  const stopDrawing = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      updateCursorStyle();
      return;
    }
    if (drawing.current) {
      drawing.current = false;
      setDrawingActivity(false);
    }
  };

  const clearCanvas = () => {
    if (historyModeRef.current) return;
    opsRef.current = [];
    gridRef.current.clear();
    hiddenOpsRef.current.clear();
    myUndoOrderRef.current = [];
    redrawAll();
    const identity = getIdentity();
    socket.emit('clear-canvas', { roomId, authorId: identity.authorId });
  };

  const clearMyDrawings = () => {
    if (historyModeRef.current) return;
    const identity = getIdentity();
    socket.emit('clear-user-drawings', { roomId, authorId: identity.authorId });
  };

  // Fetches the raw event log fresh each time (never cached) to avoid a stale view later.
  const enterHistoryView = useCallback(() => {
    const identity = getIdentity();
    setHistoryLoading(true);
    socket.emit('get-room-timeline', { roomId, authorId: identity.authorId }, (ack) => {
      setHistoryLoading(false);
      if (!ack || ack.status !== 'ok') {
        const reason = ack && ack.reason;
        const message = reason === 'room-too-large'
          ? "This room's history is too large to scrub through."
          : reason === 'rate-limited'
            ? 'Please wait a moment before trying History again.'
            : "Couldn't load room history.";
        showToast(message, 'error');
        return;
      }
      setTimelineEvents(ack.events);
      setScrubIndex(Math.max(ack.events.length - 1, 0));
      setHistoryMode(true);
    });
  }, [roomId, showToast]);

  const exitHistoryView = useCallback(() => {
    scrubStrokesRef.current = null;
    setHistoryMode(false);
    setTimelineEvents(null);
    redrawAll();
  }, [redrawAll]);

  const handleToggleHistory = () => {
    if (historyMode) {
      exitHistoryView();
    } else {
      enterHistoryView();
    }
  };

  // Recomputes the frozen scrub view on slider/timeline change; never touches opsRef/gridRef (live state).
  useEffect(() => {
    if (!historyMode || !timelineEvents) return;
    scrubStrokesRef.current = reconstructStateUpTo(timelineEvents, scrubIndex).map(item => item.data);
    redrawAll();
  }, [historyMode, timelineEvents, scrubIndex, redrawAll]);

  const handleUndoClick = () => {
    if (!canUndo || historyModeRef.current) return;
    const identity = getIdentity();
    let targetIdx = -1;
    for (let i = opsRef.current.length - 1; i >= 0; i--) {
      if (opsRef.current[i].authorId === identity.authorId) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx !== -1) {
      const [hidden] = opsRef.current.splice(targetIdx, 1);
      gridRef.current.remove(hidden.opId);
      hiddenOpsRef.current.set(hidden.opId, hidden);
      myUndoOrderRef.current.push(hidden.opId);
      redrawAll();
    }
    sendUndo();
  };

  const handleRedoClick = () => {
    if (!canRedo || historyModeRef.current) return;
    const targetOpId = myUndoOrderRef.current.pop();
    if (targetOpId && hiddenOpsRef.current.has(targetOpId)) {
      const restored = hiddenOpsRef.current.get(targetOpId);
      hiddenOpsRef.current.delete(targetOpId);
      restored.seq = nextSeqRef.current++;
      opsRef.current.push(restored);
      gridRef.current.insert(restored, getStrokeBounds(restored.data, CULL_PADDING));
      redrawAll();
    }
    sendRedo();
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, viewportRef.current);
    throttledCursorMove(roomId, world);
  };

  useEffect(() => {
    if (ctxRef.current) {
      const ctx = ctxRef.current;

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
    }
  }, [strokeStyle, lineWidth]);

  // Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z shortcuts; ignores repeat and text inputs.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.repeat) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedoClick();
        } else {
          e.preventDefault();
          handleUndoClick();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleRedoClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo]);

  // Cosmetic hint only; refreshes whenever any other state re-renders.
  const isEmpty = !isSyncing && opsRef.current.length === 0;

  // Not authorized for this room yet — show the lock gate, nothing else.
  if (joinError) {
    // Keying by attempt forces a fresh RoomPasswordGate (cleared input) on every retry, even a repeated same-reason failure.
    return <RoomPasswordGate key={joinError.attempt} reason={joinError.reason} onRetry={retryJoin} />;
  }

  return (
    <div className={styles.page}>
      <div ref={containerRef} className={styles.container}>
        <WhiteboardToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndoClick}
          onRedo={handleRedoClick}
          onClearCanvas={clearCanvas}
          onClearMyDrawings={clearMyDrawings}
          strokeStyle={strokeStyle}
          setStrokeStyle={setStrokeStyle}
          lineWidth={lineWidth}
          setLineWidth={setLineWidth}
          zoomPercent={Math.round(viewport.scale * 100)}
          isConnected={isConnected}
          isSyncing={isSyncing}
          pendingCount={pendingCount}
          onToggleHistory={handleToggleHistory}
          historyActive={historyMode}
          historyLoading={historyLoading}
        />
        <div className={styles.canvasRow}>
          <div className={styles.canvasWrapper}>
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={(e) => {
                handleMouseMove(e);
                draw(e);
              }}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              className={styles.canvas}
              style={{ cursor: cursorStyle }}
            />
            <UserCursors roomId={roomId} isConnected={isConnected} presence={presence} viewport={viewport} />
            {isSyncing && (
              <div className={styles.syncOverlay}>
                <span className={styles.spinner} />
                <span>Syncing board…</span>
              </div>
            )}
            {isEmpty && (
              <div className={styles.emptyHint}>Nothing here yet — pick a color and start drawing</div>
            )}
            {historyMode && timelineEvents && (
              <HistoryScrubber
                events={timelineEvents}
                index={scrubIndex}
                onChange={setScrubIndex}
                onExit={exitHistoryView}
              />
            )}
          </div>
          <UsersPanel presence={presence} onRename={renamePresence} />
        </div>
      </div>
    </div>
  );
}

export default Whiteboard;
