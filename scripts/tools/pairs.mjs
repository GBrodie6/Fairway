// Dev tool: before and after pairs in one labeled JPEG, one row per pair.
//   node scripts/tools/pairs.mjs out.jpg "label" before.png after.png ["label" before.png after.png ...]
// Each row reads: label, the before image on the left, the after image on the right.
import sharp from 'sharp';

const [out, ...rest] = process.argv.slice(2);
const rows = [];
for (let i = 0; i + 2 < rest.length; i += 3) rows.push({ label: rest[i], a: rest[i + 1], b: rest[i + 2] });
const tw = 560, th = 315, pad = 4, lh = 24;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const comps = [];
for (let r = 0; r < rows.length; r++) {
  const y = r * (th + lh + pad);
  const svg = `<svg width="${2 * tw + pad}" height="${lh}"><rect width="100%" height="100%" fill="#101a14"/><text x="6" y="17" font-family="sans-serif" font-size="15" fill="#e9efe6">${esc(rows[r].label)}   (left: before, right: after)</text></svg>`;
  comps.push({ input: Buffer.from(svg), left: 0, top: y });
  comps.push({ input: await sharp(rows[r].a).resize(tw, th, { fit: 'cover' }).toBuffer(), left: 0, top: y + lh });
  comps.push({ input: await sharp(rows[r].b).resize(tw, th, { fit: 'cover' }).toBuffer(), left: tw + pad, top: y + lh });
}
await sharp({ create: { width: 2 * tw + pad, height: rows.length * (th + lh + pad) - pad, channels: 3, background: '#0b120e' } })
  .composite(comps).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
console.log('wrote', out, rows.length, 'rows');
