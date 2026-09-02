import React from 'react';
import { useToast } from '../context/ToastContext';
import styles from './Toast.module.css';

const TYPE_CLASS = {
  info: styles.info,
  warning: styles.warning,
  error: styles.error
};

function Toast() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className={`${styles.toast} ${TYPE_CLASS[toast.type] || styles.info}`}>
          <span className={styles.message}>{toast.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toast;
