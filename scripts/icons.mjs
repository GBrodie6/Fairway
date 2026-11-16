// Generates the app icons procedurally (no downloaded art). Output goes to public/icons and
// is committed because the files are tiny and the first paint needs them.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

// A calm dawn sky, two rolling fairway hills with mowing stripes, a flag, and a ball.
function svg(size, { maskable = false } = {}) {
  const s = size;
  const pad = maskable ? 0.1 : 0; // maskable icons keep content inside the safe zone
  const k = 1 - pad * 2;
  const X = (v) => (pad + v * k) * s;
  const stripes = [];
  for (let i = 0; i < 7; i++) {
    const x0 = -0.1 + i * 0.2;
    stripes.push(`<path d="M ${X(x0)} ${s} L ${X(x0 + 0.34)} ${X(0.58)} L ${X(x0 + 0.44)} ${X(0.58)} L ${X(x0 + 0.1)} ${s} Z" fill="#ffffff" opacity="${i % 2 ? 0.0 : 0.07}"/>`);
  }
  const r = maskable ? 0 : s * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16324a"/><stop offset="0.45" stop-color="#3f6f8a"/><stop offset="0.72" stop-color="#f2b98a"/><stop offset="1" stop-color="#f7d9a8"/>
    </linearGradient>
    <linearGradient id="hillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8a4a"/><stop offset="1" stop-color="#1f5a33"/></linearGradient>
    <linearGradient id="hillB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#58a85a"/><stop offset="1" stop-color="#2c7440"/></linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d8"/><stop offset="0.5" stop-color="#ffe2a0" stop-opacity="0.75"/><stop offset="1" stop-color="#ffd28a" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><rect x="0" y="0" width="${s}" height="${s}" rx="${r}" ry="${r}"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="${s}" height="${s}" fill="url(#sky)"/>
    <circle cx="${X(0.3)}" cy="${X(0.56)}" r="${s * 0.26 * k}" fill="url(#sun)"/>
    <path d="M 0 ${X(0.62)} C ${X(0.25)} ${X(0.5)}, ${X(0.5)} ${X(0.52)}, ${X(0.72)} ${X(0.6)} S ${X(1.05)} ${X(0.56)}, ${s} ${X(0.6)} L ${s} ${s} L 0 ${s} Z" fill="url(#hillA)"/>
    <path d="M 0 ${X(0.74)} C ${X(0.3)} ${X(0.6)}, ${X(0.62)} ${X(0.6)}, ${s} ${X(0.72)} L ${s} ${s} L 0 ${s} Z" fill="url(#hillB)"/>
    ${stripes.join('\n    ')}
    <ellipse cx="${X(0.62)}" cy="${X(0.7)}" rx="${s * 0.12 * k}" ry="${s * 0.03 * k}" fill="#7bd07a" opacity="0.85"/>
    <rect x="${X(0.615)}" y="${X(0.3)}" width="${Math.max(1, s * 0.016 * k)}" height="${s * 0.4 * k}" rx="${s * 0.008}" fill="#f6f3ea"/>
    <path d="M ${X(0.631)} ${X(0.3)} L ${X(0.83)} ${X(0.36)} L ${X(0.631)} ${X(0.43)} Z" fill="#e8553d"/>
    <ellipse cx="${X(0.62)}" cy="${X(0.702)}" rx="${s * 0.022 * k}" ry="${s * 0.008 * k}" fill="#143a22"/>
    <circle cx="${X(0.36)}" cy="${X(0.8)}" r="${s * 0.045 * k}" fill="#ffffff"/>
    <circle cx="${X(0.372)}" cy="${X(0.812)}" r="${s * 0.045 * k}" fill="#000000" opacity="0.08"/>
  </g>
</svg>`;
}

const targets = [
  ['icon-32.png', 32, {}], ['icon-180.png', 180, {}], ['icon-192.png', 192, {}], ['icon-512.png', 512, {}],
  ['icon-maskable-192.png', 192, { maskable: true }], ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  await sharp(Buffer.from(svg(Math.max(size, 256), opts))).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
}
writeFileSync(path.join(out, 'icon.svg'), svg(512));
console.log('icons written to public/icons:', targets.map((t) => t[0]).join(', '));
