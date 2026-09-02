const mongoose = require('mongoose');

const ROOM_ID_MIN_LENGTH = 6;
const ROOM_ID_MAX_LENGTH = 8;
const ROOM_ID_PATTERN = /^[A-Za-z0-9]+$/;

const MAX_NAME_LENGTH = 50;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// Must match Whiteboard.jsx's stroke-color <select> options.
const STROKE_COLORS = ['black', 'red', 'blue', 'green'];

// Infinite canvas: coordinates can be arbitrarily large as a user pans.
const MAX_WORLD_COORDINATE = 1_000_000;
// Caps a single segment's length, independent of the per-coordinate bound.
const MAX_SEGMENT_LENGTH = 10_000;
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 10;
const MAX_OP_ID_LENGTH = 100;
const MAX_AUTHOR_ID_LENGTH = 100;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' &&
    roomId.length >= ROOM_ID_MIN_LENGTH &&
    roomId.length <= ROOM_ID_MAX_LENGTH &&
    ROOM_ID_PATTERN.test(roomId);
}

function isValidName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

function isValidHexColor(color) {
  return typeof color === 'string' && HEX_COLOR_PATTERN.test(color);
}

function isValidStrokeColor(color) {
  return typeof color === 'string' && STROKE_COLORS.includes(color);
}

function isFiniteNumberInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isValidCoordinate(value) {
  return isFiniteNumberInRange(value, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
}

function isValidLineWidth(value) {
  return isFiniteNumberInRange(value, MIN_LINE_WIDTH, MAX_LINE_WIDTH);
}

function isValidOpId(opId) {
  return opId === undefined ||
    (typeof opId === 'string' && opId.length > 0 && opId.length <= MAX_OP_ID_LENGTH);
}

// Like isValidOpId, but required — undo/redo dedup depends on it.
function isValidRequiredOpId(opId) {
  return typeof opId === 'string' && opId.length > 0 && opId.length <= MAX_OP_ID_LENGTH;
}

function isValidAuthorId(authorId) {
  return typeof authorId === 'string' && authorId.length > 0 && authorId.length <= MAX_AUTHOR_ID_LENGTH;
}

function isValidObjectIdString(id) {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

function isValidDrawingData(data) {
  if (!isPlainObject(data)) return false;
  if (
    !isValidCoordinate(data.x0) ||
    !isValidCoordinate(data.y0) ||
    !isValidCoordinate(data.x1) ||
    !isValidCoordinate(data.y1) ||
    !isValidStrokeColor(data.color) ||
    !isValidLineWidth(data.width)
  ) {
    return false;
  }

  const dx = data.x1 - data.x0;
  const dy = data.y1 - data.y0;
  return Math.sqrt(dx * dx + dy * dy) <= MAX_SEGMENT_LENGTH;
}

// Strips drawingData down to the fields isValidDrawingData checked; always
// persist/broadcast this, never the raw payload.
function sanitizeDrawingData(data) {
  return {
    x0: data.x0,
    y0: data.y0,
    x1: data.x1,
    y1: data.y1,
    color: data.color,
    width: data.width
  };
}

function isValidDrawingPayload(payload) {
  if (!isPlainObject(payload)) return false;
  return isValidRoomId(payload.roomId) &&
    isValidDrawingData(payload.drawingData) &&
    isValidOpId(payload.opId) &&
    isValidAuthorId(payload.authorId);
}

// For 'undo'/'redo': roomId + required opId + the target author.
function isValidControlOpPayload(payload) {
  if (!isPlainObject(payload)) return false;
  return isValidRoomId(payload.roomId) &&
    isValidRequiredOpId(payload.opId) &&
    isValidAuthorId(payload.authorId);
}

// For 'clear-user-drawings' and 'undo-redo-state': roomId + target author.
function isValidRoomAuthorPayload(payload) {
  if (!isPlainObject(payload)) return false;
  return isValidRoomId(payload.roomId) && isValidAuthorId(payload.authorId);
}

function isValidPresencePayload(payload) {
  if (!isPlainObject(payload)) return false;
  return isValidRoomId(payload.roomId) &&
    isValidName(payload.name) &&
    isValidHexColor(payload.color);
}

// join-room: presence fields + the authorId this socket registers.
function isValidJoinRoomPayload(payload) {
  return isValidPresencePayload(payload) && isValidAuthorId(payload.authorId);
}

function isValidCursorPayload(payload) {
  if (!isPlainObject(payload)) return false;
  const { roomId, position } = payload;
  return isValidRoomId(roomId) &&
    isPlainObject(position) &&
    isValidCoordinate(position.x) &&
    isValidCoordinate(position.y);
}

function isValidSyncSincePayload(payload) {
  if (!isPlainObject(payload)) return false;
  const { roomId, sinceId } = payload;
  if (!isValidRoomId(roomId)) return false;
  return sinceId === undefined || sinceId === null || isValidObjectIdString(sinceId);
}

function isValidActivityPayload(payload) {
  if (!isPlainObject(payload)) return false;
  return isValidRoomId(payload.roomId) && typeof payload.isDrawing === 'boolean';
}

module.exports = {
  isValidRoomId,
  isValidName,
  isValidHexColor,
  isValidStrokeColor,
  isValidCoordinate,
  isValidLineWidth,
  isValidOpId,
  isValidRequiredOpId,
  isValidAuthorId,
  isValidObjectIdString,
  isValidDrawingData,
  sanitizeDrawingData,
  isValidDrawingPayload,
  isValidControlOpPayload,
  isValidRoomAuthorPayload,
  isValidPresencePayload,
  isValidJoinRoomPayload,
  isValidCursorPayload,
  isValidSyncSincePayload,
  isValidActivityPayload
};
