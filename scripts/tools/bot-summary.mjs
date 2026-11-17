// Summarize the QA bot reports in qa/bot as a Markdown table.
//   node scripts/tools/bot-summary.mjs [qa/bot]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'qa/bot';
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const s = r.summary || {};
  const reads = r.shots.filter((x) => x.read);
  const goodReads = reads.filter((x) => Math.abs(x.read.leftDeg) <= 0.25).length;
  const t = s.tempo || {};
  rows.push({
    run: f.replace('.json', ''), input: r.input, holes: s.holes, strokes: s.strokes, toPar: s.toPar, shots: r.shots.length, putts: s.putts,
    reads: reads.length ? `${goodReads}/${reads.length}` : '-', perfect: t.Perfect || 0, stuck: s.stuck, console: s.consoleErrors, guard: s.guardErrors, min: r.timing.totalMin, secShot: r.timing.secPerShot,
  });
}
const fmt = (n) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`);
console.log('| Run | Input | Holes | Score | Shots | Putts | Putt reads within 0.25 deg | Perfect tempo | Stuck | Console errors | Guard errors | Minutes |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.run} | ${r.input} | ${r.holes} | ${r.strokes} (${fmt(r.toPar)}) | ${r.shots} | ${r.putts} | ${r.reads} | ${r.perfect} of ${r.shots} | ${r.stuck} | ${r.console} | ${r.guard} | ${r.min} |`);
