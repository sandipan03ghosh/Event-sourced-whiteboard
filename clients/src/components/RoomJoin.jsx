import React, { useState } from 'react';
import { useToast } from '../context/ToastContext';
import styles from './RoomJoin.module.css';

// Mirrors the server's room-id rule (server/utils/validation.js).
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6,8}$/;

function RoomJoin({ onJoin }) {
  const [roomInput, setRoomInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const handleSubmit = (e) => {
    e.preventDefault();

    const trimmed = roomInput.trim();
    if (trimmed.length === 0) {
      onJoin(Math.random().toString(36).substring(2, 8).toUpperCase(), passwordInput);
      return;
    }

    if (!ROOM_ID_PATTERN.test(trimmed)) {
      setError('Room code must be 6-8 letters/numbers.');
      showToast('Room code must be 6-8 letters/numbers.', 'error');
      return;
    }

    setError('');
    onJoin(trimmed, passwordInput);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Join Whiteboard Room</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          placeholder="Enter room code or leave blank for new room"
          className={styles.input}
        />
        <input
          type="password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          placeholder="Room password (optional)"
          className={styles.input}
          autoComplete="off"
        />
        <button type="submit" className={styles.button}>
          Join Room
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.hint}>
        Setting a password when creating a room protects it; leave it blank for an open room.
      </p>
    </div>
  );
}

export default RoomJoin;
