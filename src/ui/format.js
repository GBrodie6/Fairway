// Display formatting. Pure functions, unit tested.
import { YARD } from '../core/math.js';

const FOOT = 0.3048;

// Long distances: yards or meters, whole numbers.
export function fmtDist(m, units = 'yards') {
  if (!Number.isFinite(m)) return '--';
  return units === 'meters' ? `${Math.round(m)} m` : `${Math.round(m / YARD)} yd`;
}
export function distValue(m, units = 'yards') {
  if (!Number.isFinite(m)) return 0;
  return units === 'meters' ? Math.round(m) : Math.round(m / YARD);
}
export const unitLabel = (units) => (units === 'meters' ? 'm' : 'yd');

// Short distances on and around the green: feet with one decimal under 10 ft, or meters.
export function fmtShort(m, units = 'yards') {
  if (!Number.isFinite(m)) return '--';
  if (units === 'meters') return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
  const ft = m / FOOT;
  return ft < 10 ? `${ft.toFixed(1)} ft` : `${Math.round(ft)} ft`;
}

// Elevation change: feet or meters with a sign, "level" when it would round to zero.
export function fmtElev(m, units = 'yards') {
  if (!Number.isFinite(m)) return '';
  if (units === 'meters') {
    const v = Math.round(m * 10) / 10;
    return Math.abs(v) < 0.5 ? 'level' : `${v > 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)} m`;
  }
  const ft = Math.round(m / FOOT);
  return Math.abs(ft) < 1 ? 'level' : `${ft > 0 ? 'up' : 'down'} ${Math.abs(ft)} ft`;
}

// Break for a putt: a lateral aim offset in meters, shown as cups or inches/cm to the side.
export function fmtBreak(meters, units = 'yards') {
  if (!Number.isFinite(meters)) return '';
  const a = Math.abs(meters);
  const side = meters > 0 ? 'right' : 'left';
  if (a < 0.03) return 'straight';
  if (units === 'meters') return a < 1 ? `${Math.round(a * 100)} cm ${side}` : `${a.toFixed(1)} m ${side}`;
  const inch = a / 0.0254;
  return inch < 24 ? `${Math.round(inch)} in ${side}` : `${(a / FOOT).toFixed(1)} ft ${side}`;
}

export function fmtToPar(n) {
  if (!Number.isFinite(n)) return '';
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtMph(mph, units = 'yards') {
  if (!Number.isFinite(mph)) return '--';
  return units === 'meters' ? `${Math.round(mph * 0.44704)} m/s` : `${Math.round(mph)} mph`;
}
