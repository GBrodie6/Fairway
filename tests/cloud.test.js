// Accounts and cloud save against an in-memory Supabase stand-in (src/net/fakeSupabase.js):
// merge, conflict, migration, offline queue, session expiry, rate limits, delete, leaderboards,
// and display names. No network is used.
import { describe, it, expect } from 'vitest';
import { createSupabase, messageFor } from '../src/net/supabase.js';
import { createFakeSupabase } from '../src/net/fakeSupabase.js';
import { createSync, mergeSaves, resolveConflict, readBackups, addBackup, BACKUP_KEY, QUEUE_KEY } from '../src/net/sync.js';
import { BOARDS, sanitizeScore, fetchBoard, submitScore, periodFor, weekPeriod, dayPeriod } from '../src/net/leaderboard.js';
import { validateDisplayName, isProfane } from '../src/game/names.js';
import { defaultSave, migrateSave, SAVE_VERSION } from '../src/game/save.js';

const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const DAY = 86400000;

function setup({ t0 = 1_800_000_000_000 } = {}) {
  let clock = t0;
  const now = () => clock;
  const fake = createFakeSupabase({ now });
  const storage = store();
  const client = createSupabase({ url: 'https://demo.local', anonKey: 'anon', fetchImpl: fake.fetch, storage, now });
  let save = { ...defaultSave(), updatedAt: t0 };
  const timers = [];
  const sync = createSync({ client, storage, now, getSave: () => save, applySave: (s) => { save = s; }, setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer: () => {} });
  return { fake, client, sync, storage, get save() { return save; }, set save(s) { save = s; }, advance: (ms) => { clock += ms; }, now, timers };
}
const round = (id, date, strokes) => ({ id, date, courseId: 'parkland', mode: 'stroke', holes: 9, strokes, par: 36, toPar: strokes - 36 });

describe('dormant client', () => {
  it('without a URL and key every call is off and the message says so', async () => {
    const c = createSupabase({ url: '', anonKey: '' });
    expect(c.configured).toBe(false);
    expect((await c.signIn('a@b.co', 'password1')).error).toBe('off');
    expect(messageFor('off')).toMatch(/saved on this device/);
    const s = createSync({ client: c, storage: store(), getSave: () => defaultSave(), applySave: () => {} });
    expect(s.status).toBe('off');
    expect(s.schedule('round')).toBe(false);
  });
});

describe('auth', () => {
  it('signs up, signs out, signs in, and maps errors to plain messages', async () => {
    const { client } = setup();
    expect((await client.signUp('bad', 'password1')).error).toBe('bad-email');
    expect((await client.signUp('ana@example.com', 'short')).error).toBe('weak-password');
    const up = await client.signUp('ana@example.com', 'password1', 'Ana');
    expect(up.data.session.user.email).toBe('ana@example.com');
    expect((await client.signUp('ana@example.com', 'password1')).error).toBe('email-taken');
    await client.signOut();
    expect(client.user).toBe(null);
    expect((await client.signIn('ana@example.com', 'wrong-pass')).error).toBe('bad-credentials');
    expect((await client.signIn('ana@example.com', 'password1')).data.user.email).toBe('ana@example.com');
    expect((await client.magicLink('ana@example.com')).error).toBeUndefined();
    expect((await client.resetPassword('ana@example.com')).error).toBeUndefined();
  });
  it('refreshes an expired session once and retries; a dead session asks to sign in again', async () => {
    const env = setup();
    await env.client.signUp('kit@example.com', 'password1', 'Kit');
    env.fake.expireAll();
    const r = await env.client.select('profiles');
    expect(r.error).toBeUndefined();
    env.fake.expireAll();
    // Break the refresh token too.
    env.client.session.refresh_token = 'nope';
    const r2 = await env.client.select('saves');
    expect(r2.error).toBe('session-expired');
    expect(env.client.user).toBe(null);
  });
  it('a rate limit is a plain message', async () => {
    const env = setup();
    env.fake.rateLimitNext(1);
    const r = await env.client.signIn('a@example.com', 'password1');
    expect(r.error).toBe('rate-limited');
    expect(messageFor(r.error)).toMatch(/wait a minute/);
  });
});

