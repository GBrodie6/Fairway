# Deploying Fairway Next

Fairway Next is a static site: `npm run build` writes everything to `dist/` (HTML, hashed
JavaScript and CSS, the service worker, icons, and the processed game assets). Any static
host works. Vercel is configured in `vercel.json`.

## What happened in this session (2026-11-17)

The site was not deployed. The build machine has no Vercel login.

```
$ vercel --version
Vercel CLI 65.17.0 (native)
65.17.0

$ vercel whoami
Vercel CLI 65.17.0
> Logged out.
> Run `vercel deploy --temporary` to create a temporary deployment you can claim later, or `vercel login` to log in.
(exit 1)

$ vercel --prod
Vercel CLI 65.17.0
Error: No existing credentials found. Run `vercel deploy --temporary` to create a temporary deployment you can claim later, or `vercel login` to log in.
Learn More: https://err.sh/vercel/no-credentials-found
(exit 1)
```

The CLI was not installed globally; it was installed into a scratch folder only to run the
commands above. `vercel deploy --temporary` would have published the game to a public URL
outside your account, so it was not used. Everything a deployment would serve was checked
locally instead (see "Local checks" below).

## Vercel limits checked (docs read 2026-11-17)

From https://vercel.com/docs/limits (last updated 2026-09-16) and the fair-use and Hobby
pages (last updated 2026-11-12):

| Limit (Hobby) | Value | This project |
| --- | --- | --- |
| CLI source upload | 100 MB | about 51 MB of build output; deploy with a Git push or `vercel --prod` from the repo (the source upload excludes `node_modules`) |
| Files per CLI deployment | 15,000 source files | about 300 files in `dist/` |
| Per-file size for static files | no limit stated | largest file about 3 MB |
| Build time | 45 minutes | build takes under a minute; asset processing is not part of the deploy build |
| Fast data transfer | "First 100 GB" per month (fair-use guideline, not a hard cap) | a cold first visit loads about 6 to 10 MB (see REPORT.md, Stage 11) |
| Deployments per day | 100 | |

Neither page restricts Hobby to non-commercial use; the Terms of Service (not read here) are
the place to check that before any commercial launch.

Important: the processed game assets (`public/assets/`, about 50 MB) are not in git. A
Git-connected Vercel build runs `npm run build` on Vercel's machines, where those files do not
exist, and the game would ship in its procedural-fallback mode. Use one of these:

1. Deploy the prebuilt output from a machine that has the assets (recommended):
   ```
   npm ci
   npm run assets        # downloads and processes the CC0 assets into public/assets (once)
   npm run verify        # tests, build, headless smoke
   npx vercel login
   npx vercel --prod     # uses vercel.json: builds and uploads
   ```
2. Or build locally and upload only `dist/`:
   ```
   npm run build
   npx vercel deploy dist --prod
   ```
   When deploying `dist/` directly, copy `vercel.json` into `dist/` first so the headers and
   rewrites apply: `cp vercel.json dist/ && npx vercel deploy dist --prod`.

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

## Local checks (in place of a live site)

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
