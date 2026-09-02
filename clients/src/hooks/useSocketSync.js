import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';
import { getIdentity, setName as setStoredName } from '../identity';
import { useToast } from '../context/ToastContext';

const ACK_TIMEOUT_MS = 4000;

// Centralizes join/reconnect, presence, resync, and ack-reconciled control ops.
export default function useSocketSync(roomId, onSyncOps) {
  const { showToast } = useToast();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [presence, setPresence] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const lastSyncedIdRef = useRef(null);
  const pendingOpsRef = useRef(new Map()); // opId -> { eventName, payload, timer, onAck }
  const syncInFlightRef = useRef(false);
  const onSyncOpsRef = useRef(onSyncOps);
  onSyncOpsRef.current = onSyncOps;

  const requestSync = useCallback((rid) => {
    syncInFlightRef.current = true;
    setIsSyncing(true);
    socket.emit('sync-since', { roomId: rid, sinceId: lastSyncedIdRef.current });
  }, []);

  // Shared ack handler for control ops; reconciles via full resync on failure.
  const emitPendingOp = useCallback((eventName, opId, payload, onAck) => {
    socket.emit(eventName, payload, (ack) => {
      const entry = pendingOpsRef.current.get(opId);
      if (entry) clearTimeout(entry.timer);
      pendingOpsRef.current.delete(opId);
      setPendingCount(pendingOpsRef.current.size);

      if (ack && ack.status === 'ok') {
        if (ack._id) lastSyncedIdRef.current = ack._id;
        if (onAck) onAck(ack);
        return;
      }

      // Force a full resync on failure; skip if one's already in flight.
      console.warn(`${eventName} op ${opId} failed to persist (${ack && ack.reason}); reconciling via full resync`);
      showToast("Some changes couldn't be saved — reconciling…", 'warning', 'resync');
      lastSyncedIdRef.current = null;
      if (!syncInFlightRef.current) {
        requestSync(payload.roomId);
      }
    });
  }, [requestSync, showToast]);

  const sendControlOp = useCallback((eventName, payload, onAck) => {
    const { opId } = payload;

    // Surfaces a stuck op; it still gets flushed on reconnect either way.
    const timer = setTimeout(() => {
      console.warn(`${eventName} op ${opId} not acknowledged after ${ACK_TIMEOUT_MS}ms; will retry on reconnect`);
      showToast('Still trying to save your last change…', 'warning', 'ack-timeout');
    }, ACK_TIMEOUT_MS);
    pendingOpsRef.current.set(opId, { eventName, payload, timer, onAck });
    setPendingCount(pendingOpsRef.current.size);

    emitPendingOp(eventName, opId, payload, onAck);
  }, [emitPendingOp, showToast]);

  const flushPending = useCallback(() => {
    pendingOpsRef.current.forEach(({ timer }) => clearTimeout(timer));
    const toFlush = Array.from(pendingOpsRef.current.entries());
    toFlush.forEach(([opId, { eventName, payload, onAck }]) => emitPendingOp(eventName, opId, payload, onAck));
  }, [emitPendingOp]);

  const sendDrawing = useCallback((rid, drawingData) => {
    const identity = getIdentity();
    const opId = crypto.randomUUID();
    const payload = { roomId: rid, drawingData, opId, authorId: identity.authorId };

    // Optimistic flip: a new stroke always enables undo, clears redo.
    setCanUndo(true);
    setCanRedo(false);

    sendControlOp('drawing', payload);

    // Lets the caller mirror this stroke into its own optimistic ops list.
    return { opId, authorId: identity.authorId };
  }, [sendControlOp]);

  const sendUndo = useCallback(() => {
    if (!roomId) return;
    const identity = getIdentity();
    const payload = { roomId, opId: crypto.randomUUID(), authorId: identity.authorId };
    sendControlOp('undo', payload, (ack) => {
      setCanUndo(Boolean(ack.canUndo));
      setCanRedo(Boolean(ack.canRedo));
    });
  }, [roomId, sendControlOp]);

  const sendRedo = useCallback(() => {
    if (!roomId) return;
    const identity = getIdentity();
    const payload = { roomId, opId: crypto.randomUUID(), authorId: identity.authorId };
    sendControlOp('redo', payload, (ack) => {
      setCanUndo(Boolean(ack.canUndo));
      setCanRedo(Boolean(ack.canRedo));
    });
  }, [roomId, sendControlOp]);

  // Read-only; simply re-queried on every join/reconnect.
  const queryUndoRedoState = useCallback((rid) => {
    const identity = getIdentity();
    socket.emit('undo-redo-state', { roomId: rid, authorId: identity.authorId }, (result) => {
      if (result) {
        setCanUndo(Boolean(result.canUndo));
        setCanRedo(Boolean(result.canRedo));
      }
    });
  }, []);

  const joinRoom = useCallback((rid) => {
    const identity = getIdentity();
    socket.emit('join-room', { roomId: rid, name: identity.name, color: identity.color, authorId: identity.authorId });
  }, []);

  const renamePresence = useCallback((newName) => {
    if (!roomId) return;
    const identity = setStoredName(newName);
    socket.emit('presence-rename', { roomId, name: identity.name, color: identity.color });
  }, [roomId]);

  const setDrawingActivity = useCallback((isDrawing) => {
    if (!roomId) return;
    socket.emit('presence-activity', { roomId, isDrawing });
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    const handleSyncResponse = ({ ops, full }) => {
      if (ops && ops.length > 0) {
        lastSyncedIdRef.current = ops[ops.length - 1]._id;
      }
      onSyncOpsRef.current(ops || [], full);
      syncInFlightRef.current = false;
      setIsSyncing(false);
    };

    const handlePresenceUpdate = (roster) => {
      setPresence(roster || []);
    };

    const handleConnect = () => {
      setIsConnected(true);
      joinRoom(roomId);
      flushPending();
      requestSync(roomId);
      queryUndoRedoState(roomId);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    socket.on('sync-response', handleSyncResponse);
    socket.on('presence-update', handlePresenceUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Initial join, since handleConnect only fires on connect/reconnect.
    joinRoom(roomId);
    requestSync(roomId);
    queryUndoRedoState(roomId);

    return () => {
      socket.off('sync-response', handleSyncResponse);
      socket.off('presence-update', handlePresenceUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);

      // Prevents stray ack-timeout warnings after unmount/room change.
      pendingOpsRef.current.forEach(({ timer }) => clearTimeout(timer));
      pendingOpsRef.current.clear();
      setPendingCount(0);
    };
  }, [roomId, flushPending, requestSync, joinRoom, queryUndoRedoState]);

  return {
    isConnected,
    isSyncing,
    pendingCount,
    sendDrawing,
    presence,
    renamePresence,
    setDrawingActivity,
    canUndo,
    canRedo,
    sendUndo,
    sendRedo
  };
}
