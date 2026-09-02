import React, { useState } from 'react';
import styles from './RoomPasswordGate.module.css';

// Shown instead of the canvas while joinError is set — not authorized yet, so nothing about the room should render.
function RoomPasswordGate({ reason, onRetry }) {
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onRetry(password);
  };

  const message = reason === 'invalid-password'
    ? 'Wrong password. Try again.'
    : "Couldn't join this room. Try again.";

  return (
    <div className={styles.gate}>
      <div className={styles.card}>
        <h2 className={styles.title}>Room locked</h2>
        <p className={styles.message}>{message}</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Room password"
            className={styles.input}
            autoFocus
            autoComplete="off"
          />
          <button type="submit" className={styles.button}>Try again</button>
        </form>
      </div>
    </div>
  );
}

export default RoomPasswordGate;
