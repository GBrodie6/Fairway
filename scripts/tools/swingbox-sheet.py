# Before and after contact sheets for the swing guide proof: for each size, the five moments
# (address, mid backswing, top, outside the box, impact) of the old track (before) above the
# swing box (after), cropped to the lower middle of the screen where the guide lives.
#   python3 scripts/tools/swingbox-sheet.py qa/proof/swingbox
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'qa/proof/swingbox')
names = ['1-address', '2-mid-backswing', '3-top-of-backswing', '4-outside-the-box', '5-impact']
labels = ['Address', 'Mid backswing', 'Top', 'Outside the box', 'Impact']
for size in ['390x844', '844x390', '360x640', '1366x768', '1920x1080', '2560x1440']:
    W, H = map(int, size.split('x'))
    # Crop: phones keep the whole screen; desktops keep the middle around the ball and the box.
    crop = (0, 0, W, H) if W < 1180 else (int(W * 0.3), int(H * 0.28), int(W * 0.7), H)
    rows = []
    for tag in ['before', 'after']:
        ims = []
        for n in names:
            p = root / f'{tag}-{size}-{n}.jpg'
            if not p.exists():
                break
            ims.append(Image.open(p).convert('RGB').crop(crop))
        if len(ims) == len(names):
            rows.append((tag, ims))
    if len(rows) < 2:
        continue
    cw, ch = rows[0][1][0].size
    scale = min(1.0, 1800 / (cw * 5 + 40))
    tw, th = int(cw * scale), int(ch * scale)
    pad, head = 8, 26
    sheet = Image.new('RGB', (pad + (tw + pad) * 5, head + (th + head + pad) * 2), (24, 30, 26))
    d = ImageDraw.Draw(sheet)
    for i, lab in enumerate(labels):
        d.text((pad + i * (tw + pad) + 4, 6), lab, fill=(230, 236, 226))
    for r, (tag, ims) in enumerate(rows):
        y = head + r * (th + head + pad)
        d.text((pad + 4, y + 4), 'Before: the classic track' if tag == 'before' else 'After: the swing box', fill=(194, 229, 138) if tag == 'after' else (230, 236, 226))
        for i, im in enumerate(ims):
            sheet.paste(im.resize((tw, th)), (pad + i * (tw + pad), y + head - 4))
    out = root / f'compare-{size}.jpg'
    sheet.save(out, quality=84)
    print(out, sheet.size)
