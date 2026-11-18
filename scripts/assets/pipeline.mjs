// Asset pipeline: download -> license check -> compress -> manifest -> ASSETS.md.
//   npm run assets                      everything
//   npm run assets -- --only=textures   one step (textures, models, hdris, procedural)
//   npm run assets -- --ids=oak,fir     a subset of catalog ids
// Raw downloads are cached in asset-src/ (ignored by git). Shipped files go to
// public/assets/ (ignored by git). The manifest is written to src/render/assets.manifest.json
// and IS committed: it is the lock file the game reads to know what exists.
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTURES, MODELS, HDRIS, PROCEDURAL_TEXTURES, PROCEDURAL_MODELS } from './catalog.mjs';
import { fetchTextureSet, fetchModel, fetchHdri, verifyLicense } from './lib/sources.mjs';
import { loadSourceSet, processTextureSet, processFallback } from './textures.mjs';
import { processModel } from './models.mjs';
import { processHdri } from './hdri.mjs';
import { generateWaterNormal, generateCloudNoise, generateDetailNoise } from './procedural.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(root, 'asset-src');
const OUT = path.join(root, 'public', 'assets');
const MANIFEST = path.join(root, 'src', 'render', 'assets.manifest.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? String(args.only).split(',') : null;
const ids = args.ids ? String(args.ids).split(',') : null;
const want = (step) => !only || only.includes(step);
const pick = (list) => (ids ? list.filter((e) => ids.includes(e.id)) : list);

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
manifest.version = 1;
manifest.textures ||= {}; manifest.models ||= {}; manifest.hdris ||= {}; manifest.procedural ||= {};
const log = [];
const note = (s) => { console.log(s); log.push(s); };
const mb = (b) => (b / 1048576).toFixed(2);

async function withFallback(label, primary, alt) {
  try { return { value: await primary(), used: 'primary' }; } catch (err) {
    note(`  ! ${label}: primary failed (${String(err.message).slice(0, 140)})`);
    if (alt) {
      try { return { value: await alt(), used: 'alt' }; } catch (err2) { note(`  ! ${label}: alternate failed (${String(err2.message).slice(0, 140)})`); }
    }
    return { value: null, used: 'failed' };
  }
}

async function runTextures() {
  note('== textures');
  for (const e of pick(TEXTURES)) {
    const t0 = Date.now();
    const lic = await verifyLicense(e.source);
    const got = await withFallback(e.id, () => fetchTextureSet(e.source, e.asset, SRC), e.alt ? () => fetchTextureSet(e.alt.source, e.alt.asset, SRC) : null);
    let rec;
    if (got.value && lic.verified) {
      const src = got.used === 'alt' ? e.alt : e;
      const licUsed = got.used === 'alt' ? await verifyLicense(src.source) : lic;
      const out = await processTextureSet(e, await loadSourceSet(got.value.files), path.join(OUT, 'textures'));
      rec = { role: e.role, source: src.source, asset: src.asset, url: got.value.page, name: got.value.name, authors: got.value.authors, license: licUsed.license, licenseUrl: licUsed.licenseUrl, licenseEvidence: licUsed.evidence, procedural: false, scale: e.scale, ...out };
    } else {
      note(`  ! ${e.id}: generating procedurally (${!lic.verified ? 'license not verified' : 'download failed'})`);
      const out = await processFallback(e, path.join(OUT, 'textures'));
      rec = { role: e.role, source: 'procedural', asset: e.id, url: 'scripts/assets/procedural.mjs', license: 'original work', procedural: true, scale: e.scale, ...out };
    }
    manifest.textures[e.id] = rec;
    note(`  ${e.id.padEnd(10)} ${rec.source}:${rec.asset}  ${mb(rec.bytes)} MB  avg ${rec.avg.map((v) => v.toFixed(2)).join(',')}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

async function runModels() {
  note('== models');
  const lic = await verifyLicense('polyhaven');
  for (const e of pick(MODELS)) {
    const t0 = Date.now();
    try {
      if (!lic.verified) throw new Error('license not verified');
      const fetched = await fetchModel(e.asset, SRC);
      const out = await processModel(e, fetched, path.join(OUT, 'models'));
      manifest.models[e.id] = { role: e.role, source: 'polyhaven', asset: e.asset, url: fetched.page, name: fetched.name, authors: fetched.authors, license: lic.license, licenseUrl: lic.licenseUrl, licenseEvidence: lic.evidence, sourceBytes: fetched.bytes, ...out };
      note(`  ${e.id.padEnd(10)} ${e.asset.padEnd(24)} src ${mb(fetched.bytes).padStart(7)} MB ${String(out.tris.source).padStart(8)} tris -> lod0 ${String(out.tris.lod0).padStart(6)} lod1 ${String(out.tris.lod1).padStart(5)}  ${mb(out.bytes)} MB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      note(`  ! ${e.id}: FAILED (${String(err.message).slice(0, 200)}). The game falls back to its procedural stand-in.`);
      manifest.models[e.id] = { role: e.role, source: 'polyhaven', asset: e.asset, failed: true, error: String(err.message).slice(0, 200) };
    }
  }
}

async function runHdris() {
  note('== hdris');
  const lic = await verifyLicense('polyhaven');
  for (const e of pick(HDRIS)) {
    try {
      if (!lic.verified) throw new Error('license not verified');
      const f = await fetchHdri(e.asset, SRC);
      const out = processHdri(e, f.path, path.join(OUT, 'hdri'));
      manifest.hdris[e.id] = { role: e.role, source: 'polyhaven', asset: e.asset, url: f.page, name: f.name, authors: f.authors, license: lic.license, licenseUrl: lic.licenseUrl, licenseEvidence: lic.evidence, ...out };
      note(`  ${e.id.padEnd(8)} ${e.asset.padEnd(40)} ${mb(out.bytes)} MB  sun elev ${out.sunElevDeg} az ${out.sunAzDeg} hasSun ${out.hasSun}`);
    } catch (err) {
      note(`  ! ${e.id}: FAILED (${String(err.message).slice(0, 200)}). The game uses its procedural sky for lighting instead.`);
      manifest.hdris[e.id] = { role: e.role, source: 'polyhaven', asset: e.asset, failed: true, error: String(err.message).slice(0, 200) };
    }
  }
}

async function runProcedural() {
  note('== procedural');
  const dir = path.join(OUT, 'textures');
  const gens = { water_normal: generateWaterNormal, cloud_noise: generateCloudNoise, detail_noise: generateDetailNoise };
  for (const e of pick(PROCEDURAL_TEXTURES)) {
    const file = path.join(dir, `${e.id}.webp`);
    await gens[e.id](file, e.size);
    manifest.procedural[e.id] = { role: e.role, file: `textures/${e.id}.webp`, bytes: statSync(file).size, source: 'procedural', license: 'original work' };
    note(`  ${e.id.padEnd(14)} ${mb(statSync(file).size)} MB`);
  }
}

function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  let t = 0;
  for (const f of readdirSync(dir)) { const p = path.join(dir, f); const st = statSync(p); t += st.isDirectory() ? dirBytes(p) : st.size; }
  return t;
}

