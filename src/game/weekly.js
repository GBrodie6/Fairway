// What changes each week: a rotating mini-game and the weekly long drive. The rival in quick
// rounds adapts to the player's recent form. Pure functions.
import { clamp } from '../core/math.js';
import { weekPeriod } from '../net/leaderboard.js';

// The mini-game of the week rotates through four short formats.
export const MINI_GAMES = [
  { id: 'ctp', name: 'Closest to the pin', text: 'Every par 3 on a course. One shot each, nearest to the flag wins.', kind: 'round', mode: 'ctp' },
  { id: 'target', name: 'Target points', text: 'Ten balls at the five target greens on the practice ground.', kind: 'range', drill: 'target' },
  { id: 'shape', name: 'Shape shots', text: 'Draw it, fade it, hit it straight on request.', kind: 'range', drill: 'shape' },
  { id: 'ladder', name: 'Wedge ladder', text: 'Carry 50 to 100 yards, ten yards at a time.', kind: 'range', drill: 'ladder' },
];
export const weekIndex = (now) => Math.floor((now - Date.UTC(2026, 0, 5)) / (7 * 86400000));
export const miniGameForWeek = (now) => MINI_GAMES[((weekIndex(now) % MINI_GAMES.length) + MINI_GAMES.length) % MINI_GAMES.length];
export const weekKey = (now) => weekPeriod(new Date(now));

// The weekly record: best long drive (yards) and best mini-game score this week.
export function rollWeekly(state, now) {
  const key = weekKey(now);
  if (state && state.key === key) return { key, longdrive: Math.max(0, Number(state.longdrive) || 0), mini: Math.max(0, Number(state.mini) || 0) };
  return { key, longdrive: 0, mini: 0 };
}
export const recordWeekly = (state, now, { longdrive = 0, mini = 0 } = {}) => {
  const s = rollWeekly(state, now);
  return { ...s, longdrive: Math.max(s.longdrive, Math.round(longdrive) || 0), mini: Math.max(s.mini, Math.round(mini) || 0) };
};

/**
 * The quick-round rival's skill from the player's recent rounds: the per-hole score over par
 * the rival's model would average, set a touch better than the player's own recent average
 * (so it is a close contest that leans a little toward the rival). New players get 0.55.
 */
export function adaptiveRivalSkill(history, { lean = 0.06 } = {}) {
  const recent = (history || []).filter((h) => h && h.holes > 0 && Number.isFinite(h.toPar)).slice(-8);
  if (recent.length < 2) return 0.55;
  const perHole = recent.reduce((a, h) => a + h.toPar / h.holes, 0) / recent.length;
  // The rival model's mean over par per hole is 1.95 - 2.65 * skill (game/career.js).
  return +clamp((1.95 - perHole) / 2.65 + lean, 0.35, 0.88).toFixed(3);
}
export const rivalLabel = (skill) => (skill >= 0.8 ? 'sharp' : skill >= 0.65 ? 'steady' : skill >= 0.5 ? 'even' : 'friendly');
