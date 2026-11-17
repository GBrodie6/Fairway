// Round state and the rules of play, as plain data and pure functions. The controller feeds
// it shot outcomes; the UI, saves, share links, and tests all read the same structure.
import { COURSES, courseById } from '../course/courses.js';
import { SURFACES } from '../physics/surfaces.js';
import { maxStrokes, isGir, matchPlayStatus, skinsResult, strokeTotals, closestToPin } from './scoring.js';
import { clamp } from '../core/math.js';

export const ROUND_VERSION = 1;
export const MODES = Object.freeze({
  stroke: { id: 'stroke', name: 'Stroke play', minPlayers: 1, maxPlayers: 4 },
  match: { id: 'match', name: 'Match play', minPlayers: 2, maxPlayers: 2 },
  skins: { id: 'skins', name: 'Skins', minPlayers: 2, maxPlayers: 4 },
  ctp: { id: 'ctp', name: 'Closest to the pin', minPlayers: 1, maxPlayers: 4 },
  daily: { id: 'daily', name: 'Daily challenge', minPlayers: 1, maxPlayers: 1 },
  range: { id: 'range', name: 'Range', minPlayers: 1, maxPlayers: 1 },
});
export const modeById = (id) => MODES[id] || MODES.stroke;

// Which holes a round plays. Closest to the pin uses the par 3s only.
export function holesFor(courseId, mode, count = 18, startHole = 1) {
  const course = courseById(courseId);
  if (mode === 'ctp') return course.pars.map((p, i) => (p === 3 ? i : -1)).filter((i) => i >= 0);
  const n = clamp(Math.round(count), 1, 18);
  const start = clamp(Math.round(startHole), 1, 18) - 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push((start + i) % 18);
  return out;
}

export function createRound({ courseId = COURSES[0].id, mode = 'stroke', holeCount = 18, startHole = 1, holes, players, seed = 1, tod = 'morning', pinSet = 0, eventId = null } = {}) {
  const m = modeById(mode);
  const course = courseById(courseId);
  const list = (players && players.length ? players : [{ id: 'p1', name: 'Player', kind: 'human' }]).slice(0, m.maxPlayers);
  const holeList = holes && holes.length ? holes.slice() : holesFor(course.id, m.id, holeCount, startHole);
  const n = list.length;
  return {
    v: ROUND_VERSION, courseId: course.id, mode: m.id, holes: holeList, seed: seed >>> 0, tod, pinSet, eventId,
    players: list.map((p, i) => ({ id: p.id || 'p' + (i + 1), name: String(p.name || 'Player ' + (i + 1)).slice(0, 18), kind: p.kind === 'ai' ? 'ai' : 'human', skill: clamp(Number(p.skill) || 0.6, 0, 1), handed: p.handed === 'left' ? 'left' : 'right', ball: p.ball || '#ffffff' })),
    hole: 0, turn: 0,
    scores: Array.from({ length: n }, () => []),
    logs: Array.from({ length: n }, () => []),
    ctp: Array.from({ length: n }, () => []), // closest-to-pin distances per hole (meters, or null)
    state: null, // per-player state for the hole in progress
    complete: false, clock: 0,
  };
}

export const currentHoleIndex = (round) => round.holes[round.hole];
export const parOf = (round, holeSlot = round.hole) => courseById(round.courseId).pars[round.holes[holeSlot]];

// Begin the current hole: every player on the tee.
export function beginHole(round, tee) {
  round.state = round.players.map(() => ({
    x: tee.x, z: tee.z, lie: SURFACES.TEE, strokes: 0, putts: 0, penalties: 0, holed: false, pickedUp: false,
    onGreenIn: null, fairwayHit: null, driveDistance: 0, lastFrom: null, distToPin: null,
  }));
  round.turn = 0;
  return round;
}

/**
 * Apply the outcome of one shot for a player.
 * outcome: { from:{x,z,lie}, end:{x,z}, lie, holed, water, oob, carry, total, drop?:{x,z,lie}, putt, distToPin }
 * Returns { penalty, message, holeDone, pickedUp }.
 */
