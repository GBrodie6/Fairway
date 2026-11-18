// Balance runs (stage 9). The simulated golfer (src/game/simGolfer.js) plays 9-hole rounds
// across all five courses (front and back nines alternate), with paired random draws: round i
// is the same course, nine, wind and dice in every cell, so differences between cells come
// from the cells, not luck.
//   node scripts/sim/balance.mjs [roundsPerCell=200] [workers=4]
// Cells: each archetype at levels 5, 15 and 30 (auto-built skills, Common clubs); each club
// tier for a level 1 golfer with an average swing; and each difficulty setting.
// Criteria: no archetype more than 1.5 strokes per 18 holes from the average of its level;
// no tier strictly (significantly) better than Common for an average swing.
import { Worker } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARCHETYPE_IDS, ARCHETYPES } from '../../src/game/campaign.js';
import { TIERS } from '../../src/game/gear.js';

const N = Number(process.argv[2] || 200), W = Number(process.argv[3] || 4), ONLY = process.argv[4] || 'all';
const cells = [];
if (ONLY === 'all' || ONLY === 'arch') for (const level of [5, 15, 30]) for (const a of ARCHETYPE_IDS) cells.push({ kind: 'arch', archetype: a, level });
if (ONLY === 'all' || ONLY === 'tier') {
  for (const tier of TIERS) cells.push({ kind: 'tier', tier });
  // The reward side: the same tiers for a skilled, consistent swing.
  for (const tier of TIERS) cells.push({ kind: 'tier', tier, skill: 0.9, skilled: true });
  // The skilled golfer who knows the club: plans for the tier's pured bonus at its pured rate.
  const RATE = { common: 0.73, uncommon: 0.67, rare: 0.62, epic: 0.53, legendary: 0.45 };
  const BONUS = { common: 0, uncommon: 0.02, rare: 0.04, epic: 0.06, legendary: 0.08 };
  for (const tier of TIERS) cells.push({ kind: 'tier', tier, skill: 0.9, skilled: true, knows: true, planBoost: 0.88 * BONUS[tier] * RATE[tier] });
}
if (ONLY === 'all' || ONLY === 'setting') for (const setting of ['relaxed', 'standard', 'pro']) cells.push({ kind: 'setting', setting });
const tasks = [];
cells.forEach((c, ci) => { for (let i = 0; i < N; i++) tasks.push({ cell: ci, round: i }); });
// Spread work evenly (interleaved).
const parts = Array.from({ length: W }, () => []);
tasks.forEach((t, i) => parts[i % W].push(t));
const t0 = Date.now();
let doneN = 0;
const results = (await Promise.all(parts.map((p) => new Promise((res, rej) => {
  const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { tasks: p, cells } });
  w.on('message', (m) => {
    if (m.progress) { doneN += 10; if (doneN % 200 === 0) process.stdout.write(`  ${doneN} / ${tasks.length} rounds, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`); }
    if (m.done) res(m.done);
  });
  w.on('error', rej);
})))).flat();

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const byCell = cells.map((c, ci) => results.filter((r) => r.cell === ci).sort((a, b) => a.round - b.round));
const strikeRate = (rows) => {
  const tot = {}; for (const r of rows) for (const [k, n] of Object.entries(r.strikes)) tot[k] = (tot[k] || 0) + n;
  const all = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  return { full: all, pured: (tot.pured || 0) / all, mishit: (all - (tot.pured || 0) - (tot.good || 0)) / all, shank: (tot.shank || 0) / all };
};
const summary = (rows) => {
  const tp = rows.map((r) => r.toPar);
  return { rounds: rows.length, toPar9: +mean(tp).toFixed(3), per18: +(2 * mean(tp)).toFixed(2), sd9: +sd(tp).toFixed(2), se18: +(2 * sd(tp) / Math.sqrt(tp.length)).toFixed(2), putts9: +mean(rows.map((r) => r.putts)).toFixed(2), penalties9: +mean(rows.map((r) => r.penalties)).toFixed(2), pickedUp: rows.reduce((a, r) => a + r.picked, 0), ...Object.fromEntries(Object.entries(strikeRate(rows)).map(([k, v]) => [k, k === 'full' ? v : +(v * 100).toFixed(1)])) };
};

