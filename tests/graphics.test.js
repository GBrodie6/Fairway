// Desktop graphics: the GPU picks High or Ultra, the shadow quality, frame rate cap and
// resolution scale settings, the frame loop at 30 to 240 Hz (the cap's average rate, the real
// time each frame advances the game, the ball flight the same at every rate), the tracer's
// budget at a high refresh rate, and the ?debug benchmark's bookkeeping.
import { describe, it, expect } from 'vitest';
import { createLoop } from '../src/core/loop.js';
import { detectTier, isDesktopGpu, withShadows, tierKey, TIERS, fpsCapValue, FPS_CAPS, SHADOW_LEVELS } from '../src/core/quality.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/core/settings.js';
import { simulateShot, flatEnv, samplePath } from '../src/physics/ball.js';
import { CLUBS } from '../src/physics/clubs.js';
import { traceAccepts, TRACE_MAX } from '../src/render/ballView.js';
import { frameSummary, benchTable } from '../src/ui/debug.js';
import { runBench, BENCH_SIZES } from '../src/render/bench.js';

// A display refreshing at hz for seconds, with a little timing jitter like a real one.
function drive(loop, hz, seconds, jitter = 0.25) {
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  const period = 1000 / hz, start = 1000;
  let drawn = 0;
  for (let i = 0; i <= Math.round(hz * seconds); i++) if (loop.tick(start + i * period + rnd() * 2 * jitter)) drawn++;
  return drawn;
}

