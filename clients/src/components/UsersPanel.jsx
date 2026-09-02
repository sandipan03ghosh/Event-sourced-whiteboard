import React, { useState } from 'react';
import socket from '../socket';
import '../styles/presence.css';
import styles from './UsersPanel.module.css';

function UsersPanel({ presence, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  const startEditing = (currentName) => {
    setDraftName(currentName);
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed.length > 0) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const cancelEditing = () => {
    setDraftName('');
    setEditing(false);
  };

  return (
    <div className={styles.panel}>
      <strong className={styles.heading}>In this room ({presence.length})</strong>
      {presence.map((user) => {
        const isSelf = user.id === socket.id;
        const initial = user.name ? user.name.trim().charAt(0).toUpperCase() : '?';
        return (
          <div key={user.id} className={styles.row}>
            <span className={styles.avatar} style={{ backgroundColor: user.color }}>
              {initial}
            </span>
            {isSelf && editing ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') cancelEditing();
                }}
                maxLength={50}
                className={styles.nameInput}
              />
            ) : (
              <span
                onClick={isSelf ? () => startEditing(user.name) : undefined}
                className={`${styles.nameLabel} ${isSelf ? styles.self : ''}`}
                title={isSelf ? 'Click to rename' : undefined}
              >
                {user.name}{isSelf ? ' (you)' : ''}
                {user.isDrawing && <span className="presence-dot presence-dot--active" />}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default UsersPanel;
