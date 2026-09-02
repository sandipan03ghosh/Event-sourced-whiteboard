import React from 'react';
import styles from './WhiteboardToolbar.module.css';

const STROKE_OPTIONS = [
  { value: 'black', label: 'Black', swatch: 'var(--stroke-black)' },
  { value: 'red', label: 'Red', swatch: 'var(--stroke-red)' },
  { value: 'blue', label: 'Blue', swatch: 'var(--stroke-blue)' },
  { value: 'green', label: 'Green', swatch: 'var(--stroke-green)' }
];

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4.5H10.5C12.433 4.5 14 6.067 14 8C14 9.933 12.433 11.5 10.5 11.5H6"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 2L4 4.5L6.5 7" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12 4.5H5.5C3.567 4.5 2 6.067 2 8C2 9.933 3.567 11.5 5.5 11.5H10"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2L12 4.5L9.5 7" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 5H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 5V3.5C6 3.22386 6.22386 3 6.5 3H9.5C9.77614 3 10 3.22386 10 3.5V5"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 5L5 13C5 13.5523 5.44772 14 6 14H10C10.5523 14 11 13.5523 11 13L11.5 5"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Purely presentational — all values/handlers come from Whiteboard.jsx.
function WhiteboardToolbar({
  canUndo, canRedo, onUndo, onRedo, onClearCanvas, onClearMyDrawings,
  strokeStyle, setStrokeStyle, lineWidth, setLineWidth,
  zoomPercent, isConnected, isSyncing, pendingCount
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <button type="button" className={styles.iconButton} onClick={onUndo} disabled={!canUndo}
          aria-label="Undo" title="Undo (Ctrl+Z)">
          <UndoIcon />
        </button>
        <button type="button" className={styles.iconButton} onClick={onRedo} disabled={!canRedo}
          aria-label="Redo" title="Redo (Ctrl+Y)">
          <RedoIcon />
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <div className={styles.swatches} role="radiogroup" aria-label="Stroke color">
          {STROKE_OPTIONS.map(opt => (
            <label key={opt.value} className={styles.swatchLabel} title={opt.label}>
              <input
                type="radio"
                name="strokeColor"
                value={opt.value}
                checked={strokeStyle === opt.value}
                onChange={() => setStrokeStyle(opt.value)}
                className={styles.swatchInput}
                aria-label={opt.label}
              />
              <span className={styles.swatch} style={{ backgroundColor: opt.swatch }} />
            </label>
          ))}
        </div>

        <div className={styles.brushControl}>
          <input
            type="range"
            min="1"
            max="10"
            value={lineWidth}
            onChange={(e) => setLineWidth(parseInt(e.target.value))}
            className={styles.slider}
            aria-label="Brush width"
          />
          <span
            className={styles.brushPreviewDot}
            style={{
              width: `${4 + lineWidth}px`,
              height: `${4 + lineWidth}px`,
              backgroundColor: STROKE_OPTIONS.find(o => o.value === strokeStyle)?.swatch
            }}
          />
          <span className={styles.brushWidthLabel}>{lineWidth}px</span>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <button type="button" className={styles.actionButton} onClick={onClearCanvas}
          title="Clear the entire board for everyone">
          <TrashIcon />
          <span>Clear All</span>
        </button>
        <button type="button" className={styles.actionButton} onClick={onClearMyDrawings}
          title="Clear only your own drawings">
          <TrashIcon />
          <span>Clear Mine</span>
        </button>
      </div>

      <div className={styles.statusGroup}>
        <span className={styles.zoom}>{zoomPercent}%</span>
        <span className={styles.connection}>
          <span
            className={`${styles.connectionDot} ${isConnected ? styles.connected : styles.disconnected}`}
          />
          {isConnected ? 'Connected' : 'Reconnecting…'}
        </span>
        {(isSyncing || pendingCount > 0) && (
          <span className={styles.syncBadge}>
            {isSyncing ? 'Syncing…' : `${pendingCount} pending`}
          </span>
        )}
      </div>
    </div>
  );
}

export default WhiteboardToolbar;
