// Scoring for every format. Pure functions over plain arrays so they are easy to test,
// serialize into saves, and validate when a round arrives through a share link.

export const SCORE_NAMES = {
  '-4': 'Condor', '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par',
  1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey',
};

export function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  return SCORE_NAMES[d] || (d > 0 ? `+${d}` : `${d}`);
}

export function formatRelative(n) {
  if (!Number.isFinite(n)) return '';
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

const sum = (a) => a.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

// Stroke play. scores is an array of strokes per hole, undefined or null for unplayed holes.
export function strokeTotals(scores, pars) {
  let strokes = 0, par = 0, played = 0;
  for (let i = 0; i < pars.length; i++) {
    const s = scores[i];
    if (Number.isFinite(s) && s > 0) {
      strokes += s; par += pars[i]; played++;
    }
  }
  return { strokes, par, toPar: strokes - par, played, complete: played === pars.length };
}

// Rank players by strokes relative to par through the holes each has completed.
export function leaderboard(players, pars) {
  const rows = players.map((p, index) => ({ index, id: p.id, name: p.name, ...strokeTotals(p.scores, pars) }));
  rows.sort((a, b) => a.toPar - b.toPar || b.played - a.played || a.index - b.index);
  let pos = 0;
  rows.forEach((r, i) => {
    if (i > 0 && r.toPar === rows[i - 1].toPar) r.pos = rows[i - 1].pos;
    else { pos = i + 1; r.pos = pos; }
  });
  rows.forEach((r) => { r.tied = rows.filter((o) => o.pos === r.pos).length > 1; });
  return rows;
}

// Stableford points for one hole.
export function stablefordPoints(strokes, par) {
  if (!Number.isFinite(strokes) || strokes <= 0) return 0;
  return Math.max(0, 2 - (strokes - par));
}

/**
 * Match play between two players. a and b are strokes per hole.
 * Returns { holesUp (positive means A leads), played, remaining, closed, winner, text, holeResults }.
 */
export function matchPlayStatus(a, b, totalHoles) {
  let up = 0, played = 0, closedAt = -1;
  const holeResults = [];
  for (let i = 0; i < totalHoles; i++) {
    if (!(Number.isFinite(a[i]) && Number.isFinite(b[i]))) break;
    if (closedAt >= 0) break;
    const r = a[i] < b[i] ? 1 : a[i] > b[i] ? -1 : 0;
    holeResults.push(r);
    up += r;
    played++;
    const remaining = totalHoles - played;
    if (Math.abs(up) > remaining) closedAt = played;
  }
  const remaining = totalHoles - played;
  const closed = closedAt >= 0 || played === totalHoles;
  let winner = null, text;
  if (closed) {
    if (up === 0) { text = 'Match halved'; winner = 'tie'; }
    else {
      winner = up > 0 ? 'a' : 'b';
      text = remaining > 0 ? `${Math.abs(up)} & ${remaining}` : `${Math.abs(up)} UP`;
    }
  } else if (up === 0) text = 'All square';
  else if (Math.abs(up) === remaining) text = `Dormie ${Math.abs(up)}`;
  else text = `${Math.abs(up)} UP`;
  return { holesUp: up, played, remaining, closed, winner, text, holeResults };
}

/**
 * Skins. scoresByPlayer[p][h] are strokes. Ties carry the skin to the next hole.
 * Returns { skins: count per player, holeWinners: winner index or -1 (carry) per played hole,
 *           carry: skins still on the table, values: skins won on each hole }.
 */
export function skinsResult(scoresByPlayer, totalHoles, { carryOver = true } = {}) {
  const n = scoresByPlayer.length;
  const skins = new Array(n).fill(0);
  const holeWinners = [], values = [];
  let carry = 0;
  for (let h = 0; h < totalHoles; h++) {
    const col = scoresByPlayer.map((s) => s[h]);
    if (!col.every((v) => Number.isFinite(v) && v > 0)) break;
    const best = Math.min(...col);
    const winners = col.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    const pot = 1 + carry;
    if (winners.length === 1) {
      skins[winners[0]] += pot;
      holeWinners.push(winners[0]);
      values.push(pot);
      carry = 0;
    } else {
      holeWinners.push(-1);
      values.push(0);
      carry = carryOver ? pot : 0;
    }
  }
  return { skins, holeWinners, values, carry };
}

// Closest to the pin. entries: [{ id, name, distance (meters) | null when the green was missed }].
export function closestToPin(entries) {
  const rows = entries.map((e, index) => ({ ...e, index, onGreen: Number.isFinite(e.distance) }));
  rows.sort((a, b) => (a.onGreen === b.onGreen ? (a.onGreen ? a.distance - b.distance : a.index - b.index) : a.onGreen ? -1 : 1));
  rows.forEach((r, i) => { r.pos = i + 1; });
  return rows;
}

// Round statistics from the per-hole shot log.
// holes: [{ par, strokes, putts, fairwayHit (true/false/null for par 3), gir, driveDistance, penalties }]
export function roundStats(holes) {
  const done = holes.filter((h) => h && Number.isFinite(h.strokes) && h.strokes > 0);
  const fw = done.filter((h) => h.fairwayHit !== null && h.fairwayHit !== undefined);
  const drives = done.filter((h) => Number.isFinite(h.driveDistance) && h.driveDistance > 0);
  const count = (d) => done.filter((h) => h.strokes - h.par === d).length;
  return {
    holes: done.length,
    strokes: sum(done.map((h) => h.strokes)),
    toPar: sum(done.map((h) => h.strokes - h.par)),
    putts: sum(done.map((h) => h.putts || 0)),
    fairwaysHit: fw.filter((h) => h.fairwayHit).length,
    fairwaysPossible: fw.length,
    gir: done.filter((h) => h.gir).length,
    penalties: sum(done.map((h) => h.penalties || 0)),
    longestDrive: drives.length ? Math.max(...drives.map((h) => h.driveDistance)) : 0,
    averageDrive: drives.length ? sum(drives.map((h) => h.driveDistance)) / drives.length : 0,
    eagles: done.filter((h) => h.strokes - h.par <= -2).length,
    birdies: count(-1),
    pars: count(0),
    bogeys: count(1),
    doubles: done.filter((h) => h.strokes - h.par >= 2).length,
  };
}

// Green in regulation: on the green in par minus two strokes or fewer.
export function isGir(strokesToReachGreen, par) {
  return Number.isFinite(strokesToReachGreen) && strokesToReachGreen <= par - 2;
}

// Stroke cap per hole so a round can never softlock: par + 5, then the ball is picked up.
export const maxStrokes = (par) => par + 5;
