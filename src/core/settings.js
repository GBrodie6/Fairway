// User settings: versioned, validated, persisted to localStorage, overridable from the URL.
import { clamp } from './math.js';
import { TIER_ORDER, SHADOW_LEVELS, FPS_CAPS } from './quality.js';

export const SETTINGS_VERSION = 2;
const KEY = 'fairway-next.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  tier: 'auto', // auto | low | medium | high | ultra
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambientVolume: 0.6,
  musicVolume: 0.0,
  musicEnabled: false,
  aimSensitivity: 1,
  units: 'yards', // yards | meters
  handedness: 'right', // golfer handedness
  leftHandLayout: false, // mirrored bottom row and look button
  colorblind: 'off', // off | deuteranopia | protanopia | tritanopia
  reducedMotion: false,
  haptics: true,
  showGolfer: false,
  spinViz: false,
  powerGuide: true, // the gold power mark on the swing rail
  tutorialDone: false,
  accountPromptSeen: false, // the optional account card after the first round
  difficulty: 'standard', // strike quality: relaxed, standard, pro
  stickScale: 1,
  swingGuide: 'box', // box (a box to press in, a ring at the start line) | classic (the docked track)
  showFps: false,
  spinMemory: 'reset', // the ball-contact dot after each shot: reset to the middle, or remember
  allShotsQuickPlay: true, // every shot type in Quick Play (Campaign unlocks them on the skill tree)
  screenSize: 'normal', // desktop HUD and menu size: small | normal | large (ui/desktop.js)
  fpsCap: 'uncapped', // frame rate cap: uncapped (the display's refresh rate) | 30 | 60 | 120 | 144
  renderScale: 1, // resolution scale, 0.5 to 1 of the screen's pixels (before the tier's pixel ratio cap)
  shadowQuality: 'auto', // auto (follows the tier) | off | low | medium | high | ultra
  vsync: 'on', // on | off: off asks the browser for a low-latency canvas (applies after a reload)
});

const ENUMS = {
  tier: ['auto', ...TIER_ORDER],
  units: ['yards', 'meters'],
  handedness: ['right', 'left'],
  colorblind: ['off', 'deuteranopia', 'protanopia', 'tritanopia'],
  difficulty: ['relaxed', 'standard', 'pro'],
  spinMemory: ['reset', 'remember'],
  screenSize: ['small', 'normal', 'large'],
  swingGuide: ['box', 'classic'],
  fpsCap: FPS_CAPS,
  shadowQuality: SHADOW_LEVELS,
  vsync: ['on', 'off'],
};

// Validate and normalize any object into a well-formed settings object.
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k === 'version') continue;
    const def = DEFAULT_SETTINGS[k];
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof def === 'boolean') out[k] = v === true || v === 'true' || v === 1;
    else if (typeof def === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = k === 'aimSensitivity' ? clamp(n, 0.25, 3) : k === 'stickScale' ? clamp(n, 0.7, 1.5) : k === 'renderScale' ? Math.round(clamp(n, 0.5, 1) * 20) / 20 : clamp(n, 0, 1);
    } else if (ENUMS[k]) {
      if (ENUMS[k].includes(String(v))) out[k] = String(v);
    }
  }
  return out;
}

// Migrations from older saved shapes. Each step takes version n to n + 1.
const MIGRATIONS = {
  1: (s) => {
    // v1 stored a single "volume" and a boolean "leftHanded".
    const next = { ...s, version: 2 };
    if (Number.isFinite(s.volume)) next.masterVolume = s.volume;
    if (typeof s.leftHanded === 'boolean') {
      next.handedness = s.leftHanded ? 'left' : 'right';
      next.leftHandLayout = s.leftHanded;
    }
    delete next.volume; delete next.leftHanded;
    return next;
  },
};

export function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  let s = { ...raw };
  let v = Number.isInteger(s.version) ? s.version : 1;
  let guard = 0;
  while (v < SETTINGS_VERSION && MIGRATIONS[v] && guard++ < 20) {
    s = MIGRATIONS[v](s);
    v = s.version;
  }
  return sanitizeSettings(s);
}

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export function loadSettings() {
  const st = storage();
  if (!st) return { ...DEFAULT_SETTINGS };
  try {
    const txt = st.getItem(KEY);
    return txt ? migrateSettings(JSON.parse(txt)) : { ...DEFAULT_SETTINGS };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch (e) {
    return false;
  }
}

// URL parameters used for QA, the smoke test, and deep links.
export function readUrlParams(search = (typeof location !== 'undefined' ? location.search : '')) {
  const p = new URLSearchParams(search);
  const num = (k, lo, hi) => {
    if (!p.has(k)) return undefined;
    const n = Number(p.get(k));
    return Number.isFinite(n) ? clamp(n, lo, hi) : undefined;
  };
  const flag = (k) => p.has(k) && p.get(k) !== '0' && p.get(k) !== 'false';
  return {
    debug: flag('debug'),
    smoke: flag('smoke'),
    bot: flag('bot'),
    course: p.get('course') || undefined,
    tod: p.get('tod') || undefined,
    tier: TIER_ORDER.includes(p.get('tier')) ? p.get('tier') : undefined,
    hole: num('hole', 1, 18),
    timescale: num('timescale', 0.1, 60),
    seed: p.get('seed') || undefined,
    mode: p.get('mode') || undefined,
    holes: num('holes', 1, 18),
    view: p.get('view') || undefined,
    scale: num('scale', 0.1, 2),
    noassets: flag('noassets'),
    fresh: flag('fresh'),
    online: flag('online'),
    cloud: p.get('cloud') || undefined,
    bench: flag('bench'),
  };
}
