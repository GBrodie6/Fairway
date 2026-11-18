// Streaks inside a round, for game feel: pars or better in a row, birdies in a row, pured
// strikes in a row, and fairways in a row. A streak reaching 3, 5, 8 or 12 is announced.
// Pure functions; the UI keeps one streak object per round.
export const STREAK_MARKS = [3, 5, 8, 12];
export const STREAK_NAMES = {
  par: (n) => `${n} holes at par or better`,
  birdie: (n) => (n === 2 ? 'Back-to-back birdies' : `${n} birdies in a row`),
  pure: (n) => `${n} pured strikes in a row`,
  fairway: (n) => `${n} fairways in a row`,
};
export const emptyStreaks = () => ({ par: 0, birdie: 0, pure: 0, fairway: 0, best: { par: 0, birdie: 0, pure: 0, fairway: 0 } });

function step(s, key, hit, marks = STREAK_MARKS) {
  const n = hit ? s[key] + 1 : 0;
  const best = { ...s.best, [key]: Math.max(s.best[key], n) };
  return { next: { ...s, [key]: n, best }, announce: hit && marks.includes(n) ? STREAK_NAMES[key](n) : null };
}

/**
 * Feed one event. ev: { type: 'hole', toPar } | { type: 'strike', kind } | { type: 'tee', fairway }.
 * Returns { streaks, announce } where announce is a line to show, or null.
 */
export function updateStreaks(s, ev) {
  if (ev.type === 'hole') {
    const a = step(s, 'par', ev.toPar <= 0);
    const b = step(a.next, 'birdie', ev.toPar <= -1, [2, 3, 4, 5]);
    return { streaks: b.next, announce: b.announce || a.announce };
  }
  if (ev.type === 'strike') {
    const r = step(s, 'pure', ev.kind === 'pured');
    return { streaks: r.next, announce: r.announce };
  }
  if (ev.type === 'tee') {
    const r = step(s, 'fairway', !!ev.fairway);
    return { streaks: r.next, announce: r.announce };
  }
  return { streaks: s, announce: null };
}
// The chip the HUD shows: the hottest live streak of 2 or more, or null.
export function hotStreak(s) {
  const live = [['birdie', s.birdie, 2], ['pure', s.pure, 3], ['par', s.par, 3], ['fairway', s.fairway, 3]].filter(([, n, min]) => n >= min);
  if (!live.length) return null;
  const [key, n] = live[0];
  return { key, n, text: key === 'birdie' ? `${n} birdies running` : key === 'pure' ? `${n} pured running` : key === 'par' ? `${n} pars or better` : `${n} fairways running` };
}
