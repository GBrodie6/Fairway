// Settings, Graphics, Show other holes, through real input: on the Low tier it shows Off and no
// other holes are drawn; picking On draws them (the world is rebuilt); on Medium the default is
// On; Off removes them again; the choice is saved. Mouse at 1920x1080, touch at 390x844.
//   node scripts/tools/scenery-setting.mjs <out.json>
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, clickSel } from '../lib/drive.mjs';

const [outFile = 'qa/tmp/scenery-setting.json'] = process.argv.slice(2);
mkdirSync(path.dirname(outFile), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const out = { checks: [] };
const check = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
for (const [W, H] of [[1920, 1080], [390, 844]]) {
  const touch = W < 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const pointer = await createPointer(page, { touch });
  const tag = `${W}x${H}`;
  const state = () => page.evaluate(() => ({ setting: window.__fw.app.settings.otherHoles, tier: window.__fw.app.engine.tier.id, scenery: !!window.__fw.app.world.scenery, holes: window.__fw.sceneryStats() ? window.__fw.sceneryStats().holes : 0, select: (document.getElementById('s-holes') || {}).value }));
  const pick = async (id, value) => {
    await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
    await clickSel(page, pointer, `#${id}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.selectOption(`#${id}`, value);
    await page.waitForFunction(() => !window.__fw.app.world.loading || true, null);
    await page.waitForTimeout(1500);
  };
  try {
    await page.goto(`${server.url}/?course=parkland&scale=0.5&fresh=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    // Low tier from Settings, then the Show other holes control.
    await page.evaluate(() => window.__fw.ui.screens.registry.settings());
    await page.waitForTimeout(500);
    await pick('s-tier', 'low');
    let s = await state();
    check(`${tag}: on Low the setting shows Off and no other holes are drawn`, s.tier === 'low' && s.select === 'off' && !s.scenery, s);
    await pick('s-holes', 'on');
    s = await state();
    check(`${tag}: picking On draws the other holes on Low`, s.setting === 'on' && s.scenery && s.holes > 0, s);
    await pick('s-holes', 'off');
    s = await state();
    check(`${tag}: picking Off removes them`, s.setting === 'off' && !s.scenery, s);
    // Back to the default (auto) and Medium: On.
    await page.evaluate(() => { window.__fw.app.settings.otherHoles = 'auto'; window.__fw.app.saveSettings(); });
    await pick('s-tier', 'medium');
    await page.evaluate(() => window.__fw.ui.screens.registry.settings());
    await page.waitForTimeout(500);
    s = await state();
    check(`${tag}: on Medium the default is On and the other holes are drawn`, s.tier === 'medium' && s.select === 'on' && s.scenery && s.holes > 0, s);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fairway-next.settings') || '{}').otherHoles);
    check(`${tag}: the setting is saved`, saved === 'auto', { saved });
  } catch (e) { check(`${tag}: ran to the end`, false, e.message.split('\n')[0]); }
  check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).map((e) => e.text.slice(0, 160)));
  await ctx.close();
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`${out.checks.filter((c) => c.pass).length} of ${out.checks.length} checks passed`);
await browser.close();
await server.close();
