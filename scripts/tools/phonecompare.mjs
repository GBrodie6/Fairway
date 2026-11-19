// Phones unchanged: compare the HUD layout of two runs of scripts/tools/hud.mjs (the same sizes,
// the address moment): every HUD box, the ball, the swing zone and the aim fan, to a tenth of a
// pixel, plus each run's own overlap and off-screen findings.
//   node scripts/tools/phonecompare.mjs before.json after.json
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const pick = (rep) => Object.fromEntries(rep.filter((r) => r.moment === 'address' && r.boxes).map((r) => [r.size, r]));
const A = pick(a), B = pick(b);
const round = (r) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]));
let diffs = 0;
const rows = [];
for (const size of Object.keys(A)) {
  const x = A[size], y = B[size];
  if (!y) { rows.push({ size, missing: true }); diffs++; continue; }
  const changed = [];
  for (const k of new Set([...Object.keys(x.boxes.hud), ...Object.keys(y.boxes.hud)])) if (JSON.stringify(round(x.boxes.hud[k])) !== JSON.stringify(round(y.boxes.hud[k]))) changed.push(k);
  for (const k of ['ball', 'zone']) if (JSON.stringify(round(x.boxes[k])) !== JSON.stringify(round(y.boxes[k]))) changed.push(k);
  const fan = (f) => JSON.stringify((f || []).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]));
  if (fan(x.boxes.fan) !== fan(y.boxes.fan)) changed.push('fan');
  diffs += changed.length;
  rows.push({ size, changed, overlapsBefore: x.overlaps, overlapsAfter: y.overlaps, offscreenAfter: y.offscreen, smallAfter: y.smallTargets });
}
console.log(JSON.stringify(rows, null, 1));
console.log(diffs ? `${diffs} differences` : 'identical: every HUD box, the ball, the swing zone and the aim fan');
process.exitCode = diffs ? 1 : 0;
