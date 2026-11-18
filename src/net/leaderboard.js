// Casual leaderboards: daily challenge, weekly long drive, range target points, campaign level.
// Everyone can read them; only signed-in players write, and every value is bounded on this
// device before upload. They are not cheat-proof, and the screen says so. The board's period
// (a day, an ISO week, or all time) travels in the row's meta, since fairway_scores has no
// period column.
import { TABLES } from './tables.js';

export const BOARDS = {
  daily: { id: 'daily', name: 'Daily challenge', unit: 'to par', lowerIsBetter: true, min: -9, max: 18, period: 'day' },
  longdrive: { id: 'longdrive', name: 'Weekly long drive', unit: 'yd', lowerIsBetter: false, min: 50, max: 420, period: 'week' },
  target: { id: 'target', name: 'Range target points', unit: 'pts', lowerIsBetter: false, min: 0, max: 2500, period: 'week' },
  level: { id: 'level', name: 'Campaign level', unit: 'level', lowerIsBetter: false, min: 1, max: 40, period: 'all' },
};
export const BOARD_NOTE = 'Casual leaderboards. Scores are checked for sensible values but are not cheat-proof.';

export function dayPeriod(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// ISO week, for example 2026-W47.
export function weekPeriod(t) {
  const d = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((d - y0) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
export function periodFor(boardId, t = Date.now()) {
  const b = BOARDS[boardId];
  if (!b) return null;
  return b.period === 'day' ? dayPeriod(t) : b.period === 'week' ? weekPeriod(t) : 'all';
}

// A value that may be uploaded, or null when it is outside the sane range.
export function sanitizeScore(boardId, value) {
  const b = BOARDS[boardId];
  if (!b || !Number.isFinite(value)) return null;
  const v = Math.round(value);
  return v < b.min || v > b.max ? null : v;
}

export async function fetchBoard(client, boardId, { t = Date.now(), limit = 25 } = {}) {
  const b = BOARDS[boardId];
  if (!b) return { error: 'unknown' };
  if (!client.configured) return { error: 'off' };
  const period = periodFor(boardId, t);
  const r = await client.select(TABLES.scores, `board=eq.${encodeURIComponent(b.id)}&meta->>period=eq.${encodeURIComponent(period)}&order=value.${b.lowerIsBetter ? 'asc' : 'desc'}&limit=${limit}&select=display_name,value,user_id`);
  if (r.error) return r;
  // One row per player: the best one.
  const best = new Map();
  for (const row of r.data || []) {
    const cur = best.get(row.user_id);
    if (!cur || (b.lowerIsBetter ? row.value < cur.value : row.value > cur.value)) best.set(row.user_id, row);
  }
  const rows = [...best.values()].sort((x, y) => (b.lowerIsBetter ? x.value - y.value : y.value - x.value)).map((x, i) => ({ rank: i + 1, name: x.display_name, value: x.value, me: client.user && x.user_id === client.user.id }));
  return { data: { board: b, period, rows } };
}

export async function submitScore(client, boardId, value, displayName, t = Date.now()) {
  if (!client.configured) return { error: 'off' };
  if (!client.user) return { error: 'session-expired' };
  const v = sanitizeScore(boardId, value);
  if (v === null) return { error: 'out-of-range' };
  return client.insert(TABLES.scores, [{ user_id: client.user.id, board: boardId, value: v, display_name: String(displayName || 'Golfer').slice(0, 20), meta: { period: periodFor(boardId, t) } }]);
}
