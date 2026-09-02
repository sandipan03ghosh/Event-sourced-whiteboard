// Must run first — some modules read process.env.* at load time.
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const socketSetup = require('./socket');
const connectDB = require('./config/db');

// Log and continue on rejections; exit on uncaught exceptions (bad state).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const app = express();
app.use(cors());

app.use(express.json());

const roomRoutes = require('./routes/rooms');
app.use('/api/rooms', roomRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

socketSetup(io);


if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../clients/dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../clients/dist', 'index.html'));
  });
}

// Catch-all: never leak internals to the client.
app.use((err, req, res, next) => {
  console.error('Unhandled Express error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
// Localhost-only by default; set HOST=0.0.0.0 to expose deliberately.
const HOST = process.env.HOST || '127.0.0.1';

// Starts the server, retrying the next port if this one's in use.
function startServer(port) {
  server.listen(port, HOST, () => {
    console.log(`Server running on ${HOST}:${port}`);

    connectDB().then(connected => {
      if (!connected) {
        console.warn('Server running without MongoDB connection. Some features may not work properly.');
      }
    });
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is already in use, trying ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);