// Cosmetics: ball colors and shot tracer colors. All earned (defaults, achievements, the free
// season track); none affect play. Pure data and helpers over save.cosmetics.
export const COSMETICS = [
  { id: 'ball-white', kind: 'ball', name: 'Classic white', color: '#ffffff', source: 'default' },
  { id: 'ball-yellow', kind: 'ball', name: 'Optic yellow', color: '#ffd23f', source: 'default' },
  { id: 'ball-coral', kind: 'ball', name: 'Coral', color: '#ff9e7a', source: 'default' },
  { id: 'ball-sky', kind: 'ball', name: 'Sky', color: '#7fd1ff', source: 'default' },
  { id: 'ball-mint', kind: 'ball', name: 'Mint', color: '#8ff0c0', source: 'season', tier: 5 },
  { id: 'ball-violet', kind: 'ball', name: 'Violet', color: '#c6a2ff', source: 'season', tier: 15 },
  { id: 'ball-gold', kind: 'ball', name: 'Gold', color: '#ffd77a', source: 'season', tier: 25 },
  { id: 'ball-pink', kind: 'ball', name: 'Flamingo', color: '#ff9ed1', source: 'feat', feat: 'birdies-50' },
  { id: 'ball-lime', kind: 'ball', name: 'Lime', color: '#c8f26a', source: 'feat', feat: 'medal-all-gold' },
  { id: 'ball-orange', kind: 'ball', name: 'Blaze', color: '#ffae5a', source: 'feat', feat: 'drive-320' },
  { id: 'trail-warm', kind: 'trail', name: 'Warm light', color: '#fff0b8', source: 'default' },
  { id: 'trail-ice', kind: 'trail', name: 'Ice', color: '#a8e6ff', source: 'season', tier: 10 },
  { id: 'trail-rose', kind: 'trail', name: 'Rose', color: '#ffb0c8', source: 'season', tier: 20 },
  { id: 'trail-gold', kind: 'trail', name: 'Gold', color: '#ffd166', source: 'season', tier: 30 },
  { id: 'trail-mint', kind: 'trail', name: 'Mint', color: '#9ff5c8', source: 'feat', feat: 'pured-250' },
  { id: 'trail-violet', kind: 'trail', name: 'Violet', color: '#cfa8ff', source: 'feat', feat: 'campaign-complete' },
  { id: 'trail-sky', kind: 'trail', name: 'Sky', color: '#9fd0ff', source: 'feat', feat: 'par-train-9' },
];
export const cosmeticById = (id) => COSMETICS.find((c) => c.id === id) || null;
export const DEFAULT_COSMETICS = { owned: COSMETICS.filter((c) => c.source === 'default').map((c) => c.id), ball: 'ball-white', trail: 'trail-warm' };

export function sanitizeCosmetics(c, playerBall) {
  const owned = new Set(DEFAULT_COSMETICS.owned);
  for (const id of (c && Array.isArray(c.owned) ? c.owned : [])) if (cosmeticById(id)) owned.add(id);
  // An old save's ball color maps to the matching default ball.
  const fromColor = playerBall ? COSMETICS.find((x) => x.kind === 'ball' && x.color.toLowerCase() === String(playerBall).toLowerCase()) : null;
  const ball = c && owned.has(c.ball) ? c.ball : fromColor && owned.has(fromColor.id) ? fromColor.id : DEFAULT_COSMETICS.ball;
  const trail = c && owned.has(c.trail) ? c.trail : DEFAULT_COSMETICS.trail;
  return { owned: [...owned], ball, trail };
}
export const grantCosmetic = (c, id) => (cosmeticById(id) && !c.owned.includes(id) ? { ...c, owned: [...c.owned, id] } : c);
export function equipCosmetic(c, id) {
  const x = cosmeticById(id);
  if (!x || !c.owned.includes(id)) return c;
  return { ...c, [x.kind]: id };
}
