// Ramps concurrent client count through stages to find where this server's
// write path (Socket.IO -> MongoDB $push) starts to degrade. Reuses
// bench-latency.js's connect/draw helpers; each stage uses a fresh room so a
// growing drawingData array doesn't confound the concurrency measurement.
const { connectClient, drawOnce, percentile } = require('./bench-latency');

const EVENTS_PER_CLIENT = parseInt(process.env.BENCH_EVENTS, 10) || 20;
const INTERVAL_MS = parseInt(process.env.BENCH_INTERVAL_MS, 10) || 50;
const STAGES = (process.env.BENCH_STAGES || '10,25,50,100,150,200')
  .split(',')
  .map(n => parseInt(n.trim(), 10));

// "Healthy" thresholds — tune to whatever bar the number needs to defend.
const MAX_FAILURE_RATE = 0.01; // 1%
const MAX_P95_MS = 300;

async function runStage(clientCount, stageIndex) {
  const roomId = `CAP${String(stageIndex).padStart(2, '0')}`;
  const clients = [];
  for (let i = 0; i < clientCount; i++) {
    clients.push(await connectClient(i, roomId));
  }

  const results = [];
  const pending = [];
  const started = Date.now();
  clients.forEach(client => {
    for (let i = 0; i < EVENTS_PER_CLIENT; i++) {
      pending.push(
        new Promise(resolve => setTimeout(resolve, i * INTERVAL_MS))
          .then(() => drawOnce(client, i))
          .then(r => results.push(r))
      );
    }
  });
  await Promise.all(pending);
  const elapsedSec = (Date.now() - started) / 1000;

  clients.forEach(c => c.socket.disconnect());

  const ok = results.filter(r => r.ok);
  const failRate = results.length ? 1 - ok.length / results.length : 1;
  const sorted = ok.map(r => r.ms).sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const healthy = failRate <= MAX_FAILURE_RATE && p95 <= MAX_P95_MS;

  return { clientCount, roomId, total: results.length, ok: ok.length, failRate, p50, p95, throughput: ok.length / elapsedSec, healthy };
}

(async () => {
  console.log(`Ramping concurrency: ${STAGES.join(' -> ')} clients, ${EVENTS_PER_CLIENT} strokes each`);
  console.log(`"Healthy" = <=${MAX_FAILURE_RATE * 100}% failures and p95 <= ${MAX_P95_MS}ms\n`);
  console.log('  clients | acked/total | fail% | p50 ms | p95 ms | acked/sec | status');
  console.log('  --------|-------------|-------|--------|--------|-----------|--------');

  let lastHealthy = 0;
  for (let i = 0; i < STAGES.length; i++) {
    const n = STAGES[i];
    try {
      const r = await runStage(n, i);
      console.log(
        `  ${String(n).padStart(7)} | ${`${r.ok}/${r.total}`.padStart(11)} | ${(r.failRate * 100).toFixed(1).padStart(5)} | ${r.p50.toFixed(0).padStart(6)} | ${r.p95.toFixed(0).padStart(6)} | ${r.throughput.toFixed(0).padStart(9)} | ${r.healthy ? 'OK' : 'DEGRADED'}`
      );
      if (r.healthy) {
        lastHealthy = n;
      } else {
        console.log(`\nDegraded past the threshold at ${n} clients. Stopping ramp.`);
        break;
      }
    } catch (err) {
      console.log(`  ${String(n).padStart(7)} | connection/setup failed: ${err.message}`);
      break;
    }
  }

  console.log(`\nLast stage within threshold: ${lastHealthy} concurrent clients.`);
  console.log('Cleanup: mongosh --eval \'use canvassync; db.rooms.deleteMany({ roomId: /^CAP/ })\'\n');
  process.exit(0);
})().catch(err => {
  console.error('Capacity ramp failed:', err.message);
  process.exit(1);
});