describe('merge and conflict', () => {
  it('sign-up takes the guest progress into the new account', async () => {
    const env = setup();
    env.save = { ...env.save, history: [round('r1', 1, 40)], achievements: { 'first-round': 5 }, player: { name: 'Ana', handed: 'right', ball: '#fff' } };
    await env.client.signUp('ana@example.com', 'password1', 'Ana');
    const res = await env.sync.afterSignIn({ displayName: 'Ana' });
    expect(res.data.account.userId).toBe(env.client.user.id);
    const row = env.fake.tables.saves.find((r) => r.user_id === env.client.user.id);
    expect(row.data.history.map((h) => h.id)).toEqual(['r1']);
    expect(row.data.account).toBeUndefined(); // device-only part never uploaded
    expect(env.fake.tables.profiles[0].display_name).toBe('Ana');
    // Signing in again on a fresh device brings the display name back from the profile.
    await env.sync.signOut();
    env.save = defaultSave();
    await env.client.signIn('ana@example.com', 'password1');
    const again = await env.sync.afterSignIn({});
    expect(again.data.account.displayName).toBe('Ana');
    expect(again.data.player.name).toBe('Ana');
  });
  it('signing in on a device with guest progress merges both: progress only goes up', () => {
    const guest = { ...defaultSave(), history: [round('g1', 10, 38)], achievements: { birdie: 20 }, career: { xp: 500 }, daily: { '2026-11-18': { strokes: 12, toPar: 0, attempts: 1 } }, stats: { ...defaultSave().stats, rounds: 1, best: { 'parkland:9': 2 } } };
    const cloud = { ...defaultSave(), history: [round('c1', 5, 41)], achievements: { birdie: 10, 'first-round': 3 }, career: { xp: 300 }, daily: { '2026-11-18': { strokes: 14, toPar: 2, attempts: 2 } }, stats: { ...defaultSave().stats, rounds: 4, best: { 'parkland:9': 4, 'links:9': 1 } } };
    const m = mergeSaves(guest, cloud);
    expect(m.history.map((h) => h.id)).toEqual(['c1', 'g1']);
    expect(m.achievements).toEqual({ birdie: 10, 'first-round': 3 });
    expect(m.career.xp).toBe(500);
    expect(m.daily['2026-11-18']).toMatchObject({ strokes: 12, attempts: 3 });
    expect(m.stats.rounds).toBe(4);
    expect(m.stats.best).toEqual({ 'parkland:9': 2, 'links:9': 1 });
  });
  it('the newer save wins and the other is kept as a backup for 30 days', async () => {
    const env = setup();
    await env.client.signUp('ari@example.com', 'password1', 'Ari');
    await env.sync.afterSignIn({ displayName: 'Ari' });
    // Another device pushes a newer save.
    env.advance(60000);
    const row = env.fake.tables.saves[0];
    row.data = { ...row.data, history: [round('other', 99, 37)], updatedAt: env.now() };
    env.advance(1000);
    env.save = { ...env.save, updatedAt: env.now() - 120000 }; // this device is older
    const r = await env.sync.flush();
    expect(r.data).toBe('remote');
    expect(env.save.history[0].id).toBe('other');
    expect(env.save.account.userId).toBe(env.client.user.id); // the link stays
    const b = env.sync.backups();
    expect(b.length).toBe(1);
    expect(b[0].reason).toMatch(/newer cloud save/);
    // Restore puts the backup back and keeps the current one as a backup.
    expect(env.sync.restoreBackup(b[0].id)).toBe(true);
    expect(env.save.history.map((h) => h.id)).not.toContain('other');
    // After 30 days the backups are gone.
    env.advance(31 * DAY);
    expect(env.sync.backups().length).toBe(0);
  });
  it('this device newer: it is pushed, and the older cloud copy is kept as a backup', async () => {
    const env = setup();
    await env.client.signUp('jo@example.com', 'password1', 'Jo');
    await env.sync.afterSignIn({});
    env.advance(5000);
    env.save = { ...env.save, history: [round('new', 2, 36)], updatedAt: env.now() };
    const r = await env.sync.flush();
    expect(r.data).toBe('local');
    expect(env.fake.tables.saves[0].data.history[0].id).toBe('new');
    expect(env.sync.backups()[0].reason).toMatch(/older cloud save/);
  });
  it('resolveConflict handles missing sides', () => {
    expect(resolveConflict({ updatedAt: 1 }, null).source).toBe('local');
    expect(resolveConflict(null, { updatedAt: 1 }).source).toBe('remote');
  });
  it('backups are capped and pruned', () => {
    const s = store();
    for (let i = 0; i < 8; i++) addBackup(s, { n: i }, 'x', 1000 + i);
    expect(readBackups(s, 2000).length).toBe(5);
    expect(readBackups(s, 1000 + 31 * DAY).length).toBe(0);
    expect(s.getItem(BACKUP_KEY)).toBeTruthy();
  });
});

describe('migration', () => {
  it('a version 3 save gains sync fields and still syncs', async () => {
    const v3 = { version: 3, player: { name: 'Old', handed: 'right', ball: '#fff' }, career: null, history: [round('h', 1, 40)], stats: defaultSave().stats, daily: {}, achievements: {}, inProgress: null };
    const s = migrateSave(v3);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.updatedAt).toBe(0);
    expect(s.account).toBe(null);
    const env = setup();
    env.save = s;
    await env.client.signUp('old@example.com', 'password1', 'Old');
    const r = await env.sync.afterSignIn({});
    expect(r.data.history[0].id).toBe('h');
    expect(migrateSave({ ...s, account: { userId: 'u1', email: 'a@b.co', displayName: 'A'.repeat(40) } }).account.displayName.length).toBe(18);
  });
});

