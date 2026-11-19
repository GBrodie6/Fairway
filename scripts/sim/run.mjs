// Run balance cells on worker threads (scripts/sim/worker.mjs): N paired rounds per cell, W
// workers. Returns, per cell, its rounds sorted by round index. Used by balance.mjs and by
// tests/pros.test.js.
import { Worker } from 'node:worker_threads';

export function runCells(cells, N, W = 4, onProgress = null) {
  const tasks = [];
  cells.forEach((c, ci) => { for (let i = 0; i < N; i++) tasks.push({ cell: ci, round: i }); });
  const parts = Array.from({ length: W }, () => []);
  tasks.forEach((t, i) => parts[i % W].push(t));
  let doneN = 0;
  return Promise.all(parts.filter((p) => p.length).map((p) => new Promise((res, rej) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { tasks: p, cells } });
    w.on('message', (m) => {
      if (m.progress) { doneN += 10; if (onProgress) onProgress(doneN, tasks.length); }
      if (m.done) res(m.done);
    });
    w.on('error', rej);
  }))).then((r) => { const flat = r.flat(); return cells.map((c, ci) => flat.filter((x) => x.cell === ci).sort((a, b) => a.round - b.round)); });
}
