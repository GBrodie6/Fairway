// Procedural audio with the Web Audio API. Nothing is sampled: every sound is built from
// noise and oscillators, so there is no audio asset to license or download.
//   ambient: wind that follows the game wind, birds by day and crickets at night, water when
//            the camera is near it, and a crowd murmur on tournament holes
//   effects: club strikes by club type, landings by surface, the cup, splashes, a swing whoosh,
//            cheers, and a soft interface tick
//   music:   an optional slow generative pad, off by default
// The context starts on the first user gesture, as browsers require.
import { SURFACES } from '../physics/surfaces.js';
import { clamp } from '../core/math.js';

export function createAudio(settings) {
  const audio = { ctx: null, ready: false, muted: false, nodes: {}, timers: { bird: 2, cricket: 0, water: 0 }, state: { wind: 0, water: 0, crowd: 0, night: false, birdRate: 1 } };
  let noiseBuf = null, brownBuf = null;

  function makeNoise(ctx, seconds, brown) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    // A small fixed-seed generator so the buffers are the same every session.
    let x = 0x9e3779b9;
    const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const w = rnd();
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  const loopSource = (buf) => { const s = audio.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

  audio.unlock = () => {
    if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {}); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    audio.ctx = ctx;
    noiseBuf = makeNoise(ctx, 2.5, false);
    brownBuf = makeNoise(ctx, 4, true);
    const N = audio.nodes;
    N.comp = ctx.createDynamicsCompressor();
    N.comp.threshold.value = -14; N.comp.ratio.value = 3;
    N.master = ctx.createGain();
    N.master.connect(N.comp); N.comp.connect(ctx.destination);
    N.sfx = ctx.createGain(); N.sfx.connect(N.master);
    N.amb = ctx.createGain(); N.amb.connect(N.master);
    N.music = ctx.createGain(); N.music.connect(N.master);
    // Wind: pink-ish noise through a moving low-pass.
    N.windSrc = loopSource(noiseBuf);
    N.windLp = ctx.createBiquadFilter(); N.windLp.type = 'lowpass'; N.windLp.frequency.value = 400; N.windLp.Q.value = 0.6;
    N.windHp = ctx.createBiquadFilter(); N.windHp.type = 'highpass'; N.windHp.frequency.value = 60;
    N.windGain = ctx.createGain(); N.windGain.gain.value = 0;
    N.windSrc.connect(N.windHp); N.windHp.connect(N.windLp); N.windLp.connect(N.windGain); N.windGain.connect(N.amb);
    // Water: brown noise, band-passed, with a slow swell.
    N.waterSrc = loopSource(brownBuf);
    N.waterBp = ctx.createBiquadFilter(); N.waterBp.type = 'bandpass'; N.waterBp.frequency.value = 700; N.waterBp.Q.value = 0.4;
    N.waterGain = ctx.createGain(); N.waterGain.gain.value = 0;
    N.waterSrc.connect(N.waterBp); N.waterBp.connect(N.waterGain); N.waterGain.connect(N.amb);
    // Crowd murmur: noise through two vowel-like band-passes.
    N.crowdSrc = loopSource(noiseBuf);
    N.crowdGain = ctx.createGain(); N.crowdGain.gain.value = 0;
    for (const [f, q] of [[520, 2.2], [1250, 2.6]]) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; N.crowdSrc.connect(b); b.connect(N.crowdGain); }
    N.crowdGain.connect(N.amb);
    audio.ready = true;
    audio.applySettings(settings);
    if (settings.musicEnabled) startMusic();
  };

  audio.applySettings = (s = settings) => {
    if (!audio.ready) return;
    const t = audio.ctx.currentTime, N = audio.nodes;
    N.master.gain.setTargetAtTime(audio.muted ? 0 : clamp(s.masterVolume, 0, 1), t, 0.05);
    N.sfx.gain.setTargetAtTime(clamp(s.sfxVolume, 0, 1), t, 0.05);
    N.amb.gain.setTargetAtTime(clamp(s.ambientVolume, 0, 1), t, 0.05);
    N.music.gain.setTargetAtTime(s.musicEnabled ? clamp(s.musicVolume || 0.4, 0, 1) * 0.5 : 0, t, 0.3);
    if (s.musicEnabled && !audio.music) startMusic();
  };
  audio.setMuted = (m) => { audio.muted = !!m; audio.applySettings(); };

  // --- one-shot helpers ---
  function env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noiseHit({ type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.002, decay = 0.1, to = null, bus = 'sfx', sweep = null, rate = 1 }) {
    const ctx = audio.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + attack + decay);
    const g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(to || audio.nodes[bus]);
    env(g, t, attack, peak, decay);
    s.start(t, Math.random() * 1.5); s.stop(t + attack + decay + 0.05);
  }
  function tone({ freq = 440, type = 'sine', peak = 0.3, attack = 0.003, decay = 0.2, bend = null, bus = 'sfx', delay = 0 }) {
    const ctx = audio.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(bend, t + attack + decay);
    const g = ctx.createGain();
    o.connect(g); g.connect(audio.nodes[bus]);
    env(g, t, attack, peak, decay);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  // --- effects ---
  audio.strike = (club, power = 1, quality = 1) => {
    if (!audio.ready) return;
    const p = clamp(power, 0.1, 1);
    if (club.putter) { tone({ freq: 1150, peak: 0.25 * (0.5 + p), decay: 0.06 }); noiseHit({ type: 'highpass', freq: 3000, peak: 0.08, decay: 0.03 }); return; }
    const wood = club.kind === 'wood';
    // The crack: a bright, very short noise burst; woods ring lower and longer.
    noiseHit({ type: 'bandpass', freq: wood ? 2600 : 3800, q: 0.8, peak: 0.6 * p * (0.7 + 0.3 * quality), decay: wood ? 0.09 : 0.05 });
    tone({ freq: wood ? 190 : 260, peak: 0.35 * p, decay: wood ? 0.12 : 0.07, bend: wood ? 120 : 170 });
    // Turf after an iron: a soft tear.
    if (!wood && club.id !== 'DR') noiseHit({ type: 'lowpass', freq: 900, peak: 0.18 * p, attack: 0.01, decay: 0.12 });
  };
  audio.whoosh = (power = 1) => { if (audio.ready) noiseHit({ type: 'bandpass', freq: 500, q: 1.2, peak: 0.12 * power, attack: 0.12, decay: 0.16, sweep: 2400 }); };
  audio.land = (surface, speed = 10, first = true) => {
    if (!audio.ready) return;
    const k = clamp(speed / 30, 0.08, 1) * (first ? 1 : 0.6);
    if (surface === SURFACES.BUNKER || surface === SURFACES.WASTE) noiseHit({ type: 'highpass', freq: 1800, peak: 0.3 * k, attack: 0.005, decay: 0.22 });
    else if (surface === SURFACES.GREEN || surface === SURFACES.FRINGE) { noiseHit({ type: 'lowpass', freq: 380, peak: 0.45 * k, decay: 0.08 }); tone({ freq: 120, peak: 0.2 * k, decay: 0.06 }); }
    else if (surface === SURFACES.PATH || surface === SURFACES.ROCK) { tone({ freq: 1900, peak: 0.25 * k, decay: 0.05 }); noiseHit({ type: 'highpass', freq: 2500, peak: 0.15 * k, decay: 0.04 }); }
    else noiseHit({ type: 'lowpass', freq: 520, peak: 0.4 * k, decay: 0.1 });
  };
  audio.splash = () => { if (audio.ready) { noiseHit({ type: 'lowpass', freq: 2400, peak: 0.55, attack: 0.004, decay: 0.45, sweep: 300 }); noiseHit({ type: 'bandpass', freq: 900, q: 0.7, peak: 0.25, attack: 0.05, decay: 0.6 }); } };
  audio.cup = () => {
    if (!audio.ready) return;
    // A short rattle then the drop.
    for (let i = 0; i < 4; i++) tone({ freq: 2100 - i * 160, peak: 0.12 / (i + 1), decay: 0.03, delay: i * 0.045 });
    tone({ freq: 420, peak: 0.25, decay: 0.12, delay: 0.2, bend: 300 });
  };
  audio.lip = () => { if (audio.ready) { tone({ freq: 1800, peak: 0.12, decay: 0.03 }); tone({ freq: 1500, peak: 0.08, decay: 0.03, delay: 0.06 }); } };
  audio.cheer = (amount = 1) => {
    if (!audio.ready) return;
    noiseHit({ type: 'bandpass', freq: 900, q: 0.6, peak: 0.35 * amount, attack: 0.25, decay: 2.2 });
    noiseHit({ type: 'bandpass', freq: 2200, q: 1.2, peak: 0.18 * amount, attack: 0.3, decay: 1.8 });
    // Applause: a cloud of tiny clicks.
    for (let i = 0; i < 40 * amount; i++) setTimeout(() => audio.ready && noiseHit({ type: 'highpass', freq: 2200 + Math.random() * 2000, peak: 0.05 * amount, decay: 0.02 }), Math.random() * 2200);
  };
  audio.tick = () => { if (audio.ready) tone({ freq: 1600, peak: 0.05, decay: 0.03 }); };

  function bird() {
    // A short song: a few frequency-swept chirps.
    const base = 2200 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) tone({ freq: base * (1 + Math.random() * 0.25), bend: base * (0.7 + Math.random() * 0.8), peak: 0.035, attack: 0.01, decay: 0.07 + Math.random() * 0.06, bus: 'amb', delay: i * (0.09 + Math.random() * 0.06) });
  }
  function cricket() {
    for (let i = 0; i < 3; i++) tone({ freq: 4400, peak: 0.02, attack: 0.004, decay: 0.025, bus: 'amb', delay: i * 0.05 });
  }

  // --- music: a slow pad of three voices that changes chord every few seconds ---
  const CHORDS = [[220, 277.18, 329.63], [196, 246.94, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
  function startMusic() {
    if (!audio.ready || audio.music) return;
    const ctx = audio.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(audio.nodes.music);
    const voices = [0, 1, 2].map(() => { const o = ctx.createOscillator(); o.type = 'triangle'; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(lp); o.start(); return o; });
    let i = 0;
    const step = () => { const c = CHORDS[i++ % CHORDS.length]; voices.forEach((o, k) => o.frequency.setTargetAtTime(c[k], ctx.currentTime, 1.2)); };
    step();
    audio.music = { voices, timer: setInterval(step, 6500) };
  }

  // --- per frame: ambience follows the world ---
  audio.update = (dt, world, game) => {
    if (!audio.ready || !world || !world.terrain) return;
    const ctx = audio.ctx, t = ctx.currentTime, N = audio.nodes;
    const w = world.wind || { x: 0, z: 0 };
    const speed = Math.hypot(w.x, w.z); // m/s
    const gust = 0.8 + 0.2 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    N.windGain.gain.setTargetAtTime(clamp(0.02 + speed * 0.022, 0, 0.35) * gust, t, 0.4);
    N.windLp.frequency.setTargetAtTime(260 + speed * 70 * gust, t, 0.4);
    // Water: is there water near the camera? Sampled on a coarse ring twice a second.
    audio.timers.water -= dt;
    if (audio.timers.water <= 0) {
      audio.timers.water = 0.5;
      const c = world.camera.position, tr = world.terrain;
      let near = 0;
      for (const r of [8, 20, 40]) for (let a = 0; a < 6.28; a += 0.79) {
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (tr.inBounds(x, z, 1) && tr.isWater(x, z)) near = Math.max(near, 1 - r / 55);
      }
      audio.state.water = near;
      audio.state.night = world.todId === 'night' || world.todId === 'dusk';
      audio.state.crowd = world.terrain.hole && world.terrain.hole.tournament ? 1 : 0;
    }
    N.waterGain.gain.setTargetAtTime(audio.state.water * 0.16, t, 0.6);
    N.crowdGain.gain.setTargetAtTime(audio.state.crowd * 0.045, t, 1.0);
    // Birds by day, crickets at night.
    audio.timers.bird -= dt;
    if (audio.timers.bird <= 0) {
      audio.timers.bird = 3 + Math.random() * 7;
      if (!audio.state.night) bird();
    }
    if (audio.state.night) { audio.timers.cricket -= dt; if (audio.timers.cricket <= 0) { audio.timers.cricket = 0.6 + Math.random() * 0.5; cricket(); } }
  };

  // Game events to sounds.
  audio.attach = (game, getWorld) => game.on((type, d) => {
    if (!audio.ready) return;
    switch (type) {
      case 'swing': audio.strike(d.club, d.swing.power, d.swing.tempoQuality ?? 1); break;
      case 'land': audio.land(d.surface, d.speed, d.first); break;
      case 'splash': audio.splash(); break;
      case 'holed': audio.cup(); { const w = getWorld(); if (w.terrain.hole.tournament) setTimeout(() => audio.cheer(0.8), 450); } break;
      case 'lip': audio.lip(); break;
      default: break;
    }
  });
  // Render one sound into an OfflineAudioContext and measure it. Used by the QA tools to
  // prove the procedural sounds are audible, since headless Chrome has no speakers.
  audio.probe = async (play, seconds = 1.2) => {
    if (!audio.ready) return null;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const off = new OAC(1, Math.ceil(44100 * seconds), 44100);
    const saved = { ctx: audio.ctx, nodes: audio.nodes };
    const out = off.createGain();
    out.connect(off.destination);
    audio.ctx = off;
    audio.nodes = { ...saved.nodes, sfx: out, amb: out, music: out, master: out };
    try { play(audio); } finally { audio.ctx = saved.ctx; audio.nodes = saved.nodes; }
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / d.length).toFixed(5), finite: Number.isFinite(sum) };
  };
  audio.dispose = () => { if (audio.music) clearInterval(audio.music.timer); if (audio.ctx) audio.ctx.close().catch(() => {}); audio.ctx = null; audio.ready = false; };
  return audio;
}
