// Measures delta-sync payload size against full-sync payload size, using the
// same reconstructState the server uses. Pure computation — no DB, no network.
const mongoose = require('mongoose');
const { reconstructState } = require('../utils/replay');

const STROKE_COLORS = ['black', 'red', 'blue', 'green'];

// Mirrors the shape actually persisted in Room.drawingData and sent over the wire.
function makeStrokeEvent(i) {
  return {
    _id: new mongoose.Types.ObjectId(),
    type: 'stroke',
    data: {
      x0: Math.round(Math.random() * 1600),
      y0: Math.round(Math.random() * 900),
      x1: Math.round(Math.random() * 1600),
      y1: Math.round(Math.random() * 900),
      color: STROKE_COLORS[i % STROKE_COLORS.length],
      width: (i % 10) + 1
    },
    userId: `socket_${i % 4}`,
    authorId: `author_${i % 4}`,
    opId: `op_${i}`,
    timestamp: new Date()
  };
}

function bytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function run(totalEvents, missedCounts) {
  const log = Array.from({ length: totalEvents }, (_, i) => makeStrokeEvent(i));

  // No sinceId: the client gets the whole derived visible state.
  const fullOps = reconstructState(log);
  const fullBytes = bytes({ ops: fullOps, full: true });

  console.log(`\nRoom with ${totalEvents.toLocaleString()} events`);
  console.log(`Full sync payload: ${fmtKB(fullBytes)} (${fullOps.length} strokes)\n`);
  console.log('  missed events | delta payload | reduction vs full sync');
  console.log('  --------------|---------------|-----------------------');

  missedCounts.forEach(missed => {
    // With a sinceId: only events after it, stroke-type only.
    const delta = log.slice(totalEvents - missed).filter(e => e.type === 'stroke');
    const deltaBytes = bytes({ ops: delta, full: false });
    const reduction = ((1 - deltaBytes / fullBytes) * 100).toFixed(1);
    console.log(
      `  ${String(missed).padStart(13)} | ${fmtKB(deltaBytes).padStart(13)} | ${`${reduction}%`.padStart(21)}`
    );
  });
}

run(2000, [10, 50, 200, 1000]);
run(5000, [10, 50, 200, 1000]);

console.log('\nReduction depends entirely on how much the client missed — quote the scenario with the number.\n');
