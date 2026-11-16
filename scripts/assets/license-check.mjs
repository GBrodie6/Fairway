// License check: confirms from each source's own license page that the catalog's sources are
// CC0, and that every shipped asset in the manifest carries a verified permissive license.
// Exits non-zero on any unverified asset.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLicense } from './lib/sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'src', 'render', 'assets.manifest.json'), 'utf8'));
const ALLOWED = new Set(['CC0 1.0', 'original work']);
let bad = 0;
for (const source of ['polyhaven', 'ambientcg']) {
  const l = await verifyLicense(source);
  console.log(`${l.verified ? 'OK  ' : 'FAIL'} ${source}: ${l.license}  ${l.evidence}  (${l.licenseUrl})`);
  if (!l.verified) bad++;
}
let n = 0;
for (const group of ['textures', 'models', 'hdris', 'procedural']) {
  for (const [id, rec] of Object.entries(manifest[group] || {})) {
    if (rec.failed) continue;
    n++;
    if (!ALLOWED.has(rec.license)) { console.log(`FAIL ${group}/${id}: license "${rec.license}" is not on the allowed list`); bad++; }
  }
}
console.log(`${n} shipped assets checked, ${bad} problem(s).`);
process.exit(bad ? 1 : 0);
