import { describe, it, expect } from 'vitest';
import { makeChallenge, encodeChallenge, decodeChallenge, validateChallenge, challengeUrl, readChallengeFromHash, mergeIntoChallenge, toCompact, challengeStandings } from '../src/game/share.js';
import { createRound } from '../src/game/round.js';

function sampleRound() {
  const r = createRound({ courseId: 'links', mode: 'stroke', holeCount: 9, seed: 12345, tod: 'golden', players: [{ name: 'Ana' }] });
  r.scores[0] = [4, 5, 3, 5, 4, 4, 5, 3, 4];
  return r;
}

describe('challenge links', () => {
  it('round-trips through a URL hash', () => {
    const ch = makeChallenge(sampleRound());
    const url = challengeUrl('https://example.test/play/?x=1#old', ch);
    expect(url.startsWith('https://example.test/play/?x=1#c=')).toBe(true);
    expect(url.length).toBeLessThan(400);
    const back = readChallengeFromHash(url.slice(url.indexOf('#')));
    expect(back.ok).toBe(true);
    expect(back.challenge).toMatchObject({ courseId: 'links', seed: 12345, tod: 'golden', holes: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    expect(back.challenge.players[0]).toEqual({ name: 'Ana', scores: [4, 5, 3, 5, 4, 4, 5, 3, 4] });
  });
  it('detects edits and damage', () => {
    const tok = encodeChallenge(makeChallenge(sampleRound()));
    // Change one score inside the payload and re-encode the body without a new checksum.
    const [body, sum] = tok.split('.');
    const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    json.p[0][1][0] = 1;
    const forged = Buffer.from(JSON.stringify(json)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sum;
    expect(decodeChallenge(forged).ok).toBe(false);
    expect(decodeChallenge(forged).reason).toMatch(/changed or damaged/);
    expect(decodeChallenge(tok.slice(0, -3)).ok).toBe(false);
    expect(decodeChallenge('').ok).toBe(false);
    expect(decodeChallenge('x'.repeat(5000)).ok).toBe(false);
    expect(decodeChallenge('!!!!!!!!.abc').ok).toBe(false);
    expect(readChallengeFromHash('#nothing')).toBe(null);
  });
  it('rejects impossible content even with a valid checksum', () => {
    const base = toCompact({ courseId: 'parkland', holes: [0, 1, 2], seed: 1, tod: 'morning', players: [{ name: 'A', scores: [4, 5, 3] }] });
    const bad = (mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return decodeChallenge(encodeChallenge(c)); };
    expect(bad(() => {}).ok).toBe(true);
    expect(bad((c) => { c.c = 'moon'; }).ok).toBe(false);
    expect(bad((c) => { c.h = [0, 0]; }).ok).toBe(false);
    expect(bad((c) => { c.h = [42]; }).ok).toBe(false);
    expect(bad((c) => { c.p[0][1] = [0, 5, 3]; }).ok).toBe(false);
    expect(bad((c) => { c.p[0][1] = [4, 5, 99]; }).ok).toBe(false);
    expect(bad((c) => { c.p[0][1] = [4, 5, 3, 4]; }).ok).toBe(false);
    expect(bad((c) => { c.p.push(['A', []]); }).ok).toBe(false);
    expect(bad((c) => { c.p = [['a', []], ['b', []], ['c', []], ['d', []], ['e', []]]; }).ok).toBe(false);
    expect(bad((c) => { c.v = 9; }).ok).toBe(false);
    expect(bad((c) => { c.s = -4; }).ok).toBe(false);
    // Markup in a name is stripped, not executed or refused.
    const n = bad((c) => { c.p[0][0] = '<b>Al</b>'; });
    expect(n.ok).toBe(true);
    expect(n.challenge.players[0].name).toBe('bAl/b');
    // An unknown time of day falls back to morning.
    expect(bad((c) => { c.t = 'eclipse'; }).challenge.tod).toBe('morning');
  });
  it('merges a new player and ranks over common holes', () => {
    const ch = validateChallenge(makeChallenge(sampleRound())).challenge;
    const merged = mergeIntoChallenge(ch, 'Ben', [3, 5, 3]);
    expect(merged.players.length).toBe(2);
    const st = challengeStandings(merged);
    // Over the three holes both have finished, Ben is one better.
    expect(st[0].name).toBe('Ben');
    expect(st[0].common).toBe(st[1].common - 1);
    const again = mergeIntoChallenge(merged, 'Ben', [3, 4, 3, 4]);
    expect(again.players.length).toBe(2);
    expect(again.players[1].scores).toEqual([3, 4, 3, 4]);
    // The challenge survives another round trip after merging.
    expect(decodeChallenge(encodeChallenge(toCompact(again))).ok).toBe(true);
  });
});
