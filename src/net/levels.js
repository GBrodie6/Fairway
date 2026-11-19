// Community holes in the cloud (fairway_levels). Reading is public; publishing, liking,
// reporting and counting plays need a signed-in game account (the server checks the robot
// check flag). The server limits publishing to 10 holes a day and 100 in all, and hides a hole
// at 5 reports. Every level that comes back goes through the strict loader before use.
import { LEVEL_TABLES, LEVEL_RPCS, TABLES } from './tables.js';
import { parseLevel, levelPar, serializeLevel, levelBytes, LEVEL_CAPS, cleanName } from '../game/level.js';

const COLS = 'id,user_id,author,name,par,data,plays,likes,created_at';
export const LEVEL_TEXT = {
  limit: 'You can publish 10 holes a day and 100 in all.',
  signin: 'Sign in to publish, like or report holes.',
  offline: 'You are offline. The hole is saved here and will be published when you are back online.',
  big: 'The hole is too detailed to share: remove some trees.',
  failed: 'The hole could not be published. Please try again.',
};
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{8,40}$/i.test(s);

// A row as the game uses it: the level parsed strictly, or null if it does not load.
export function rowToLevel(row) {
  if (!row || !isUuid(String(row.id))) return null;
  const p = parseLevel(row.data);
  if (!p.ok) return null;
  return { id: String(row.id), userId: row.user_id, author: cleanName(row.author).slice(0, 20) || 'Golfer', name: cleanName(row.name) || p.level.name, par: levelPar(p.level), level: p.level, plays: Math.max(0, Number(row.plays) || 0), likes: Math.max(0, Number(row.likes) || 0), createdAt: row.created_at || null };
}

export async function listLevels(client, tab = 'new', { limit = 30, offset = 0 } = {}) {
  if (!client.configured) return { error: 'off' };
  let q = `select=${COLS}&hidden=eq.false&limit=${limit}&offset=${offset}`;
  if (tab === 'top') q += '&order=likes.desc,plays.desc,created_at.desc';
  else if (tab === 'mine') {
    if (!client.user) return { error: 'session-expired' };
    q = `select=${COLS}&user_id=eq.${encodeURIComponent(client.user.id)}&order=created_at.desc&limit=${limit}`;
  } else q += '&order=created_at.desc';
  const r = await client.select(LEVEL_TABLES.levels, q);
  if (r.error) return r;
  return { data: (Array.isArray(r.data) ? r.data : []).map(rowToLevel).filter(Boolean) };
}

export async function getLevel(client, id) {
  if (!client.configured) return { error: 'off' };
  if (!isUuid(id)) return { error: 'unknown' };
  const r = await client.select(LEVEL_TABLES.levels, `select=${COLS}&id=eq.${encodeURIComponent(id)}`);
  if (r.error) return r;
  const lv = rowToLevel(Array.isArray(r.data) ? r.data[0] : null);
  return lv ? { data: lv } : { error: 'unknown' };
}

export async function publishLevel(client, level, author) {
  if (!client.configured) return { error: 'off' };
  if (!client.user) return { error: 'signin' };
  const p = parseLevel(level);
  if (!p.ok) return { error: 'invalid' };
  if (levelBytes(p.level) > LEVEL_CAPS.bytes) return { error: 'big' };
  const r = await client.insert(LEVEL_TABLES.levels, [{ user_id: client.user.id, author: cleanName(author).slice(0, 20) || 'Golfer', name: p.level.name, par: levelPar(p.level), data: JSON.parse(serializeLevel(p.level)) }]);
  if (r.error) return { error: limitOrCode(r) };
  return { data: rowToLevel(Array.isArray(r.data) ? r.data[0] : r.data) };
}
function limitOrCode(r) {
  const t = JSON.stringify(r.detail || '').toLowerCase();
  return /limit|too many|quota|per day|maximum/.test(t) ? 'limit' : r.error;
}

export const updateLevel = (client, id, level) => { const p = parseLevel(level); return p.ok ? client.update(LEVEL_TABLES.levels, `id=eq.${encodeURIComponent(id)}`, { name: p.level.name, par: levelPar(p.level), data: JSON.parse(serializeLevel(p.level)) }) : Promise.resolve({ error: 'invalid' }); };
export const deleteLevel = (client, id) => client.remove(LEVEL_TABLES.levels, `id=eq.${encodeURIComponent(id)}`);
export async function likeLevel(client, id) {
  if (!client.user) return { error: 'signin' };
  const r = await client.rpc(LEVEL_RPCS.like, { p_level: id });
  return r.error ? r : { data: r.data === true || (Array.isArray(r.data) && r.data[0] === true) };
}
export const reportLevel = (client, id, reason) => (client.user ? client.rpc(LEVEL_RPCS.report, { p_level: id, p_reason: String(reason || 'other').slice(0, 80) }) : Promise.resolve({ error: 'signin' }));
export const playedLevel = (client, id) => (client.user ? client.rpc(LEVEL_RPCS.played, { p_level: id }) : Promise.resolve({ error: 'signin' }));

// Best scores per hole, through the scores table: board "level:<id>", value = strokes.
export const levelBoard = (id) => `level:${id}`;
export async function submitLevelScore(client, id, strokes, displayName) {
  if (!client.configured || !client.user) return { error: 'session-expired' };
  const v = Math.round(Number(strokes));
  if (!Number.isFinite(v) || v < 1 || v > 15) return { error: 'out-of-range' };
  return client.insert(TABLES.scores, [{ user_id: client.user.id, board: levelBoard(id), value: v, display_name: String(displayName || 'Golfer').slice(0, 20), meta: { period: 'all' } }]);
}
export async function levelBest(client, id) {
  if (!client.configured) return { error: 'off' };
  const r = await client.select(TABLES.scores, `board=eq.${encodeURIComponent(levelBoard(id))}&order=value.asc,created_at.asc&limit=50&select=display_name,value,user_id`);
  if (r.error) return r;
  const rows = Array.isArray(r.data) ? r.data : [];
  const mine = client.user ? rows.filter((x) => x.user_id === client.user.id).reduce((m, x) => (m == null || x.value < m ? x.value : m), null) : null;
  return { data: { best: rows[0] ? { name: rows[0].display_name, value: rows[0].value } : null, mine } };
}
