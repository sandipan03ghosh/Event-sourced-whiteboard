const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Room = require('../models/Room');
const validation = require('../utils/validation');
const { reconstructState, getUndoRedoDepth, getLastUndoRedoTarget } = require('../utils/replay');
const { maybeCreateSnapshot, loadFullState, RESHAPING_TYPES } = require('../utils/snapshot');

const DRAWING_LOG_WARN_THRESHOLD = 5000;
const PASSWORD_SALT_ROUNDS = 10;

function broadcastPresence(io, roomUsers, roomId) {
  const roster = roomUsers[roomId] ? Array.from(roomUsers[roomId].values()) : [];
  io.to(roomId).emit('presence-update', roster);
}

function warnIfLogGrowingLarge(roomId, length) {
  if (length > 0 && length % DRAWING_LOG_WARN_THRESHOLD === 0) {
    console.warn(`Room ${roomId} drawingData has grown to ${length} entries (diagnostic only, no action taken)`);
  }
}

// The authorId a socket registered at join-room time; later control ops must match it.
function getRegisteredAuthorId(roomUsers, roomId, socketId) {
  const entry = roomUsers[roomId] && roomUsers[roomId].get(socketId);
  return entry ? entry.authorId : undefined;
}

// Simple fixed-window limiter, created fresh per socket connection.
function createRateLimiter(maxEvents, windowMs) {
  let count = 0;
  let windowStart = Date.now();
  return function allow() {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= maxEvents;
  };
}

// Appends an undo/redo tombstone and acks the client with the resulting depth.
async function appendUndoRedo(type, roomId, authorId, opId, socket, ack) {
  const existing = await Room.findOne(
    { roomId, 'drawingData.opId': opId },
    { 'drawingData.$': 1 }
  );
  if (existing && existing.drawingData && existing.drawingData.length > 0) {
    const room = await Room.findOne({ roomId });
    const depth = room ? getUndoRedoDepth(room.drawingData, authorId) : { canUndo: false, canRedo: false };
    if (typeof ack === 'function') {
      ack({
        status: 'ok',
        canUndo: depth.canUndo,
        canRedo: depth.canRedo,
        _id: existing.drawingData[0]._id.toString()
      });
    }
    return;
  }

  const updatedRoom = await Room.findOneAndUpdate(
    { roomId },
    {
      $push: {
        drawingData: { type, userId: socket.id, authorId, opId, timestamp: Date.now() }
      },
      $set: { lastActivity: Date.now() }
    },
    { returnDocument: 'after' }
  );

  if (!updatedRoom) {
    console.warn(`Room ${roomId} not found when appending ${type} event from ${socket.id}`);
    if (typeof ack === 'function') ack({ status: 'error', reason: 'room-not-found' });
    return;
  }

  const savedEntry = updatedRoom.drawingData[updatedRoom.drawingData.length - 1];
  warnIfLogGrowingLarge(roomId, updatedRoom.drawingData.length);

  const depth = getUndoRedoDepth(updatedRoom.drawingData, authorId);
  const effect = getLastUndoRedoTarget(updatedRoom.drawingData);

  if (typeof ack === 'function') {
    ack({
      status: 'ok',
      canUndo: depth.canUndo,
      canRedo: depth.canRedo,
      _id: savedEntry ? savedEntry._id.toString() : null
    });
  }

  // Only broadcast if it actually changed something (not a no-op).
  if (effect) {
    socket.to(roomId).emit('undo-redo-applied', effect);
  }

  maybeCreateSnapshot(roomId, updatedRoom.drawingData); // fire-and-forget
}

