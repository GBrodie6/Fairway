// An in-memory stand-in for the Supabase endpoints this game uses, as a fetch function. It is
// used by the unit tests and by the "?cloud=demo" mode, which lets the account screens be tried
// and screenshotted without a real project (nothing leaves the device in that mode).
//
// It follows the real project's rules where they matter (OVERHAUL.md, Accounts): the fairway_
// tables and their columns, row level security (own rows only; scores and levels readable by
// everyone), the robot check (a game sign-up needs a picture answer that is right, unused, at
// least 2 seconds and at most 10 minutes old), the app_metadata.fairway flag that every write
// needs, email confirmation off, tokens that expire, and fairway_delete_my_account.
import { TABLES, RPCS } from './tables.js';

const KEYS = { [TABLES.profiles]: 'id', [TABLES.saves]: 'user_id', [TABLES.scores]: null };
const OWNER = { [TABLES.profiles]: 'id', [TABLES.saves]: 'user_id', [TABLES.scores]: 'user_id' };
const PUBLIC_READ = new Set([TABLES.scores]);

// A plain picture of 5 digits for the demo (the real server draws its own, noisier one).
export function demoChallengeSvg(digits) {
  const chars = String(digits).split('').map((d, i) => `<text x="${24 + i * 38}" y="${52 + (i % 2 ? 6 : -4)}" font-family="monospace" font-size="38" fill="#2b3a2f" transform="rotate(${(i % 3) * 6 - 6} ${30 + i * 38} 45)">${d}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="80" viewBox="0 0 220 80"><rect width="220" height="80" fill="#f4efe0"/>${chars}</svg>`;
}

export function createFakeSupabase({ now = () => Date.now(), tokenTtl = 3600, digits = null } = {}) {
  const users = new Map(); // email -> { id, email, password, meta, app }
  const tokens = new Map(); // access token -> { userId, exp }
  const refreshTokens = new Map(); // refresh token -> userId
  const challenges = new Map(); // id -> { answer, at, used }
  const tables = { [TABLES.profiles]: [], [TABLES.saves]: [], [TABLES.scores]: [] };
  const extra = { rpc: {}, tables: {} }; // later parts register their own tables and procedures here
  let seq = 1, offline = false, failNext = null, rateLimit = 0, lastChallenge = null;
  const calls = [];

  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const userJson = (user) => ({ id: user.id, email: user.email, app_metadata: { provider: 'email', ...(user.app.fairway ? { fairway: true } : {}) }, user_metadata: user.meta });
  const issue = (user) => {
    const access = `at-${user.id}-${seq++}`, refresh = `rt-${user.id}-${seq++}`;
    tokens.set(access, { userId: user.id, exp: Math.round(now() / 1000) + tokenTtl });
    refreshTokens.set(refresh, user.id);
    return { access_token: access, refresh_token: refresh, expires_in: tokenTtl, expires_at: Math.round(now() / 1000) + tokenTtl, token_type: 'bearer', user: userJson(user) };
  };
  const userById = (id) => [...users.values()].find((x) => x.id === id);
  const userFromAuth = (h) => {
    const t = String(h.Authorization || '').replace(/^Bearer /, '');
    const rec = tokens.get(t);
    if (!rec) return { anon: true };
    if (rec.exp < now() / 1000) return { expired: true };
    const u = userById(rec.userId);
    return u ? { userId: rec.userId, verified: !!u.app.fairway } : { anon: true };
  };
  // PostgREST-style filters: col=eq.value, col->>key=eq.value, gte, lte, order=col.asc|desc, limit=n.
  const get = (r, k) => { const m = /^(\w+)->>(\w+)$/.exec(k); return m ? (r[m[1]] || {})[m[2]] : r[k]; };
  function filter(rows, qs) {
    const p = new URLSearchParams(qs);
    let out = rows.slice();
    for (const [k, v] of p) {
      if (k === 'order' || k === 'limit' || k === 'select' || k === 'on_conflict' || k === 'offset') continue;
      const m = /^(eq|gte|lte|neq)\.(.*)$/.exec(v);
      if (!m) continue;
      out = out.filter((r) => { const a = get(r, k); return m[1] === 'eq' ? String(a) === m[2] : m[1] === 'neq' ? String(a) !== m[2] : m[1] === 'gte' ? Number(a) >= Number(m[2]) : Number(a) <= Number(m[2]); });
    }
    return out;
  }
  function query(rows, qs) {
    const p = new URLSearchParams(qs);
    let out = filter(rows, qs);
    if (p.get('order')) { const [col, dir] = p.get('order').split('.'); out.sort((a, b) => { const x = a[col], y = b[col]; const d = typeof x === 'string' ? String(x).localeCompare(String(y)) : x - y; return dir === 'desc' ? -d : d; }); }
    if (p.get('offset')) out = out.slice(Number(p.get('offset')));
    if (p.get('limit')) out = out.slice(0, Number(p.get('limit')));
    return out;
  }
  function newChallenge() {
    const answer = digits ? String(digits) : String(Math.floor(10000 + Math.random() * 90000));
    const id = `ch-${seq++}`;
    challenges.set(id, { answer, at: now(), used: false });
    lastChallenge = { id, answer };
    return { id, svg: demoChallengeSvg(answer) };
  }

  async function fetchImpl(url, { method = 'GET', headers = {}, body } = {}) {
    const u = new URL(url);
    calls.push({ method, path: u.pathname, search: u.search, body: body ? JSON.parse(body) : undefined });
    if (offline) throw new TypeError('Failed to fetch');
    if (failNext) { const f = failNext; failNext = null; return json(f.status, f.body || { message: 'forced failure' }); }
    if (rateLimit > 0) { rateLimit--; return json(429, { message: 'Rate limit exceeded' }); }
    const b = body ? JSON.parse(body) : {};
    const path = u.pathname;
    // --- auth ---
    if (path === '/auth/v1/signup') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return json(400, { msg: 'Unable to validate email address: invalid format' });
      if (String(b.password || '').length < 8) return json(422, { msg: 'Password should be at least 8 characters' });
      if (users.has(b.email)) return json(422, { code: 'user_already_exists', msg: 'User already registered' });
      const meta = b.data || {};
      const app = {};
      if (meta.app === 'fairway') {
        const ch = challenges.get(meta.challenge_id);
        const ok = ch && !ch.used && now() - ch.at >= 2000 && now() - ch.at <= 600000 && String(meta.challenge_answer) === ch.answer;
        if (ch) ch.used = true;
        if (!ok) return json(500, { code: 'unexpected_failure', message: 'Database error saving new user' });
        app.fairway = true;
      }
      const user = { id: `u${seq++}`, email: b.email, password: b.password, meta: { ...meta, challenge_answer: undefined, challenge_id: undefined }, app };
      users.set(b.email, user);
      return json(200, issue(user));
    }
    if (path === '/auth/v1/token') {
      const g = u.searchParams.get('grant_type');
      if (g === 'password') {
        const user = users.get(b.email);
        if (!user || user.password !== b.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(200, issue(user));
      }
      if (g === 'refresh_token') {
        const id = refreshTokens.get(b.refresh_token);
        if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        refreshTokens.delete(b.refresh_token);
        const user = userById(id);
        return user ? json(200, issue(user)) : json(400, { error: 'invalid_grant' });
      }
    }
    if (path === '/auth/v1/logout') return json(204);
    if (path === `/rest/v1/rpc/${RPCS.newChallenge}`) return json(200, newChallenge());
    const who = userFromAuth(headers);
    if (who.expired) return json(401, { message: 'JWT expired' });
    if (path === '/auth/v1/user') {
      if (!who.userId) return json(401, { message: 'invalid JWT' });
      return json(200, userJson(userById(who.userId)));
    }
    // --- delete my account: removes the caller's rows and the user ---
    if (path === `/rest/v1/rpc/${RPCS.deleteMyAccount}`) {
      if (!who.userId) return json(401, { message: 'not signed in' });
      for (const t of Object.keys(tables)) tables[t] = tables[t].filter((r) => r[OWNER[t] || 'user_id'] !== who.userId);
      for (const [email, user] of users) if (user.id === who.userId) users.delete(email);
      for (const [t, rec] of tokens) if (rec.userId === who.userId) tokens.delete(t);
      return json(200, null);
    }
    const rp = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
    if (rp && extra.rpc[rp[1]]) return extra.rpc[rp[1]](b, who, json);
    // --- tables, with row level security ---
    const m = /^\/rest\/v1\/(\w+)$/.exec(path);
    if (m && extra.tables[m[1]]) return extra.tables[m[1]]({ method, search: u.search, body: b, who, json, query, filter });
    if (m && tables[m[1]]) {
      const t = m[1], owner = OWNER[t];
      if (method === 'GET') {
        if (!PUBLIC_READ.has(t) && !who.userId) return json(200, []);
        const rows = PUBLIC_READ.has(t) ? tables[t] : tables[t].filter((r) => r[owner] === who.userId);
        return json(200, query(rows, u.search));
      }
      if (!who.userId || !who.verified) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
      if (method === 'POST') {
        const rows = Array.isArray(b) ? b : [b];
        if (rows.some((r) => r[owner] !== who.userId)) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
        const key = KEYS[t];
        const out = [];
        for (const r of rows) {
          const row = { ...r, ...(t === TABLES.scores ? { id: seq++ } : {}), created_at: r.created_at || new Date(now()).toISOString() };
          if (key) { const i = tables[t].findIndex((x) => x[key] === row[key]); if (i >= 0) tables[t][i] = { ...tables[t][i], ...row }; else tables[t].push(row); } else tables[t].push(row);
          out.push(row);
        }
        return json(201, out);
      }
      if (method === 'PATCH' || method === 'DELETE') {
        const hit = filter(tables[t], u.search).filter((r) => r[owner] === who.userId);
        if (method === 'DELETE') { tables[t] = tables[t].filter((r) => !hit.includes(r)); return json(204); }
        for (const r of hit) Object.assign(r, b);
        return json(200, hit);
      }
    }
    return json(404, { message: `no route ${method} ${path}` });
  }
  return {
    fetch: fetchImpl, tables, users, calls, extra, challenges,
    lastChallenge: () => lastChallenge,
    setOffline(v) { offline = !!v; },
    failOnce(status, body) { failNext = { status, body }; },
    rateLimitNext(n = 1) { rateLimit = n; },
    expireAll() { for (const rec of tokens.values()) rec.exp = 0; },
    // An account made outside the game (no robot check, so no game flag).
    addPlainUser(email, password) { const user = { id: `u${seq++}`, email, password, meta: {}, app: {} }; users.set(email, user); return user; },
  };
}
