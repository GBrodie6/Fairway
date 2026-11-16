// Minimal static file server for dist/. Mirrors the headers in vercel.json so local checks
// exercise the same caching and MIME rules as the deployed site.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function loadVercelHeaders(root) {
  const p = path.resolve(root, '..', 'vercel.json');
  if (!existsSync(p)) return [];
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    return (cfg.headers || []).map((h) => ({ re: new RegExp('^' + h.source.replace(/\((.*?)\)/g, '($1)') + '$'), headers: h.headers }));
  } catch (e) { return []; }
}

export async function serveStatic(root, { port = 0, host = '127.0.0.1' } = {}) {
  const rules = loadVercelHeaders(root);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      let file = path.join(root, rel);
      if (!file.startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
      let st = null;
      try { st = await stat(file); } catch (e) { st = null; }
      let status = 200;
      if (!st || !st.isFile()) {
        // SPA fallback for extensionless routes only. Missing assets are real 404s.
        if (path.extname(rel)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); requests.push({ path: rel, status: 404, bytes: 0 }); return; }
        file = path.join(root, 'index.html');
      }
      const body = await readFile(file);
      const headers = { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': body.length };
      const servedPath = '/' + path.relative(root, file).split(path.sep).join('/');
      for (const r of rules) if (r.re.test(servedPath)) for (const h of r.headers) headers[h.key.toLowerCase()] = h.value;
      res.writeHead(status, headers);
      res.end(body);
      requests.push({ path: servedPath, status, bytes: body.length });
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  const addr = server.address();
  return { url: `http://${host}:${addr.port}`, port: addr.port, requests, close: () => new Promise((r) => server.close(r)) };
}
