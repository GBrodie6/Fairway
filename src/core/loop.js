// The frame loop. Each subsystem is registered with a label and wrapped so that a throw in
// one of them is logged and skipped while every other subsystem, and the next frame, still run.
import { guarded } from './guards.js';

export function createLoop({ timescale = 1 } = {}) {
  const systems = [];
  const stats = { frame: 0, dt: 0, cpuMs: 0, cpuAvg: 0, fps: 0, perSystem: {}, lastError: null };
  let running = false, rafId = 0, last = 0, simTime = 0, fpsAcc = 0, fpsFrames = 0;
  let minInterval = 0, nextDue = 0, dirty = true, onDemand = false;
  // The display's refresh rate, measured from the browser's frame callbacks (which run once per
  // refresh): the median of the recent intervals, so a skipped or stalled frame does not move it.
  const refresh = { prev: 0, ring: new Float64Array(31), n: 0, i: 0 };
  stats.refreshHz = 60; stats.refreshMs = 1000 / 60; stats.cap = 0;
  // The time between the last 240 drawn frames, for the ?debug overlay (average, slowest 5 and 1 percent).
  stats.frameMs = new Float32Array(240);
  function trackRefresh(now) {
    const d = refresh.prev ? now - refresh.prev : 0;
    refresh.prev = now;
    if (!(d > 2 && d < 100)) return;
    refresh.ring[refresh.i] = d; refresh.i = (refresh.i + 1) % refresh.ring.length; refresh.n = Math.min(refresh.n + 1, refresh.ring.length);
    if (refresh.n >= 5 && refresh.i % 5 === 0) {
      const a = Array.from(refresh.ring.subarray(0, refresh.n)).sort((x, y) => x - y);
      stats.refreshMs = a[a.length >> 1];
      stats.refreshHz = 1000 / stats.refreshMs;
    }
  }

  function add(label, fn, { profile = true } = {}) {
    const g = guarded(label, fn);
    systems.push({ label, run: g, profile });
    stats.perSystem[label] = 0;
    return () => {
      const i = systems.findIndex((s) => s.run === g);
      if (i >= 0) systems.splice(i, 1);
    };
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!Number.isFinite(now)) now = performance.now();
    trackRefresh(now);
    if (!due(now)) return;
    if (onDemand && !dirty) { last = now; return; }
    step(now);
  }

  // Frame rate cap. The browser calls once per display refresh (60, 120, 144, 240 Hz...); a cap
  // draws on the refresh nearest each due time and moves the due time on by exactly one
  // interval, so the average rate is the cap (a 60 cap on a 144 Hz display draws 60 times a
  // second, alternating gaps of two and three refreshes), not the next whole divisor of the
  // refresh rate. Uncapped draws on every refresh. The game advances by the real time between
  // drawn frames, so the ball flight, the swing timing and every animation are the same at any
  // rate: the flight is computed in advance with its own fixed step and played back by time,
  // and the swing reads the input events' own timestamps.
  function due(now) {
    if (!(minInterval > 0)) return true;
    const slack = Math.min(stats.refreshMs, minInterval) * 0.5;
    if (now + slack < nextDue) return false;
    nextDue = now - nextDue > minInterval ? now + minInterval : nextDue + minInterval;
    return true;
  }

  // One frame. Exposed so tests and capture tools can advance deterministically.
  function step(now = performance.now(), fixedDt) {
    const rawDt = last ? (now - last) / 1000 : 1 / 60;
    last = now; dirty = false;
    // Clamp so a background tab or a long stall cannot produce a giant step.
    const realDt = Number.isFinite(fixedDt) ? fixedDt : Math.min(Math.max(rawDt, 0), 0.1);
    const dt = realDt * loop.timescale;
    simTime += dt;
    const t0 = performance.now();
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      if (s.profile) {
        const a = performance.now();
        s.run(dt, simTime, realDt);
        const ms = performance.now() - a;
        stats.perSystem[s.label] = stats.perSystem[s.label] * 0.9 + ms * 0.1;
      } else s.run(dt, simTime, realDt);
    }
    stats.cpuMs = performance.now() - t0;
    stats.cpuAvg = stats.cpuAvg ? stats.cpuAvg * 0.92 + stats.cpuMs * 0.08 : stats.cpuMs;
    stats.dt = realDt;
    if (rawDt > 0 && rawDt < 30) { stats.frameMs[stats.frame % stats.frameMs.length] = rawDt * 1000; }
    stats.frame++;
    fpsAcc += rawDt; fpsFrames++;
    if (fpsAcc >= 0.5) { stats.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  }

  const loop = {
    timescale,
    stats,
    add,
    step,
    get time() { return simTime; },
    get running() { return running; },
    start() {
      if (running) return;
      running = true; last = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    // Cap the frame rate (0 = uncapped: every display refresh). Settings, Graphics.
    setMaxFps(fps) { minInterval = fps > 0 ? 1000 / fps : 0; nextDue = 0; stats.cap = fps > 0 ? fps : 0; },
    // Drive the loop from outside with the browser's frame times (tests and tools).
    tick(now) { trackRefresh(now); if (due(now) && !(onDemand && !dirty)) { step(now); return true; } return false; },
    // Render-on-demand: when enabled, frames only run after invalidate().
    setOnDemand(v) { onDemand = !!v; dirty = true; },
    invalidate() { dirty = true; },
  };
  return loop;
}
