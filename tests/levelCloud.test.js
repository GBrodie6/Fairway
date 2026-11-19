// Community holes in the cloud (src/net/levels.js) against the in-memory stand-in, which
// follows the server's rules: public reading, game accounts only for writes, 10 a day and 100
// in all, likes toggle, a hole hidden at 5 reports, plays counted, best scores per hole, and
// Delete my data removing the player's holes.
import { describe, it, expect } from 'vitest';
import { createSupabase } from '../src/net/supabase.js';
import { createFakeSupabase } from '../src/net/fakeSupabase.js';
import { createSync } from '../src/net/sync.js';
import { RPCS, LEVEL_TABLES, LEVEL_RPCS } from '../src/net/tables.js';
import { signUpPayload, authEmail } from '../src/net/account.js';
import { listLevels, getLevel, publishLevel, updateLevel, deleteLevel, likeLevel, reportLevel, playedLevel, submitLevelScore, levelBest, rowToLevel } from '../src/net/levels.js';
import { TEMPLATES } from '../src/game/level.js';
import { defaultSave } from '../src/game/save.js';

function env() {
  let t = 1_800_000_000_000;
  const fake = createFakeSupabase({ now: () => t });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const client = createSupabase({ url: 'https://demo.local', anonKey: 'anon', fetchImpl: fake.fetch, storage, now: () => t });
  const join = async (u) => { const ch = (await client.rpc(RPCS.newChallenge)).data; t += 2500; await client.signUp(signUpPayload({ username: u, password: 'password1', challengeId: ch.id, answer: fake.lastChallenge().answer })); };
  return { fake, client, join, advance: (ms) => { t += ms; }, storage };
}

describe('community holes in the cloud', () => {
  it('names live in the constants file', () => {
    expect(LEVEL_TABLES).toEqual({ levels: 'fairway_levels', likes: 'fairway_level_likes', reports: 'fairway_level_reports' });
    expect(LEVEL_RPCS).toEqual({ like: 'fairway_level_like', report: 'fairway_level_report', played: 'fairway_level_played' });
  });
  it('publish, read, like, report, play, update, delete; guests can only read', async () => {
    const e = env();
    expect((await publishLevel(e.client, TEMPLATES[0].make(), 'Ana')).error).toBe('signin');
    await e.join('ana');
    const p = await publishLevel(e.client, TEMPLATES[0].make(), 'Ana');
    expect(p.data.name).toBe('Island Carry');
    const call = e.fake.calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/fairway_levels');
    expect(Object.keys(call.body[0]).sort()).toEqual(['author', 'data', 'name', 'par', 'user_id']);
    const id = p.data.id;
    expect((await getLevel(e.client, id)).data.level).toEqual(TEMPLATES[0].make());
    expect((await likeLevel(e.client, id)).data).toBe(true);
    expect((await likeLevel(e.client, id)).data).toBe(false);
    await likeLevel(e.client, id);
    await playedLevel(e.client, id);
    const listed = (await listLevels(e.client, 'new')).data;
    expect(listed.map((l) => [l.id, l.likes, l.plays])).toEqual([[id, 1, 1]]);
    expect((await listLevels(e.client, 'mine')).data.length).toBe(1);
    await updateLevel(e.client, id, { ...TEMPLATES[0].make(), name: 'Renamed Carry' });
    expect((await getLevel(e.client, id)).data.name).toBe('Renamed Carry');
    // Best scores per hole through the scores table.
    await submitLevelScore(e.client, id, 3, 'Ana');
    await submitLevelScore(e.client, id, 2, 'Ana');
    expect((await levelBest(e.client, id)).data).toEqual({ best: { name: 'Ana', value: 2 }, mine: 2 });
    expect((await submitLevelScore(e.client, id, 40, 'Ana')).error).toBe('out-of-range');
    // A guest reads the board but cannot write.
    await e.client.signOut();
    expect((await listLevels(e.client, 'top')).data.length).toBe(1);
    expect((await likeLevel(e.client, id)).error).toBe('signin');
    await e.join('ben');
    expect((await deleteLevel(e.client, id)).error).toBeUndefined();
    expect((await getLevel(e.client, id)).data).toBeDefined(); // not Ben's to delete
  });
  it('the publishing limit and hiding at five reports', async () => {
    const e = env();
    await e.join('maker');
    for (let i = 0; i < 10; i++) expect((await publishLevel(e.client, TEMPLATES[i % 6].make(), 'Maker')).data).toBeTruthy();
    expect((await publishLevel(e.client, TEMPLATES[0].make(), 'Maker')).error).toBe('limit');
    const id = (await listLevels(e.client, 'new')).data[0].id;
    for (const u of ['r1', 'r2', 'r3', 'r4', 'r5']) { await e.client.signOut(); await e.join(u); await reportLevel(e.client, id, 'Unplayable'); }
    expect((await listLevels(e.client, 'new')).data.some((l) => l.id === id)).toBe(false);
  });
  it('rows that do not load are skipped, never shown', () => {
    expect(rowToLevel({ id: 'not a uuid', data: TEMPLATES[0].make() })).toBe(null);
    expect(rowToLevel({ id: '12345678-aaaa', data: { v: 1, evil: true } })).toBe(null);
    expect(rowToLevel({ id: '12345678-aaaa', data: TEMPLATES[0].make(), author: '<b>x</b>' }).author).toBe('bx/b');
  });
  it('Delete my data removes the player\'s holes too', async () => {
    const e = env();
    await e.join('gone');
    await publishLevel(e.client, TEMPLATES[1].make(), 'Gone');
    let save = defaultSave();
    const sync = createSync({ client: e.client, storage: e.storage, getSave: () => save, applySave: (s) => { save = s; }, setTimer: () => 0, clearTimer: () => {} });
    expect((await sync.deleteEverything(defaultSave())).data).toBe(true);
    expect(e.fake.tables.fairway_levels.length).toBe(0);
    expect((await e.client.signIn(authEmail('gone'), 'password1')).error).toBe('bad-credentials');
  });
});
