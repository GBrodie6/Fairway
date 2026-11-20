# Before and after contact sheets for the course scenery proof: for each course, hole and size,
# the build before the other holes (top row) above the build with them (bottom row), at the
# tee, mid-fairway, on the green and in the flyover, plus the course map (after only).
#   python3 scripts/tools/scenery-sheet.py qa/proof/scenery/shots
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'qa/proof/scenery/shots')
views = ['tee', 'mid', 'green', 'flyover', 'map']
labels = {'tee': 'Tee', 'mid': 'Mid-fairway', 'green': 'Green', 'flyover': 'Flyover', 'map': 'Course map'}
groups = {}
for p in root.glob('after-*.jpg'):
    # after-<course>-h<hole>-<size>-<view>.jpg
    stem = p.stem[len('after-'):]
    course_hole_size, view = stem.rsplit('-', 1)
    groups.setdefault(course_hole_size, set()).add(view)
for key, have in sorted(groups.items()):
    cols = [v for v in views if v in have]
    rows = []
    for tag in ['before', 'after']:
        ims = []
        for v in cols:
            f = root / f'{tag}-{key}-{v}.jpg'
            ims.append(Image.open(f).convert('RGB') if f.exists() else None)
        rows.append((tag, ims))
    sample = next(im for _, ims in rows for im in ims if im is not None)
    w, h = sample.size
    scale = min(1.0, 2200 / (w * len(cols) + 40), 900 / (h * 2 + 60))
    tw, th = int(w * scale), int(h * scale)
    pad, head = 8, 24
    sheet = Image.new('RGB', (pad + (tw + pad) * len(cols), head + (th + head + pad) * 2), (24, 30, 26))
    d = ImageDraw.Draw(sheet)
    for i, v in enumerate(cols):
        d.text((pad + i * (tw + pad) + 4, 6), labels[v], fill=(230, 236, 226))
    for r, (tag, ims) in enumerate(rows):
        y = head + r * (th + head + pad)
        d.text((pad + 4, y + 4), 'Before: no other holes' if tag == 'before' else 'After: the other holes drawn', fill=(194, 229, 138) if tag == 'after' else (230, 236, 226))
        for i, im in enumerate(ims):
            x = pad + i * (tw + pad)
            if im is None:
                d.text((x + 10, y + head + th // 2), 'not in this build', fill=(160, 160, 160))
                continue
            sheet.paste(im.resize((tw, th)), (x, y + head - 4))
    out = root / f'compare-{key}.jpg'
    sheet.save(out, quality=84)
    print(out, sheet.size)
