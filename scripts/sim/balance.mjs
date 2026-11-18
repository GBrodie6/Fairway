// Balance runs. The simulated golfer (src/game/simGolfer.js) plays 9-hole rounds across all
// five courses (front and back nines alternate), with paired random draws: round i is the same
// course, nine, wind and dice in every cell, so differences between cells come from the cells.
//   node scripts/sim/balance.mjs [roundsPerCell=200] [workers=4] [all|arch|tier|setting] [tag]
// Cells:
//   archetypes at levels 5, 15 and 30 (auto-built skills, Common clubs);
//   each club tier for a poor (0.35), average (0.6) and skilled (0.9) swing, two ways:
//     none      plans with the base carry (ignores the tier),
//     guide     plans for the tier's carry as the game shows it (strike.tierCarryFactor at the
//               golfer's own clean-strike Pured rate, measured in the first pass; the same as
//               none in builds whose guide showed the base carry);
//   each difficulty setting.
// Criteria: no archetype more than 1.5 strokes per 18 holes from its level's average. Tier
// targets (golfer following the guide): Legendary 0.5 to 1.5 strokes per 18 better than Common
// for a skilled swing, within 0.5 of Common for an average swing, and worse for a poor swing.
// Output: qa/balance.json and qa/balance.md for "all" (or qa/tmp/balance-<tag>.* when tagged).
import { Worker } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARCHETYPE_IDS, ARCHETYPES } from '../../src/game/campaign.js';
import { TIERS } from '../../src/game/gear.js';
import * as strike from '../../src/game/strike.js';

const N = Number(process.argv[2] || 200), W = Number(process.argv[3] || 4), ONLY = process.argv[4] || 'all', TAG = process.argv[5] || '';
const SKILLS = [['poor', 0.35], ['average', 0.6], ['skilled', 0.9]];
// The guide's extra carry for a tier at a clean-strike Pured rate (0 in builds without one).
const guideBoost = (tier, pureRate) => (strike.tierCarryFactor && strike.guideShare ? strike.tierCarryFactor(tier, strike.guideShare(pureRate)) - 1 : 0);
const hasGuide = TIERS.some((t) => guideBoost(t, 0.5) > 0);
const t0 = Date.now();

function run(cells) {
  const tasks = [];
  cells.forEach((c, ci) => { for (let i = 0; i < N; i++) tasks.push({ cell: ci, round: i }); });
  const parts = Array.from({ length: W }, () => []);
  tasks.forEach((t, i) => parts[i % W].push(t));
  let doneN = 0;
  return Promise.all(parts.map((p) => new Promise((res, rej) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { tasks: p, cells } });
    w.on('message', (m) => {
      if (m.progress) { doneN += 10; if (doneN % 500 === 0) process.stdout.write(`  ${doneN} / ${tasks.length} rounds, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`); }
      if (m.done) res(m.done);
    });
    w.on('error', rej);
  }))).then((r) => { const flat = r.flat(); return cells.map((c, ci) => flat.filter((x) => x.cell === ci).sort((a, b) => a.round - b.round)); });
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const strikeMix = (rows) => {
  const tot = {}; for (const r of rows) for (const [k, n] of Object.entries(r.strikes)) tot[k] = (tot[k] || 0) + n;
  const all = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  return { pured: (tot.pured || 0) / all, good: (tot.good || 0) / all, mishit: (all - (tot.pured || 0) - (tot.good || 0)) / all, shank: (tot.shank || 0) / all };
};
const summary = (rows) => {
  const tp = rows.map((r) => r.toPar), mix = strikeMix(rows);
  return { rounds: rows.length, per18: +(2 * mean(tp)).toFixed(2), se18: +(2 * sd(tp) / Math.sqrt(tp.length)).toFixed(2), putts9: +mean(rows.map((r) => r.putts)).toFixed(2), pured: +(mix.pured * 100).toFixed(1), good: +(mix.good * 100).toFixed(1), mishit: +(mix.mishit * 100).toFixed(1), shank: +(mix.shank * 100).toFixed(1) };
};
// Paired difference against a reference cell, per 18 holes, with a 95 percent interval.
const paired = (rows, ref) => {
  const d = rows.map((r, i) => 2 * (r.toPar - ref[i].toPar));
  const m = mean(d), se = sd(d) / Math.sqrt(d.length);
  return { diff18: +m.toFixed(2), ci95: [+(m - 1.96 * se).toFixed(2), +(m + 1.96 * se).toFixed(2)] };
};

