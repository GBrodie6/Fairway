// A small Supabase client over fetch: email and password auth, magic link, password reset,
// sign out, session refresh, table reads and writes, and remote procedure calls. No SDK, so it
// adds a few kilobytes, and it is unit tested with a fake fetch (tests/cloud.test.js).
//
// Only the public anon key is ever used. Row level security on the server decides what a
// signed-in user may read and write (supabase/schema.sql). With no URL or key the client is
// dormant: `configured` is false and every call resolves to { error: 'off' }.

export const SESSION_KEY = 'fairway-next.session';

// Plain messages for the player, by error code.
export const MESSAGES = {
  off: 'Cloud sync is off in this build. Your progress is saved on this device.',
  offline: 'You are offline. Your progress is saved on this device and will sync later.',
  'session-expired': 'Your session ended. Please sign in again.',
  'rate-limited': 'Too many tries. Please wait a minute and try again.',
  'bad-credentials': 'That email and password do not match.',
  'email-taken': 'An account with that email already exists. Try signing in.',
  'weak-password': 'Please use a password of at least 8 characters.',
  'bad-email': 'That email address does not look right.',
  'not-confirmed': 'Please confirm your email first. Check your inbox for the link.',
  server: 'The server had a problem. Please try again in a moment.',
  unknown: 'Something went wrong. Please try again.',
};
export const messageFor = (code) => MESSAGES[code] || MESSAGES.unknown;

function codeFor(status, body) {
  const text = `${(body && (body.error_code || body.code || body.error || '')) || ''} ${(body && (body.msg || body.message || body.error_description || '')) || ''}`.toLowerCase();
  if (status === 429 || text.includes('rate limit')) return 'rate-limited';
  if (text.includes('invalid login') || text.includes('invalid_credentials') || text.includes('invalid grant')) return 'bad-credentials';
  if (text.includes('already registered') || text.includes('user_already_exists') || text.includes('already exists')) return 'email-taken';
  if (text.includes('password') && (text.includes('short') || text.includes('weak') || text.includes('at least'))) return 'weak-password';
  if (text.includes('email') && (text.includes('invalid') || text.includes('format'))) return 'bad-email';
  if (text.includes('not confirmed') || text.includes('email_not_confirmed')) return 'not-confirmed';
  if (status === 401 || text.includes('jwt expired') || text.includes('invalid jwt')) return 'session-expired';
  if (status >= 500) return 'server';
  return 'unknown';
}

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

/**
 * createSupabase({ url, anonKey, fetchImpl, storage, now })
 *   url, anonKey   project URL and public anon key (both required, or the client is dormant)
 *   fetchImpl      fetch (injected in tests)
 *   storage        localStorage-like, for the session
 */
export function createSupabase({ url = '', anonKey = '', fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null, storage = memStore(), now = () => Date.now() } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const configured = !!(base && anonKey && fetchImpl);
  let session = null;
  try { const s = storage.getItem(SESSION_KEY); if (s) session = JSON.parse(s); } catch { session = null; }
  const listeners = new Set();
  const setSession = (s) => {
    session = s;
    try { if (s) storage.setItem(SESSION_KEY, JSON.stringify(s)); else storage.removeItem(SESSION_KEY); } catch { /* storage full or blocked */ }
    for (const fn of listeners) { try { fn(s); } catch { /* listener errors stay local */ } }
  };

  async function request(path, { method = 'GET', body, auth = true, headers = {}, retry = true } = {}) {
    if (!configured) return { error: 'off' };
    if (auth && session && session.expires_at && session.expires_at * 1000 < now() + 30000 && retry) await refresh();
    const h = { apikey: anonKey, 'Content-Type': 'application/json', ...headers };
    h.Authorization = `Bearer ${auth && session ? session.access_token : anonKey}`;
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { error: 'offline' };
    }
    let data = null;
    const txt = await res.text().catch(() => '');
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (res.ok) return { data, status: res.status };
    const code = codeFor(res.status, data);
    if (code === 'session-expired' && auth && session && retry) {
      const r = await refresh();
      if (!r.error) return request(path, { method, body, auth, headers, retry: false });
      setSession(null);
    }
    return { error: code, status: res.status, detail: data };
  }

  function acceptSession(d) {
    if (!d || !d.access_token) return null;
    const s = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.round(now() / 1000) + (d.expires_in || 3600), user: d.user ? { id: d.user.id, email: d.user.email } : session && session.user };
    setSession(s);
    return s;
  }
  async function refresh() {
    if (!session || !session.refresh_token) return { error: 'session-expired' };
    const r = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false, retry: false });
    if (r.error) return r;
    return { data: acceptSession(r.data) };
  }

  const client = {
    configured,
    get session() { return session; },
    get user() { return session ? session.user : null; },
    onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    request,
    // --- auth ---
    async signUp(email, password, displayName) {
      const r = await request('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password, data: { display_name: displayName } } });
      if (r.error) return r;
      // With email confirmation on there is no session yet.
      const s = acceptSession(r.data && r.data.session ? r.data.session : r.data);
      return { data: { session: s, needsConfirmation: !s } };
    },
    async signIn(email, password) {
      const r = await request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
      if (r.error) return r;
      return { data: acceptSession(r.data) };
    },
    async magicLink(email, redirectTo) {
      return request('/auth/v1/otp', { method: 'POST', auth: false, body: { email, create_user: true, ...(redirectTo ? { options: { email_redirect_to: redirectTo } } : {}) } });
    },
    async resetPassword(email, redirectTo) {
      return request('/auth/v1/recover', { method: 'POST', auth: false, body: { email, ...(redirectTo ? { redirect_to: redirectTo } : {}) } });
    },
    // A magic link or reset link lands with the tokens in the URL fragment.
    acceptRedirect(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      if (!p.get('access_token')) return null;
      return acceptSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600 });
    },
    async updatePassword(password) { return request('/auth/v1/user', { method: 'PUT', body: { password } }); },
    async fetchUser() {
      const r = await request('/auth/v1/user');
      if (!r.error && r.data && session) setSession({ ...session, user: { id: r.data.id, email: r.data.email } });
      return r;
    },
    async signOut() {
      if (configured && session) await request('/auth/v1/logout', { method: 'POST' });
      setSession(null);
      return { data: true };
    },
    refresh,
    // --- data ---
    select(table, query = '') { return request(`/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } }); },
    upsert(table, rows, onConflict) { return request(`/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }); },
    insert(table, rows) { return request(`/rest/v1/${table}`, { method: 'POST', body: rows, headers: { Prefer: 'return=representation' } }); },
    rpc(fn, args = {}) { return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }); },
  };
  return client;
}

// Build-time configuration: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
export function cloudConfig(env = (typeof import.meta !== 'undefined' && import.meta.env) || {}) {
  const url = env.VITE_SUPABASE_URL || '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
  return { url, anonKey, enabled: !!(url && anonKey) };
}
