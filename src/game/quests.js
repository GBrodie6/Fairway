// Daily and weekly quests. Three of each, picked from a pool by the date (the same for every
// player on the same day or week), filled by playing, and claimed for XP (weekly quests also
// give a gear token). Pure functions over save.quests.
import { createRng, hashString } from '../core/rng.js';

export const QUEST_POOL = {
  daily: [
    { id: 'd-birdies', text: 'Make 2 birdies', stat: 'birdies', goal: 2, xp: 60 },
    { id: 'd-fairways', text: 'Hit 6 fairways', stat: 'fairways', goal: 6, xp: 50 },
    { id: 'd-holes', text: 'Play 9 holes', stat: 'holes', goal: 9, xp: 50 },
    { id: 'd-pured', text: 'Pure 8 shots', stat: 'pured', goal: 8, xp: 60 },
    { id: 'd-gir', text: 'Hit 4 greens in regulation', stat: 'gir', goal: 4, xp: 50 },
    { id: 'd-range', text: 'Finish a range session', stat: 'rangeSessions', goal: 1, xp: 40 },
    { id: 'd-daily', text: 'Play the daily challenge', stat: 'dailies', goal: 1, xp: 50 },
    { id: 'd-oneputts', text: 'One-putt 3 greens', stat: 'onePutts', goal: 3, xp: 60 },
    { id: 'd-pars', text: 'Make 6 pars or better', stat: 'parsOrBetter', goal: 6, xp: 50 },
  ],
  weekly: [
    { id: 'w-rounds', text: 'Finish 5 rounds', stat: 'rounds', goal: 5, xp: 200, tokens: 1 },
    { id: 'w-birdies', text: 'Make 10 birdies', stat: 'birdies', goal: 10, xp: 250, tokens: 1 },
    { id: 'w-events', text: 'Play 3 campaign events', stat: 'events', goal: 3, xp: 220, tokens: 1 },
    { id: 'w-medals', text: 'Earn 3 range medals', stat: 'medals', goal: 3, xp: 200, tokens: 1 },
    { id: 'w-pured', text: 'Pure 40 shots', stat: 'pured', goal: 40, xp: 220, tokens: 1 },
    { id: 'w-match', text: 'Win a match against a rival', stat: 'matchWins', goal: 1, xp: 200, tokens: 1 },
    { id: 'w-drive', text: 'Hit a drive of 260 yards', stat: 'drive260', goal: 1, xp: 180, tokens: 1 },
  ],
};
export const QUESTS_PER = 3;

export function pickQuests(kind, key) {
  const pool = [...QUEST_POOL[kind]];
  const rng = createRng(hashString(`${kind}:${key}`));
  const out = [];
  while (out.length < QUESTS_PER && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length) % pool.length, 1)[0]);
  return out;
}

const fresh = (kind, key) => ({ key, list: pickQuests(kind, key).map((q) => ({ id: q.id, progress: 0, claimed: false })) });

// Bring the state up to the current day and week (new quests replace finished periods).
export function rollQuests(state, dayKey, weekKey) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    daily: s.daily && s.daily.key === dayKey && Array.isArray(s.daily.list) ? s.daily : fresh('daily', dayKey),
    weekly: s.weekly && s.weekly.key === weekKey && Array.isArray(s.weekly.list) ? s.weekly : fresh('weekly', weekKey),
    done: Math.max(0, Math.floor(Number(s.done) || 0)),
  };
}

export const questDef = (id) => [...QUEST_POOL.daily, ...QUEST_POOL.weekly].find((q) => q.id === id) || null;

/** Add play to the quests. delta: { stat: amount }. Returns { state, completed: [defs] }. */
export function progressQuests(state, delta) {
  const completed = [];
  const bump = (part) => ({
    ...part,
    list: part.list.map((q) => {
      const d = questDef(q.id);
      if (!d || q.claimed) return q;
      const add = Number(delta[d.stat]) || 0;
      if (add <= 0) return q;
      const before = q.progress;
      const progress = Math.min(d.goal, before + add);
      if (before < d.goal && progress >= d.goal) completed.push(d);
      return { ...q, progress };
    }),
  });
  return { state: { ...state, daily: bump(state.daily), weekly: bump(state.weekly) }, completed };
}

/** Claim a finished quest. Returns { state, reward: { xp, tokens } } or { state, reward: null }. */
export function claimQuest(state, id) {
  let reward = null;
  const take = (part) => ({
    ...part,
    list: part.list.map((q) => {
      const d = questDef(q.id);
      if (q.id !== id || q.claimed || !d || q.progress < d.goal) return q;
      reward = { xp: d.xp, tokens: d.tokens || 0 };
      return { ...q, claimed: true };
    }),
  });
  const next = { ...state, daily: take(state.daily), weekly: take(state.weekly) };
  if (reward) next.done = (state.done || 0) + 1;
  return { state: next, reward };
}
export const unclaimed = (state) => (state ? [...state.daily.list, ...state.weekly.list].filter((q) => { const d = questDef(q.id); return d && !q.claimed && q.progress >= d.goal; }).length : 0);
