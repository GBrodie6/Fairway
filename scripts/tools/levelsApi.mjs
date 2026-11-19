// The community holes' server contract against a real Supabase project, from Node, with a
// throwaway account that is deleted at the end: sign-up through the robot check, publish a
// template, read it back from New, like (and unlike, and like again), Top, Mine, count a play,
// report it once, post a best score on its board, read the best, delete it, then Delete my data.
// The robot-check picture is saved as <prefix>-pic-<n>.png and the tool waits for the digits in
// <prefix>-answer-<n>.txt (a person, or the agent running it, reads the picture).
//   node scripts/tools/levelsApi.mjs qa/tmp/lvapi/a
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createSupabase } from '../../src/net/supabase.js';
import { RPCS, TABLES, LEVEL_TABLES } from '../../src/net/tables.js';
import { signUpPayload, isGameAccount, authEmail } from '../../src/net/account.js';
import { TEMPLATES } from '../../src/game/level.js';
import { listLevels, getLevel, publishLevel, likeLevel, reportLevel, playedLevel, submitLevelScore, levelBest, deleteLevel } from '../../src/net/levels.js';

const [prefix = 'qa/tmp/lvapi/a'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const env = Object.fromEntries(readFileSync('.env.production', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const client = createSupabase({ url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY, storage });
const out = { project: (env.VITE_SUPABASE_URL || '').replace(/^https:\/\//, ''), steps: {} };
const step = (k, v) => { out.steps[k] = v; console.log(k, JSON.stringify(v).slice(0, 300)); };
const user = `fwlvapi${Math.floor(100000 + Math.random() * 900000)}`;
const pass = `Fw-${Math.random().toString(36).slice(2, 10)}-5`;
out.username = user;
let id = null;
try {
  // Sign-up through the robot check (up to 5 pictures).
  for (let n = 1; n <= 5 && !client.user; n++) {
    const c = await client.rpc(RPCS.newChallenge);
    const d = c.data && (Array.isArray(c.data) ? c.data[0] : c.data);
    if (!d || !d.svg) throw new Error(`no picture: ${JSON.stringify(c).slice(0, 200)}`);
    await sharp(Buffer.from(d.svg)).resize({ width: 600 }).png().toFile(`${prefix}-pic-${n}.png`);
    const f = `${prefix}-answer-${n}.txt`;
    console.log(`PICTURE ${prefix}-pic-${n}.png -> write the digits to ${f}`);
    const shown = Date.now();
    while (!existsSync(f)) { if (Date.now() - shown > 540000) throw new Error('no answer in 9 minutes'); await new Promise((r) => setTimeout(r, 1000)); }
    const answer = readFileSync(f, 'utf8').trim();
    if (Date.now() - shown < 2100) await new Promise((r) => setTimeout(r, 2100 - (Date.now() - shown)));
    const r = await client.signUp(signUpPayload({ username: user, password: pass, challengeId: d.id, answer }));
    step(`signUp${n}`, r.error ? { error: r.error } : { ok: true, gameAccount: isGameAccount(client.user) });
  }
  if (!client.user) throw new Error('not signed up');
  // Reading is public: New without a session works too.
  const anon = createSupabase({ url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY });
  const pub = await listLevels(anon, 'new', { limit: 5 });
  step('publicNew', pub.error ? { error: pub.error } : { rows: pub.data.length });
  // Publish a template.
  const lv = { ...TEMPLATES[0].make(), name: `API check ${Math.floor(Math.random() * 900 + 100)}` };
  const p = await publishLevel(client, lv, user);
  step('publish', p.error ? { error: p.error } : { id: p.data && p.data.id, name: p.data && p.data.name, par: p.data && p.data.par });
  id = p.data && p.data.id;
  if (!id) throw new Error('publish failed');
  const nw = await listLevels(client, 'new', { limit: 30 });
  step('inNew', nw.error ? { error: nw.error } : { found: nw.data.some((x) => x.id === id), first: nw.data[0] && nw.data[0].name });
  const g = await getLevel(anon, id);
  step('getPublic', g.error ? { error: g.error } : { name: g.data.name, author: g.data.author, likes: g.data.likes, plays: g.data.plays });
  step('like', await likeLevel(client, id));
  step('likesAfterLike', (await getLevel(anon, id)).data.likes);
  step('unlike', await likeLevel(client, id));
  step('likesAfterUnlike', (await getLevel(anon, id)).data.likes);
  step('likeAgain', await likeLevel(client, id));
  const top = await listLevels(anon, 'top', { limit: 50 });
  step('inTop', top.error ? { error: top.error } : top.data.some((x) => x.id === id));
  const mine = await listLevels(client, 'mine');
  step('inMine', mine.error ? { error: mine.error } : mine.data.map((x) => x.name));
  step('played', await playedLevel(client, id));
  step('playsAfter', (await getLevel(anon, id)).data.plays);
  step('report', await reportLevel(client, id, 'Something else'));
  step('reportAgain', await reportLevel(client, id, 'Something else'));
  step('stillVisible', !(await getLevel(anon, id)).error);
  step('score', await submitLevelScore(client, id, 3, user));
  step('best', await levelBest(client, id));
  // Someone else's session cannot delete it (anonymous here).
  step('anonDelete', await deleteLevel(anon, id));
  step('stillThere', !(await getLevel(anon, id)).error);
  step('delete', await deleteLevel(client, id));
  step('goneAfterDelete', !!(await getLevel(anon, id)).error);
} catch (e) { out.failed = String(e.message || e); console.log('FAILED', out.failed); }
// Delete my data, as the app does it.
try {
  if (client.user) {
    const uid = encodeURIComponent(client.user.id);
    const del = {};
    for (const [t, q] of [[TABLES.scores, `user_id=eq.${uid}`], [TABLES.saves, `user_id=eq.${uid}`], [TABLES.profiles, `id=eq.${uid}`], [LEVEL_TABLES.levels, `user_id=eq.${uid}`]]) del[t] = (await client.remove(t, q)).error || 'ok';
    del.rpc = (await client.rpc(RPCS.deleteMyAccount)).error || 'ok';
    await client.signOut({ local: true });
    step('deleteMyData', del);
    const again = await client.signIn(authEmail(user), pass);
    step('signInAfterDelete', again && again.error ? { error: again.error } : { signedIn: !!client.user });
  }
} catch (e) { out.deleteFailed = String(e.message || e); }
writeFileSync(`${prefix}.json`, JSON.stringify(out, null, 1));
console.log('DONE');
