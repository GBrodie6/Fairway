// Cloud save sync on top of the Supabase client (net/supabase.js).
//
//   merge     on sign-up or first sign-in, the guest save on this device merges into the
//             account: progress only ever goes up (higher level, union of rounds, gear, and
//             achievements, better bests)
//   conflict  otherwise the newer save (updatedAt) wins, and the other one is kept on this
//             device as a backup for 30 days, restorable from settings
//   queue     every push is queued in local storage first and flushed with a debounce; when
//             offline it stays queued and is retried later, so offline play never blocks
import { messageFor } from './supabase.js';

export const BACKUP_KEY = 'fairway-next.backups';
export const QUEUE_KEY = 'fairway-next.syncqueue';
export const BACKUP_DAYS = 30;
const DAY = 86400000;

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// --- merging two saves (pure) ---
export function mergeSaves(a, b) {
  if (!isObj(a)) return b;
  if (!isObj(b)) return a;
  const out = { ...b, ...a };
  // Rounds: union by id, oldest first, capped.
  const hist = new Map();
  for (const h of [...(b.history || []), ...(a.history || [])]) if (h && h.id) hist.set(h.id, h);
  out.history = [...hist.values()].sort((x, y) => (x.date || 0) - (y.date || 0)).slice(-100);
  // Aggregate stats: the save with more rounds is the fuller record (adding them would count
  // rounds twice when both saves share history); bests take the better of the two.
  const sa = a.stats || {}, sb = b.stats || {};
  out.stats = { ...((sa.rounds || 0) >= (sb.rounds || 0) ? sa : sb) };
  out.stats.best = { ...(sb.best || {}) };
  for (const [k, v] of Object.entries(sa.best || {})) if (out.stats.best[k] === undefined || v < out.stats.best[k]) out.stats.best[k] = v;
  out.stats.longestDrive = Math.max(sa.longestDrive || 0, sb.longestDrive || 0);
  // Achievements: union, earliest time.
  out.achievements = { ...(b.achievements || {}) };
  for (const [k, t] of Object.entries(a.achievements || {})) out.achievements[k] = out.achievements[k] ? Math.min(out.achievements[k], t) : t;
  // Daily results: the better score per day, attempts added.
  out.daily = { ...(b.daily || {}) };
  for (const [k, d] of Object.entries(a.daily || {})) {
    const o = out.daily[k];
    out.daily[k] = !o ? d : { ...(d.strokes < o.strokes ? d : o), attempts: (d.attempts || 1) + (o.attempts || 1) };
  }
  // Career and profile progress: the one further along.
  const xp = (s, k) => (s && s[k] ? s[k].xp || 0 : -1);
  for (const k of ['career', 'profile', 'campaign']) out[k] = xp(a, k) >= xp(b, k) ? a[k] ?? b[k] : b[k];
  // Wallet: the larger balance per currency (adding would duplicate earnings).
  if (a.wallet || b.wallet) { out.wallet = { ...(b.wallet || {}) }; for (const [k, v] of Object.entries(a.wallet || {})) out.wallet[k] = Math.max(v || 0, out.wallet[k] || 0); }
  // Gear and cosmetics: union by id.
  if (a.gear || b.gear) {
    const ga = a.gear || {}, gb = b.gear || {};
    const uni = (x = [], y = []) => { const m = new Map(); for (const i of [...y, ...x]) if (i && i.uid) m.set(i.uid, i); return [...m.values()]; };
    out.gear = { ...gb, ...ga, clubs: uni(ga.clubs, gb.clubs), balls: uni(ga.balls, gb.balls), gloves: uni(ga.gloves, gb.gloves) };
  }
  if (a.cosmetics || b.cosmetics) out.cosmetics = { ...(b.cosmetics || {}), ...(a.cosmetics || {}), owned: [...new Set([...((b.cosmetics || {}).owned || []), ...((a.cosmetics || {}).owned || [])])] };
  // Range bests: the better value.
  if (a.range || b.range) {
    const ra = a.range || {}, rb = b.range || {};
    out.range = { ...rb, ...ra, sessions: Math.max(ra.sessions || 0, rb.sessions || 0), best: { ...(rb.best || {}) } };
    for (const [k, v] of Object.entries(ra.best || {})) out.range.best[k] = Math.max(v || 0, out.range.best[k] || 0);
  }
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}

