import React, { useState, useEffect } from 'react';
import RoomJoin from './components/RoomJoin';
import Whiteboard from './components/Whiteboard';
import ThemeToggle from './components/ThemeToggle';
import ErrorBoundary from './components/ErrorBoundary';
import socket from './socket';
import styles from './components/App.module.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');

  const handleJoinRoom = (newRoomId, password) => {
    setRoomId(newRoomId);
    setRoomPassword(password || '');
  };

  const handleLeaveRoom = () => {
    if (roomId) {
      socket.emit('leave-room', roomId);
      console.log(`Leaving room: ${roomId}`);
    }
    setRoomId('');
    setRoomPassword('');
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (roomId) {
        socket.emit('leave-room', roomId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (roomId) {
        socket.emit('leave-room', roomId);
      }
    };
  }, [roomId]);

  return (
    <div className={styles.app}>
      <ThemeToggle />
      <ErrorBoundary>
        {roomId === '' ? (
          <RoomJoin onJoin={handleJoinRoom} />
        ) : (
          <div style={{ position: 'relative' }}>
            <div className={styles.roomBar}>
              <h3 className={styles.roomTitle}>Room: {roomId}</h3>
              <p className={styles.roomHint}>Share this room code with others to collaborate!</p>
              <button className={styles.leaveButton} onClick={handleLeaveRoom}>Leave Room</button>
            </div>
            <Whiteboard roomId={roomId} roomPassword={roomPassword} />
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
}

export default App;
