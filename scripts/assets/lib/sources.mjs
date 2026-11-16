// Source adapters. Each resolves an asset id into concrete file URLs plus license evidence.
import path from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { fetchJson, fetchRetry, downloadTo } from './net.mjs';

const PH_API = 'https://api.polyhaven.com';
const ACG_API = 'https://ambientcg.com/api/v2/full_json';

// License evidence is fetched once per run from each source's own license page.
const licenseCache = new Map();
export async function verifyLicense(source) {
  if (licenseCache.has(source)) return licenseCache.get(source);
  let out;
  if (source === 'polyhaven') {
    const url = 'https://polyhaven.com/license';
    const html = await (await fetchRetry(url)).text();
    const ok = /CC0/.test(html) && /public domain/i.test(html);
    out = { source, license: 'CC0 1.0', licenseUrl: url, verified: ok, evidence: ok ? 'License page states all assets are CC0 (public domain).' : 'License page did not contain the expected CC0 statement.' };
  } else if (source === 'ambientcg') {
    const url = 'https://docs.ambientcg.com/license/';
    const html = await (await fetchRetry(url)).text();
    const ok = /Creative Commons CC0 1\.0/i.test(html);
    out = { source, license: 'CC0 1.0', licenseUrl: url, verified: ok, evidence: ok ? 'License page states assets are licensed under Creative Commons CC0 1.0.' : 'License page did not contain the expected CC0 statement.' };
  } else {
    out = { source, license: 'unknown', verified: false, evidence: 'unknown source' };
  }
  licenseCache.set(source, out);
  return out;
}

const PH_MAPS = { albedo: ['Diffuse', 'diff', 'col_1', 'coll1'], normal: ['nor_gl'], rough: ['Rough', 'rough'], ao: ['AO', 'ao'], height: ['Displacement', 'disp'] };

// Returns { files: { albedo, normal, rough, ao?, height? } (local paths), page, info }.
export async function fetchTextureSet(source, asset, srcDir, res = '2k') {
  const dir = path.join(srcDir, 'textures', `${source}-${asset}`);
  if (source === 'polyhaven') {
    const [files, info] = await Promise.all([fetchJson(`${PH_API}/files/${asset}`), fetchJson(`${PH_API}/info/${asset}`)]);
    const out = {};
    for (const [role, keys] of Object.entries(PH_MAPS)) {
      const key = keys.find((k) => files[k] && files[k][res] && files[k][res].jpg);
      if (!key) continue;
      const f = files[key][res].jpg;
      const local = path.join(dir, path.basename(f.url));
      await downloadTo(f.url, local, { expectedSize: f.size });
      out[role] = local;
    }
    if (!out.albedo || !out.normal) throw new Error(`polyhaven:${asset} is missing albedo or normal at ${res}`);
    return { files: out, page: `https://polyhaven.com/a/${asset}`, name: info.name, authors: Object.keys(info.authors || {}) };
  }
  if (source === 'ambientcg') {
    const j = await fetchJson(`${ACG_API}?id=${asset}&include=downloadData`);
    const a = j.foundAssets && j.foundAssets[0];
    if (!a) throw new Error(`ambientcg:${asset} not found`);
    const dls = a.downloadFolders.default.downloadFiletypeCategories.zip.downloads;
    const want = `${res.toUpperCase()}-JPG`;
    const dl = dls.find((d) => d.attribute === want);
    if (!dl) throw new Error(`ambientcg:${asset} has no ${want} download`);
    const zipFile = path.join(dir, dl.fileName);
    await downloadTo(dl.fullDownloadPath, zipFile, { expectedSize: dl.size });
    const marker = path.join(dir, '.unzipped');
    if (!existsSync(marker)) {
      const entries = unzipSync(new Uint8Array(readFileSync(zipFile)));
      mkdirSync(dir, { recursive: true });
      for (const [name, data] of Object.entries(entries)) {
        if (/\.(jpg|png)$/i.test(name) && !name.includes('/')) writeFileSync(path.join(dir, name), data);
      }
      writeFileSync(marker, Object.keys(entries).join('\n'));
    }
    const names = readFileSync(marker, 'utf8').split('\n');
    const find = (re) => { const n = names.find((x) => re.test(x)); return n ? path.join(dir, n) : undefined; };
    const out = { albedo: find(/_Color\.jpg$/i), normal: find(/_NormalGL\.jpg$/i), rough: find(/_Roughness\.jpg$/i), ao: find(/_AmbientOcclusion\.jpg$/i), height: find(/_Displacement\.jpg$/i) };
    if (!out.albedo || !out.normal) throw new Error(`ambientcg:${asset} zip is missing color or normal`);
    return { files: out, page: `https://ambientcg.com/view?id=${asset}`, name: a.displayName || asset, authors: ['ambientCG'] };
  }
  throw new Error(`unknown source ${source}`);
}

// Poly Haven model: glTF + bin + textures (1k), plus any separate alpha maps.
export async function fetchModel(asset, srcDir, res = '1k') {
  const dir = path.join(srcDir, 'models', asset);
  const [files, info] = await Promise.all([fetchJson(`${PH_API}/files/${asset}`), fetchJson(`${PH_API}/info/${asset}`)]);
  const g = files.gltf && (files.gltf[res] || files.gltf['2k']);
  if (!g || !g.gltf) throw new Error(`polyhaven:${asset} has no glTF at ${res}`);
  const gltfPath = path.join(dir, path.basename(g.gltf.url));
  await downloadTo(g.gltf.url, gltfPath, { expectedSize: g.gltf.size });
  let bytes = g.gltf.size;
  for (const [rel, f] of Object.entries(g.gltf.include || {})) {
    await downloadTo(f.url, path.join(dir, rel), { expectedSize: f.size });
    bytes += f.size;
  }
  const alphas = {};
  for (const key of Object.keys(files)) {
    if (!/alpha/i.test(key)) continue;
    const f = files[key][res] && (files[key][res].png || files[key][res].jpg);
    if (!f) continue;
    const local = path.join(dir, 'textures', path.basename(f.url));
    await downloadTo(f.url, local, { expectedSize: f.size });
    alphas[key] = local;
    bytes += f.size;
  }
  return { gltfPath, dir, alphas, bytes, page: `https://polyhaven.com/a/${asset}`, name: info.name, authors: Object.keys(info.authors || {}) };
}

export async function fetchHdri(asset, srcDir, res = '1k') {
  const [files, info] = await Promise.all([fetchJson(`${PH_API}/files/${asset}`), fetchJson(`${PH_API}/info/${asset}`)]);
  const f = files.hdri && files.hdri[res] && files.hdri[res].hdr;
  if (!f) throw new Error(`polyhaven:${asset} has no ${res} hdr`);
  const local = path.join(srcDir, 'hdri', path.basename(f.url));
  await downloadTo(f.url, local, { expectedSize: f.size });
  return { path: local, bytes: f.size, page: `https://polyhaven.com/a/${asset}`, name: info.name, authors: Object.keys(info.authors || {}) };
}