export function applyShot(round, playerIdx, outcome) {
  const st = round.state[playerIdx];
  const par = parOf(round);
  const res = { penalty: 0, message: '', holeDone: false, pickedUp: false };
  st.strokes += 1;
  if (outcome.putt) st.putts += 1;
  st.lastFrom = { x: outcome.from.x, z: outcome.from.z, lie: outcome.from.lie };
  // Driving stats come from the first stroke on par 4s and 5s.
  if (st.strokes === 1 && par > 3) {
    st.driveDistance = outcome.total || 0;
    st.fairwayHit = !outcome.water && !outcome.oob && (outcome.lie === SURFACES.FAIRWAY || outcome.lie === SURFACES.GREEN || outcome.lie === SURFACES.FRINGE);
  }
  if (outcome.holed) {
    st.holed = true; st.x = outcome.end.x; st.z = outcome.end.z; st.lie = SURFACES.GREEN; st.distToPin = 0;
    if (st.onGreenIn === null) st.onGreenIn = st.strokes; // holed from off the green
    res.holeDone = true;
    return res;
  }
  if (outcome.oob) {
    // Stroke and distance: one penalty stroke, replay from the previous spot.
    st.penalties += 1; st.strokes += 1; res.penalty = 1; res.message = 'Out of bounds';
    st.x = outcome.from.x; st.z = outcome.from.z; st.lie = outcome.from.lie;
  } else if (outcome.water) {
    // One penalty stroke, drop near where the ball last crossed dry ground.
    st.penalties += 1; st.strokes += 1; res.penalty = 1; res.message = 'Water hazard';
    const d = outcome.drop || outcome.from;
    st.x = d.x; st.z = d.z; st.lie = d.lie ?? SURFACES.ROUGH;
  } else {
    st.x = outcome.end.x; st.z = outcome.end.z; st.lie = outcome.lie;
    if (outcome.lie === SURFACES.GREEN && st.onGreenIn === null) st.onGreenIn = st.strokes;
  }
  if (Number.isFinite(outcome.distToPin)) st.distToPin = outcome.distToPin;
  // Closest to the pin is a single shot per hole.
  if (round.mode === 'ctp') { res.holeDone = true; return res; }
  // The stroke cap keeps a round from ever getting stuck on one hole.
  if (st.strokes >= maxStrokes(par)) {
    st.strokes = maxStrokes(par); st.pickedUp = true; st.holed = true;
    res.holeDone = true; res.pickedUp = true; res.message = 'Picked up at the stroke limit';
  }
  return res;
}

export const playerDone = (round, i) => round.state[i].holed || (round.mode === 'ctp' && round.state[i].strokes > 0);
export const holeFinished = (round) => round.state.every((s, i) => playerDone(round, i));

// Who plays next: the player furthest from the hole who has not finished. On the tee, in order.
export function nextTurn(round) {
  let best = -1, bestD = -1;
  for (let i = 0; i < round.players.length; i++) {
    if (playerDone(round, i)) continue;
    const st = round.state[i];
    const d = st.strokes === 0 ? 1e9 - i : (st.distToPin ?? 1e8);
    if (d > bestD) { bestD = d; best = i; }
  }
  round.turn = best < 0 ? 0 : best;
  return best;
}

// Record the finished hole and move on. Returns true when the round is over.
export function completeHole(round) {
  const par = parOf(round);
  round.players.forEach((p, i) => {
    const st = round.state[i];
    round.scores[i][round.hole] = st.strokes;
    round.logs[i][round.hole] = {
      par, strokes: st.strokes, putts: st.putts, penalties: st.penalties,
      fairwayHit: par > 3 ? st.fairwayHit : null, gir: isGir(st.onGreenIn, par),
      driveDistance: par > 3 ? st.driveDistance : 0, pickedUp: st.pickedUp,
    };
    if (round.mode === 'ctp') round.ctp[i][round.hole] = st.lie === SURFACES.GREEN || st.holed ? st.distToPin : null;
  });
  round.state = null;
  // Match play can end before the last hole.
  if (round.mode === 'match' && round.players.length === 2) {
    const m = matchPlayStatus(round.scores[0], round.scores[1], round.holes.length);
    if (m.closed) { round.complete = true; return true; }
  }
  if (round.hole >= round.holes.length - 1) { round.complete = true; return true; }
  round.hole += 1;
  return false;
}