// ---- phase 1: archetypes, tiers without planning and with the guide, settings ----
const cells = [];
if (ONLY === 'all' || ONLY === 'arch') for (const level of [5, 15, 30]) for (const a of ARCHETYPE_IDS) cells.push({ kind: 'arch', archetype: a, level });
if (ONLY === 'all' || ONLY === 'tier') for (const [name, skill] of SKILLS) for (const tier of TIERS) cells.push({ kind: 'tier', tier, skill, skillName: name, plan: 'none' });
if (ONLY === 'all' || ONLY === 'setting') for (const setting of ['relaxed', 'standard', 'pro']) cells.push({ kind: 'setting', setting });
const rows1 = await run(cells);
const find = (f) => { const i = cells.findIndex(f); return i < 0 ? null : rows1[i]; };

// ---- phase 2: tiers planned with the game's guide at the golfer's own clean-strike Pured rate ----
const cells2 = [];
if (hasGuide && (ONLY === 'all' || ONLY === 'tier')) for (const [name, skill] of SKILLS) for (const tier of TIERS) {
  const mix = strikeMix(find((c) => c.kind === 'tier' && c.tier === tier && c.skill === skill && c.plan === 'none'));
  const rate = mix.pured / Math.max(1e-9, mix.pured + mix.good);
  cells2.push({ kind: 'tier', tier, skill, skillName: name, plan: 'guide', pureRate: +rate.toFixed(3), planBoost: guideBoost(tier, rate) });
}
const rows2 = cells2.length ? await run(cells2) : [];
const tierRows = (skill, plan) => {
  const src = plan === 'guide' ? [cells2, rows2] : [cells, rows1];
  const get = (tier) => { const i = src[0].findIndex((c) => c.kind === 'tier' && c.tier === tier && c.skill === skill && c.plan === plan); return i < 0 ? null : src[1][i]; };
  const ref = get('common');
  if (!ref) return null;
  return TIERS.map((tier) => ({ tier, ...summary(get(tier)), ...paired(get(tier), ref), planBoost: +((src[0].find((c) => c.kind === 'tier' && c.tier === tier && c.skill === skill && c.plan === plan) || {}).planBoost || 0).toFixed(4) }));
};

// ---- tables ----
const arch = {};
if (ONLY === 'all' || ONLY === 'arch') for (const level of [5, 15, 30]) {
  const rows = ARCHETYPE_IDS.map((a) => ({ archetype: a, name: ARCHETYPES[a].name, ...summary(find((c) => c.kind === 'arch' && c.archetype === a && c.level === level)) }));
  const avg = mean(rows.map((r) => r.per18));
  for (const r of rows) { r.vsAvg18 = +(r.per18 - avg).toFixed(2); r.pass = Math.abs(r.vsAvg18) <= 1.5; }
  arch[level] = { average18: +avg.toFixed(2), rows };
}
const tiers = {};
if (ONLY === 'all' || ONLY === 'tier') for (const [name, skill] of SKILLS) tiers[name] = { skill, none: tierRows(skill, 'none'), guide: hasGuide ? tierRows(skill, 'guide') : tierRows(skill, 'none') };
const settings = (ONLY === 'all' || ONLY === 'setting') ? ['relaxed', 'standard', 'pro'].map((s) => ({ setting: s, ...summary(find((c) => c.kind === 'setting' && c.setting === s)) })) : [];
const leg = (name, plan) => (tiers[name] && tiers[name][plan] ? tiers[name][plan].find((t) => t.tier === 'legendary').diff18 : null);
const targets = tiers.skilled ? {
  skilledBetterBy0_5to1_5: leg('skilled', 'guide') <= -0.5 && leg('skilled', 'guide') >= -1.5,
  averageWithin0_5: Math.abs(leg('average', 'guide')) <= 0.5,
  poorCostsStrokes: leg('poor', 'guide') > 0,
  legendary: { poor: leg('poor', 'guide'), average: leg('average', 'guide'), skilled: leg('skilled', 'guide') },
} : null;
const report = {
  method: `Simulated golfer: plans like the AI and swings with a fixed human-like error model (skill 0.35 poor, 0.6 average, 0.9 skilled). 9-hole rounds across all five courses (front and back nines alternate); paired random draws per round index (strike dice on their own stream); ${N} rounds per cell; per-18 values are twice the 9-hole means. Tier differences are paired against Common with the same swing and planning.${hasGuide ? ' "Plans for the tier\'s carry" uses the carry the game shows: the tier\'s Good-strike bonus plus the rest in proportion to the golfer\'s own Pured rate among clean strikes (strike.tierCarryFactor).' : ' This build showed the base carry for every tier, so planning for the tier\'s carry as the game showed it is the same as not planning.'}`,
  goodShare: strike.GOOD_SHARE || 0, seconds: Math.round((Date.now() - t0) / 1000), archetypes: arch, tiers, settings, targets,
  pass: { archetypes: Object.values(arch).every((l) => l.rows.every((r) => r.pass)) },
};

