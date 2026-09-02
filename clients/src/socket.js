import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:5000';

const socket = io(SOCKET_URL, {
  reconnectionDelayMax: 10000,
  reconnection: true,
  reconnectionAttempts: Infinity,
  transports: ['websocket', 'polling'],
  forceNew: false,
  timeout: 5000,
  perMessageDeflate: {
    threshold: 1024
  }
});

socket.on('connect', () => {
  console.log('Socket connected:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
});

export default socket;