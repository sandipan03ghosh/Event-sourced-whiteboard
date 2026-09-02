import { useState, useEffect, useCallback } from 'react';

// Absent = follow system; 'light'/'dark' = an explicit choice that always wins over the OS setting.
const STORAGE_KEY = 'theme';

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(explicit) {
  if (explicit) {
    document.documentElement.setAttribute('data-theme', explicit);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// Reads/writes localStorage defensively — private browsing can throw.
function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function useTheme() {
  const [explicit, setExplicit] = useState(readStoredTheme);
  const [effective, setEffective] = useState(() => explicit || getSystemTheme());

  useEffect(() => {
    applyTheme(explicit);
    setEffective(explicit || getSystemTheme());
  }, [explicit]);

  // Live-follows the OS setting, but only while no explicit choice is stored.
  useEffect(() => {
    if (explicit || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setEffective(getSystemTheme());
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [explicit]);

  const toggleTheme = useCallback(() => {
    const next = effective === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Theme still applies for this session even if it can't be persisted.
    }
    setExplicit(next);
  }, [effective]);

  return { theme: effective, toggleTheme };
}
