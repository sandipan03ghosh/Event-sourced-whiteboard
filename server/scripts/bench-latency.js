// Measures emit->ack round-trip latency for the 'drawing' event under N
// concurrent clients sharing one room. Requires the server and MongoDB to be
// running. Writes real events to the bench room — see cleanup note at the end.
const { io } = require('socket.io-client');

const URL = process.env.BENCH_URL || 'http://127.0.0.1:5000';
const CLIENTS = parseInt(process.env.BENCH_CLIENTS, 10) || 25;
const EVENTS_PER_CLIENT = parseInt(process.env.BENCH_EVENTS, 10) || 40;
// 20 strokes/sec/client — comfortably under the server's 150/sec limiter.
const INTERVAL_MS = parseInt(process.env.BENCH_INTERVAL_MS, 10) || 50;
const ROOM_ID = process.env.BENCH_ROOM || 'BENCH01';
const ACK_TIMEOUT_MS = 15000;

const STROKE_COLORS = ['black', 'red', 'blue', 'green'];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function connectClient(index, roomId = ROOM_ID) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 10000 });
    const authorId = `bench_author_${index}`;

    socket.on('connect_error', err => reject(new Error(`connect failed: ${err.message}`)));
    socket.on('connect', () => {
      socket.emit('join-room', {
        roomId,
        name: `bench${index}`,
        color: '#3366cc',
        authorId,
        password: ''
      }, ack => {
        if (ack && ack.status === 'ok') resolve({ socket, authorId, roomId });
        else reject(new Error(`join rejected: ${ack && ack.reason}`));
      });
    });
  });
}

function drawOnce(client, seq) {
  return new Promise(resolve => {
    const x = Math.round(Math.random() * 1000);
    const y = Math.round(Math.random() * 600);
    const start = process.hrtime.bigint();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ms: ACK_TIMEOUT_MS, ok: false, reason: 'ack-timeout' });
    }, ACK_TIMEOUT_MS);

    client.socket.emit('drawing', {
      roomId: client.roomId,
      drawingData: { x0: x, y0: y, x1: x + 5, y1: y + 5, color: STROKE_COLORS[seq % 4], width: 3 },
      opId: `${client.authorId}_${seq}_${Date.now()}`,
      authorId: client.authorId
    }, ack => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ms: Number(process.hrtime.bigint() - start) / 1e6,
        ok: Boolean(ack && ack.status === 'ok'),
        reason: ack && ack.reason
      });
    });
  });
}

// Fires on a fixed interval without waiting for each ack, so latency is
// measured under sustained load rather than one request at a time.
async function runClient(client) {
  const results = [];
  const pending = [];
  for (let i = 0; i < EVENTS_PER_CLIENT; i++) {
    pending.push(drawOnce(client, i).then(r => results.push(r)));
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
  await Promise.all(pending);
  return results;
}

module.exports = { connectClient, drawOnce, percentile, ROOM_ID };

// Only runs the full single-stage benchmark when executed directly
// (`node bench-latency.js`) — bench-capacity.js requires this file just for
// the helpers above, and must not trigger this run as a side effect.
if (require.main === module) {
  (async () => {
    console.log(`Connecting ${CLIENTS} clients to ${URL} (room ${ROOM_ID})...`);
    const clients = [];
    for (let i = 0; i < CLIENTS; i++) {
      clients.push(await connectClient(i));
    }

    console.log(`Connected. Each sending ${EVENTS_PER_CLIENT} strokes at ${(1000 / INTERVAL_MS).toFixed(0)}/sec...`);
    const started = Date.now();
    const all = (await Promise.all(clients.map(runClient))).flat();
    const elapsedSec = (Date.now() - started) / 1000;

    clients.forEach(c => c.socket.disconnect());

    const ok = all.filter(r => r.ok);
    const failed = all.filter(r => !r.ok);
    const sorted = ok.map(r => r.ms).sort((a, b) => a - b);

    console.log(`\n  Concurrent clients : ${CLIENTS}`);
    console.log(`  Offered rate       : ${(CLIENTS * (1000 / INTERVAL_MS)).toFixed(0)} strokes/sec across all clients`);
    console.log(`  Strokes acked      : ${ok.length} / ${all.length}`);
    if (failed.length) {
      const reasons = {};
      failed.forEach(f => { reasons[f.reason || 'unknown'] = (reasons[f.reason || 'unknown'] || 0) + 1; });
      console.log(`  Failed             : ${failed.length} ${JSON.stringify(reasons)}`);
    }
    console.log(`  Throughput         : ${(ok.length / elapsedSec).toFixed(0)} acked strokes/sec`);
    console.log(`  Ack latency p50    : ${percentile(sorted, 50).toFixed(1)} ms`);
    console.log(`  Ack latency p95    : ${percentile(sorted, 95).toFixed(1)} ms`);
    console.log(`  Ack latency p99    : ${percentile(sorted, 99).toFixed(1)} ms`);
    console.log(`  Ack latency max    : ${sorted.length ? sorted[sorted.length - 1].toFixed(1) : 0} ms`);
    console.log(`\n  Note: clients and server on the same machine — this is localhost, not network latency.`);
    console.log(`  Cleanup: mongosh -> use canvassync -> db.rooms.deleteOne({ roomId: "${ROOM_ID}" })\n`);

    process.exit(0);
  })().catch(err => {
    console.error('Benchmark failed:', err.message);
    process.exit(1);
  });
}