// ---- output ----
const md = ['# Balance tables', '', report.method, ''];
for (const [level, l] of Object.entries(arch)) {
  md.push(`## Archetypes at level ${level} (average ${l.average18} over par per 18)`, '', '| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of l.rows) md.push(`| ${r.name} | ${r.per18} | ${r.vsAvg18 >= 0 ? '+' : ''}${r.vsAvg18} | ${r.pured} | ${r.mishit} | ${r.putts9} | ${r.pass ? 'yes' : 'NO'} |`);
  md.push('');
}
const sgn = (x) => `${x > 0 ? '+' : ''}${x}`;
for (const [name, t] of Object.entries(tiers)) {
  md.push(`## Club tiers, ${name} swing (skill ${t.skill}): strokes per 18 against Common`, '',
    '| Tier | Plans with the base carry | Plans for the tier\'s carry | Pured % | Good % | Mishit % |', '| --- | --- | --- | --- | --- | --- |');
  for (let i = 0; i < TIERS.length; i++) {
    const a = t.none[i], b = t.guide[i];
    md.push(`| ${a.tier} | ${sgn(a.diff18)} (${a.ci95[0]} to ${a.ci95[1]}) | ${sgn(b.diff18)} (${b.ci95[0]} to ${b.ci95[1]}) | ${b.pured} | ${b.good} | ${b.mishit} |`);
  }
  md.push('', `Common plays ${t.none[0].per18} over par per 18 for this swing.`, '');
}
if (settings.length) {
  md.push('## Difficulty settings (Common clubs, level 1, average swing)', '', '| Setting | Over par per 18 | Pured % | Mishit % | Shank % |', '| --- | --- | --- | --- | --- |');
  for (const x of settings) md.push(`| ${x.setting} | ${x.per18} | ${x.pured} | ${x.mishit} | ${x.shank} |`);
  md.push('');
}
if (targets) md.push(`Legendary against Common, planning for the tier's carry: poor ${sgn(targets.legendary.poor)}, average ${sgn(targets.legendary.average)}, skilled ${sgn(targets.legendary.skilled)} strokes per 18. Targets: skilled 0.5 to 1.5 better ${targets.skilledBetterBy0_5to1_5 ? 'met' : 'NOT met'}; average within 0.5 ${targets.averageWithin0_5 ? 'met' : 'NOT met'}; poor costs strokes ${targets.poorCostsStrokes ? 'met' : 'NOT met'}.`);
if (Object.keys(arch).length) md.push(`Archetypes within 1.5 strokes of their level's average: ${report.pass.archetypes ? 'yes' : 'no'}.`);
md.push(`Run time ${report.seconds} s.`);
mkdirSync('qa/tmp', { recursive: true });
const base = ONLY === 'all' && !TAG ? 'qa/balance' : `qa/tmp/balance-${TAG || ONLY}`;
writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
writeFileSync(`${base}.md`, md.join('\n') + '\n');
console.log(md.slice(4).join('\n'));
