// npm run verify: the regression gate for every stage.
//   1. all unit tests (vitest)
//   2. production build (vite)
//   3. headless Chrome smoke over every course and time-of-day preset
// Exits non-zero if any step fails. Writes qa/verify.json with the evidence.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = { when: new Date().toISOString(), steps: [] };

function run(name, cmd, args) {
  const t0 = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out.length > 6000 ? out.slice(0, 1500) + '\n...\n' + out.slice(-4000) : out);
  const step = { name, ok: r.status === 0, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  result.steps.push(step);
  return { ok: r.status === 0, out, step };
}

function dirSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

const tests = run('unit tests', npx, ['vitest', 'run', '--reporter=dot']);
const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(tests.out.replace(/\u001b\[[0-9;]*m/g, ''));
if (m) { tests.step.passed = Number(m[2]); tests.step.failed = Number(m[1] || 0); }

const build = tests.ok ? run('production build', npx, ['vite', 'build']) : { ok: false };
if (build.ok) {
  try { build.step.distBytes = dirSize(path.join(root, 'dist')); } catch (e) { /* ignore */ }
}
const smoke = build.ok ? run('headless smoke', process.execPath, ['scripts/smoke.mjs', ...process.argv.slice(2)]) : { ok: false };

result.ok = tests.ok && build.ok && smoke.ok;
mkdirSync(path.join(root, 'qa'), { recursive: true });
writeFileSync(path.join(root, 'qa', 'verify.json'), JSON.stringify(result, null, 1));
console.log('\n=== verify summary ===');
for (const s of result.steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  (${s.seconds}s)${s.passed !== undefined ? `  ${s.passed} tests passed` : ''}${s.distBytes ? `  dist ${(s.distBytes / 1048576).toFixed(2)} MB` : ''}`);
if (!tests.ok) console.log('Build and smoke were skipped because tests failed.');
else if (!build.ok) console.log('Smoke was skipped because the build failed.');
console.log(result.ok ? 'VERIFY OK' : 'VERIFY FAILED');
process.exit(result.ok ? 0 : 1);
