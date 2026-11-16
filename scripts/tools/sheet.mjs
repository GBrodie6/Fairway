// Dev tool: tile PNGs into one JPEG. node scripts/tools/sheet.mjs out.jpg cols w h file...
import sharp from 'sharp';
const [out, cols, w, h, ...files] = process.argv.slice(2);
const C = Number(cols), W = Number(w), H = Number(h);
const imgs = await Promise.all(files.map((f) => sharp(f).resize(W, H, { fit: 'cover' }).toBuffer()));
await sharp({ create: { width: C * W, height: Math.ceil(files.length / C) * H, channels: 3, background: '#000' } })
  .composite(imgs.map((b, i) => ({ input: b, left: (i % C) * W, top: Math.floor(i / C) * H }))).jpeg({ quality: 88 }).toFile(out);
console.log('wrote', out);
