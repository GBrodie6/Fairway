// Network helpers for the asset pipeline: retry with backoff, caching into asset-src/.
import { mkdirSync, existsSync, statSync, writeFileSync, renameSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { USER_AGENT } from '../catalog.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRetry(url, { tries = 4, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Referer: 'https://fairway-next.local/' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      // Policy denials and missing files will not fix themselves.
      if ([401, 403, 404, 407].includes(res.status)) break;
    } catch (err) {
      lastErr = err;
    }
    await sleep(800 * 2 ** i);
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  const res = await fetchRetry(url, opts);
  return res.json();
}

// Download to a file unless a non-empty copy is already cached. Returns { path, bytes, cached }.
export async function downloadTo(url, file, { expectedSize, tries = 4 } = {}) {
  if (existsSync(file)) {
    const sz = statSync(file).size;
    if (sz > 0 && (!expectedSize || sz === expectedSize)) return { path: file, bytes: sz, cached: true };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.part';
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchRetry(url, { tries: 1, timeoutMs: 15 * 60 * 1000 });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      const sz = statSync(tmp).size;
      if (expectedSize && sz !== expectedSize) throw new Error(`size mismatch for ${url}: got ${sz}, expected ${expectedSize}`);
      if (sz === 0) throw new Error(`empty download for ${url}`);
      renameSync(tmp, file);
      return { path: file, bytes: sz, cached: false };
    } catch (err) {
      lastErr = err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw lastErr;
}

export function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 1));
}
