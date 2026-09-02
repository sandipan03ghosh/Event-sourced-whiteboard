import React from 'react';
import styles from './HistoryScrubber.module.css';

function formatTimestamp(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString();
}

// Purely presentational — events/index/onChange/onExit all come from Whiteboard.jsx.
function HistoryScrubber({ events, index, onChange, onExit }) {
  const total = events.length;
  const current = events[index];

  return (
    <div className={styles.bar}>
      <span className={styles.badge}>Viewing history</span>
      <input
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        value={index}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={styles.slider}
        aria-label="Scrub through room history"
      />
      <span className={styles.position}>
        {total === 0 ? 'No history yet' : `Event ${index + 1} / ${total}`}
        {current && ` · ${formatTimestamp(current.timestamp)}`}
      </span>
      <button type="button" className={styles.exitButton} onClick={onExit}>
        Exit history view
      </button>
    </div>
  );
}

export default HistoryScrubber;
