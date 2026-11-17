import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The heavy assets are not in git. If they have not been built (npm run assets), the game is
// compiled in procedural-fallback mode and never requests a missing file.
function assetsPresent() {
  try {
    const m = JSON.parse(readFileSync('src/render/assets.manifest.json', 'utf8'));
    const files = [];
    for (const t of Object.values(m.textures || {})) for (const f of Object.values(t.files || {})) files.push(f.a, f.n);
    for (const mo of Object.values(m.models || {})) if (!mo.failed) files.push(mo.file, mo.lod0);
    for (const h of Object.values(m.hdris || {})) if (!h.failed) files.push(h.file);
    for (const p of Object.values(m.procedural || {})) files.push(p.file);
    return files.length > 0 && files.every((f) => existsSync(path.join('public', 'assets', f)));
  } catch (e) {
    return false;
  }
}
const ASSETS = process.env.FAIRWAY_NO_ASSETS === '1' ? false : assetsPresent();
if (!ASSETS) console.warn('[fairway] processed assets not found: building in procedural-fallback mode. Run "npm run assets" for full visuals.');

// The service worker is written at build time with the exact list of files in this build.
function assetStamp() {
  try {
    const g = String(JSON.parse(readFileSync('src/render/assets.manifest.json', 'utf8')).generated || 'dev');
    let h = 2166136261;
    for (let i = 0; i < g.length; i++) { h ^= g.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  } catch (e) { return 'dev'; }
}
function serviceWorker() {
  return {
    name: 'fairway-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css|html)$/.test(f)).sort();
      const icons = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-32.png'].filter((f) => existsSync(path.join('public', f)));
      const precache = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest', ...icons.map((f) => `./${f}`)];
      const version = createHash('sha1').update(files.join('|') + assetStamp()).digest('hex').slice(0, 12);
      const src = readFileSync('src/sw/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__STAMP__', assetStamp()).replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  base: './',
  publicDir: 'public',
  define: { __ASSETS_PRESENT__: JSON.stringify(ASSETS) },
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 900,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples')) return 'three-addons';
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