describe('offline queue', () => {
  it('queues while offline, keeps the request through a reload, and flushes when back', async () => {
    const env = setup();
    await env.client.signUp('max@example.com', 'password1', 'Max');
    await env.sync.afterSignIn({});
    env.fake.setOffline(true);
    env.advance(1000);
    env.save = { ...env.save, history: [round('offline', 3, 39)], updatedAt: env.now() };
    expect(env.sync.schedule('round end')).toBe(true);
    expect(env.storage.getItem(QUEUE_KEY)).toBeTruthy();
    const r = await env.sync.flush();
    expect(r.error).toBe('offline');
    expect(env.sync.status).toBe('error');
    expect(env.sync.message).toMatch(/offline/i);
    expect(env.sync.pending()).toBe(true);
    // A retry was scheduled.
    expect(env.timers.length).toBeGreaterThan(0);
    env.fake.setOffline(false);
    const r2 = await env.sync.flush();
    expect(r2.data).toBe('local');
    expect(env.sync.pending()).toBe(false);
    expect(env.fake.tables.saves[0].data.history[0].id).toBe('offline');
  });
});

describe('delete', () => {
  it('deletes the account, its cloud rows, and everything on this device', async () => {
    const env = setup();
    await env.client.signUp('del@example.com', 'password1', 'Del');
    await env.sync.afterSignIn({ displayName: 'Del' });
    await submitScore(env.client, 'level', 5, 'Del');
    addBackup(env.storage, { x: 1 }, 'x', env.now());
    const id = env.client.user.id;
    const r = await env.sync.deleteEverything(defaultSave());
    expect(r.data).toBe(true);
    expect(env.fake.tables.saves.some((x) => x.user_id === id)).toBe(false);
    expect(env.fake.tables.scores.some((x) => x.user_id === id)).toBe(false);
    expect([...env.fake.users.values()].some((u) => u.id === id)).toBe(false);
    expect(env.client.user).toBe(null);
    expect(env.save.history).toEqual([]);
    expect(env.storage.getItem(BACKUP_KEY)).toBe(null);
  });
  it('a guest delete wipes this device only', async () => {
    const env = setup();
    env.save = { ...env.save, history: [round('a', 1, 40)] };
    await env.sync.deleteEverything(defaultSave());
    expect(env.save.history).toEqual([]);
  });
  it('row level security: nobody can write another player\'s row', async () => {
    const env = setup();
    await env.client.signUp('one@example.com', 'password1', 'One');
    const r = await env.client.upsert('saves', [{ user_id: 'someone-else', data: {} }], 'user_id');
    expect(r.error).toBeDefined();
  });
});

describe('leaderboards', () => {
  it('bounds values before upload and only signed-in players write', async () => {
    expect(sanitizeScore('longdrive', 312.4)).toBe(312);
    expect(sanitizeScore('longdrive', 900)).toBe(null);
    expect(sanitizeScore('daily', -40)).toBe(null);
    expect(sanitizeScore('level', NaN)).toBe(null);
    const env = setup();
    expect((await submitScore(env.client, 'longdrive', 300, 'X')).error).toBe('session-expired');
    await env.client.signUp('a1@example.com', 'password1', 'A1');
    expect((await submitScore(env.client, 'longdrive', 2000, 'A1')).error).toBe('out-of-range');
    await submitScore(env.client, 'longdrive', 280, 'A1');
    await submitScore(env.client, 'longdrive', 301, 'A1');
    await env.client.signOut();
    await env.client.signUp('b2@example.com', 'password1', 'B2');
    await submitScore(env.client, 'longdrive', 290, 'B2');
    const board = await fetchBoard(env.client, 'longdrive');
    expect(board.data.rows.map((r) => [r.name, r.value])).toEqual([['A1', 301], ['B2', 290]]);
    expect(board.data.rows[1].me).toBe(true);
  });
  it('period keys are stable', () => {
    const t = Date.UTC(2026, 10, 18, 12);
    expect(dayPeriod(t)).toBe('2026-11-18');
    expect(weekPeriod(t)).toBe('2026-W47');
    expect(periodFor('level', t)).toBe('all');
    expect(Object.keys(BOARDS)).toEqual(['daily', 'longdrive', 'target', 'level']);
  });
});

describe('display names', () => {
  it('validates length, characters, links, and profanity with letter swaps', () => {
    expect(validateDisplayName('Ana').ok).toBe(true);
    expect(validateDisplayName('  Kit   Vale ').name).toBe('Kit Vale');
    expect(validateDisplayName('ab').ok).toBe(false);
    expect(validateDisplayName('x'.repeat(19)).ok).toBe(false);
    expect(validateDisplayName('go<script>').ok).toBe(false);
    expect(validateDisplayName('www.win.com').ok).toBe(false);
    expect(validateDisplayName('Sh1tShot').ok).toBe(false);
    expect(isProfane('F u u c k')).toBe(true);
    expect(isProfane('Dickens')).toBe(false);
    expect(validateDisplayName('José Núñez').ok).toBe(true);
  });
});
