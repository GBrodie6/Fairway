import { describe, it, expect } from 'vitest';
import { scoreName, formatRelative, strokeTotals, leaderboard, stablefordPoints, matchPlayStatus, skinsResult, closestToPin, roundStats, isGir, maxStrokes } from '../src/game/scoring.js';

describe('score names', () => {
  it('names results relative to par', () => {
    expect(scoreName(1, 3)).toBe('Hole in one');
    expect(scoreName(2, 5)).toBe('Albatross');
    expect(scoreName(3, 5)).toBe('Eagle');
    expect(scoreName(3, 4)).toBe('Birdie');
    expect(scoreName(4, 4)).toBe('Par');
    expect(scoreName(5, 4)).toBe('Bogey');
    expect(scoreName(6, 4)).toBe('Double bogey');
    expect(scoreName(7, 4)).toBe('Triple bogey');
    expect(scoreName(9, 4)).toBe('+5');
  });
  it('formats relative scores', () => {
    expect(formatRelative(0)).toBe('E');
    expect(formatRelative(3)).toBe('+3');
    expect(formatRelative(-2)).toBe('-2');
    expect(formatRelative(NaN)).toBe('');
  });
});

describe('stroke play', () => {
  const pars = [4, 5, 3, 4];
  it('totals only played holes', () => {
    const t = strokeTotals([4, 6, undefined, null], pars);
    expect(t).toMatchObject({ strokes: 10, par: 9, toPar: 1, played: 2, complete: false });
    expect(strokeTotals([3, 4, 3, 4], pars)).toMatchObject({ toPar: -2, complete: true });
    expect(strokeTotals([], pars)).toMatchObject({ strokes: 0, toPar: 0, played: 0 });
  });
  it('ranks a leaderboard with ties sharing a position', () => {
    const lb = leaderboard([
      { id: 'a', name: 'A', scores: [4, 5, 3, 4] },
      { id: 'b', name: 'B', scores: [3, 5, 3, 4] },
      { id: 'c', name: 'C', scores: [4, 5, 3, 4] },
      { id: 'd', name: 'D', scores: [5, 6, 4, 5] },
    ], pars);
    expect(lb.map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(lb.map((r) => r.pos)).toEqual([1, 2, 2, 4]);
    expect(lb[1].tied).toBe(true);
    expect(lb[0].tied).toBe(false);
  });
  it('stableford points', () => {
    expect(stablefordPoints(4, 4)).toBe(2);
    expect(stablefordPoints(3, 4)).toBe(3);
    expect(stablefordPoints(2, 4)).toBe(4);
    expect(stablefordPoints(5, 4)).toBe(1);
    expect(stablefordPoints(7, 4)).toBe(0);
    expect(stablefordPoints(undefined, 4)).toBe(0);
  });
});

describe('match play', () => {
  it('tracks the running state', () => {
    expect(matchPlayStatus([], [], 18).text).toBe('All square');
    const s = matchPlayStatus([4, 4, 3], [5, 4, 4], 18);
    expect(s.holesUp).toBe(2);
    expect(s.text).toBe('2 UP');
    expect(s.closed).toBe(false);
    expect(matchPlayStatus([5, 4], [4, 4], 18).holesUp).toBe(-1);
  });
  it('closes the match when the lead exceeds the holes remaining', () => {
    // A wins the first 10 holes of 18: 10 up with 8 to play.
    const a = new Array(10).fill(3), b = new Array(10).fill(4);
    const s = matchPlayStatus(a, b, 18);
    expect(s.closed).toBe(true);
    expect(s.winner).toBe('a');
    expect(s.text).toBe('10 & 8');
  });
  it('reports the classic 3 and 2', () => {
    // 16 holes played, A is 3 up with 2 to go.
    const a = [], b = [];
    for (let i = 0; i < 16; i++) { a.push(4); b.push(i < 3 ? 5 : 4); }
    const s = matchPlayStatus(a, b, 18);
    expect(s.text).toBe('3 & 2');
    expect(s.played).toBe(16);
  });
  it('stops counting holes after the match is closed', () => {
    const a = new Array(18).fill(3), b = new Array(18).fill(4);
    const s = matchPlayStatus(a, b, 18);
    expect(s.played).toBe(10);
    expect(s.holeResults.length).toBe(10);
  });
  it('dormie, final hole win, and a halved match', () => {
    const a = [], b = [];
    for (let i = 0; i < 16; i++) { a.push(4); b.push(i < 2 ? 5 : 4); }
    expect(matchPlayStatus(a, b, 18).text).toBe('Dormie 2');
    const a2 = new Array(18).fill(4), b2 = new Array(18).fill(4);
    expect(matchPlayStatus(a2, b2, 18)).toMatchObject({ text: 'Match halved', winner: 'tie', closed: true });
    b2[17] = 5;
    expect(matchPlayStatus(a2, b2, 18)).toMatchObject({ text: '1 UP', winner: 'a', closed: true });
  });
  it('works for 9 hole matches', () => {
    const s = matchPlayStatus([3, 3, 3, 3, 3], [4, 4, 4, 4, 4], 9);
    expect(s.closed).toBe(true);
    expect(s.text).toBe('5 & 4');
  });
});

describe('skins', () => {
  it('awards a skin to the outright low score', () => {
    const r = skinsResult([[4, 3], [5, 4], [5, 5]], 2);
    expect(r.skins).toEqual([2, 0, 0]);
    expect(r.holeWinners).toEqual([0, 0]);
  });
  it('carries tied holes forward', () => {
    const r = skinsResult([[4, 4, 3, 4], [4, 4, 4, 4], [5, 4, 4, 3]], 4);
    expect(r.holeWinners).toEqual([-1, -1, 0, 2]);
    expect(r.values).toEqual([0, 0, 3, 1]);
    expect(r.skins).toEqual([3, 0, 1]);
    expect(r.carry).toBe(0);
  });
  it('reports skins left on the table and total is conserved', () => {
    const r = skinsResult([[4, 4, 4], [4, 4, 4]], 3);
    expect(r.carry).toBe(3);
    expect(r.skins).toEqual([0, 0]);
    const r2 = skinsResult([[4, 3, 4, 4, 3], [4, 4, 4, 4, 4]], 5);
    expect(r2.skins.reduce((a, b) => a + b, 0) + r2.carry).toBe(5);
  });
  it('without carry-over tied holes are simply lost', () => {
    const r = skinsResult([[4, 3], [4, 4]], 2, { carryOver: false });
    expect(r.skins).toEqual([1, 0]);
  });
  it('stops at the first incomplete hole', () => {
    const r = skinsResult([[4, undefined], [5, 4]], 2);
    expect(r.holeWinners).toEqual([0]);
  });
});

describe('closest to the pin', () => {
  it('ranks by distance and puts missed greens last', () => {
    const r = closestToPin([{ id: 'a', distance: 4.2 }, { id: 'b', distance: null }, { id: 'c', distance: 1.1 }, { id: 'd', distance: undefined }]);
    expect(r.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(r[0].pos).toBe(1);
    expect(r[2].onGreen).toBe(false);
  });
});

describe('round stats', () => {
  const holes = [
    { par: 4, strokes: 4, putts: 2, fairwayHit: true, gir: true, driveDistance: 240, penalties: 0 },
    { par: 3, strokes: 2, putts: 1, fairwayHit: null, gir: true, penalties: 0 },
    { par: 5, strokes: 7, putts: 3, fairwayHit: false, gir: false, driveDistance: 262, penalties: 1 },
    { par: 4, strokes: 2, putts: 0, fairwayHit: true, gir: true, driveDistance: 250, penalties: 0 },
    undefined,
    { par: 4 },
  ];
  it('aggregates the scorecard stats', () => {
    const s = roundStats(holes);
    expect(s).toMatchObject({ holes: 4, strokes: 15, toPar: -1, putts: 6, fairwaysHit: 2, fairwaysPossible: 3, gir: 3, penalties: 1, longestDrive: 262, eagles: 1, birdies: 1, pars: 1, bogeys: 0, doubles: 1 });
    expect(s.averageDrive).toBeCloseTo((240 + 262 + 250) / 3, 6);
  });
  it('handles an empty round', () => {
    const s = roundStats([]);
    expect(s.holes).toBe(0);
    expect(s.averageDrive).toBe(0);
    expect(s.longestDrive).toBe(0);
  });
  it('green in regulation and stroke cap', () => {
    expect(isGir(2, 4)).toBe(true);
    expect(isGir(3, 4)).toBe(false);
    expect(isGir(1, 3)).toBe(true);
    expect(isGir(3, 5)).toBe(true);
    expect(isGir(undefined, 4)).toBe(false);
    expect(maxStrokes(4)).toBe(9);
  });
});