describe('desktop GPU tier', () => {
  it('desktop GPUs start on High or Ultra', () => {
    const desk = { memoryGb: 8, cores: 12 };
    expect(detectTier({ ...desk, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('ultra');
    expect(detectTier({ ...desk, gpu: 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('ultra');
    expect(detectTier({ ...desk, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11)' })).toBe('high');
    expect(detectTier({ ...desk, gpu: 'ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11)' })).toBe('high');
    expect(detectTier({ ...desk, gpu: 'Apple M1' })).toBe('high');
    expect(detectTier({ ...desk, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)' })).toBe('ultra');
    expect(detectTier({ memoryGb: undefined, cores: 8, gpu: 'Apple GPU' })).toBe('high'); // Safari on a Mac
    expect(detectTier({ ...desk, gpu: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)' })).toBe('ultra');
  });
  it('a desktop GPU is told apart from integrated, software and phone GPUs', () => {
    expect(isDesktopGpu({ gpu: 'NVIDIA GeForce RTX 3060' })).toBe(true);
    expect(isDesktopGpu({ gpu: 'Apple GPU' })).toBe(true);
    expect(isDesktopGpu({ gpu: 'Apple GPU', mobile: true })).toBe(false);
    expect(isDesktopGpu({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' })).toBe(false);
    expect(isDesktopGpu({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' })).toBe(false);
    expect(detectTier({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', memoryGb: 8, cores: 16 })).toBe('low');
  });
});

describe('graphics settings', () => {
  it('shadow quality overrides the tier\'s shadows and nothing else', () => {
    expect(withShadows(TIERS.high, 'auto')).toBe(TIERS.high);
    expect(withShadows(TIERS.high, 'high')).toBe(TIERS.high);
    const off = withShadows(TIERS.ultra, 'off');
    expect(off.shadows.enabled).toBe(false);
    expect(off.id).toBe('ultra');
    expect(off.grassBlades).toBe(TIERS.ultra.grassBlades);
    const up = withShadows(TIERS.low, 'ultra');
    expect(up.shadows).toBe(TIERS.ultra.shadows);
    expect(tierKey(up)).not.toBe(tierKey(TIERS.low));
    expect(SHADOW_LEVELS).toEqual(['auto', 'off', 'low', 'medium', 'high', 'ultra']);
  });
  it('the settings validate: frame rate cap, resolution scale 50 to 100 percent, shadows, V-Sync', () => {
    expect(DEFAULT_SETTINGS.fpsCap).toBe('uncapped');
    expect(DEFAULT_SETTINGS.renderScale).toBe(1);
    expect(FPS_CAPS).toEqual(['uncapped', '30', '60', '120', '144']);
    expect(sanitizeSettings({ fpsCap: 144 }).fpsCap).toBe('144');
    expect(sanitizeSettings({ fpsCap: '999' }).fpsCap).toBe('uncapped');
    expect(sanitizeSettings({ renderScale: 0.2 }).renderScale).toBe(0.5);
    expect(sanitizeSettings({ renderScale: 0.77 }).renderScale).toBe(0.75);
    expect(sanitizeSettings({ renderScale: 3 }).renderScale).toBe(1);
    expect(sanitizeSettings({ shadowQuality: 'off', vsync: 'off' })).toMatchObject({ shadowQuality: 'off', vsync: 'off' });
    expect(sanitizeSettings({ shadowQuality: 'max', vsync: 'maybe' })).toMatchObject({ shadowQuality: 'auto', vsync: 'on' });
    expect([fpsCapValue('uncapped'), fpsCapValue('30'), fpsCapValue('144'), fpsCapValue('nope')]).toEqual([0, 30, 144, 0]);
  });
});

describe('the frame loop at the display refresh rate', () => {
  it('uncapped draws on every refresh at 60, 120, 144, 165 and 240 Hz and measures the rate', () => {
    for (const hz of [60, 120, 144, 165, 240]) {
      const loop = createLoop();
      const n = drive(loop, hz, 10);
      expect(Math.abs(n - hz * 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(loop.stats.refreshHz - hz) / hz).toBeLessThan(0.02);
    }
  });
  it('a cap averages its rate on any display (not the next whole divisor of the refresh rate)', () => {
    for (const hz of [60, 120, 144, 165, 240]) {
      for (const cap of [30, 60, 120, 144]) {
        const loop = createLoop();
        loop.setMaxFps(cap);
        const n = drive(loop, hz, 10);
        const want = Math.min(cap, hz) * 10;
        expect(Math.abs(n - want) / want, `${cap} cap on ${hz} Hz drew ${n}`).toBeLessThan(0.02);
      }
    }
  });
  it('each frame advances the game by the real time since the last drawn frame, at any rate', () => {
    for (const [hz, cap] of [[60, 0], [144, 0], [240, 0], [144, 60], [240, 144], [60, 30]]) {
      const loop = createLoop();
      loop.setMaxFps(cap);
      let sim = 0;
      loop.add('game', (dt) => { sim += dt; });
      drive(loop, hz, 10);
      expect(Math.abs(sim - 10), `${hz} Hz cap ${cap}`).toBeLessThan(0.05);
      expect(Math.abs(loop.time - sim)).toBeLessThan(1e-9);
    }
  });
  it('a ball flight plays back the same at 30, 60, 144 and 240 Hz: same path, same events, same rest point', () => {
    const dr = CLUBS.find((c) => c.id === 'DR');
    const r = simulateShot({ x: 0, z: 0, speed: dr.speed, vAngle: dr.launchRad, heading: 0.03, spin: dr.spin }, flatEnv());
    const runs = {};
    for (const hz of [30, 60, 144, 240]) {
      const loop = createLoop();
      const shot = { t: 0, ev: 0, fired: [], end: null };
      const p = { x: 0, y: 0, z: 0 };
      loop.add('game', (dt) => {
        if (shot.end) return;
        shot.t += dt;
        samplePath(r.points, shot.t, p);
        while (shot.ev < r.events.length && r.events[shot.ev].t <= shot.t) shot.fired.push(r.events[shot.ev++].type);
        if (shot.t >= r.duration) shot.end = { ...p };
      });
      drive(loop, hz, r.duration + 1, 0);
      runs[hz] = shot;
    }
    for (const hz of [60, 144, 240]) {
      expect(runs[hz].fired).toEqual(runs[30].fired);
      expect(Math.hypot(runs[hz].end.x - runs[30].end.x, runs[hz].end.z - runs[30].end.z)).toBeLessThan(1e-6);
    }
    expect(runs[60].fired.length).toBe(r.events.length);
  });
  it('the tracer reaches the landing at every refresh rate (it ran out above about 100 Hz before)', () => {
    const dr = CLUBS.find((c) => c.id === 'DR');
    // A long hitter's drive: 10 percent more ball speed than the table driver.
    const r = simulateShot({ x: 0, z: 0, speed: dr.speed * 1.1, vAngle: dr.launchRad, heading: 0, spin: dr.spin }, flatEnv());
    const land = r.events.find((e) => e.type === 'land');
    for (const hz of [30, 60, 120, 144, 240, 360]) {
      const tp = [];
      const p = { x: 0, y: 0, z: 0 };
      for (let t = 0; t < r.hang; t += 1 / hz) { samplePath(r.points, t, p); if (traceAccepts(tp, p.x, p.y, p.z)) tp.push(p.x, p.y, p.z); }
      const n = tp.length / 3;
      expect(n, `${hz} Hz`).toBeLessThan(TRACE_MAX);
      expect(Math.hypot(tp[tp.length - 3] - land.x, tp[tp.length - 1] - land.z), `${hz} Hz`).toBeLessThan(3);
    }
  });
});

describe('the ?debug benchmark', () => {
  it('frame summaries: average, slowest 5 and 1 percent', () => {
    const ms = new Float32Array(200).fill(7);
    ms[0] = 30; ms[1] = 20; ms[2] = 0;
    const s = frameSummary(ms);
    expect(s.n).toBe(199);
    expect(s.avg).toBeGreaterThan(7);
    expect(s.p95).toBe(7);
    expect(s.p99).toBe(20);
  });
  it('runs every tier at 1080p and 1440p, then puts the tier, the shadows and the size back', async () => {
    const log = [];
    const engine = {
      tier: { id: 'high' }, shadowLevel: 'off', cssWidth: 1920, cssHeight: 1080, stats: { calls: 50, triangles: 1000 },
      renderer: { getContext: () => ({ readPixels() { log.push('sync'); }, RGBA: 0, UNSIGNED_BYTE: 0 }), setRenderTarget() {} },
      setForcedSize(sz) { log.push(sz ? `size ${sz.width}x${sz.height}` : 'size off'); },
    };
    const loop = { stopped: 0, started: 0, steps: 0, stop() { this.stopped++; }, start() { this.started++; }, step() { this.steps++; } };
    const app = { engine, loop, caps: { gpu: 'Test GPU' }, world: { whenSettled: async () => {} }, async setTier(id, sh) { engine.tier = { id }; engine.shadowLevel = sh; log.push(`tier ${id} ${sh}`); } };
    const r = await runBench(app, { warm: 1, frames: 2, batches: 2 });
    expect(Object.keys(r.rows)).toEqual(['low', 'medium', 'high', 'ultra']);
    for (const t of Object.keys(r.rows)) for (const s of BENCH_SIZES) expect(r.rows[t][s.id].ms).toBeGreaterThanOrEqual(0);
    expect(log).toContain('size 2560x1440');
    expect(log.filter((x) => x.startsWith('tier ')).slice(0, 4)).toEqual(['tier low auto', 'tier medium auto', 'tier high auto', 'tier ultra auto']);
    expect(log.slice(-2)).toEqual(['size off', 'tier high off']);
    expect([loop.stopped, loop.started]).toEqual([1, 1]);
    expect(loop.steps).toBe(4 * 2 * (1 + 2 * 2));
    expect(benchTable(r)).toMatch(/1080p.*1440p/);
    expect(benchTable(null)).toMatch(/not run/);
  });
});
