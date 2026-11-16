// Shared headless Chrome launcher for the smoke test, QA bot, contact sheets, and perf runs.
// Headless Chrome here renders with SwiftShader (software). That is NOT representative of a
// real GPU: frame times from these runs are CPU-rasterizer numbers. We rely on renderer.info
// (draw calls, triangles), CPU-side timings, and screenshots, and say so in every report.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

export function resolveChrome() {
  const candidates = [
    process.env.FAIRWAY_CHROME,
    '/opt/pw-browsers/chromium',
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export async function launchBrowser({ gpu = process.env.FAIRWAY_GPU === '1' } = {}) {
  const executablePath = resolveChrome();
  const args = [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ];
  // Software rendering unless FAIRWAY_GPU=1 asks for the real GPU (use that on a dev machine).
  if (!gpu) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const opts = { headless: true, args };
  if (executablePath) opts.executablePath = executablePath;
  else opts.channel = 'chrome';
  const browser = await chromium.launch(opts);
  return { browser, executablePath: executablePath || 'channel:chrome', software: !gpu };
}

// Collect console errors and page errors for a page. Returns the live array.
export function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ kind: 'console', text: msg.text() });
  });
  page.on('pageerror', (err) => errors.push({ kind: 'pageerror', text: String(err && err.stack ? err.stack : err) }));
  page.on('requestfailed', (req) => {
    const f = req.failure();
    // Aborted requests are expected when a page navigates away mid-load.
    if (f && !/ERR_ABORTED/.test(f.errorText)) errors.push({ kind: 'requestfailed', text: `${req.url()} ${f.errorText}` });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push({ kind: 'http', text: `${res.status()} ${res.url()}` });
  });
  return errors;
}