// A summary of standings in the round's own format, for the HUD and scorecard.
export function standings(round) {
  const pars = round.holes.map((h) => courseById(round.courseId).pars[h]);
  const totals = round.players.map((p, i) => ({ id: p.id, name: p.name, kind: p.kind, ...strokeTotals(round.scores[i], pars) }));
  const out = { mode: round.mode, pars, totals, text: '' };
  if (round.mode === 'match' && round.players.length === 2) {
    out.match = matchPlayStatus(round.scores[0], round.scores[1], round.holes.length);
    const lead = out.match.holesUp > 0 ? round.players[0].name : out.match.holesUp < 0 ? round.players[1].name : '';
    out.text = out.match.closed && out.match.winner !== 'tie' ? `${lead} wins ${out.match.text}` : lead && !out.match.closed ? `${lead} ${out.match.text}` : out.match.text;
  } else if (round.mode === 'skins') {
    out.skins = skinsResult(round.scores, round.holes.length);
    out.text = round.players.map((p, i) => `${p.name} ${out.skins.skins[i]}`).join('  ') + (out.skins.carry ? `  (${out.skins.carry} carried)` : '');
  } else if (round.mode === 'ctp') {
    out.ctp = round.players.map((p, i) => { const ds = round.ctp[i].filter((d) => Number.isFinite(d)); return { name: p.name, best: ds.length ? Math.min(...ds) : null, total: ds.reduce((a, b) => a + b, 0), greens: ds.length }; });
    const rank = closestToPin(out.ctp.map((c, i) => ({ id: round.players[i].id, name: c.name, distance: c.best })));
    out.text = rank[0] && rank[0].onGreen ? `${rank[0].name} leads` : 'No greens hit yet';
  } else {
    const t = totals[0];
    out.text = t.played ? (t.toPar === 0 ? 'Even par' : `${t.toPar > 0 ? '+' : ''}${t.toPar}`) : 'Even par';
  }
  return out;
}

// --- validation (saves and share links both pass through this) ---
export function validateRound(r) {
  const errs = [];
  const fail = (m) => { errs.push(m); return false; };
  if (!r || typeof r !== 'object') return { ok: false, errors: ['not an object'] };
  if (r.v !== ROUND_VERSION) fail('unsupported round version');
  if (!COURSES.some((c) => c.id === r.courseId)) fail('unknown course');
  if (!MODES[r.mode]) fail('unknown mode');
  if (!Array.isArray(r.holes) || r.holes.length < 1 || r.holes.length > 18 || !r.holes.every((h) => Number.isInteger(h) && h >= 0 && h < 18)) fail('bad hole list');
  if (!Array.isArray(r.players) || r.players.length < 1 || r.players.length > 4) fail('bad player count');
  else {
    for (const p of r.players) {
      if (!p || typeof p.name !== 'string' || p.name.length < 1 || p.name.length > 18) fail('bad player name');
      if (p && p.kind !== 'human' && p.kind !== 'ai') fail('bad player kind');
    }
  }
  if (errs.length) return { ok: false, errors: errs };
  if (!Number.isInteger(r.hole) || r.hole < 0 || r.hole >= r.holes.length) fail('hole index out of range');
  if (!Array.isArray(r.scores) || r.scores.length !== r.players.length) fail('scores do not match players');
  else {
    const course = courseById(r.courseId);
    r.scores.forEach((row, pi) => {
      if (!Array.isArray(row) || row.length > r.holes.length) return fail('score row too long');
      row.forEach((s, hi) => {
        const par = course.pars[r.holes[hi]];
        // A recorded score must be a whole number between 1 and the stroke cap.
        if (!Number.isInteger(s) || s < 1 || s > maxStrokes(par)) fail(`impossible score ${s} for player ${pi + 1} on hole ${hi + 1}`);
      });
      // Holes are completed in order: nothing recorded past the hole in progress.
      const played = row.length;
      if (played > r.hole + (r.complete ? 1 : 0)) fail('scores recorded beyond the current hole');
      if (!r.complete && played < r.hole) fail('missing scores before the current hole');
    });
  }
  return { ok: errs.length === 0, errors: errs };
}
