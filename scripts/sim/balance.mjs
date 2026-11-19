// Balance runs. The simulated golfer (src/game/simGolfer.js) plays 9-hole rounds across all
// seven courses (front and back nines alternate), with paired random draws: round i is the same
// course, nine, wind and dice in every cell, so differences between cells come from the cells.
//   node scripts/sim/balance.mjs [roundsPerCell=200] [workers=4] [all|arch|tier|setting|pros] [tag]
// Cells:
//   archetypes at levels 5, 15 and 30 (auto-built skills, Common clubs, normal conditions);
//   each club tier for a poor (0.35), average (0.6) and skilled (0.9) swing in three conditions
//     (scripts/sim/worker.mjs): calm fairway play (no wind, every lie through the green played
//     as fairway, no slope), normal (the course's own wind and lies), and wind and rough (a 10
//     to 20 mph gusty wind and every fairway lie played as rough);
//   each difficulty setting; the twelve pros.
// Criteria: no archetype or pro more than 1.5 strokes per 18 holes from its group's average;
// the tier targets (tier benefits, data/tierBenefits.js): Legendary 0.3 to 1.0 strokes better
// than Common for a skilled swing in wind and rough, no better than Common for a poor swing,
// and within 0.3 strokes of Common for an average swing on calm fairway play.
// Output: qa/balance.json and qa/balance.md for "all" (or qa/tmp/balance-<tag>.* when tagged).
import { runCells } from './run.mjs';
import { PROS, PRO_LEVEL } from '../../src/game/pros.js';
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

const run = (cells) => runCells(cells, N, W, (done, total) => { if (done % 500 === 0) process.stdout.write(`  ${done} / ${total} rounds, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`); });

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
const CONDITIONS = [['calm-fairway', 'Calm fairway play'], ['normal', 'Normal conditions'], ['wind-rough', 'Wind and rough']];
if (ONLY === 'all' || ONLY === 'tier') for (const [cond] of CONDITIONS) for (const [name, skill] of SKILLS) for (const tier of TIERS) cells.push({ kind: 'tier', tier, skill, skillName: name, plan: 'none', conditions: cond });
if (ONLY === 'all' || ONLY === 'setting') for (const setting of ['relaxed', 'standard', 'pro']) cells.push({ kind: 'setting', setting });
// The pros (data/pros.json) at their matched level, with a tour swing and an average one.
const PRO_SKILLS = [['tour', 0.85], ['average', 0.6]];
if (ONLY === 'all' || ONLY === 'pros') for (const [, skill] of PRO_SKILLS) for (const p of PROS) cells.push({ kind: 'pro', pro: p.id, skill });
const rows1 = await run(cells);
const find = (f) => { const i = cells.findIndex(f); return i < 0 ? null : rows1[i]; };