function writeAssetsMd() {
  const L = [];
  L.push('# Assets', '');
  L.push('Every external asset shipped with the game, with source, URL, and license. This file is generated by `npm run assets` from `scripts/assets/catalog.mjs` and the metadata returned by each source API at download time. The license of each source was confirmed from that source\'s own license page during the run (see the evidence column).', '');
  L.push('Raw downloads live in `asset-src/` (ignored by git). The processed files in `public/assets/` are committed, so a Git-connected host (a Vercel import, for example) builds the full game with no download step; `npm run assets` rebuilds them. The manifest `src/render/assets.manifest.json` is committed.', '');
  L.push('No asset contains a real person\'s likeness or name, and nothing comes from a commercial game.', '');
  L.push(`Shipped size: **${mb(manifest.totals.shippedBytes)} MB** (textures ${mb(manifest.totals.textures)} MB, models ${mb(manifest.totals.models)} MB, HDRIs ${mb(manifest.totals.hdris)} MB).`, '');
  L.push('## PBR texture sets', '', '| Id | Role | Source | Asset | License | Sizes | Shipped |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, t] of Object.entries(manifest.textures)) L.push(`| ${id} | ${t.role} | ${t.source} | ${t.procedural ? 'generated (download failed)' : `[${t.name || t.asset}](${t.url})`} | ${t.license} | ${Object.keys(t.files).join(', ')} | ${mb(t.bytes)} MB |`);
  L.push('', '## Models', '', '| Id | Role | Asset | License | Source triangles | LOD0 / LOD1 triangles | Shipped |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, m] of Object.entries(manifest.models)) L.push(m.failed ? `| ${id} | ${m.role} | ${m.asset} | n/a | n/a | FAILED: ${m.error} | 0 |` : `| ${id} | ${m.role} | [${m.name}](${m.url}) | ${m.license} | ${m.tris.source} | ${m.tris.lod0} / ${m.tris.lod1} | ${mb(m.bytes)} MB |`);
  L.push('', '## HDRI environments', '', '| Id | Role | Asset | License | Sun elevation | Shipped |', '| --- | --- | --- | --- | --- | --- |');
  for (const [id, h] of Object.entries(manifest.hdris)) L.push(h.failed ? `| ${id} | ${h.role} | ${h.asset} | n/a | n/a | FAILED |` : `| ${id} | ${h.role} | [${h.name}](${h.url}) | ${h.license} | ${h.sunElevDeg} deg | ${mb(h.bytes)} MB |`);
  L.push('', '## Generated in this repo (original work)', '', '| Id | Role | Made by |', '| --- | --- | --- |');
  for (const [id, p] of Object.entries(manifest.procedural)) L.push(`| ${id} | ${p.role} | scripts/assets/procedural.mjs |`);
  for (const p of PROCEDURAL_MODELS) L.push(`| ${p.id} | ${p.role} | built in code. Reason: ${p.reason} |`);
  L.push('| app icons | PWA and iOS icons | scripts/icons.mjs |');
  L.push('| audio | all sound and music | synthesized at runtime with Web Audio (src/audio) |');
  L.push('', '## License evidence', '');
  const seen = new Set();
  for (const rec of [...Object.values(manifest.textures), ...Object.values(manifest.models), ...Object.values(manifest.hdris)]) {
    if (!rec.licenseUrl || seen.has(rec.licenseUrl)) continue;
    seen.add(rec.licenseUrl);
    L.push(`- ${rec.source}: ${rec.license}. ${rec.licenseEvidence} Source: ${rec.licenseUrl}`);
  }
  L.push('- Poly Haven API terms (https://github.com/Poly-Haven/Public-API/blob/master/ToS.md): the API is free for any use; requests carry the user agent `fairway-next-asset-pipeline`. The API is used at build time only, never from the running game.');
  L.push('', 'The old project\'s four baked HDRIs and its Mixamo golfer were not available in the build environment and are not used.');
  writeFileSync(path.join(root, 'ASSETS.md'), L.join('\n') + '\n');
}

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
if (want('textures')) await runTextures();
if (want('hdris')) await runHdris();
if (want('procedural')) await runProcedural();
if (want('models')) await runModels();
const sumBytes = (o) => Object.values(o).reduce((a, r) => a + (r.bytes || 0), 0);
manifest.totals = {
  textures: sumBytes(manifest.textures) + sumBytes(manifest.procedural), models: sumBytes(manifest.models), hdris: sumBytes(manifest.hdris),
  shippedBytes: dirBytes(OUT), sourceBytes: dirBytes(SRC),
};
manifest.generated = new Date().toISOString();
mkdirSync(path.dirname(MANIFEST), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
writeAssetsMd();
note(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s. shipped ${mb(manifest.totals.shippedBytes)} MB, raw cache ${mb(manifest.totals.sourceBytes)} MB`);
writeFileSync(path.join(SRC, 'pipeline.log'), log.join('\n') + '\n');
