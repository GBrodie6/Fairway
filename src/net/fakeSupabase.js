// An in-memory stand-in for the Supabase endpoints this game uses, as a fetch function. It is
// used by the unit tests and by the "?cloud=demo" mode, which lets the account screens be tried
// and screenshotted without a real project (nothing leaves the device in that mode).
//
// It follows the real rules where they matter: row level security (a user may only write their
// own rows), email confirmation off, tokens that expire, and the delete-my-account procedure.

export function createFakeSupabase({ now = () => Date.now(), tokenTtl = 3600 } = {}) {
  const users = new Map(); // email -> { id, email, password, meta }
  const tokens = new Map(); // access token -> { userId, exp }
  const refreshTokens = new Map(); // refresh token -> userId
  const tables = { saves: [], profiles: [], scores: [] };
  let seq = 1, offline = false, failNext = null, rateLimit = 0;
  const calls = [];

  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const issue = (user) => {
    const access = `at-${user.id}-${seq++}`, refresh = `rt-${user.id}-${seq++}`;
    tokens.set(access, { userId: user.id, exp: Math.round(now() / 1000) + tokenTtl });
    refreshTokens.set(refresh, user.id);
    return { access_token: access, refresh_token: refresh, expires_in: tokenTtl, expires_at: Math.round(now() / 1000) + tokenTtl, token_type: 'bearer', user: { id: user.id, email: user.email } };
  };
  const userFromAuth = (h) => {
    const t = String(h.Authorization || '').replace(/^Bearer /, '');
    const rec = tokens.get(t);
    if (!rec) return { anon: true };
    if (rec.exp < now() / 1000) return { expired: true };
    return { userId: rec.userId };
  };
  // PostgREST-style filters: col=eq.value, order=col.asc|desc, limit=n.
  function query(rows, qs) {
    const p = new URLSearchParams(qs);
    let out = rows.slice();
    for (const [k, v] of p) {
      if (k === 'order' || k === 'limit' || k === 'select' || k === 'on_conflict') continue;
      const m = /^(eq|gte|lte)\.(.*)$/.exec(v);
      if (!m) continue;
      out = out.filter((r) => { const a = String(r[k]); return m[1] === 'eq' ? a === m[2] : m[1] === 'gte' ? Number(r[k]) >= Number(m[2]) : Number(r[k]) <= Number(m[2]); });
    }
    if (p.get('order')) { const [col, dir] = p.get('order').split('.'); out.sort((a, b) => (dir === 'desc' ? b[col] - a[col] : a[col] - b[col])); }
    if (p.get('limit')) out = out.slice(0, Number(p.get('limit')));
    return out;
  }

  async function fetchImpl(url, { method = 'GET', headers = {}, body } = {}) {
    const u = new URL(url);
    calls.push({ method, path: u.pathname, search: u.search });
    if (offline) throw new TypeError('Failed to fetch');
    if (failNext) { const f = failNext; failNext = null; return json(f.status, f.body || { message: 'forced failure' }); }
    if (rateLimit > 0) { rateLimit--; return json(429, { message: 'Rate limit exceeded' }); }
    const b = body ? JSON.parse(body) : {};
    const path = u.pathname;
    // --- auth ---
    if (path === '/auth/v1/signup') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return json(400, { msg: 'Unable to validate email address: invalid format' });
      if (String(b.password || '').length < 8) return json(422, { msg: 'Password should be at least 8 characters' });
      if (users.has(b.email)) return json(422, { msg: 'User already registered' });
      const user = { id: `u${seq++}`, email: b.email, password: b.password, meta: b.data || {} };
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
        const user = [...users.values()].find((x) => x.id === id);
        return user ? json(200, issue(user)) : json(400, { error: 'invalid_grant' });
      }
    }
    if (path === '/auth/v1/otp' || path === '/auth/v1/recover') return json(200, {});
    if (path === '/auth/v1/logout') return json(204);
    const who = userFromAuth(headers);
    if (who.expired) return json(401, { message: 'JWT expired' });
    if (path === '/auth/v1/user') {
      if (!who.userId) return json(401, { message: 'invalid JWT' });
      const user = [...users.values()].find((x) => x.id === who.userId);
      if (method === 'PUT' && b.password) user.password = b.password;
      return json(200, { id: user.id, email: user.email });
    }
    // --- delete my account: removes the caller's rows and the user ---
    if (path === '/rest/v1/rpc/delete_my_account') {
      if (!who.userId) return json(401, { message: 'not signed in' });
      for (const t of Object.keys(tables)) tables[t] = tables[t].filter((r) => r.user_id !== who.userId);
      for (const [email, user] of users) if (user.id === who.userId) users.delete(email);
      for (const [t, rec] of tokens) if (rec.userId === who.userId) tokens.delete(t);
      return json(200, true);
    }
    // --- tables, with row level security ---
    const m = /^\/rest\/v1\/(\w+)$/.exec(path);
    if (m && tables[m[1]]) {
      const t = m[1];
      if (method === 'GET') {
        // Saves are private; profiles and scores are readable by everyone.
        const rows = t === 'saves' ? tables.saves.filter((r) => r.user_id === who.userId) : tables[t];
        return json(200, query(rows, u.search));
      }
      if (method === 'POST') {
        if (!who.userId) return json(401, { message: 'new row violates row-level security policy' });
        const rows = Array.isArray(b) ? b : [b];
        if (rows.some((r) => r.user_id !== who.userId)) return json(403, { message: 'new row violates row-level security policy' });
        const key = t === 'scores' ? null : 'user_id';
        const out = [];
        for (const r of rows) {
          const row = { ...r, id: r.id || seq++, updated_at: r.updated_at || new Date(now()).toISOString() };
          if (key) { const i = tables[t].findIndex((x) => x[key] === row[key]); if (i >= 0) tables[t][i] = { ...tables[t][i], ...row }; else tables[t].push(row); } else tables[t].push(row);
          out.push(row);
        }
        return json(201, out);
      }
    }
    return json(404, { message: `no route ${method} ${path}` });
  }
  return {
    fetch: fetchImpl, tables, users, calls,
    setOffline(v) { offline = !!v; },
    failOnce(status, body) { failNext = { status, body }; },
    rateLimitNext(n = 1) { rateLimit = n; },
    expireAll() { for (const rec of tokens.values()) rec.exp = 0; },
  };
}
