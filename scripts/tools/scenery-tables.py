# Markdown tables for OVERHAUL.md from the measurements: the routing (qa/proof/routing/
# routing.json) and the scenery benchmark (before: scenery-bench.mjs on the old build; after: the
# same tool on the new build, scenery on and off in alternating batches).
#   python3 scripts/tools/scenery-tables.py routing qa/proof/routing/routing.json
#   python3 scripts/tools/scenery-tables.py before qa/proof/scenery/bench-before.json
#   python3 scripts/tools/scenery-tables.py after qa/proof/scenery/bench-before.json qa/proof/scenery/bench-after.json
import json
import sys

kind = sys.argv[1]
k = lambda n: f'{n / 1000:.0f}k' if n >= 10000 else f'{n:,}'

if kind == 'routing':
    rows = json.load(open(sys.argv[2]))
    print('| course | source | least gap (holes) | walks, green edge to next tee | 18th green to 1st tee | size | real direction within 10 / 30 degrees |')
    print('| --- | --- | --- | --- | --- | --- | --- |')
    for r in rows:
        dev = r.get('deviation')
        real = f"{sum(1 for d in dev if d['headingOff'] <= 10)} / {sum(1 for d in dev if d['headingOff'] <= 30)} of 18" if dev else 'generated'
        print(f"| {r['course']} | {r['source']} | {r['minGap']} m ({r['minPair'][0]}, {r['minPair'][1]}) | {min(r['walks']):.0f} to {max(r['walks']):.0f} m | {r['home']:.0f} m | {r['width']} x {r['depth']} m | {real} |")
elif kind == 'before':
    data = json.load(open(sys.argv[2]))
    by = {}
    for r in data['runs']:
        if 'view' in r:
            by.setdefault(r['tier'], {})[r['view']] = r
    print('| tier | tee (address) | flyover | green |')
    print('| --- | --- | --- | --- |')
    for t in ['low', 'medium', 'high', 'ultra']:
        if t not in by:
            continue
        cell = lambda r: f"{r['draws']} draws, {k(r['tris'])} tris, {r['ms']:,.0f} ms"
        print(f"| {t} | " + ' | '.join(cell(by[t][v]) for v in ['address', 'flyover', 'green']) + ' |')
elif kind == 'after':
    before = json.load(open(sys.argv[2]))
    after = json.load(open(sys.argv[3]))
    bb = {(r['tier'], r['view']): r for r in before['runs'] if 'view' in r}
    print('| tier | view | before: draws, tris, ms | after, scenery off | after, scenery on | added | frame cost, on / off (median of paired batches) |')
    print('| --- | --- | --- | --- | --- | --- | --- |')
    for r in after['runs']:
        if 'view' not in r or 'offDraws' not in r:
            continue
        b = bb.get((r['tier'], r['view']))
        bs = f"{b['draws']}, {k(b['tris'])}, {b['ms']:,.0f}" if b else 'n/a'
        sc = r['scenery']
        print(f"| {r['tier']} | {r['view']} | {bs} | {r['offDraws']}, {k(r['offTris'])}, {r['offMs']:,.0f} | {r['draws']}, {k(r['tris'])}, {r['ms']:,.0f} | +{r['draws'] - r['offDraws']} draws, +{k(r['tris'] - r['offTris'])} tris ({sc['drawnHoles']} holes) | {r['costRatio'] * 100 - 100:+.1f}% ({min(r['ratios']) * 100 - 100:+.1f} to {max(r['ratios']) * 100 - 100:+.1f}) |")