module.exports = (io) => {
  const roomUsers = {};

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    let currentRoom = null;

    // Serializes this connection's writes to drawingData in arrival order.
    let writeChain = Promise.resolve();
    function serializeForSocket(fn) {
      writeChain = writeChain.then(fn, fn);
      return writeChain;
    }

    // Generous headroom over legitimate rates; only catches an actual flood.
    const allowDrawing = createRateLimiter(150, 1000);
    const allowCursorMove = createRateLimiter(150, 1000);
    // A manual, occasional UI action that does a real DB read — tighter budget than the two above.
    const allowTimelineRequest = createRateLimiter(5, 10000);

    socket.on('join-room', async (payload, ack) => {
      if (!validation.isValidJoinRoomPayload(payload)) {
        console.warn(`Rejecting malformed join-room payload from ${socket.id}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'invalid-payload' });
        return;
      }
      const { roomId, name, color, authorId, password } = payload;

      // Needs the room's passwordHash before registering the socket (await unavoidable); '' and undefined both mean "no password".
      try {
        // Atomic upsert avoids a find-then-save race (e.g. React StrictMode's double effect) hitting a duplicate-key error.
        const passwordHash = password ? await bcrypt.hash(password, PASSWORD_SALT_ROUNDS) : null;
        const rawResult = await Room.findOneAndUpdate(
          { roomId },
          { $setOnInsert: { roomId, passwordHash } },
          { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true }
        );
        const room = rawResult.value;

        if (rawResult.lastErrorObject && rawResult.lastErrorObject.upserted) {
          console.log(`Created new room in database: ${roomId}`);
        } else if (room.passwordHash) {
          const matches = password ? await bcrypt.compare(password, room.passwordHash) : false;
          if (!matches) {
            console.warn(`Rejecting join-room from ${socket.id}: wrong password for room ${roomId}`);
            if (typeof ack === 'function') ack({ status: 'error', reason: 'invalid-password' });
            return;
          }
        }
      } catch (err) {
        console.error('Error checking/creating room in database:', err);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'server-error' });
        return;
      }

      socket.join(roomId);
      currentRoom = roomId;
      console.log(`User ${socket.id} joined room ${roomId}`);

      if (!roomUsers[roomId]) {
        roomUsers[roomId] = new Map();
      }
      roomUsers[roomId].set(socket.id, { id: socket.id, name: name.trim(), color, isDrawing: false, authorId });

      console.log(`Room ${roomId} now has ${roomUsers[roomId].size} users`);

      broadcastPresence(io, roomUsers, roomId);
      if (typeof ack === 'function') ack({ status: 'ok' });
    });

    socket.on('leave-room', (roomId) => {
      if (!validation.isValidRoomId(roomId)) {
        console.warn(`Rejecting malformed leave-room roomId from ${socket.id}`);
        return;
      }

      console.log(`User ${socket.id} left room ${roomId}`);
      socket.leave(roomId);

      if (roomUsers[roomId]) {
        roomUsers[roomId].delete(socket.id);

        console.log(`Room ${roomId} now has ${roomUsers[roomId].size} users after leave`);

        broadcastPresence(io, roomUsers, roomId);

        if (roomUsers[roomId].size === 0) {
          delete roomUsers[roomId];
        }
      }

      if (currentRoom === roomId) {
        currentRoom = null;
      }
    });

    socket.on('presence-rename', (payload) => {
      if (!validation.isValidPresencePayload(payload)) {
        console.warn(`Rejecting malformed presence-rename payload from ${socket.id}`);
        return;
      }
      const { roomId, name, color } = payload;

      if (!roomUsers[roomId] || !roomUsers[roomId].has(socket.id)) {
        console.warn(`presence-rename from ${socket.id} for a room it isn't tracked in: ${roomId}`);
        return;
      }

      const existing = roomUsers[roomId].get(socket.id);
      roomUsers[roomId].set(socket.id, {
        id: socket.id,
        name: name.trim(),
        color,
        isDrawing: existing ? existing.isDrawing : false,
        authorId: existing ? existing.authorId : undefined
      });
      broadcastPresence(io, roomUsers, roomId);
    });

    socket.on('presence-activity', (payload) => {
      if (!validation.isValidActivityPayload(payload)) {
        console.warn(`Rejecting malformed presence-activity payload from ${socket.id}`);
        return;
      }
      const { roomId, isDrawing } = payload;

      if (!roomUsers[roomId] || !roomUsers[roomId].has(socket.id)) {
        return;
      }

      const existing = roomUsers[roomId].get(socket.id);
      roomUsers[roomId].set(socket.id, { ...existing, isDrawing });
      broadcastPresence(io, roomUsers, roomId);
    });

    socket.on('drawing', (payload, ack) => {
      if (!validation.isValidDrawingPayload(payload)) {
        console.warn(`Rejecting malformed drawing payload from ${socket.id}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'invalid-payload' });
        return;
      }
      const { roomId, drawingData, opId, authorId } = payload;

      if (!allowDrawing()) {
        console.warn(`Rate-limiting drawing events from ${socket.id}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'rate-limited' });
        return;
      }

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting drawing from ${socket.id}: authorId doesn't match what it registered for room ${roomId}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'unauthorized' });
        return;
      }

      // Only sanitized fields are ever persisted/broadcast, never the raw payload.
      const sanitizedData = validation.sanitizeDrawingData(drawingData);

      serializeForSocket(async () => {
        console.log(`Received drawing data in room ${roomId} from ${socket.id}`);

        const enhancedData = {
          ...sanitizedData,
          senderId: socket.id,
          authorId,
          opId
        };

        try {
          // De-dup guard: don't insert this opId twice on a retried send.
          if (opId) {
            const existing = await Room.findOne(
              { roomId, 'drawingData.opId': opId },
              { 'drawingData.$': 1 }
            );
            if (existing && existing.drawingData && existing.drawingData.length > 0) {
              const existingEntry = existing.drawingData[0];
              if (typeof ack === 'function') {
                ack({ status: 'ok', opId, _id: existingEntry._id.toString() });
              }
              socket.to(roomId).emit('drawing', enhancedData);
              return;
            }
          }

          const updatedRoom = await Room.findOneAndUpdate(
            { roomId },
            {
              $push: {
                drawingData: {
                  type: 'stroke',
                  data: sanitizedData,
                  timestamp: Date.now(),
                  userId: socket.id,
                  authorId,
                  opId
                }
              },
              $set: { lastActivity: Date.now() }
            },
            { returnDocument: 'after' }
          );

          if (!updatedRoom) {
            console.warn(`Room ${roomId} not found when saving drawing data from ${socket.id}`);
            if (typeof ack === 'function') ack({ status: 'error', reason: 'room-not-found' });
            return;
          }

          const savedEntry = updatedRoom.drawingData[updatedRoom.drawingData.length - 1];
          console.log(`Saved drawing data to database for room ${roomId}`);
          warnIfLogGrowingLarge(roomId, updatedRoom.drawingData.length);

          if (typeof ack === 'function') {
            ack({ status: 'ok', opId, _id: savedEntry ? savedEntry._id.toString() : null });
          }

          // Only a persisted stroke is broadcast, never a failed/unsaved one.
          socket.to(roomId).emit('drawing', enhancedData);

          maybeCreateSnapshot(roomId, updatedRoom.drawingData); // fire-and-forget
        } catch (err) {
          console.error('Error saving drawing data to database:', err);
          if (typeof ack === 'function') ack({ status: 'error', reason: 'persist-failed' });
        }
      });
    });

    const registerUndoRedoHandler = (eventName, type) => {
      socket.on(eventName, (payload, ack) => {
        if (!validation.isValidControlOpPayload(payload)) {
          console.warn(`Rejecting malformed ${eventName} payload from ${socket.id}`);
          if (typeof ack === 'function') ack({ status: 'error', reason: 'invalid-payload' });
          return;
        }
        const { roomId, authorId, opId } = payload;

        if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
          console.warn(`Rejecting ${eventName} from ${socket.id}: authorId doesn't match what it registered for room ${roomId}`);
          if (typeof ack === 'function') ack({ status: 'error', reason: 'unauthorized' });
          return;
        }

        serializeForSocket(() =>
          appendUndoRedo(type, roomId, authorId, opId, socket, ack).catch((err) => {
            console.error(`Error appending ${type} event:`, err);
            if (typeof ack === 'function') ack({ status: 'error', reason: 'persist-failed' });
          })
        );
      });
    };

    registerUndoRedoHandler('undo', 'undo');
    registerUndoRedoHandler('redo', 'redo');

    socket.on('undo-redo-state', async (payload, ack) => {
      if (!validation.isValidRoomAuthorPayload(payload)) {
        console.warn(`Rejecting malformed undo-redo-state payload from ${socket.id}`);
        if (typeof ack === 'function') ack({ canUndo: false, canRedo: false });
        return;
      }
      const { roomId, authorId } = payload;

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting undo-redo-state from ${socket.id}: authorId doesn't match what it registered for room ${roomId}`);
        if (typeof ack === 'function') ack({ canUndo: false, canRedo: false });
        return;
      }

      try {
        const room = await Room.findOne({ roomId });
        const depth = room ? getUndoRedoDepth(room.drawingData, authorId) : { canUndo: false, canRedo: false };
        if (typeof ack === 'function') ack(depth);
      } catch (err) {
        console.error('Error computing undo/redo state:', err);
        if (typeof ack === 'function') ack({ canUndo: false, canRedo: false });
      }
    });

    // sinceId lets a reconnecting client fetch only what it's missing.
    socket.on('sync-since', async (payload) => {
      if (!validation.isValidSyncSincePayload(payload)) {
        console.warn(`Rejecting malformed sync-since payload from ${socket.id}`);
        socket.emit('sync-response', { ops: [], full: true, error: 'invalid-payload' });
        return;
      }
      const { roomId, sinceId, authorId } = payload;

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting sync-since from ${socket.id}: not registered for room ${roomId}`);
        socket.emit('sync-response', { ops: [], full: true, error: 'unauthorized' });
        return;
      }

      try {
        if (!sinceId) {
          const ops = await loadFullState(roomId);
          console.log(`Sending full sync (${ops.length} items) to ${socket.id}`);
          socket.emit('sync-response', { ops, full: true });
          return;
        }

        // Let MongoDB compare native ObjectId (BSON) ordering directly.
        const sinceObjectId = new mongoose.Types.ObjectId(sinceId);
        const deltaAgg = await Room.aggregate([
          { $match: { roomId } },
          {
            $project: {
              drawingData: {
                $filter: {
                  input: '$drawingData',
                  as: 'item',
                  cond: { $gt: ['$$item._id', sinceObjectId] }
                }
              }
            }
          }
        ]);

        if (deltaAgg.length === 0) {
          socket.emit('sync-response', { ops: [], full: true });
          return;
        }

        const deltaRaw = deltaAgg[0].drawingData;
        const hasReshapingEvent = deltaRaw.some(item => RESHAPING_TYPES.has(item.type));

        if (hasReshapingEvent) {
          const ops = await loadFullState(roomId);
          console.log(`Delta range contains a reshaping event; sending full sync (${ops.length} items) to ${socket.id}`);
          socket.emit('sync-response', { ops, full: true });
          return;
        }

        const delta = deltaRaw.filter(item => item.type === 'stroke');
        console.log(`Sending delta sync (${delta.length} items) to ${socket.id}`);
        socket.emit('sync-response', { ops: delta, full: false });
      } catch (err) {
        console.error('Error syncing drawings from database:', err);
        socket.emit('sync-response', { ops: [], full: true });
      }
    });

    // Read-only: full raw event log for history scrubbing — shows everything, undo/clear included, since room history is shared, not per-author-private.
    socket.on('get-room-timeline', async (payload, ack) => {
      if (!validation.isValidRoomAuthorPayload(payload)) {
        console.warn(`Rejecting malformed get-room-timeline payload from ${socket.id}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'invalid-payload' });
        return;
      }
      const { roomId, authorId } = payload;

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting get-room-timeline from ${socket.id}: not registered for room ${roomId}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'unauthorized' });
        return;
      }

      if (!allowTimelineRequest()) {
        console.warn(`Rate-limiting get-room-timeline from ${socket.id}`);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'rate-limited' });
        return;
      }

      try {
        const room = await Room.findOne({ roomId });
        if (!room) {
          if (typeof ack === 'function') ack({ status: 'error', reason: 'room-not-found' });
          return;
        }

        // Caps the payload for very large rooms — reuses the same threshold that flags them elsewhere.
        if (room.drawingData.length > DRAWING_LOG_WARN_THRESHOLD) {
          if (typeof ack === 'function') ack({ status: 'error', reason: 'room-too-large' });
          return;
        }

        const events = room.drawingData.map(item => ({
          type: item.type,
          data: item.data,
          authorId: item.authorId,
          opId: item.opId,
          timestamp: item.timestamp
        }));
        if (typeof ack === 'function') ack({ status: 'ok', events });
      } catch (err) {
        console.error(`Error loading timeline for room ${roomId}:`, err);
        if (typeof ack === 'function') ack({ status: 'error', reason: 'server-error' });
      }
    });

    socket.on('cursor-move', (payload) => {
      if (!validation.isValidCursorPayload(payload)) {
        return;
      }
      if (!allowCursorMove()) {
        return;
      }
      const { roomId, position, authorId } = payload;

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        return;
      }

      socket.to(roomId).emit('cursor-move', {
        userId: socket.id,
        position
      });
    });

    socket.on('clear-canvas', (payload) => {
      if (!validation.isValidRoomAuthorPayload(payload)) {
        console.warn(`Rejecting malformed clear-canvas payload from ${socket.id}`);
        return;
      }
      const { roomId, authorId } = payload;

      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting clear-canvas from ${socket.id}: not registered for room ${roomId}`);
        return;
      }

      serializeForSocket(async () => {
        try {
          const updatedRoom = await Room.findOneAndUpdate(
            { roomId },
            {
              $push: {
                drawingData: {
                  type: 'clear-canvas',
                  userId: socket.id,
                  timestamp: Date.now()
                }
              },
              $set: { lastActivity: Date.now() }
            },
            { returnDocument: 'after' }
          );
          console.log(`Appended clear-canvas event for room ${roomId}`);

          if (updatedRoom) {
            maybeCreateSnapshot(roomId, updatedRoom.drawingData); // fire-and-forget
          }
        } catch (err) {
          console.error('Error clearing canvas data in database:', err);
        }

        socket.to(roomId).emit('clear-canvas');
      });
    });

    socket.on('clear-user-drawings', (payload) => {
      if (!validation.isValidRoomAuthorPayload(payload)) {
        console.warn(`Rejecting malformed clear-user-drawings payload from ${socket.id}`);
        return;
      }
      const { roomId, authorId } = payload;

      // Self-service only — never another author's drawings.
      if (getRegisteredAuthorId(roomUsers, roomId, socket.id) !== authorId) {
        console.warn(`Rejecting clear-user-drawings from ${socket.id}: authorId doesn't match what it registered for room ${roomId}`);
        return;
      }

      serializeForSocket(async () => {
        try {
          const updatedRoom = await Room.findOneAndUpdate(
            { roomId },
            {
              $push: {
                drawingData: {
                  type: 'clear-user',
                  userId: socket.id,
                  data: { targetAuthorId: authorId },
                  timestamp: Date.now()
                }
              },
              $set: { lastActivity: Date.now() }
            },
            { returnDocument: 'after' }
          );

          if (!updatedRoom) {
            console.warn(`Room ${roomId} not found when clearing user drawings`);
            return;
          }

          console.log(`Appended clear-user event for ${authorId} in room ${roomId}`);
          io.to(roomId).emit('sync-response', { ops: reconstructState(updatedRoom.drawingData), full: true });

          maybeCreateSnapshot(roomId, updatedRoom.drawingData); // fire-and-forget
        } catch (err) {
          console.error('Error clearing user drawings in database:', err);
        }
      });
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);

      if (currentRoom && roomUsers[currentRoom]) {
        roomUsers[currentRoom].delete(socket.id);

        console.log(`Room ${currentRoom} now has ${roomUsers[currentRoom].size} users after disconnect`);

        broadcastPresence(io, roomUsers, currentRoom);

        if (roomUsers[currentRoom].size === 0) {
          delete roomUsers[currentRoom];
        }
      }

      // Stops chaining further work onto this connection's write queue.
      writeChain = Promise.resolve();
    });
  });
};