// The conflict rule: the newer save wins; the other is returned as the backup.
export function resolveConflict(local, remote) {
  const lt = (local && local.updatedAt) || 0, rt = (remote && remote.updatedAt) || 0;
  if (!remote) return { winner: local, backup: null, source: 'local' };
  if (!local) return { winner: remote, backup: null, source: 'remote' };
  return rt > lt ? { winner: remote, backup: local, source: 'remote' } : { winner: local, backup: remote, source: 'local' };
}

// --- backups on this device ---
export function readBackups(storage, now = Date.now()) {
  try {
    const list = JSON.parse(storage.getItem(BACKUP_KEY) || '[]');
    return Array.isArray(list) ? list.filter((b) => b && now - b.savedAt < BACKUP_DAYS * DAY) : [];
  } catch { return []; }
}
export function addBackup(storage, data, reason, now = Date.now()) {
  const list = [{ id: `b${now}`, savedAt: now, reason, updatedAt: (data && data.updatedAt) || 0, data }, ...readBackups(storage, now)].slice(0, 5);
  try { storage.setItem(BACKUP_KEY, JSON.stringify(list)); } catch { /* full: the newest backup still went into memory */ }
  return list;
}

// What goes to the cloud: the save without device-only parts.
export function cloudPayload(save) {
  const { account, ...rest } = save || {};
  return rest;
}

/**
 * createSync({ client, getSave, applySave, storage, now, debounceMs, setTimer, clearTimer })
 *   getSave()        the current save
 *   applySave(s, why) replace the save on this device (and persist it)
 */