// ---- phase 2: tiers planned with the game's guide at the golfer's own clean-strike Pured rate ----
const cells2 = [];
if (hasGuide && (ONLY === 'all' || ONLY === 'tier')) for (const [name, skill] of SKILLS) for (const tier of TIERS) {
  const mix = strikeMix(find((c) => c.kind === 'tier' && c.tier === tier && c.skill === skill && c.plan === 'none' && c.conditions === 'normal'));
  const rate = mix.pured / Math.max(1e-9, mix.pured + mix.good);
  cells2.push({ kind: 'tier', tier, skill, skillName: name, plan: 'guide', pureRate: +rate.toFixed(3), planBoost: guideBoost(tier, rate) });
}
const rows2 = cells2.length ? await run(cells2) : [];
const tierRows = (skill, plan, cond = 'normal') => {
  const src = plan === 'guide' ? [cells2, rows2] : [cells, rows1];
  const get = (tier) => { const i = src[0].findIndex((c) => c.kind === 'tier' && c.tier === tier && c.skill === skill && c.plan === plan && (plan === 'guide' || c.conditions === cond)); return i < 0 ? null : src[1][i]; };
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
// The same tiers in each condition.
const byCondition = {};
if (ONLY === 'all' || ONLY === 'tier') for (const [cond, label] of CONDITIONS) byCondition[cond] = { label, skills: Object.fromEntries(SKILLS.map(([name, skill]) => [name, { skill, rows: tierRows(skill, 'none', cond) }])) };
const legIn = (cond, name) => byCondition[cond].skills[name].rows.find((t) => t.tier === 'legendary');
const pros = {};
if (ONLY === 'all' || ONLY === 'pros') for (const [name, skill] of PRO_SKILLS) {
  const rows = PROS.map((p) => ({ pro: p.id, name: p.name, archetype: p.archetype, ...summary(find((c) => c.kind === 'pro' && c.pro === p.id && c.skill === skill)) }));
  const avg = mean(rows.map((r) => r.per18));
  for (const r of rows) { r.vsAvg18 = +(r.per18 - avg).toFixed(2); r.pass = Math.abs(r.vsAvg18) <= 1.5; }
  pros[name] = { skill, average18: +avg.toFixed(2), rows };
}
const settings = (ONLY === 'all' || ONLY === 'setting') ? ['relaxed', 'standard', 'pro'].map((s) => ({ setting: s, ...summary(find((c) => c.kind === 'setting' && c.setting === s)) })) : [];
const leg = (name, plan) => (tiers[name] && tiers[name][plan] ? tiers[name][plan].find((t) => t.tier === 'legendary').diff18 : null);
const legOf = (name) => leg(name, 'guide');
const targets = tiers.average ? {
  // Tier benefits: Legendary against Common (negative is better than Common).
  skilledWindRough: { value: legIn('wind-rough', 'skilled').diff18, ci95: legIn('wind-rough', 'skilled').ci95, met: legIn('wind-rough', 'skilled').diff18 <= -0.3 && legIn('wind-rough', 'skilled').diff18 >= -1.0 },
  poorNoBetter: { values: Object.fromEntries(CONDITIONS.map(([c]) => [c, legIn(c, 'poor').diff18])), met: CONDITIONS.every(([c]) => legIn(c, 'poor').diff18 >= 0) },
  averageCalm: { value: legIn('calm-fairway', 'average').diff18, ci95: legIn('calm-fairway', 'average').ci95, met: Math.abs(legIn('calm-fairway', 'average').diff18) <= 0.3 },
  legendary: { poor: legOf('poor'), average: legOf('average'), skilled: legOf('skilled') },
} : null;
const report = {
  method: `Simulated golfer: plans like the AI and swings with a fixed human-like error model (skill 0.35 poor, 0.6 average, 0.9 skilled). 9-hole rounds across all seven courses (front and back nines alternate); paired random draws per round index (strike dice on their own stream); ${N} rounds per cell; per-18 values are twice the 9-hole means. Tier differences are paired against Common with the same swing, planning and conditions. Conditions: calm fairway play (no wind, every lie through the green played as a flat fairway lie), normal (each course's own wind and the real lies), and wind and rough (a 10 to 20 mph gusty wind and every fairway lie played as rough). Archetypes, settings and pros play normal conditions. Tier benefits (data/tierBenefits.js) apply to the shots and the plan: a crosswind moves a higher tier's ball less and rough, sand and bad lies cost it less; the golfer does not use the spin pad, so the third benefit, the wider spin and shape range, is not in these numbers.${hasGuide ? ' "Plans for the tier\'s carry" uses the carry the game shows: the tier\'s Good-strike bonus plus the rest in proportion to the golfer\'s own Pured rate among clean strikes (strike.tierCarryFactor).' : ' Every tier carries the table carry in this build and the guide shows it, so the golfer plans the same way with every tier.'}`,
  carryRule: !hasGuide, seconds: Math.round((Date.now() - t0) / 1000), archetypes: arch, tiers, byCondition, settings, targets,
  pros, proLevel: PRO_LEVEL,
  pass: { archetypes: Object.values(arch).every((l) => l.rows.every((r) => r.pass)), pros: Object.values(pros).every((l) => l.rows.every((r) => r.pass)) },
};

// ---- output ----
const md = ['# Balance tables', '', report.method, ''];
for (const [level, l] of Object.entries(arch)) {
  md.push(`## Archetypes at level ${level} (average ${l.average18} over par per 18)`, '', '| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of l.rows) md.push(`| ${r.name} | ${r.per18} | ${r.vsAvg18 >= 0 ? '+' : ''}${r.vsAvg18} | ${r.pured} | ${r.mishit} | ${r.putts9} | ${r.pass ? 'yes' : 'NO'} |`);
  md.push('');
}
const sgn = (x) => `${x > 0 ? '+' : ''}${x}`;
for (const [cond, c] of Object.entries(byCondition)) {
  md.push(`## Club tiers, ${c.label.toLowerCase()}: strokes per 18 against Common`, '', '| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |', '| --- | --- | --- | --- | --- |');
  for (const [name, x] of Object.entries(c.skills)) for (const t of x.rows) md.push(`| ${t.tier === 'common' ? `${name} (${x.skill}), Common ${x.rows[0].per18} over par` : ''} | ${t.tier} | ${t.tier === 'common' ? '0' : `${sgn(t.diff18)} (${t.ci95[0]} to ${t.ci95[1]})`} | ${t.pured} | ${t.mishit} |`);
  md.push('');
}
for (const [name, l] of Object.entries(pros)) {
  md.push(`## Pros, ${name} swing (skill ${l.skill}), matched level (average ${l.average18} over par per 18)`, '', '| Pro | Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of l.rows) md.push(`| ${r.name} | ${r.archetype} | ${r.per18} | ${r.vsAvg18 >= 0 ? '+' : ''}${r.vsAvg18} | ${r.pured} | ${r.mishit} | ${r.putts9} | ${r.pass ? 'yes' : 'NO'} |`);
  md.push('');
}
if (settings.length) {
  md.push('## Difficulty settings (Common clubs, level 1, average swing)', '', '| Setting | Over par per 18 | Pured % | Mishit % | Shank % |', '| --- | --- | --- | --- | --- |');
  for (const x of settings) md.push(`| ${x.setting} | ${x.per18} | ${x.pured} | ${x.mishit} | ${x.shank} |`);
  md.push('');
}
if (targets) {
  md.push(`Targets for Legendary against Common (negative is better than Common):`, '');
  md.push(`- Skilled swing in wind and rough, 0.3 to 1.0 strokes better: ${sgn(targets.skilledWindRough.value)} (${targets.skilledWindRough.ci95[0]} to ${targets.skilledWindRough.ci95[1]}), ${targets.skilledWindRough.met ? 'met' : 'NOT met'}.`);
  md.push(`- Poor swing no better than Common: calm fairway ${sgn(targets.poorNoBetter.values['calm-fairway'])}, normal ${sgn(targets.poorNoBetter.values.normal)}, wind and rough ${sgn(targets.poorNoBetter.values['wind-rough'])}, ${targets.poorNoBetter.met ? 'met' : 'NOT met'}.`);
  md.push(`- Average swing on calm fairway play within 0.3 strokes: ${sgn(targets.averageCalm.value)} (${targets.averageCalm.ci95[0]} to ${targets.averageCalm.ci95[1]}), ${targets.averageCalm.met ? 'met' : 'NOT met'}.`, '');
}
if (Object.keys(arch).length) md.push(`Archetypes within 1.5 strokes of their level's average: ${report.pass.archetypes ? 'yes' : 'no'}.`);
if (Object.keys(pros).length) md.push(`Pros within 1.5 strokes of the pros' average: ${report.pass.pros ? 'yes' : 'no'}.`);
md.push(`Run time ${report.seconds} s.`);
mkdirSync('qa/tmp', { recursive: true });
const base = ONLY === 'all' && !TAG ? 'qa/balance' : `qa/tmp/balance-${TAG || ONLY}`;
writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
writeFileSync(`${base}.md`, md.join('\n') + '\n');
console.log(md.slice(4).join('\n'));