// Archetypes per level.
const arch = {};
const idx = (f) => cells.findIndex(f);
for (const level of idx((c) => c.kind === 'arch') >= 0 ? [5, 15, 30] : []) {
  const rows = ARCHETYPE_IDS.map((a) => ({ archetype: a, name: ARCHETYPES[a].name, ...summary(byCell[cells.findIndex((c) => c.kind === 'arch' && c.archetype === a && c.level === level)]) }));
  const avg = mean(rows.map((r) => r.per18));
  for (const r of rows) { r.vsAvg18 = +(r.per18 - avg).toFixed(2); r.pass = Math.abs(r.vsAvg18) <= 1.5; }
  arch[level] = { average18: +avg.toFixed(2), rows };
}
// Tiers against Common, paired by round, for an average swing and for a skilled one.
const tierTable = (skilled, knows = false) => {
  const ci0 = idx((c) => c.kind === 'tier' && c.tier === 'common' && !!c.skilled === skilled && !!c.knows === knows);
  if (ci0 < 0) return [];
  const common = byCell[ci0];
  return TIERS.map((t) => {
  const rows = byCell[idx((c) => c.kind === 'tier' && c.tier === t && !!c.skilled === skilled && !!c.knows === knows)];
  const diffs = rows.map((r, i) => 2 * (r.toPar - common[i].toPar));
  const d = mean(diffs), se = sd(diffs) / Math.sqrt(diffs.length);
  // "Strictly better" = significantly fewer strokes than Common (95 percent interval below zero).
  return { tier: t, ...summary(rows), diff18: +d.toFixed(2), ci95: [+(d - 1.96 * se).toFixed(2), +(d + 1.96 * se).toFixed(2)], strictlyBetter: d + 1.96 * se < 0 };
  });
};
const tiers = tierTable(false), tiersSkilled = tierTable(true), tiersKnown = tierTable(true, true);
const settings = idx((c) => c.kind === 'setting') < 0 ? [] : ['relaxed', 'standard', 'pro'].map((s) => ({ setting: s, ...summary(byCell[idx((c) => c.kind === 'setting' && c.setting === s)]) }));
const report = {
  method: `Simulated golfer with an average swing (skill 0.6; 0.9 for the skilled tier table), 9-hole rounds across all five courses (front and back nines alternate), paired random draws per round index (strike dice on their own stream), ${N} rounds per cell. Per-18 values are twice the 9-hole means.`,
  seconds: Math.round((Date.now() - t0) / 1000), archetypes: arch, tiers, tiersSkilled, tiersKnown, settings,
  pass: { archetypes: Object.values(arch).every((l) => l.rows.every((r) => r.pass)), tiers: tiers.every((t) => !t.strictlyBetter) },
};
mkdirSync('qa', { recursive: true });
writeFileSync(ONLY === 'all' ? 'qa/balance.json' : `qa/tmp/balance-${ONLY}.json`, JSON.stringify(report, null, 1));
// Markdown tables for the report.
if (ONLY === 'all') {
  const md = ['# Balance tables', '', report.method, ''];
  for (const [level, l] of Object.entries(arch)) {
    md.push(`## Archetypes at level ${level} (average ${l.average18} over par per 18)`, '', '| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of l.rows) md.push(`| ${r.name} | ${r.per18} | ${r.vsAvg18 >= 0 ? '+' : ''}${r.vsAvg18} | ${r.pured} | ${r.mishit} | ${r.putts9} | ${r.pass ? 'yes' : 'NO'} |`);
    md.push('');
  }
  for (const [label, list] of [['an average swing (skill 0.6)', tiers], ['a skilled swing (skill 0.9)', tiersSkilled], ['a skilled swing that plans for the tier\'s usual extra carry', tiersKnown]]) {
    md.push(`## Club tiers for ${label}, paired against Common`, '', '| Tier | Over par per 18 | Difference vs Common | 95% interval | Pured % | Mishit % | Strictly better than Common |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const t of list) md.push(`| ${t.tier} | ${t.per18} | ${t.diff18 >= 0 ? '+' : ''}${t.diff18} | ${t.ci95[0]} to ${t.ci95[1]} | ${t.pured} | ${t.mishit} | ${t.strictlyBetter ? 'YES' : 'no'} |`);
    md.push('');
  }
  md.push('## Difficulty settings (Common clubs, level 1)', '', '| Setting | Over par per 18 | Pured % | Mishit % | Shank % |', '| --- | --- | --- | --- | --- |');
  for (const x of settings) md.push(`| ${x.setting} | ${x.per18} | ${x.pured} | ${x.mishit} | ${x.shank} |`);
  md.push('', `Result: archetypes within 1.5 strokes: ${report.pass.archetypes ? 'yes' : 'no'}. No tier strictly better than Common for an average swing: ${report.pass.tiers ? 'yes' : 'no'}. Run time ${report.seconds} s.`);
  writeFileSync('qa/balance.md', md.join('\n') + '\n');
}
for (const [level, l] of Object.entries(arch)) {
  console.log(`\nLevel ${level} (average ${l.average18} per 18)`);
  for (const r of l.rows) console.log(`  ${r.name.padEnd(20)} ${String(r.per18).padStart(6)} per 18  (${r.vsAvg18 >= 0 ? '+' : ''}${r.vsAvg18})  pured ${r.pured}%  mishit ${r.mishit}%  ${r.pass ? 'ok' : 'OUT'}`);
}
for (const [label, list] of [['average swing', tiers], ['skilled swing', tiersSkilled], ['skilled swing, plans for the bonus', tiersKnown]]) {
console.log(`\nTiers vs Common, ${label} (per 18, paired)`);
for (const t of list) console.log(`  ${t.tier.padEnd(10)} ${String(t.per18).padStart(6)}  diff ${t.diff18}  95% [${t.ci95.join(', ')}]  pured ${t.pured}%  mishit ${t.mishit}%  ${t.strictlyBetter ? 'STRICTLY BETTER' : 'ok'}`);
}
console.log('\nSettings');
for (const s of settings) console.log(`  ${s.setting.padEnd(10)} ${String(s.per18).padStart(6)} per 18  pured ${s.pured}%  mishit ${s.mishit}%  shank ${s.shank}%`);
console.log(`\npass: archetypes ${report.pass.archetypes}, tiers ${report.pass.tiers}  (${report.seconds} s)`);
