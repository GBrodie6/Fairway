# Deploying Fairway Next

Fairway Next is a static site with no server: `npm run build` writes everything to `dist/`
(HTML, hashed JavaScript and CSS, the service worker, icons, and the processed game assets).
Any static host works. Vercel is configured in `vercel.json`.

Live now: https://gbrodie6.github.io/Fairway/ (GitHub Pages, from the `gh-pages` branch).

Deploy of commit 0abbf48 (gh-pages 19bfb81): route A, Vercel, still unavailable (no
VERCEL_TOKEN, and the Vercel CLI folder holds no login). Route B: the `dist/` that `npm run verify`
passed at 0abbf48 (472 tests, smoke 56 of 56 inside the bands) replaced the files on `gh-pages`;
Pages served it about 40 seconds after the push. Route C was not needed. Live checks at 390x844
(touch) and 1920x1080 (mouse) in `qa/proof/live-0abbf48/`.

Earlier: deploy of commit 3c0a275 (gh-pages 07b17cc): route A, Vercel, still unavailable (no
VERCEL_TOKEN in the environment, and the Vercel CLI folder holds only its config notes and
telemetry, no login). Route B: the `dist/` that `npm run verify` passed at 3c0a275 (460 tests,
smoke 56 of 56 inside the bands) replaced the files on `gh-pages` (the old hashed bundles from
earlier builds went with it); Pages served it about 40 seconds after the push. Route C was not
needed. Live checks at 1920x1080 with real mouse events in `qa/proof/live-3c0a275/`.

Earlier: deploy of commit 5ec8117 (gh-pages ea5db3d): route A, Vercel, still unavailable (no
VERCEL_TOKEN, no saved login). Route B: the `dist/` that `npm run verify` passed at 5ec8117 (431
tests, smoke 56 of 56 inside the bands) was copied onto `gh-pages`; Pages served it about 36
seconds after the push. Live checks in `qa/proof/live-5ec8117/`.

Earlier: deploy of commit a4fbc48 (gh-pages 3025a4b): route A, Vercel, again did not work (no
VERCEL_TOKEN in the environment and no saved Vercel login; the CLI folder holds only telemetry
files). Route B worked: the `dist/` that `npm run verify` built and passed at a4fbc48 (424 tests,
smoke 56 of 56 inside the bands) was copied onto `gh-pages` and pushed; Pages served the new
bundle about 36 seconds later. Live checks are in `qa/proof/live-a4fbc48/`.

Earlier: deploy of commit d88848a (gh-pages 80f653b): route A, Vercel, did not work (no login and no
VERCEL_TOKEN on this machine; the CLI config holds no credentials). Route B, the gh-pages
flow, worked: the verified `dist/` from a clean checkout of d88848a was copied onto the
`gh-pages` branch and pushed; Pages served it within 40 seconds. Route C was not needed and
was not possible anyway (no Netlify, Cloudflare, Surge or Firebase credentials). The build
carries the Supabase URL and public anon key from `.env.production`.

## Optional: Vercel from your phone (one tap, no commands)

The repository holds everything the build needs, including the processed CC0 game assets in
`public/assets/` (about 44 MB, 153 files, none over 2 MB), so a Git-connected build ships the full
game, not the procedural fallback.

1. On vercel.com: Add New, Project.
2. Pick the GitHub repository `GBrodie6/Fairway` (connect GitHub if Vercel asks).
3. Leave every setting as it is and tap Deploy. `vercel.json` already says: install with
   `npm ci`, build with `npm run build`, serve `dist`. Framework preset "Other" is fine.

The branch with this work is `claude/fairway-next-golf-game-a7fzjc`, which is also the
repository's default branch, so Vercel builds it without any branch setting.

## What happened in this session (2026-11-18)

The game is live on GitHub Pages: https://gbrodie6.github.io/Fairway/

Routes were tried in the order the brief gives and the first that worked was kept.

Route A, Vercel: did not work (no credentials on this machine).

```
$ env | grep -i vercel          (no VERCEL_TOKEN or any other Vercel variable)
$ vercel --version
Vercel CLI 65.17.0 (native)
65.17.0
$ vercel whoami
> Logged out.
> Run `vercel deploy --temporary` to create a temporary deployment you can claim later, or `vercel login` to log in.
$ vercel --prod
Error: No existing credentials found. Run `vercel deploy --temporary` to create a temporary deployment you can claim later, or `vercel login` to log in.
(exit 1)
```

`vercel deploy --temporary` publishes outside your account and was not used.

Route B, GitHub Pages: worked. The `gh` CLI is limited to search in this environment, so it was
not used; the git remote is pushable. The production build (byte-identical to the build that
passed `npm run verify` at 9543fab, rebuilt from a clean clone at 64abdff) was committed with a
`.nojekyll` file to a new `gh-pages` branch and pushed. It was updated later to the verified
build of 756496a after the tap-through found a bug. GitHub enabled Pages from that branch
on its own; the repository is public, so no paid plan was needed. The site answered 200 about
30 seconds later. Vite's base path is `./` (relative), so the same build works at
`/Fairway/` with no change.

Route C, other hosts: not tried. There is no Netlify or Cloudflare token in the environment.

### Live checks (headless Chrome, software rendering)

