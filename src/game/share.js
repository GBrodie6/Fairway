// Async multiplayer through links. A challenge link carries the round setup (course, holes,
// seed, time of day) and every player's scores so far. Because wind, pins, and lies are all
// seeded from the round, everyone who opens the link plays exactly the same conditions.
// The link lives in the URL hash, so it never reaches a server.
//
// Integrity: the payload carries a checksum. It catches damaged links and casual edits. It is
// NOT security: the checksum key ships with the game, so a determined player can forge a link.
// Real-time play would need a server that replays the shots; that is behind a flag only.
import { courseById, COURSES } from '../course/courses.js';
import { holesFor } from './round.js';
import { maxStrokes } from './scoring.js';
import { TOD_ORDER } from '../render/timeOfDay.js';

export const SHARE_VERSION = 1;
const KEY = 'fwn1';
const MAX_PLAYERS = 4;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const b64url = {
  enc(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s) {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  },
};

// Compact challenge: { v, c: courseId, h: [hole indices], s: seed, t: tod, p: [[name, [scores]]] }
export function makeChallenge(round, { includeIncomplete = true } = {}) {
  const players = round.players.map((p, i) => [p.name, (round.scores[i] || []).filter((x, k) => k < round.holes.length).map((x) => (Number.isFinite(x) ? x : null))]);
  return { v: SHARE_VERSION, c: round.courseId, h: round.holes.slice(), s: round.seed >>> 0, t: round.tod, p: includeIncomplete ? players : players.filter(([, sc]) => sc.length === round.holes.length) };
}

export function encodeChallenge(ch) {
  const body = JSON.stringify(ch);
  const sum = fnv(KEY + body).toString(36);
  return `${b64url.enc(body)}.${sum}`;
}

// Returns { ok: true, challenge } or { ok: false, reason } with a reason a person can read.
export function decodeChallenge(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 4000) return { ok: false, reason: 'This link is incomplete.' };
  const dot = token.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'This link is incomplete.' };
  let body;
  try { body = b64url.dec(token.slice(0, dot)); } catch { return { ok: false, reason: 'This link is damaged.' }; }
  if (fnv(KEY + body).toString(36) !== token.slice(dot + 1)) return { ok: false, reason: 'This link was changed or damaged, so its scores cannot be trusted.' };
  let ch;
  try { ch = JSON.parse(body); } catch { return { ok: false, reason: 'This link is damaged.' }; }
  const v = validateChallenge(ch);
  return v.ok ? { ok: true, challenge: v.challenge } : v;
}

export function validateChallenge(ch) {
  const bad = (reason) => ({ ok: false, reason });
  if (!ch || typeof ch !== 'object' || ch.v !== SHARE_VERSION) return bad('This link is from a different version of the game.');
  const course = COURSES.find((c) => c.id === ch.c);
  if (!course) return bad('This link names a course that does not exist.');
  if (!Array.isArray(ch.h) || ch.h.length < 1 || ch.h.length > 18) return bad('This link has the wrong number of holes.');
  if (!ch.h.every((x) => Number.isInteger(x) && x >= 0 && x < 18) || new Set(ch.h).size !== ch.h.length) return bad('This link names holes that do not exist.');
  if (!Number.isInteger(ch.s) || ch.s < 0 || ch.s > 0xffffffff) return bad('This link is damaged.');
  const tod = TOD_ORDER.includes(ch.t) ? ch.t : 'morning';
  if (!Array.isArray(ch.p) || ch.p.length < 1 || ch.p.length > MAX_PLAYERS) return bad('This link has too many players.');
  const names = new Set();
  const players = [];
  for (const entry of ch.p) {
    if (!Array.isArray(entry) || entry.length !== 2) return bad('This link is damaged.');
    const [rawName, scores] = entry;
    const name = String(rawName ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Player';
    if (names.has(name)) return bad('This link lists the same player twice.');
    names.add(name);
    if (!Array.isArray(scores) || scores.length > ch.h.length) return bad('This link has scores for holes that were not played.');
    for (let i = 0; i < scores.length; i++) {
      const sc = scores[i];
      if (sc === null) continue;
      const par = course.pars[ch.h[i]];
      if (!Number.isInteger(sc) || sc < 1 || sc > maxStrokes(par)) return bad('This link has a score that is not possible.');
    }
    players.push({ name, scores: scores.slice() });
  }
  return { ok: true, challenge: { v: SHARE_VERSION, courseId: course.id, holes: ch.h.slice(), seed: ch.s >>> 0, tod, players } };
}

// The link for a challenge, given the page's base URL.
export function challengeUrl(base, ch) {
  const u = String(base).split('#')[0];
  return `${u}#c=${encodeChallenge(ch)}`;
}
export function readChallengeFromHash(hash) {
  const m = /(?:^#|&)c=([^&]+)/.exec(hash || '');
  return m ? decodeChallenge(decodeURIComponent(m[1])) : null;
}

// Merge a finished (or partial) local round into a challenge: the local player's scores
// replace their old entry or are added as a new player.
export function mergeIntoChallenge(ch, name, scores) {
  const players = ch.players.map((p) => ({ ...p, scores: p.scores.slice() }));
  const i = players.findIndex((p) => p.name === name);
  if (i >= 0) players[i].scores = scores.slice(0, ch.holes.length);
  else if (players.length < MAX_PLAYERS) players.push({ name, scores: scores.slice(0, ch.holes.length) });
  return { ...ch, players };
}
export function toCompact(ch) {
  return { v: SHARE_VERSION, c: ch.courseId, h: ch.holes.slice(), s: ch.seed >>> 0, t: ch.tod, p: ch.players.map((p) => [p.name, p.scores.slice()]) };
}

// Standings across a challenge: totals over the holes everyone has finished, and over all.
export function challengeStandings(ch) {
  const course = courseById(ch.courseId);
  const common = ch.holes.map((_, i) => ch.players.every((p) => Number.isFinite(p.scores[i])));
  return ch.players.map((p) => {
    let total = 0, par = 0, played = 0, cTotal = 0, cPar = 0;
    p.scores.forEach((s, i) => {
      if (!Number.isFinite(s)) return;
      total += s; par += course.pars[ch.holes[i]]; played++;
      if (common[i]) { cTotal += s; cPar += course.pars[ch.holes[i]]; }
    });
    return { name: p.name, total, toPar: total - par, played, common: cTotal - cPar };
  }).sort((a, b) => a.common - b.common || a.toPar - b.toPar);
}

export function defaultChallengeHoles(courseId, n) {
  return holesFor(courseId, 'stroke', n, 1);
}
