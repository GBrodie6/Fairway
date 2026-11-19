// A contact strip of the seven swing frames from scripts/tools/swingframes.mjs.
//   node scripts/tools/swingstrip.mjs <dir> <tag> <out.png> [cropTop] [cropHeight]
import sharp from 'sharp';
const [dir, tag, out, top, h] = process.argv.slice(2);
const names = ['1-address', '2-quarter', '3-half', '4-top', '5-mid-downswing', '6-impact', '7-follow-through'];
const meta = await sharp(`${dir}/${names[0]}-${tag}.png`).metadata();
const W = meta.width, T = Number(top ?? 0), H = Number(h ?? meta.height - T);
const sw = Math.round(W / 2), sh = Math.round(H / 2);
const imgs = await Promise.all(names.map((n) => sharp(`${dir}/${n}-${tag}.png`).extract({ left: 0, top: T, width: W, height: H }).resize(sw, sh).toBuffer()));
await sharp({ create: { width: (sw + 2) * 7, height: sh, channels: 3, background: '#000' } }).composite(imgs.map((b, i) => ({ input: b, left: i * (sw + 2), top: 0 }))).png().toFile(out);
console.log(out);
