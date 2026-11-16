# Fairway Next: plan

## Where this was built, and what that changes

The brief names two Windows paths: the old project at `C:\Users\gb1\fairway` (read-only
reference) and the new project at `C:\Users\gb1\fairway-next`. This work ran in a cloud Linux
container, not on that machine. Consequences, stated plainly:

1. **The old project could not be read.** The container holds a fresh clone of the GitHub repo
   `GBrodie6/Fairway`, and that repo was empty (no commits, no branches). I searched every
   other repository on the account through the GitHub search API for the old code (swing stick,
   carry ladder, Mixamo, ASSETS.md) and found nothing, and no folder from the Windows machine
   was shared with this session. So Stage 0's "read the old repo fully" was not possible.
2. **Nothing was ported.** The brief asks for the verified physics, wind, aim, swing math,
   swing stick gesture, and scoring to be ported unchanged with their tests. With no source to
   port from, each of those was written fresh to the specification in the brief, with new tests.
   They are not the old, previously verified implementations and their numbers (for example the
   carry ladder) are new values chosen here, not the old ones. See "Porting the old modules
   later" below for how to drop the originals in.
3. **The new project lives at the root of this repo** on branch
   `claude/fairway-next-golf-game-a7fzjc`, instead of a new `fairway-next` folder with its own
   `git init`. Clone it to `C:\Users\gb1\fairway-next` to get the layout the brief describes.
4. **The four baked HDRIs and the Mixamo golfer** from the old repo's assets were not
   available. HDRIs are sourced from Poly Haven instead (Stage 2). The golfer is not shipped
   (Stage 7), which is the brief's stated default.
5. **Vercel deploy** needs the CLI to be installed and logged in on a machine that has the
   account. That is handled in Stage 14 and DEPLOY.md.

## What would have been ported, and what stands in for it

| Area | Brief said | What exists here | Evidence |
| --- | --- | --- | --- |
| Ball physics | port, ladder within 0.2 yd, hang times, no NaN, roll friction | `src/physics/ball.js`, `surfaces.js`, `clubs.js` written fresh: RK4 flight with drag and Magnus lift fitted to published tour launch-monitor averages, rigid-body bounce with spin, rolling resistance with slope, cup capture | `tests/physics.test.js` (47 tests) |
| Wind with gusts | port | `src/physics/wind.js` written fresh: seeded gust envelope, log height profile | `tests/wind.test.js` (9 tests) |
| Aim math | port | `src/physics/aim.js` written fresh | `tests/aim.test.js` (8 tests) |
| Swing math | port | `src/physics/shot.js` written fresh: face, path, tempo, lie, shot type, profile to launch conditions | `tests/swing.test.js` (22 tests) |
| Swing stick gesture | port | `src/game/swingGesture.js` written fresh to the brief: drag down for the backswing, reverse through the start line for impact, 3 to 1 tempo grading, face and path from horizontal drift, power from backswing depth | `tests/gesture.test.js` (20 tests) |
| Scoring and match modes | port | `src/game/scoring.js` written fresh: stroke, match play, skins, closest to pin, stats | `tests/scoring.test.js` (22 tests) |
| Old course generator | reuse as a layout source only | not available; a new layout generator is written in Stage 3 | Stage 3 tests |

Discarded by the brief regardless (and not available anyway): all old rendering, terrain,
vegetation, UI, and the golfer rig.

### The carry ladder used here (yards, full swing, flat, calm, clean lie)

Driver 250, 3 wood 228, 5 wood 212, 4 iron 196, 5 iron 185, 6 iron 174, 7 iron 163, 8 iron 151,
9 iron 139, PW 127, GW 112, SW 96, LW 80.

Ball speeds are solved by `scripts/tools/calibrate-clubs.mjs`; the test suite then simulates
each club independently and asserts the carry within 0.2 yards. The aerodynamic coefficients
were fitted with `scripts/tools/fit-aero.mjs` against published tour averages (carry within
about 4 percent and apex within about 4 yards across driver to pitching wedge).

### Porting the old modules later

The interfaces are small on purpose. To restore the originals from `C:\Users\gb1\fairway`:
replace the files in `src/physics/` and `src/game/swingGesture.js`, `src/game/scoring.js` and
keep these exports: `simulateShot(launch, env)`, `CLUBS`, `createWind`, `computeLaunch`,
`createSwingGesture`, and the scoring functions. Bring the old tests into `tests/` next to
the new ones and run `npm run verify`.

## Lessons from the old repo, guarded from the start

The brief lists five past bugs. Each has a guard in this codebase from the first commit:

| Past bug | Guard |
| --- | --- |
| NaN in a canvas gradient killed the render loop before the first frame | `core/guards.js`: `safeLinearGradient` / `safeRadialGradient` refuse non-finite geometry; every canvas and projection value goes through `fin()`; tested |
| One throw killed the frame | `core/loop.js` wraps every subsystem in `guarded()`; a throw is logged, counted, and the frame continues; the smoke gate fails on any guarded error |
| Camera matrix not refreshed before projection | `render/post.js` and every projection helper call `updateMatrixWorld` and `updateProjectionMatrix` first |
| Grass rendered as black spikes | grass is lit with the terrain normal and colored from the terrain beneath; verified in address screenshots on every course (Stage 5) |
| Composer grading applied in linear space | the grade runs after the tone map and the sRGB encode, in display space, in one composite shader (`render/post.js`) |
| Unprofiled frame cost | the loop times every subsystem from frame one; `?debug` shows it; `npm run perf` reports it (Stage 11) |

## The regression gate

`npm run verify` runs, in order: all unit tests, the production build, and a headless Chrome
smoke over every course and time-of-day preset in landscape plus a portrait pass. The smoke
reports console errors, guarded subsystem errors, mean luma, and clipped pixel percent for the
3D viewport only (read back from the WebGL canvas, so HUD pixels are excluded). Any console
error, failed request, or guarded error fails the gate. Luma band enforcement is switched on in
`qa/gate.json` at Stage 4, once the sky and exposure are real.

Headless Chrome here renders with SwiftShader, a software rasterizer. Pixel measurements and
screenshots are valid evidence. Frame times from it say nothing about a real GPU, so
performance claims rest on `renderer.info` (draw calls, triangles), CPU-side timings, asset
sizes, and budgets, and real-device frame rate is listed as unverified.

## Stages

0. Recon, plan, fresh core logic with tests, the verify gate.
1. Engine foundation: modular layout, linear HDR pipeline, tiers, debug overlay, asset
   pipeline scripts, resize, DPR, orientation, context loss.
2. Assets from Poly Haven and ambientCG (CC0), with procedural fallbacks.
3. Heightfield terrain, splat material, mowing, greens, bunkers; three flagship courses.
4. Sky, light, atmosphere, water, grade.
5. Vegetation and props.
6. Ball, flight presentation, cameras, overlays, putting aids.
7. Golfer: evaluated and not shipped (assets unavailable; ball-first is the default).
8. Swing stick and controls, tutorial.
9. Game modes and career.
10. UI, settings, accessibility, audio.
11. Performance.
12. Share links and pass and play.
13. PWA and iOS packaging guide.
14. Hosting and deploy.
15. QA bot, contact sheets, luma report, realism gaps.

REPORT.md is updated at the end of every stage with what changed, the evidence, the commit,
test counts, and asset size.
