// Which PBR set each terrain surface uses on each course, plus per-surface tint and tile size.
// Surfaces are in painter's order, bottom to top. Index 0 is the base (maintained rough).
export const SURFACE_SLOTS = ['rough', 'deep', 'waste', 'dirt', 'shore', 'rock', 'firstCut', 'fairway', 'path', 'fringe', 'tee', 'green', 'bunker'];

const BASE = {
  rough: { set: 'rough', tint: [1, 1, 1] },
  deep: { set: 'deeprough', tint: [1.05, 1.05, 1.0] },
  waste: { set: 'forest', tint: [1, 1, 1] },
  dirt: { set: 'dirt', tint: [0.8, 0.8, 0.8] },
  shore: { set: 'wetsand', tint: [0.9, 0.9, 0.9] },
  rock: { set: 'rock', tint: [1, 1, 1] },
  firstCut: { set: 'fairway', tint: [0.82, 0.88, 0.78] },
  fairway: { set: 'fairway', tint: [1, 1, 1] },
  path: { set: 'gravel', tint: [1, 1, 1] },
  fringe: { set: 'green', tint: [0.86, 0.92, 0.82] },
  tee: { set: 'green', tint: [0.95, 1.0, 0.92] },
  green: { set: 'green', tint: [1, 1, 1] },
  bunker: { set: 'bunker', tint: [1.12, 1.1, 1.06] },
};

const OVERRIDES = {
  parkland: {},
  links: {
    rough: { set: 'rough', tint: [1.1, 1.06, 0.82] },
    deep: { set: 'fescue', tint: [0.66, 0.84, 0.5] },
    waste: { set: 'beach', tint: [1.25, 1.2, 1.08] },
    fairway: { set: 'fairway', tint: [1.08, 1.04, 0.84] },
    firstCut: { set: 'fairway', tint: [0.92, 0.92, 0.72] },
    green: { set: 'green', tint: [1.04, 1.02, 0.9] },
    fringe: { set: 'green', tint: [0.92, 0.94, 0.78] },
    bunker: { set: 'bunker', tint: [1.18, 1.14, 1.04] },
    dirt: { set: 'beach', tint: [1.0, 0.95, 0.85] },
  },
  desert: {
    waste: { set: 'desert', tint: [1.25, 1.1, 1.0] },
    dirt: { set: 'scrub', tint: [1.1, 1.0, 0.95] },
    rock: { set: 'cliff', tint: [1.2, 1.05, 1.0] },
    path: { set: 'concrete', tint: [1.15, 1.1, 1.05] },
    bunker: { set: 'bunker', tint: [1.2, 1.12, 1.02] },
  },
  alpine: {
    deep: { set: 'alpine', tint: [1.2, 1.2, 1.1] },
    waste: { set: 'needles', tint: [1, 1, 1] },
    rock: { set: 'rock', tint: [0.95, 0.97, 1.0] },
  },
  tropical: {
    rough: { set: 'rough', tint: [0.95, 1.08, 0.9] },
    waste: { set: 'forest', tint: [0.9, 1.0, 0.85] },
    bunker: { set: 'beach', tint: [1.45, 1.42, 1.34] },
    shore: { set: 'beach', tint: [1.0, 0.98, 0.9] },
    path: { set: 'concrete', tint: [1.2, 1.18, 1.1] },
    fairway: { set: 'fairway', tint: [0.96, 1.06, 0.92] },
  },
};

export function layersFor(courseId, manifest) {
  const ov = OVERRIDES[courseId] || {};
  const surfaces = SURFACE_SLOTS.map((slot) => ({ slot, ...BASE[slot], ...(ov[slot] || {}) }));
  const sets = [];
  for (const s of surfaces) {
    if (!sets.includes(s.set)) sets.push(s.set);
    s.layer = sets.indexOf(s.set);
    const rec = manifest.textures[s.set];
    s.scale = rec ? rec.scale : 3;
    s.avg = rec ? rec.avg.map((v, i) => v * s.tint[i]) : [0.2, 0.3, 0.1];
    s.rough = rec ? rec.rough : 0.9;
  }
  return { surfaces, sets };
}
