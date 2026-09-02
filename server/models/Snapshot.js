const mongoose = require('mongoose');

// A derived cache only — always safe to delete, falls back to full replay.
const SnapshotSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  // Schema-format version of `state`'s shape.
  snapshotVersion: { type: Number, required: true },
  // _id of the last drawingData event folded into `state`.
  lastAppliedEventId: { type: String, required: true },
  // drawingData.length when this snapshot was taken.
  eventCountAtSnapshot: { type: Number, required: true },
  // Reconstructed, currently-visible stroke list.
  state: { type: Array, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Snapshot', SnapshotSchema);