`scripts/tools/live.mjs` against https://gbrodie6.github.io/Fairway/ at a phone size (390x844,
touch, device scale 2) and a desktop size (1366x768):

| | Phone | Desktop |
| --- | --- | --- |
| Console errors | 0 | 0 |
| Requests not over HTTPS | 0 of 201 | 0 of 202 |
| Failed requests | 0 | 0 |
| Bytes to the settled main menu (cold cache) | 8.5 MB | 8.5 MB |
| Service worker | active, scope `/Fairway/`, controls the page after a reload | same |

- HTTP redirects to HTTPS (301) and the site sends HSTS.
- Content types: HTML, JavaScript, the web app manifest (`application/manifest+json`), PNG
  icons; `.hdr` and `.glb` come as `application/octet-stream`, which the loaders accept.
- Cache headers: GitHub Pages sends `cache-control: max-age=600` for every file and does not
  allow custom headers, so the long immutable caching in `vercel.json` does not apply there.
  After the first visit the service worker serves the app shell and assets from its cache, and
  the game plays offline.
- Installability, as Chrome itself judges it (`Page.getInstallabilityErrors`, in a normal
  profile): no errors; manifest parsing: no errors. (Playwright's default contexts are
  incognito-like and report only `in-incognito`, which is why a persistent profile was used.)
- A real tap-through of a hole on the live site: see "Tap-through" below.

### Tap-through on the live site

`node scripts/bot.mjs --url https://gbrodie6.github.io/Fairway --holes 1 --start 4 --view portrait`
plays a hole on the deployed site with real touch events at 390x844 (the bot reads the game's
state but acts only through the screen: the swing zone, course drags, and buttons).

- First attempt: it never got off the tee. During the hole flyover the HUD is invisible but
  its buttons still took taps, and the "Skip flyover" button sat exactly over the round club
  button, so the tap on Skip opened the club list, which then covered the swing zone (30 swing
  attempts, none started). Fixed in 756496a (a hidden HUD takes no taps; Skip moved to the top
  center), verified, and the site updated.
- After the fix, on the live site: parkland hole 4 (par 3), a 3-wood to 1.9 m and one putt,
  birdie 2, zero console errors, zero stuck states, 3.3 minutes in software rendering.
- The same hole with a mouse in landscape (844x390): a 5-wood into the greenside bunker, a lob
  wedge out to 8.5 m, one putt, par 3, zero console errors, zero stuck states.

### Updating the live site

```
npm ci
npm run verify                       # tests, build, headless smoke
git worktree add ../fw-ghpages gh-pages
cp -r dist/. ../fw-ghpages/ && touch ../fw-ghpages/.nojekyll
cd ../fw-ghpages && git add -A && git commit -m "Update site" && git push origin gh-pages
```

### Vercel instead

The one-tap import above needs nothing else:
`vercel.json` installs with `npm ci`, builds with `npm run build`, and serves `dist`, and the
game assets are in the repository. A clean clone built that way here produced a `dist/` that is
byte-identical to the verified build. On Vercel the headers in `vercel.json` apply (immutable
caching for `/assets/*`, revalidation for the HTML, the manifest, and the service worker).

## Size against the hosts' limits

| | Limit | This build |
| --- | --- | --- |
| Vercel Hobby, CLI source upload | 100 MB | 45.2 MB in `dist/` |
| Vercel, files per deployment | 15,000 | 167 files |
| Vercel, per static file | no limit stated | largest 1.7 MB (the night sky HDR) |
| GitHub Pages, published site | 1 GB | 45.2 MB |
| GitHub Pages, per file | 100 MB | 1.7 MB |
| GitHub Pages, bandwidth | 100 GB a month (soft) | a cold visit loads 8.5 MB to the settled main menu |

Heavy assets already load after first paint: the first frame needs the code, one sky, and the
low terrain textures; the rest of a hole's textures, models, and the full-resolution sky stream
in afterwards (REPORT.md, Stage 11). No change was needed for these limits.

## What vercel.json does

- `/assets/*` is cached for a year as immutable. Bundles have content hashes in their names;
  game assets keep stable names but every request carries `?v=<asset build stamp>`, so a new
  asset build changes every URL.
- `index.html`, `/`, `manifest.webmanifest`, and `sw.js` revalidate on every load, so a new
  release is picked up immediately.
- Explicit types for `.glb` (`model/gltf-binary`) and `.hdr` (`image/vnd.radiance`).
- Every route that is not a file falls back to `index.html`; a missing file under `/assets/`
  or `/icons/` is a real 404, not an HTML page.
- `nosniff`, a strict referrer policy, and a permissions policy that denies camera,
  microphone, and location.

## Local checks

`scripts/lib/serve.mjs` serves `dist/` with the same headers as `vercel.json`. The smoke test,
the QA bot, and the offline test all run against it. See REPORT.md, Stages 13 to 15.

## After deploying

```
npx vercel inspect <deployment-url>
curl -sI https://<your-domain>/ | grep -i cache-control                 # max-age=0, must-revalidate
curl -sI https://<your-domain>/assets/<any>.js | grep -i cache-control  # immutable
curl -sI https://<your-domain>/sw.js | grep -i service-worker-allowed
FAIRWAY_URL=https://<your-domain> npm run smoke    # if you want the smoke run against the live site
```
