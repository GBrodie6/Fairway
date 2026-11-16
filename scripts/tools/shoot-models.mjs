// Dev QA: screenshots every processed model at LOD0 and LOD1 into a contact sheet.
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { MODELS } from '../assets/catalog.mjs';

const ids = process.argv[2] ? process.argv[2].split(',') : MODELS.map((m) => m.id);
const out = process.argv[3] || 'qa/tmp/models.jpg';
const server = await createServer({ logLevel: 'error', server: { port: 5199, host: '127.0.0.1' } });
await server.listen();
const { browser } = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 420, height: 420 } });
const errors = trackErrors(page);
const tiles = [];
for (const id of ids) {
  for (const lod of ['0', '1']) {
    await page.goto(`http://127.0.0.1:5199/tools/viewer.html?id=${id}&lod=${lod}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 120000 });
    const info = await page.evaluate(() => window.__viewer);
    const png = await page.screenshot();
    const label = Buffer.from(`<svg width="420" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="24" fill="#111"/><text x="6" y="17" font-family="sans-serif" font-size="14" fill="#fff">${id} LOD${lod}  ${Math.round(info.tris)} tris  ${info.height} m</text></svg>`);
    tiles.push(await sharp(png).composite([{ input: label, top: 396, left: 0 }]).png().toBuffer());
  }
}
await browser.close();
await server.close();
const cols = 4, rows = Math.ceil(tiles.length / cols);
mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: cols * 420, height: rows * 420, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 420, top: Math.floor(i / cols) * 420 }))).resize(cols * 380).jpeg({ quality: 84 }).toFile(out);
console.log('wrote', out, 'errors', errors.length, errors.slice(0, 3));
