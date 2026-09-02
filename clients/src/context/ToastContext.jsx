import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastContext = createContext(null);

const TOAST_DURATION_MS = 4000;

// Self-contained toast queue; optional `key` lets repeated warnings refresh
// one toast instead of stacking duplicates.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map()); // id -> timeout id

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', key) => {
    setToasts(prev => {
      const existingId = key ? prev.find(t => t.key === key)?.id : undefined;
      const id = existingId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const existingTimer = timersRef.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      timersRef.current.set(id, setTimeout(() => dismissToast(id), TOAST_DURATION_MS));

      const next = { id, message, type, key };
      return existingId ? prev.map(t => (t.id === id ? next : t)) : [...prev, next];
    });
  }, [dismissToast]);

  // Prevents orphaned timeouts from firing setState after unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
