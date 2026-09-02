const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const Room = require('../models/Room');
const { isValidRoomId } = require('../utils/validation');

// Bounds how fast new rooms can be created, to stop DB-filling abuse.
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/join', joinLimiter, async (req, res) => {
  const roomId = req.body ? req.body.roomId : undefined;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'Room ID must be 6-8 alphanumeric characters.' });
  }

  try {
    let room = await Room.findOne({ roomId });

    if (!room) {
      room = new Room({ roomId });
      await room.save();
      console.log(`Created new room via API: ${roomId}`);
    }

    return res.json({ 
      roomId: room.roomId,
      createdAt: room.createdAt,
      hasDrawings: room.drawingData.length > 0
    });
  } catch (err) {
    console.error('Error in room join:', err);
    return res.status(500).json({ error: 'Server error joining room' });
  }
});

router.get('/:roomId', async (req, res) => {
  const { roomId } = req.params;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'Room ID must be 6-8 alphanumeric characters.' });
  }

  try {
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    return res.json({
      roomId: room.roomId,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      drawingCount: room.drawingData.length,
    });
  } catch (err) {
    console.error('Error getting room info:', err);
    return res.status(500).json({ error: 'Server error retrieving room info' });
  }
});

router.get('/:roomId/drawings', async (req, res) => {
  const { roomId } = req.params;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'Room ID must be 6-8 alphanumeric characters.' });
  }

  try {
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    return res.json({
      drawingData: room.drawingData
    });
  } catch (err) {
    console.error('Error getting room drawings:', err);
    return res.status(500).json({ error: 'Server error retrieving drawings' });
  }
});

module.exports = router;
