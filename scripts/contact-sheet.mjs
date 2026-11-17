// Contact sheets: every course at every time-of-day preset from the address view, plus
// close-ups (green, bunker, water, tree line, rough, flyover) at every quality tier.
//   node scripts/contact-sheet.mjs [--course parkland,links] [--tiers low,medium,high,ultra] [--out qa/contact]
// Writes one JPEG sheet per course and section, and qa/contact/luma.json with the measured
// luma and clipping of the 3D view for each course and preset (headless SwiftShader).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { launchBrowser, trackErrors } from './lib/browser.mjs';
import { serveStatic } from './lib/serve.mjs';
import { COURSES } from '../src/course/courses.js';
import { TOD_ORDER, bandFor } from '../src/render/timeOfDay.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const courses = args.course ? String(args.course).split(',') : COURSES.map((c) => c.id);
const tiers = args.tiers ? String(args.tiers).split(',') : ['low', 'medium', 'high', 'ultra'];
const outDir = args.out || 'qa/contact';
const W = 640, H = 360;
const CLOSE = ['green', 'bunker', 'water', 'treeline', 'rough', 'flyover'];
mkdirSync(path.join(outDir, 'raw'), { recursive: true });
const server = await serveStatic(path.resolve('dist'));
const { browser, software } = await launchBrowser();
const lumaPath = path.join(outDir, 'luma.json');
const luma = existsSync(lumaPath) ? JSON.parse(readFileSync(lumaPath, 'utf8')) : { note: '', rows: [] };
luma.note = 'Measured on the 3D view only (WebGL canvas read back), headless Chrome with SwiftShader. Valid for exposure and clipping; not a GPU performance number.';
const T0 = Date.now();

async function sheet(files, labels, cols, out) {
  const tw = 480, th = 270, pad = 4, lh = 22;
  const rows = Math.ceil(files.length / cols);
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    const x = (i % cols) * (tw + pad), y = Math.floor(i / cols) * (th + lh + pad);
    comps.push({ input: await sharp(files[i]).resize(tw, th, { fit: 'cover' }).toBuffer(), left: x, top: y + lh });
    const svg = `<svg width="${tw}" height="${lh}"><rect width="100%" height="100%" fill="#101a14"/><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#e9efe6">${labels[i].replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y });
  }
  await sharp({ create: { width: cols * (tw + pad) - pad, height: rows * (th + lh + pad) - pad, channels: 3, background: '#0b120e' } }).composite(comps).jpeg({ quality: 76, mozjpeg: true }).toFile(out);
}

for (const course of courses) {
  // 1. Every time-of-day preset from the address view, medium tier.
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(240000); ctx.setDefaultNavigationTimeout(240000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await page.goto(`${server.url}/?course=${course}&tod=${TOD_ORDER[0]}&tier=medium&hole=1&smoke=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => { const s = document.querySelector('.screen'); if (s) s.style.display = 'none'; });
  await page.evaluate(() => window.__fw.settle());
  const files = [], labels = [];
  for (const tod of TOD_ORDER) {
    const m = await page.evaluate(async (t) => { await window.__fw.setTimeOfDay(t); await window.__fw.settle(); window.__fw.view('address'); const r = window.__fw.measure(); return { luma: +r.luma.toFixed(1), clip: +r.clippedPct.toFixed(2), crushed: +r.crushedPct.toFixed(2) }; }, tod);
    const band = bandFor(tod);
    const row = { course, tod, tier: 'medium', ...m, band: [band.min, band.max], maxClip: band.maxClippedPct, inBand: m.luma >= band.min && m.luma <= band.max && m.clip <= band.maxClippedPct };
    luma.rows = luma.rows.filter((r) => !(r.course === course && r.tod === tod && r.tier === 'medium'));
    luma.rows.push(row);
    const f = path.join(outDir, 'raw', `${course}-${tod}.png`);
    await page.screenshot({ path: f });
    files.push(f); labels.push(`${course} ${tod}  luma ${m.luma} clip ${m.clip}%${row.inBand ? '' : '  OUT OF BAND'}`);
    console.log(course, tod, JSON.stringify(m), row.inBand ? '' : 'OUT OF BAND');
  }
  await sheet(files, labels, 3, path.join(outDir, `${course}-times.jpg`));
  if (errors.length) console.log('console errors', errors.slice(0, 3).map((e) => e.text.slice(0, 200)));
  await ctx.close();
  // 2. Close-ups at every tier, golden hour where the light is hardest, morning for the rest.
  const cf = [], cl = [];
  for (const tier of tiers) {
    // Resume: a tier whose close-ups all exist is not rendered again.
    const have = CLOSE.map((v) => path.join(outDir, 'raw', `${course}-${tier}-${v}.png`));
    if (!args.fresh && have.every((f) => existsSync(f))) { for (let k = 0; k < CLOSE.length; k++) { cf.push(have[k]); cl.push(`${course} ${tier} ${CLOSE[k]}`); } console.log(course, tier, 'close-ups reused'); continue; }
    const c2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    c2.setDefaultTimeout(240000); c2.setDefaultNavigationTimeout(240000);
    const p2 = await c2.newPage();
    await p2.goto(`${server.url}/?course=${course}&tod=morning&tier=${tier}&hole=1&smoke=1`, { waitUntil: 'load', timeout: 180000 });
    await p2.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
    await p2.evaluate(() => { const s = document.querySelector('.screen'); if (s) s.style.display = 'none'; });
    await p2.evaluate(() => window.__fw.settle());
    for (const v of CLOSE) {
      const ok = await p2.evaluate(async (name) => { const r = window.__fw.view(name); await new Promise((res) => setTimeout(res, name === 'flyover' ? 1500 : 200)); window.__fw.measure(); return r; }, v);
      const f = path.join(outDir, 'raw', `${course}-${tier}-${v}.png`);
      await p2.screenshot({ path: f });
      cf.push(f); cl.push(`${course} ${tier} ${v}${ok === false ? ' (no such feature, nearest view)' : ''}`);
    }
    const info = await p2.evaluate(() => { const i = window.__fw.info(); return { calls: i.stats.calls, tris: i.stats.triangles }; });
    console.log(course, tier, 'close-ups done', JSON.stringify(info));
    await c2.close();
  }
  await sheet(cf, cl, CLOSE.length, path.join(outDir, `${course}-closeups.jpg`));
  writeFileSync(lumaPath, JSON.stringify(luma, null, 1));
  console.log(`${course} done at ${((Date.now() - T0) / 60000).toFixed(1)} min`);
}
luma.software = software;
writeFileSync(lumaPath, JSON.stringify(luma, null, 1));
await browser.close();
await server.close();
