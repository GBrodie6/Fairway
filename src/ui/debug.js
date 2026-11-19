// ?debug overlay: frame time, draw calls, triangles, texture memory, active tier, exposure, the
// display's refresh rate and the frame rate cap, and the frame time by tier at 1080p and 1440p
// (render/bench.js: the button runs it, ?debug&bench runs it on load).
import { BENCH_SIZES } from '../render/bench.js';
import { TIER_ORDER } from '../core/quality.js';

const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB');

// Average, slowest 5 percent and slowest 1 percent of the recent frame times (ms). Pure.
export function frameSummary(ms) {
  const a = Array.from(ms).filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return { avg: 0, p95: 0, p99: 0, n: 0 };
  const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { avg: a.reduce((s, x) => s + x, 0) / a.length, p95: at(0.95), p99: at(0.99), n: a.length };
}

// The bench table as text. Pure.
export function benchTable(r) {
  if (!r || !r.rows) return 'bench: not run (press Run benchmark, or open with ?debug&bench)';
  const pad = (x, n) => String(x).padEnd(n);
  const head = `bench ms per frame (fps)  ${BENCH_SIZES.map((s) => pad(s.id, 15)).join('')}`;
  const rows = TIER_ORDER.filter((t) => r.rows[t]).map((t) => `  ${pad(t, 23)}${BENCH_SIZES.map((s) => { const c = r.rows[t][s.id]; return pad(c ? `${c.ms.toFixed(1)} (${c.fps.toFixed(0)})` : '--', 15); }).join('')}`);
  return [head, ...rows, `  ${r.method}; ${String(r.gpu || 'GPU not reported').slice(0, 60)}; ${String(r.at).slice(0, 16).replace('T', ' ')}`].join('\n');
}

export function createDebugOverlay(root, { engine, loop, app, getExtra }) {
  const box = document.createElement('div');
  box.id = 'fw-debug-box';
  box.style.cssText = 'position:absolute;left:8px;top:8px;z-index:40;pointer-events:none;max-width:92vw';
  const el = document.createElement('pre');
  el.id = 'fw-debug';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'margin:0;padding:8px 10px;' +
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#d8f5d0;background:rgba(6,14,10,0.72);' +
    'border-radius:8px;white-space:pre;overflow:hidden';
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'fw-debug-bench';
  run.textContent = 'Run benchmark';
  run.title = 'Frame time by tier at 1080p and 1440p (takes a little while; the picture changes while it runs)';
  run.style.cssText = 'pointer-events:auto;margin-top:6px;font:12px/1 ui-monospace,Menlo,Consolas,monospace;padding:6px 10px;border-radius:6px;border:1px solid rgba(216,245,208,0.4);background:rgba(6,14,10,0.8);color:#d8f5d0;cursor:pointer';
  box.append(el, run);
  root.appendChild(box);
  let acc = 0, status = '';
  const overlay = {
    el,
    async runBench() {
      if (!app || !app.bench || app.benchRunning) return null;
      run.disabled = true; run.textContent = 'Benchmark running...';
      try { return await app.bench({ onProgress: (s) => { status = s; } }); }
      finally { status = ''; run.disabled = false; run.textContent = 'Run benchmark'; overlay.update(1); }
    },
    update(dt) {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = engine.stats, ls = loop.stats, mem = engine.memoryEstimate();
      const fs = frameSummary(ls.frameMs || []);
      const sys = Object.entries(ls.perSystem).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ');
      const extra = getExtra ? getExtra() : '';
      el.textContent =
        `tier ${engine.tier.id}  shadows ${engine.tier.shadowLevel || 'auto'}  ${engine.width}x${engine.height} @${engine.pixelRatio.toFixed(2)}  ${engine.orientation}\n` +
        `frame ${fs.avg.toFixed(1)} ms avg  ${fs.p95.toFixed(1)} slowest 5%  ${fs.p99.toFixed(1)} slowest 1%  ${ls.fps.toFixed(0)} fps  cpu ${ls.cpuAvg.toFixed(1)} ms\n` +
        `display ${(ls.refreshHz || 60).toFixed(0)} Hz  cap ${ls.cap ? ls.cap + ' fps' : 'none'}  vsync ${engine.lowLatency ? 'off (low-latency hint)' : 'on'}  scale ${Math.round((engine.renderScale || 1) * 100)}%\n` +
        `draws ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k  geo ${s.geometries}  tex ${s.textures}  prog ${s.programs}\n` +
        `texture mem ${fmtBytes(mem.textures)}  targets ${fmtBytes(mem.renderTargets)}\n` +
        `exposure ${engine.exposure.value.toFixed(3)}  luma ${engine.post.state.measured.luma.toFixed(0)} / ${engine.exposure.target}\n` +
        `budget draws ${engine.tier.budget.drawCalls}  tris ${(engine.tier.budget.triangles / 1000).toFixed(0)}k\n` +
        (sys ? `ms: ${sys}\n` : '') + (extra ? extra + '\n' : '') +
        (status ? `bench running: ${status}\n` : benchTable(app && app.benchResult));
    },
    dispose() { box.remove(); },
  };
  run.addEventListener('click', () => overlay.runBench());
  return overlay;
}