export function createSync({ client, getSave, applySave, storage, now = () => Date.now(), debounceMs = 4000, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) }) {
  let timer = null, flushing = null;
  const listeners = new Set();
  const sync = {
    status: client.configured ? (client.user ? 'idle' : 'guest') : 'off',
    message: client.configured ? '' : messageFor('off'),
    lastSync: 0,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const set = (status, message = '') => { sync.status = status; sync.message = message; for (const fn of listeners) { try { fn(sync); } catch { /* ignore */ } } };
  const readQueue = () => { try { return JSON.parse(storage.getItem(QUEUE_KEY) || 'null'); } catch { return null; } };
  const writeQueue = (q) => { try { if (q) storage.setItem(QUEUE_KEY, JSON.stringify(q)); else storage.removeItem(QUEUE_KEY); } catch { /* ignore */ } };
  sync.pending = () => !!readQueue();

  // Ask for a push. Debounced; the request survives a reload through the queue.
  sync.schedule = (reason = 'change') => {
    if (!client.configured || !client.user) return false;
    const q = readQueue();
    writeQueue({ reason: q ? q.reason : reason, at: now(), tries: q ? q.tries : 0 });
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; sync.flush(); }, debounceMs);
    set('queued', '');
    return true;
  };

  async function pull() {
    const user = client.user;
    const r = await client.select('saves', `user_id=eq.${encodeURIComponent(user.id)}&select=data,updated_at`);
    if (r.error) return r;
    const row = Array.isArray(r.data) ? r.data[0] : null;
    return { data: row ? row.data : null };
  }
  async function push(save) {
    const user = client.user;
    const r = await client.upsert('saves', [{ user_id: user.id, data: cloudPayload(save), version: save.version, updated_at: new Date(save.updatedAt || now()).toISOString() }], 'user_id');
    if (!r.error && save.account && save.account.displayName) await client.upsert('profiles', [{ user_id: user.id, display_name: save.account.displayName, updated_at: new Date(now()).toISOString() }], 'user_id');
    return r;
  }

  // Pull, resolve, and push if this device has the newer save.
  sync.flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      if (!client.configured) { set('off', messageFor('off')); return { error: 'off' }; }
      if (!client.user) { set('guest', ''); return { error: 'guest' }; }
      set('syncing', '');
      const remote = await pull();
      if (remote.error) return fail(remote.error);
      const local = getSave();
      const res = resolveConflict(local, remote.data);
      if (res.backup && res.source === 'remote') {
        addBackup(storage, res.backup, 'replaced by a newer cloud save', now());
        applySave({ ...res.winner, account: local.account }, 'cloud newer');
      } else {
        if (res.backup) addBackup(storage, res.backup, 'older cloud save', now());
        const p = await push(local);
        if (p.error) return fail(p.error);
      }
      writeQueue(null);
      sync.lastSync = now();
      set('idle', '');
      return { data: res.source };
    })().finally(() => { flushing = null; });
    return flushing;
  };
  function fail(code) {
    const q = readQueue() || { reason: 'retry', at: now(), tries: 0 };
    q.tries = (q.tries || 0) + 1;
    writeQueue(q);
    if (code === 'session-expired') set('signed-out', messageFor(code));
    else set('error', messageFor(code));
    // Retry later with a growing wait while offline or rate limited.
    if (code === 'offline' || code === 'rate-limited' || code === 'server') {
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; sync.flush(); }, Math.min(300000, 15000 * Math.pow(2, Math.min(q.tries, 4))));
    }
    return { error: code };
  }

  // After a sign-up or sign-in on this device: merge the guest save into the account.
  sync.afterSignIn = async ({ displayName } = {}) => {
    const user = client.user;
    if (!user) return { error: 'session-expired' };
    set('syncing', '');
    const remote = await pull();
    if (remote.error) return fail(remote.error);
    const local = getSave();
    const linkedElsewhere = local.account && local.account.userId && local.account.userId !== user.id;
    // The display name lives in the profile row (the save travels without the account part).
    if (!displayName) {
      const pr = await client.select('profiles', `user_id=eq.${encodeURIComponent(user.id)}&select=display_name`);
      if (!pr.error && Array.isArray(pr.data) && pr.data[0]) displayName = pr.data[0].display_name;
    }
    let merged;
    if (!remote.data) merged = local; // a new account takes this device's progress
    else if (linkedElsewhere) { addBackup(storage, local, 'signed in to a different account', now()); merged = remote.data; }
    else merged = mergeSaves(local, remote.data);
    const name = displayName || (merged.account && merged.account.displayName) || (local.account && local.account.displayName) || (merged.player && merged.player.name) || 'Golfer';
    merged = { ...merged, updatedAt: now(), player: { ...(merged.player || {}), name }, account: { userId: user.id, email: user.email, displayName: name } };
    applySave(merged, 'signed in');
    const p = await push(merged);
    if (p.error) return fail(p.error);
    writeQueue(null);
    sync.lastSync = now();
    set('idle', '');
    return { data: merged };
  };

  sync.signOut = async () => {
    await client.signOut();
    const s = getSave();
    applySave({ ...s, account: null }, 'signed out');
    writeQueue(null);
    set(client.configured ? 'guest' : 'off', '');
  };

  // Delete the account and its data in the cloud (when signed in) and everything on this device.
  sync.deleteEverything = async (freshSave) => {
    if (client.configured && client.user) {
      const r = await client.rpc('delete_my_account');
      if (r.error) return { error: r.error, message: messageFor(r.error) };
      await client.signOut();
    }
    try { storage.removeItem(BACKUP_KEY); storage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
    applySave(freshSave, 'deleted');
    set(client.configured ? 'guest' : 'off', '');
    return { data: true };
  };

  sync.backups = () => readBackups(storage, now());
  sync.restoreBackup = (id) => {
    const b = readBackups(storage, now()).find((x) => x.id === id);
    if (!b) return false;
    const cur = getSave();
    addBackup(storage, cur, 'before restoring a backup', now());
    applySave({ ...b.data, updatedAt: now(), account: cur.account }, 'restored');
    sync.schedule('restore');
    return true;
  };
  return sync;
}
