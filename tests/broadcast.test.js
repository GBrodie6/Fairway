import { describe, it, expect } from 'vitest';
import { shotLine, holeLine, holeIntro, line, COMMENTARY_KEYS } from '../src/game/commentary.js';
import { createTournament, tournamentBoard, finishTournamentRound, roundHoles, rank, posLabel, PURSE, T_ROUNDS, T_HOLES, T_CUT_TOP, T_FIELD, sanitizeTournament, eventBoard, rivalRound } from '../src/game/tournament.js';
import { getHole } from '../src/course/layout.js';
import { courseById } from '../src/course/courses.js';

describe('commentary', () => {
  it('is deterministic, covers the big moments, and stays quiet on routine shots', () => {
    expect(line('birdie', 'a')).toBe(line('birdie', 'a'));
    expect(shotLine({ holed: true, tee: true, par: 3 }, 's')).toMatch(/one|ace|cup/i);
    expect(shotLine({ holed: true, putt: true, fromDist: 9 }, 's')).toBeTruthy();
    expect(shotLine({ holed: true, putt: true, fromDist: 1 }, 's')).toBe(null);
    expect(shotLine({ water: true }, 's')).toMatch(/water|wet/i);
    expect(shotLine({ putt: false, lie: 'Fairway', tee: false, onGreen: false, fromDist: 40 }, 's')).toBe(null);
    for (const k of COMMENTARY_KEYS) expect(line(k, 'x')).toBeTruthy();
    for (const k of COMMENTARY_KEYS) expect(line(k, 'x')).not.toMatch(/—/);
    expect(holeLine(-1, 'h')).toBeTruthy(); expect(holeLine(3, 'h')).toBeTruthy();
  });
  it('describes every hole without failing', () => {
    for (const id of ['parkland', 'links', 'desert', 'alpine', 'tropical']) for (let i = 0; i < 18; i++) expect(holeIntro(getHole(courseById(id), i))).toMatch(/^A .+\.$/);
  });
});

describe('tournament', () => {
  const par = (t, r) => roundHoles(r).map((h) => courseById(t.courseId).pars[h]);
  it('four rounds of six holes against 29 rivals', () => {
    const t = createTournament({ seed: 5 });
    expect(t.field.length).toBe(T_FIELD - 1);
    expect(roundHoles(0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rivalRound(t, t.field[0], 1)).toEqual(rivalRound(t, t.field[0], 1));
  });
  it('a strong player makes the cut, finishes, and wins the purse and trophy', () => {
    let t = createTournament({ seed: 9 });
    for (let r = 0; r < T_ROUNDS; r++) {
      const sc = par(t, r).map((p) => p - 2);
      const out = finishTournamentRound(t, sc);
      t = out.tournament;
      if (r === 1) { expect(out.events).toContain('made-cut'); expect(t.cut.length).toBeGreaterThanOrEqual(T_CUT_TOP - 1); }
    }
    expect(t.done).toBe(true);
    expect(t.result.position).toBe(1); expect(t.result.trophy).toBe(true); expect(t.result.coins).toBe(PURSE[0]);
    expect(finishTournamentRound(t, [1, 1, 1, 1, 1, 1]).tournament).toBe(t);
  });
  it('a weak player misses the cut after round two and gets the small payment', () => {
    let t = createTournament({ seed: 3 });
    for (let r = 0; r < 2; r++) t = finishTournamentRound(t, par(t, r).map((p) => p + 3)).tournament;
    expect(t.done).toBe(true); expect(t.missedCut).toBe(true); expect(t.result.madeCut).toBe(false);
    expect(t.result.coins).toBeLessThan(PURSE[PURSE.length - 1]);
  });
  it('the live board ranks with ties and shows movement', () => {
    const t = createTournament({ seed: 11 });
    const b0 = tournamentBoard(t, [], 0);
    expect(b0.length).toBe(T_FIELD);
    expect(b0.every((r) => r.toPar === 0 && r.pos === 1)).toBe(true);
    const b2 = tournamentBoard(t, [2, 2], 2);
    const me = b2.find((r) => r.me);
    expect(me.pos).toBe(1); expect(me.move).toBeGreaterThanOrEqual(0);
    expect(posLabel({ pos: 3, tie: true })).toBe('T3');
    const rk = rank([{ toPar: 1 }, { toPar: -1 }, { toPar: 1 }]);
    expect(rk.map((r) => r.pos)).toEqual([1, 2, 2]);
  });
  it('saves sanitize and the campaign board reveals the field hole by hole', () => {
    const t = createTournament({ seed: 2 });
    expect(sanitizeTournament(JSON.parse(JSON.stringify(t)))).toBeTruthy();
    expect(sanitizeTournament({ ...t, me: [[1, 2]] })).toBe(null);
    const field = [{ id: 'a', name: 'A', scores: [3, 3, 3] }, { id: 'b', name: 'B', scores: [5, 5, 5], boss: true }];
    const b = eventBoard('You', [4, 3], field, [4, 4, 4], 2);
    expect(b[0].id).toBe('a'); expect(b.find((r) => r.me).pos).toBe(2);
    expect(b.find((r) => r.id === 'b').boss).toBe(true);
  });
});
