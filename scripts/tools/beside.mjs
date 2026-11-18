// Dev tool: put two images side by side with a label bar over each, at full resolution.
//   node scripts/tools/beside.mjs out.jpg "left label" left.jpg "right label" right.jpg
import sharp from 'sharp';
const [out, la, a, lb, b] = process.argv.slice(2);
const ia = sharp(a), ib = sharp(b);
const [ma, mb] = await Promise.all([ia.metadata(), ib.metadata()]);
const lh = 30, gap = 10, W = ma.width + gap + mb.width, H = lh + Math.max(ma.height, mb.height);
const bar = (w, t) => Buffer.from(`<svg width="${w}" height="${lh}"><rect width="100%" height="100%" fill="#101a14"/><text x="8" y="21" font-family="sans-serif" font-size="18" font-weight="bold" fill="#e9efe6">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
await sharp({ create: { width: W, height: H, channels: 3, background: '#0b120e' } })
  .composite([{ input: bar(ma.width, la), left: 0, top: 0 }, { input: await ia.toBuffer(), left: 0, top: lh }, { input: bar(mb.width, lb), left: ma.width + gap, top: 0 }, { input: await ib.toBuffer(), left: ma.width + gap, top: lh }])
  .jpeg({ quality: 76, mozjpeg: true }).toFile(out);
console.log('wrote', out);
