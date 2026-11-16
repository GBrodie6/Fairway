// Headless Chrome smoke test over every course and every time-of-day preset.
// For each combination it loads the real built app, waits for the first frame, and reports
// console errors, mean luma, and clipped pixel percent FOR THE 3D VIEWPORT ONLY (read back
// from the WebGL canvas, so no HUD pixels are included).
//
// Headless Chrome uses SwiftShader, a software rasterizer. Pixel values are valid evidence;
// frame times are not representative of a real GPU.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, trackErrors } from './lib/browser.mjs';
import { serveStatic } from './lib/serve.mjs';
import { COURSES } from '../src/course/courses.js';
import { TOD_ORDER, bandFor } from '../src/render/timeOfDay.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const gatePath = path.join(root, 'qa', 'gate.json');
const gate = existsSync(gatePath) ? JSON.parse(readFileSync(gatePath, 'utf8')) : {};
const enforceLuma = args.luma !== undefined ? args.luma !== 'off' : !!gate.enforceLuma;
const courseFilter = args.course ? String(args.course).split(',') : null;
const shots = !!args.shots;
const tier = args.tier || 'low';

export async function runSmoke() {
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing. Run "npm run build" first.');
  const server = await serveStatic(dist);
  const { browser, executablePath, software } = await launchBrowser();
  const rows = [];
  const failures = [];
  const outDir = path.join(root, 'qa');
  mkdirSync(path.join(outDir, 'tmp'), { recursive: true });
  const courses = COURSES.filter((c) => (gate.courses ? gate.courses.includes(c.id) : true)).filter((c) => !courseFilter || courseFilter.includes(c.id));
  const started = Date.now();
  try {
    for (const view of [{ name: 'landscape', width: 640, height: 360 }, { name: 'portrait', width: 360, height: 640 }]) {
      for (const course of courses) {
        const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1, hasTouch: view.name === 'portrait', isMobile: view.name === 'portrait' });
        const page = await context.newPage();
        const errors = trackErrors(page);
        const url = `${server.url}/?course=${course.id}&tod=${TOD_ORDER[0]}&tier=${tier}&smoke=1`;
        let loaded = false;
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 120000 });
          await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null, { timeout: 180000 });
          loaded = true;
        } catch (err) {
          failures.push(`${course.id}/${view.name}: app did not become ready (${String(err.message).split('\n')[0]})`);
        }
        // Portrait runs one day preset and night per course. Landscape runs all of them.
        const presets = view.name === 'landscape' ? TOD_ORDER : ['midday', 'night'];
        for (const tod of presets) {
          if (!loaded) break;
          const before = errors.length;
          let m = null;
          try {
            m = await page.evaluate(async (id) => {
              await window.__fw.setTimeOfDay(id);
              const r = window.__fw.measure();
              const info = window.__fw.info();
              return { ...r, guardErrors: window.__fw.errors.count, lastGuard: window.__fw.errors.last, tier: info.tier };
            }, tod);
          } catch (err) {
            failures.push(`${course.id}/${tod}/${view.name}: measure threw (${String(err.message).split('\n')[0]})`);
          }
          const newErrors = errors.slice(before);
          const band = bandFor(tod);
          const row = {
            course: course.id, tod, view: view.name, tier,
            luma: m ? +m.luma.toFixed(1) : null, clippedPct: m ? +m.clippedPct.toFixed(2) : null, crushedPct: m ? +m.crushedPct.toFixed(2) : null,
            exposure: m ? +m.exposure.toFixed(3) : null, calls: m ? m.calls : null, triangles: m ? m.triangles : null,
            consoleErrors: newErrors.length, guardErrors: m ? m.guardErrors : null,
            band: `${band.min}-${band.max}`,
            lumaOk: m ? m.luma >= band.min && m.luma <= band.max : false,
            clipOk: m ? m.clippedPct <= band.maxClippedPct : false,
          };
          rows.push(row);
          if (newErrors.length) failures.push(`${course.id}/${tod}/${view.name}: ${newErrors.length} console error(s): ${newErrors[0].text.slice(0, 300)}`);
          if (m && m.guardErrors > 0) failures.push(`${course.id}/${tod}/${view.name}: ${m.guardErrors} guarded subsystem error(s): ${JSON.stringify(m.lastGuard)}`);
          if (m && !Number.isFinite(m.luma)) failures.push(`${course.id}/${tod}/${view.name}: non-finite luma`);
          if (enforceLuma && m && (!row.lumaOk || !row.clipOk)) failures.push(`${course.id}/${tod}/${view.name}: luma ${row.luma} clipped ${row.clippedPct}% outside band ${row.band} / ${band.maxClippedPct}%`);
          if (shots && m) await page.screenshot({ path: path.join(outDir, 'tmp', `smoke-${course.id}-${tod}-${view.name}.png`) });
        }
        // Errors that arrived outside a preset step (during load) still fail the gate.
        const counted = rows.filter((r) => r.course === course.id && r.view === view.name).reduce((a, r) => a + r.consoleErrors, 0);
        if (errors.length > counted) failures.push(`${course.id}/${view.name}: ${errors.length - counted} console error(s) during load: ${errors[0].text.slice(0, 300)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const summary = {
    when: new Date().toISOString(), executablePath, software, tier, enforceLuma,
    note: 'Software rendering (SwiftShader). Luma and clipping are valid; frame time is not representative of a real GPU.',
    seconds: +((Date.now() - started) / 1000).toFixed(1), rows, failures,
  };
  writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify(summary, null, 1));
  return summary;
}

function printTable(summary) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('course', 10), pad('tod', 9), pad('view', 10), pad('luma', 7), pad('band', 9), pad('clip%', 7), pad('exp', 8), pad('draws', 6), pad('tris', 9), 'errors');
  for (const r of summary.rows) {
    const flag = r.lumaOk && r.clipOk ? ' ' : '*';
    console.log(pad(r.course, 10), pad(r.tod, 9), pad(r.view, 10), pad(r.luma + flag, 7), pad(r.band, 9), pad(r.clippedPct, 7), pad(r.exposure, 8), pad(r.calls, 6), pad(r.triangles, 9), r.consoleErrors + (r.guardErrors ? ` (+${r.guardErrors} guarded)` : ''));
  }
  const inBand = summary.rows.filter((r) => r.lumaOk && r.clipOk).length;
  console.log(`\n${summary.rows.length} combinations in ${summary.seconds}s, ${inBand} inside the luma and clipping bands (enforced: ${summary.enforceLuma}). * marks a row outside its band.`);
  console.log(summary.note);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmoke().then((s) => {
    printTable(s);
    if (s.failures.length) {
      console.error(`\nSMOKE FAILED (${s.failures.length}):`);
      for (const f of s.failures) console.error(' - ' + f);
      process.exit(1);
    }
    console.log('SMOKE OK');
  }).catch((err) => { console.error(err); process.exit(1); });
}
export { printTable };
