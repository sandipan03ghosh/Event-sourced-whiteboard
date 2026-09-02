// client/src/components/UserCursors.js
import React, { useEffect, useMemo, useState } from 'react';
import socket from '../socket';
import { worldToScreen } from '../utils/viewport';
import '../styles/presence.css';
import styles from './UserCursors.module.css';

function UserCursors({ roomId, isConnected, presence, viewport }) {
  const [cursors, setCursors] = useState({});

  const presenceById = useMemo(
    () => Object.fromEntries((presence || []).map(user => [user.id, user])),
    [presence]
  );

  useEffect(() => {
    const handleCursorMove = ({ userId, position }) => {
      setCursors(prev => ({
        ...prev,
        [userId]: position
      }));
    };

    socket.on('cursor-move', handleCursorMove);

    return () => {
      socket.off('cursor-move', handleCursorMove);
    };
  }, []);

  // Drop any cursor whose user is no longer in the presence roster.
  useEffect(() => {
    setCursors(prev => {
      const next = {};
      Object.entries(prev).forEach(([userId, position]) => {
        if (presenceById[userId]) {
          next[userId] = position;
        }
      });
      return next;
    });
  }, [presenceById]);

  // Clear stale cursors on reconnect rather than leaving ghosts.
  useEffect(() => {
    if (isConnected) {
      setCursors({});
    }
  }, [isConnected]);

  return (
    <>
      {Object.entries(cursors).map(([userId, position]) => {
        const user = presenceById[userId];
        const color = user ? user.color : '#FF5722';
        const label = user ? user.name : userId.substring(0, 6);
        const isDrawing = Boolean(user && user.isDrawing);
        // Broadcast in world coords; convert to this viewer's screen space.
        const screenPos = worldToScreen(position.x, position.y, viewport);

        return (
          <div
            key={userId}
            className={styles.cursor}
            style={{ transform: `translate(${screenPos.x}px, ${screenPos.y}px)` }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20">
              <polygon points="0,0 10,15 5,10" fill={color} stroke="black" strokeWidth="1" />
            </svg>
            <div className={styles.label}>
              {label}
              {isDrawing && <span className="presence-dot presence-dot--active" />}
            </div>
          </div>
        );
      })}
    </>
  );
}

export default UserCursors;
