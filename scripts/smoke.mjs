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
  let engineChecks = null;
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
    engineChecks = await runEngineChecks(browser, server.url, courses[0].id, failures);
  } finally {
    await browser.close();
    await server.close();
  }
  const summary = {
    when: new Date().toISOString(), executablePath, software, tier, enforceLuma,
    note: 'Software rendering (SwiftShader). Luma and clipping are valid; frame time is not representative of a real GPU.',
    seconds: +((Date.now() - started) / 1000).toFixed(1), rows, engineChecks, failures,
  };
  writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify(summary, null, 1));
  return summary;
}

// Stage 1 engine checks: WebGL context loss and restore, tier switching, DPR capping, and a
// live orientation change, all on one page without reloading.
async function runEngineChecks(browser, baseUrl, courseId, failures) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const out = {};
  const fail = (m) => failures.push('engine: ' + m);
  try {
    await page.goto(`${baseUrl}/?course=${courseId}&tod=midday&tier=low&smoke=1&debug=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null, { timeout: 180000 });
    out.contextLoss = await page.evaluate(async () => {
      const before = window.__fw.measure();
      const f0 = window.__fw.info().frame;
      const lost = await window.__fw.loseContext(250);
      await new Promise((r) => setTimeout(r, 400));
      const after = window.__fw.measure();
      return { supported: lost.supported, lossCount: lost.lost, stillLost: lost.contextLost, lumaBefore: before.luma, lumaAfter: after.luma, framesAfter: window.__fw.info().frame - f0 };
    });
    const cl = out.contextLoss;
    if (!cl.supported) fail('WEBGL_lose_context is not available, context loss could not be exercised');
    else {
      if (cl.lossCount !== 1 || cl.stillLost) fail(`context was not restored (lossCount ${cl.lossCount}, stillLost ${cl.stillLost})`);
      if (!(Math.abs(cl.lumaAfter - cl.lumaBefore) < 8)) fail(`image changed after context restore: luma ${cl.lumaBefore.toFixed(1)} -> ${cl.lumaAfter.toFixed(1)}`);
      if (!(cl.framesAfter > 0)) fail('the frame loop did not continue after context restore');
    }
    out.tiers = await page.evaluate(() => {
      const rows = [];
      for (const t of ['low', 'medium', 'high', 'ultra', 'low']) {
        window.__fw.setTier(t);
        const m = window.__fw.measure();
        const i = window.__fw.info();
        rows.push({ tier: i.tier, width: m.width, height: m.height, pixelRatio: i.pixelRatio, luma: +m.luma.toFixed(1), calls: m.calls });
      }
      return rows;
    });
    // Device pixel ratio is 3 here, so every tier must be clamped to its own cap.
    const caps = { low: 1, medium: 1.5, high: 2, ultra: 2.5 };
    for (const r of out.tiers) {
      if (Math.abs(r.pixelRatio - caps[r.tier]) > 1e-6) fail(`tier ${r.tier} pixel ratio ${r.pixelRatio}, expected cap ${caps[r.tier]}`);
      if (r.width !== Math.round(640 * caps[r.tier])) fail(`tier ${r.tier} buffer width ${r.width}`);
      if (!Number.isFinite(r.luma) || r.luma < 20) fail(`tier ${r.tier} rendered a bad frame (luma ${r.luma})`);
    }
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForFunction(() => window.__fw.info().orientation === 'portrait', null, { timeout: 15000 }).catch(() => fail('orientation did not switch to portrait after a resize'));
    out.portrait = await page.evaluate(() => { const m = window.__fw.measure(); const i = window.__fw.info(); return { orientation: i.orientation, width: m.width, height: m.height, luma: +m.luma.toFixed(1) }; });
    if (out.portrait.width !== 360 || out.portrait.height !== 640) fail(`portrait buffer is ${out.portrait.width}x${out.portrait.height}`);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForFunction(() => window.__fw.info().orientation === 'landscape', null, { timeout: 15000 }).catch(() => fail('orientation did not switch back to landscape'));
    out.debugOverlay = await page.evaluate(() => { const el = document.getElementById('fw-debug'); return el ? el.textContent.split('\n').slice(0, 4) : null; });
    if (!out.debugOverlay || !/tier/.test(out.debugOverlay.join(' ')) || !/draws/.test(out.debugOverlay.join(' ')) || !/texture mem/.test(out.debugOverlay.join(' '))) fail('?debug overlay is missing tier, draw calls, or texture memory');
    out.guardErrors = await page.evaluate(() => window.__fw.errors.count);
    if (out.guardErrors) fail(`${out.guardErrors} guarded subsystem error(s)`);
  } catch (err) {
    fail(String(err.message).split('\n')[0]);
  }
  // A lost context logs a browser warning, not an error. Anything at error level fails.
  if (errors.length) fail(`${errors.length} console error(s): ${errors[0].text.slice(0, 200)}`);
  out.consoleErrors = errors.length;
  await context.close();
  return out;
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
  const e = summary.engineChecks;
  if (e && e.contextLoss) {
    console.log(`engine: context loss ${e.contextLoss.supported ? `restored (luma ${e.contextLoss.lumaBefore.toFixed(1)} -> ${e.contextLoss.lumaAfter.toFixed(1)}, ${e.contextLoss.framesAfter} frames after)` : 'not testable'}; tiers ${(e.tiers || []).map((t) => `${t.tier}@${t.pixelRatio}x`).join(' ')}; portrait ${e.portrait ? e.portrait.width + 'x' + e.portrait.height : 'n/a'}; debug overlay ${e.debugOverlay ? 'present' : 'missing'}`);
  }
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
