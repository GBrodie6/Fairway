import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

export default defineConfig({
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
