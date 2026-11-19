// Course conditions: how fast the greens run and how firm the fairways are, as bounded
// multipliers on the surface table (physics/surfaces.js) for one course. A course without
// conditions (every invented course) uses the table untouched; the ball simulation only reads
// these through env.props when a course sets them.
//
//   greenSpeed  0.8 to 1.35: green roll deceleration divided by it (1.28 is a very fast green)
//   firmness    0.8 to 1.4: fairway, first cut and tee roll deceleration divided by it, bounce
//               a little livelier and less soft (rough feels half of it); 1.35 is links-firm
import { SURFACES as S, surfaceProps } from '../physics/surfaces.js';
import { clamp } from '../core/math.js';

export const CONDITION_LIMITS = Object.freeze({ greenSpeed: [0.8, 1.35], firmness: [0.8, 1.4] });

export function courseConditions(course) {
  const c = (course && course.conditions) || {};
  const g = Number.isFinite(c.greenSpeed) ? c.greenSpeed : 1, f = Number.isFinite(c.firmness) ? c.firmness : 1;
  return { greenSpeed: clamp(g, ...CONDITION_LIMITS.greenSpeed), firmness: clamp(f, ...CONDITION_LIMITS.firmness) };
}

// A surface lookup for those conditions, or null when they are neutral.
export function conditionedProps(cond) {
  if (!cond || (cond.greenSpeed === 1 && cond.firmness === 1)) return null;
  const table = new Map();
  const firm = (id, k) => {
    const p = surfaceProps(id), f = 1 + (cond.firmness - 1) * k;
    return { ...p, rollDecel: p.rollDecel / f, restitution: clamp(p.restitution * (1 + (f - 1) * 0.6), 0, 0.6), soft: clamp(p.soft * (1 - (f - 1) * 0.8), 0.05, 1) };
  };
  table.set(S.GREEN, { ...surfaceProps(S.GREEN), rollDecel: surfaceProps(S.GREEN).rollDecel / cond.greenSpeed });
  for (const id of [S.FAIRWAY, S.FIRST_CUT, S.TEE]) table.set(id, firm(id, 1));
  table.set(S.ROUGH, firm(S.ROUGH, 0.5));
  return (id) => table.get(id) || surfaceProps(id);
}
