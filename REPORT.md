# Fairway Next: stage report

Running log, one section per stage: what changed, evidence, commit, test counts, asset size.
The overhaul (fourth brief) report comes first, right below. Then the first brief's stages with
their final report, and the second brief (HUD, the first-person club, controls, surfaces,
water, proof, and the deploy) under "Second brief", with its own final report at the very end.
Live site: https://gbrodie6.github.io/Fairway/
Evidence is always a test, a measurement, or a headless Chrome run. Headless Chrome uses
SwiftShader (software rendering), so frame times from it are not representative of a real GPU.

## Overhaul brief (fourth brief): final report

Supabase values were blank, so every account and cloud feature is built and tested, but cloud
sync is dormant in this build: the game says "Cloud sync is off in this build", plays as a
guest, keeps progress on the device, and the leaderboards say they need cloud sync. A build
with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set turns it on (schema and row level
security in `supabase/schema.sql`, since replaced by `supabase/README.md`); `?cloud=demo` runs the same screens against an in-memory
stand-in on the device. Live sign-up with a real email was not verified. Design notes for every
stage are in OVERHAUL.md. All verification ran on the production build in headless Chrome
(SwiftShader software rendering), through real touch input.

| Stage | What changed | Evidence | Commit | Tests | Build |
| --- | --- | --- | --- | --- | --- |
| 0 Recon | Read the code, baseline gate, OVERHAUL.md | baseline verify | edf6b5e | 259 | 43.13 MB |
| 1 Accounts | Guest by default; email and password, magic link, reset, sign out, delete account and data; display names with a profanity filter; merge on sign-up; newer-wins sync with 30-day backups and restore; offline queue; four casual leaderboards; plain error messages; privacy page; all dormant without keys | 18 mocked tests (merge, conflict, migration, offline queue, delete, RLS); demo-mode tap-through; qa/proof/overhaul-o1-accounts | 37e8e66 | 277 | 43.16 MB |
| 2 Strike quality | Pured, Good, Heel, Toe, Thin, Fat, Shank with severity from tempo, face drift, path, release timing, overswing, lie, slope and club; bounded launch modifiers before the unchanged simulation; label, contact marker, haptic, sound, shot card with the cause; relaxed, standard, pro; earned Mulligan | 10 tests (distribution, floor 40 percent, cap, no NaN, determinism, Common pured equals the carry ladder); real-touch mishit and Mulligan; qa/proof/overhaul-o2-strike | bb08a0d | 287 | 43.17 MB |
| 3 Club tiers | Common to Legendary (Meadow, Harrow, Kingfisher, Ember, Solstice): pured carry bonus 0 to 8 percent in the cap, smaller sweet spot, costlier mishits; gear screen with stat bars and compare; drops with printed odds and pity; duplicates to shards; upgrades; 14-club bag; balls and gloves; tier finish on the club | 20 tests (caps, odds over 20,000 drops, pity, duplicates, loadout, migration); real taps at three sizes; qa/proof/overhaul-o3-gear | dd3719e | 310 | 43.19 MB |
| 4 Range | A real practice ground: five bays, mats and grass, nets, clubhouse, evening lights, signs every 25 yd to 300, five target greens, picker cart; 50-ball bucket or unlimited; launch monitor card; dispersion map with ellipse; per-club averages; summary; target points, long drive, wedge ladder, shape shots, pressure streak, club test lane; XP, medals, a token for gold; range averages in the club list | 13 tests; every mode played with real swings at four sizes; qa/proof/overhaul-o4-range | ed81464 | 323 | 43.22 MB |
| 5 Campaign | Six archetypes with perks, weaknesses and evolutions at 10 and 25; levels to 40; five stats; a 20-node tree each with punch, high, flop and bump and run; free respec; six chapters, 28 events, objectives and stars, named bosses, match play against the rival; save migration | 20 tests (caps, carry ladder for every archetype, unlocks, migration); the QA bot played an event and a boss match; qa/proof/overhaul-o5-campaign | fc9f607 | 341 | 43.26 MB |
| 6 Fun layer | Daily and weekly quests, a free 30-tier season, 69 achievements, ball and tracer cosmetics, streaks and confetti, this week's mini-game and long drive, 3 and 6 hole rounds, an adaptive rival | 11 tests; a real 3-hole round against the adaptive rival; qa/proof/overhaul-o6-fun | 94e9857 | 359 | 43.29 MB |
| 7 Broadcast | Hole intro card over the flyover, lower thirds, live leaderboard with movement arrows, commentary lines, replay speed with the existing angles, round recap, tournaments with a cut, purse in coins and trophies | 7 tests; a tournament round and a campaign event through real touch; qa/proof/overhaul-o7-broadcast | 3f212ed | 359 | 43.31 MB |
| 8 First minute | Main menu: Quick Play, Campaign, Range, Daily, Profile; Profile hub; three skippable tutorial prompts (swing, strike result, club choice); settings already complete | 22 screens at four sizes with no overflow, small buttons, clipped text or overlaps; tutorial completed at every size; qa/proof/overhaul-o8-menus | 831c07c | 359 | 43.31 MB |
| 9 Balance | Headless simulated golfer and paired balance runs; Sharpshooter and Power Hitter retuned; pured higher-tier strikes fly straighter | qa/balance.md, qa/balance.json | c414850 | 361 | 43.31 MB |
| 10 Proof and deploy | Final screens at four sizes (22 screens each, no overflow, small buttons, clipped text or overlaps; tutorial completed), a range session (Target points, bronze), a campaign event (first of 6) and a daily challenge (even par) through real taps on the gated build; GitHub Pages deploy and live checks | qa/proof/overhaul-o10-final | this commit (site on gh-pages 5789ae0) | 361 | 43.31 MB |

Every gate also passed the headless smoke (5 courses, 40 combinations, renderer and physics
agreement at least 99 percent). The physics, swing, career and share-link tests from before the
overhaul pass unchanged. No em dashes were written.

### Balance tables (qa/balance.md)

Revised after the overhaul: the tier carry bonus now applies at half strength on a Good strike
and full strength on a Pured one, and the club card and power guide show the tier's carry for
a clean strike at the player's own Pured rate (OVERHAUL.md, stage 3 and stage 9). The tables
below are from that build, 400 rounds per cell; the tables before the change, from the same
simulator on the previous commit, are in qa/balance-before.md.

Method: the simulated golfer plans like the AI and swings with a fixed human-like error model
(skill 0.35 poor, 0.6 average, 0.9 skilled). 9-hole rounds rotate through all five courses and
both nines; round i is the same course, wind and dice in every cell, so differences come from
the cells. Per-18 values are twice the 9-hole means.

#### Archetypes at level 5 (average 6.17 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 6.28 | +0.11 | 24.6 | 3.3 | 16.63 | yes |
| Sharpshooter | 5.48 | -0.69 | 24.8 | 3.6 | 16.59 | yes |
| Short Game Artist | 6.39 | +0.22 | 23.5 | 4 | 16.65 | yes |
| Putting Specialist | 6.54 | +0.37 | 22.9 | 3.9 | 16.62 | yes |
| Links Player | 6.64 | +0.47 | 22.3 | 4.1 | 16.68 | yes |
| All-Rounder | 5.7 | -0.47 | 23.4 | 4 | 16.4 | yes |

#### Archetypes at level 15 (average 5.49 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 6.29 | +0.8 | 26.6 | 2.9 | 16.75 | yes |
| Sharpshooter | 4.2 | -1.29 | 27.4 | 3.1 | 16.43 | yes |
| Short Game Artist | 6.04 | +0.55 | 25.4 | 3.8 | 16.54 | yes |
| Putting Specialist | 5.61 | +0.12 | 25.3 | 3.5 | 16.39 | yes |
| Links Player | 5.4 | -0.09 | 25.1 | 3.3 | 16.54 | yes |
| All-Rounder | 5.39 | -0.1 | 25.7 | 3.5 | 16.59 | yes |

#### Archetypes at level 30 (average 4.05 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 5.22 | +1.17 | 28.6 | 2.9 | 16.74 | yes |
| Sharpshooter | 3.85 | -0.2 | 29.1 | 3 | 16.39 | yes |
| Short Game Artist | 3.63 | -0.42 | 27.7 | 3.1 | 16.1 | yes |
| Putting Specialist | 3.68 | -0.37 | 28.4 | 3.2 | 16.16 | yes |
| Links Player | 4.13 | +0.08 | 27.8 | 3.4 | 16.39 | yes |
| All-Rounder | 3.81 | -0.24 | 28.2 | 3.2 | 16.3 | yes |

#### Club tiers, poor swing (skill 0.35): strokes per 18 against Common

| Tier | Plans with the base carry | Plans for the tier's carry | Pured % | Good % | Mishit % |
| --- | --- | --- | --- | --- | --- |
| common | 0 (0 to 0) | 0 (0 to 0) | 10.6 | 80.2 | 9.1 |
| uncommon | +0.42 (-0.34 to 1.19) | +0.17 (-0.54 to 0.88) | 8.5 | 81.3 | 10.2 |
| rare | +0.57 (-0.18 to 1.32) | +0.16 (-0.6 to 0.92) | 6.3 | 81 | 12.7 |
| epic | +0.69 (-0.08 to 1.47) | -0.35 (-1.1 to 0.39) | 5.1 | 80.6 | 14.2 |
| legendary | +1.79 (0.97 to 2.62) | +0.89 (0.1 to 1.67) | 3.8 | 78.9 | 17.3 |

Common plays 15.3 over par per 18 for this swing.

#### Club tiers, average swing (skill 0.6): strokes per 18 against Common

| Tier | Plans with the base carry | Plans for the tier's carry | Pured % | Good % | Mishit % |
| --- | --- | --- | --- | --- | --- |
| common | 0 (0 to 0) | 0 (0 to 0) | 23 | 73 | 4 |
| uncommon | -0.21 (-0.83 to 0.4) | -0.14 (-0.75 to 0.47) | 19.5 | 75.6 | 4.8 |
| rare | -0.17 (-0.82 to 0.47) | -0.79 (-1.4 to -0.17) | 16.2 | 77.8 | 6 |
| epic | +0.77 (0.09 to 1.45) | -0.21 (-0.86 to 0.44) | 13.1 | 79.7 | 7.3 |
| legendary | +1.97 (1.3 to 2.63) | +0.12 (-0.5 to 0.73) | 10.1 | 80.3 | 9.6 |

Common plays 6.83 over par per 18 for this swing.

#### Club tiers, skilled swing (skill 0.9): strokes per 18 against Common

| Tier | Plans with the base carry | Plans for the tier's carry | Pured % | Good % | Mishit % |
| --- | --- | --- | --- | --- | --- |
| common | 0 (0 to 0) | 0 (0 to 0) | 73.1 | 26.3 | 0.6 |
| uncommon | +0.09 (-0.4 to 0.57) | -0.29 (-0.74 to 0.15) | 69.2 | 30.1 | 0.7 |
| rare | +1.69 (1.12 to 2.25) | -0.8 (-1.28 to -0.31) | 63.5 | 35.6 | 1 |
| epic | +3.38 (2.83 to 3.92) | -0.6 (-1.09 to -0.11) | 56.7 | 42.2 | 1.1 |
| legendary | +5.4 (4.79 to 6.01) | -0.7 (-1.21 to -0.19) | 49.5 | 49.1 | 1.4 |

Common plays -2.73 over par per 18 for this swing.

#### Difficulty settings (Common clubs, level 1, average swing)

| Setting | Over par per 18 | Pured % | Mishit % | Shank % |
| --- | --- | --- | --- | --- |
| relaxed | 6.36 | 60 | 0.5 | 0 |
| standard | 6.83 | 23 | 4 | 0 |
| pro | 7.72 | 8.9 | 10.1 | 0 |

Legendary against Common, planning for the tier's carry: poor +0.89, average +0.12, skilled -0.7 strokes per 18. Targets: skilled 0.5 to 1.5 better met; average within 0.5 met; poor costs strokes met.
Archetypes within 1.5 strokes of their level's average: yes.
Run time 158 s.

### Deploy

- Route A, Vercel: failed. Vercel CLI 66.2.0, `vercel whoami` reported "Logged out.", and there
  is no `VERCEL_TOKEN` in the environment. The CLI suggests `vercel deploy --temporary`, which
  publishes outside your account; it was not used.
- Route B, GitHub Pages: worked. The gated build (c414850, byte-identical) was pushed to the
  `gh-pages` branch (5789ae0) and was live about 30 seconds later. Built with blank Supabase
  values, so cloud sync is dormant on the live site.
- Route C was not needed.
- Live checks at 390x844 and 1366x768: no console errors, all 202 requests over HTTPS and none failed, 8.5 MB to the settled menu on a cold cache, the service worker active with scope `/Fairway/` and controlling the page, and Chrome reporting no installability errors in a normal profile.
- Live tap-through on the deployed site at 390x844: from the new main menu to Daily (this week card), Quick Play with 3 holes against the adaptive rival, a full round through touch (13 strokes, even par), then Profile, Quests, Achievements and Locker: no console errors, counters, quests, streak bests and four achievements recorded.

### For a person to check on a real device (most important first)

1. Frame rate and heat on a real phone. Every measurement here used software rendering, which
   says nothing about a real GPU; the range adds bays, nets, signs, a cart and light glows.
2. Swing feel with strike penalties on: whether standard feels only a little harder than
   before (the target was a mishit on about 4 percent of full shots for an average swing, and
   the simulation says 3.7), and whether the strike label, contact marker, haptic and card make
   the cause clear.
3. Fairness of penalties: whether thin, fat, heel, toe and the rare shank read as earned
   (the card names a cause), and whether pro feels harsh but fair.
4. Club tiers (revised): with the half-on-Good rule and a guide that follows your Pured rate,
   Legendary now helps a skilled swing (-0.70 per 18), is level for an average one and costs a
   poor one. Whether the club card's carry creeping up as you pure more reads as a reward or as
   confusing, and whether Rare helping an average player (-0.79) is welcome, need a person.
5. Progression pacing: about 10 campaign events to level 10 and about 90 to level 40, one gear
   token per round (3 a day) plus quests, drills and first clears, the season track at 300 XP a
   tier. Whether it feels generous or slow over a week of play.
6. Live sign-up with a real email: needs the Supabase project URL and anon key at build time,
   then a check of confirmation mail, magic link and reset links, and delete my data.
7. Campaign difficulty: whether the bosses and the later chapters' objectives are reachable for
   a casual player, and whether 9-hole events are the right length on a phone.
8. The first minute: whether the three tutorial prompts land at the right moments for a new
   player and the new menu reads at a glance.
9. The quick-round rival: it adapts to recent form and should lean slightly toward winning,
   but in the live run a new player's rival ("even") shot 5 over on three holes. The on-screen
   AI may play below the statistical model the adaptation is based on; worth a look over
   several rounds.

## Stage 0: recon and plan

- The old project was not reachable from this environment (see PLAN.md). Nothing was ported.
  Ball physics, wind, aim, swing math, the swing stick gesture, and scoring were written fresh
  to the brief with new tests.
- `npm run verify` gate: unit tests, production build, headless smoke over every course and
  preset (landscape, plus a portrait pass), reporting console errors, luma, and clipping for
  the 3D viewport only.
- Guards for the five lessons from the old repo are in place from the first commit.
- Evidence: 146 unit tests pass; smoke 24 of 24 combinations, zero console errors. The gate
  caught a real defect on its first run (404 for the app icons), which was fixed by generating
  the icons procedurally.
- The 3D scene at this stage is a placeholder (sky gradient, ground plane, sun). The luma
  numbers prove the measurement and auto exposure path, not final visuals.
- Shipped asset size: 0 MB external. dist is 0.74 MB.

## Stage 1: engine foundation

- Modular `src/` layout: `core` (loop, settings, quality, rng, guards, math), `physics`,
  `course`, `render` (engine, post, assets, world), `game`, `ui`, `audio`, `tools`.
- Color pipeline: materials write linear light into a half-float HDR target with a depth
  texture and MSAA per tier. One composite pass applies exposure, tone mapping (ACES by
  default, AgX available), the sRGB encode, and then the grade and vignette in display space.
  Bloom (thresholded HDR highlights), GTAO (half resolution, three.js GTAOPass on the scene
  depth), light shafts, depth of field, height fog with aerial perspective, and heat shimmer
  are all wired into the same pipeline and switched per tier.
- Quality tiers low, medium, high, ultra with auto detection (`detectTier`, unit tested) and a
  settings and URL override. Each tier sets pixel ratio cap, MSAA, shadow cascades and size,
  AO, bloom, texture resolution, instance densities, grass radius, draw distance, and a draw
  call and triangle budget.
- `?debug` overlay: frame time, fps, CPU ms, per-subsystem ms, draw calls, triangles, texture
  memory, render target memory, tier, exposure, luma.
- Resize, DPR, orientation, and WebGL context loss and restore are handled in
  `render/engine.js`.
- Evidence (headless, in `qa/smoke.json` under `engineChecks`): a forced context loss was
  restored with the image unchanged (luma 151.0 before, 150.9 after) and the loop kept
  running; with a device pixel ratio of 3 each tier clamped to its cap (1, 1.5, 2, 2.5); a live
  resize to 360x640 switched to portrait and back; the debug overlay showed tier, draw calls,
  and texture memory. Zero console errors.
- Not verified: behavior on a real GPU and on real phones (context loss on iOS Safari in
  particular behaves differently from the WEBGL_lose_context extension).

## Stage 2: asset acquisition

- Endpoints were verified against the published docs, not assumed: Poly Haven
  `GET /files/{id}`, `/info/{id}`, `/assets?type=` (OpenAPI spec at
  api.polyhaven.com/api-docs/swagger.json) and ambientCG `GET /api/v2/full_json?id=&include=downloadData`.
  Both license pages were fetched and checked for the CC0 statement during the run.
- `npm run assets` pipeline (pure Node, so it runs on Windows too): download with retry and
  alternate source, license check, texture compression to tier resolutions, model LOD
  generation with meshopt compression, HDRI analysis, procedural maps, manifest, ASSETS.md.
- Shipped: 21 PBR sets (albedo with baked AO and height in alpha as WebP; normal GL plus
  roughness as 4:4:4 JPEG) at 512 and 1024, plus 2048 for fairway and green; 32 models with two
  mesh LODs each; 8 HDRIs at the 1k baked size with the sun located in each; water normal,
  cloud noise, and detail noise generated procedurally.
- Every download succeeded, so no PBR set needed the procedural fallback. The fallback path is
  implemented and unit tested (`generateFallbackSet`).
- Model LODs: the scanned trees are 0.7 to 3.9 million triangles with every leaf a separate
  mesh. The pipeline keeps a seeded subset of leaf cards, rebuilds each as one plane-fitted
  quad with an affine UV fit, scales them to keep canopy coverage, and simplifies wood with
  attribute-aware meshopt. Result: about 25k triangles at LOD0 and 5k at LOD1 per tree.
  Verified by rendering every model at both LODs (`scripts/tools/shoot-models.mjs`).
- Rejected after inspection: `boulder_01` (texture smears under simplification),
  `painted_wooden_bench` (an indoor shelf bench, not a park bench), `shrub_01` (scattered
  fragments). Not available at either source, so built in code instead: palms, cactus, reeds,
  signs, fences, tee markers, flag and cup, park bench, buildings, bridges, grandstands.
- The old repo's four baked HDRIs were not available, so all environments come from Poly Haven.
- Evidence: `tests/assets.test.js` (13 tests: manifest covers the catalog, licenses, LOD
  budgets, HDRI sun, size budget, files on disk); `npm run assets:licenses` reports 64 shipped
  assets, 0 problems.
- Shipped asset size: 49.67 MB (textures 26.71, models 12.53, HDRIs 10.43), under the 60 MB
  budget. Raw download cache: 1.5 GB in `asset-src/` (not in git).
- Known weak spots: the conifers (`fir`, `pine`) come from sapling scans and are thin; LOD1
  foliage is visibly sparser than LOD0 up close.

## Stage 3: terrain and courses

- `src/course/layout.js`: deterministic hole generator (routing with doglegs, fairway width
  profile, green outline with harmonics, tee boxes, greenside and fairway bunkers, ponds,
  streams, coastline, cart path, pin candidates, marker anchors). The old course generator was
  not available, so this is new.
- `src/course/terrain.js`: one 1 m heightfield and one set of surface masks per hole. Macro
  land, a corridor that settles toward the smoothed centerline profile, fairway undulation,
  raised greens with tilt, internal contour, optional tier, mounds and collection hollows,
  flat tee pads, bunker bowls with a lip that is higher on the target side, ponds and streams
  that take their level from the surrounding land with graded banks, a beach and sea shelf on
  coastal holes, dunes on the links, and mesas and rock bands in the desert. Pins are cut only
  where the finished green is under 4.5 percent.
- `src/render/terrainView.js`: chunked LOD mesh with skirts, an outer landscape that samples
  the same macro function out to several kilometers with range-dependent relief (hills, mesas,
  mountains), and a splat shader injected into MeshStandardMaterial. It blends tiling PBR
  texture array layers from per-texel masks in painter's order, with world-space mapping,
  triplanar projection on rock, a second rotated scale plus low-frequency noise to break
  tiling, maximum anisotropy per tier, mowing stripes, checker, and diagonal cuts that follow
  the centerline on fairways and run straight on greens and tees (albedo plus a normal lean),
  raked ridges and a damp lip band in bunkers, and dew glints.
- Greens: a real hole cut in the surface by the shader with a liner and visible lip, a
  flagstick, and a flag simulated as Verlet cloth driven by the wind (`greenProps.js`).
  Ball marks, divots, sand craters, and footprints are instanced decals (`decals.js`).
- Three flagship courses, each 18 holes and par 72: Alderwick Park (parkland), Saltmarrow
  Links (coastal links), Cinder Mesa (desert). Alpine and tropical are defined but not gated
  until a later pass.
- Physics reads the same data the renderer uploads. Evidence:
  - Unit tests (`tests/course.test.js`, 21 tests): all 54 flagship holes build finite terrain
    with the tee on a tee box, every pin on the green and under 6 percent slope, the fairway
    centerline on fairway, no bunker flooded, bunkers are bowls with a lip; `heightAt` matches
    the mesh triangulation; `surfaceAt` matches the uploaded mask bytes; mask edges sit within
    12 cm of the layout geometry; a simulated drive lands and stops in bounds on real terrain.
  - Headless GPU check in the smoke gate: the real terrain shader renders surface ids top down
    and they are compared to `terrain.groundSurfaceAt`. Agreement: parkland 99.98 percent,
    links 99.98 percent, desert 99.97 percent of 27,648 samples each. Mesh vertex height
    versus `heightAt`: at most 0.0001 m over more than 5,000 vertices per course.
- Bugs the tests caught and that were fixed at the source: a sign error in the routing
  rotation, pins on tier slopes, a bunker placed on a fairway centerline by a shared scratch
  object, a bunker flooded by a nearby pond's water level.
- Verify: 180 tests pass, build passes, smoke 24 of 24 with zero console errors.
- Terrain build time (Node, this machine): 0.2 to 0.6 s per hole. Not measured on a phone.
- Not yet done at this stage: trees (the density field exists, Stage 5), the real sky and
  water shaders (Stage 4), decal persistence across holes inside a round (the game state does
  that in Stage 9). The top-down maps in `scripts/tools/map-hole.mjs` were used to review
  every layout change.

## Stage 4: sky, light, atmosphere

- `render/sky.js`: analytic atmospheric scattering (Preetham: Rayleigh and Mie), a sun disc with
  limb darkening that dims toward the horizon, a moon and stars at night, and a procedural
  cloud layer on a plane above the camera, lit from the sun's side (one or two light samples
  per tier) with a forward-scattering silver lining, drifting with the game wind.
- Six presets: dawn, morning, midday, golden hour, dusk, night (`render/timeOfDay.js`). The
  sun's compass bearing is rotated by each hole's routing, so the light differs hole to hole.
- Image-based lighting from the eight Poly Haven 1k HDRIs, prefiltered with PMREM, rotated so
  the HDRI's sun matches the game sun, and normalized by each map's own mean luminance. A
  prefilter of the procedural sky is used for first paint and whenever the HDRIs are absent.
- Cascaded shadow maps (three's CSM addon): 1, 2, 3, or 4 cascades by tier with PCF soft
  filtering. Every lit material is registered through `lighting.setup`.
- GTAO at half resolution from the scene depth (high and ultra), bloom on thresholded HDR
  highlights only, light shafts at low sun (quarter resolution radial blur from the sky
  mask), height fog with aerial perspective tied to the sky's horizon color, heat shimmer on
  the desert course by day, dew glints on grass at dawn and morning, depth of field wired for
  replay and flyover cameras.
- `render/water.js`: a physically based surface on MeshStandardMaterial (sun specular, Fresnel
  sky reflection from the environment, cascaded shadows) with Beer-Lambert depth color from
  the real ground height under each vertex, three wind-driven normal layers, a foam line at
  the bank, and surf bands on the sea. Pond meshes follow the actual shoreline.
- Auto exposure is a closed loop on measured display luma (like a camera meter).
- Evidence:
  - Luma and clipping, enforced in the gate since this stage (`qa/smoke.json`): all 24
    course, preset, and orientation combinations are inside their bands. Day presets measured
    148.9 to 150.9 against the 140 to 160 band with at most 0.48 percent clipped pixels; night
    measured 61.8 to 62.4 against its 50 to 76 band.
  - A mirror-probe measurement in the gate confirms the HDRI lighting is rotated to the sun:
    azimuth error -0.1 degrees (morning), -0.1 (midday), 1.1 (dawn); 5.6 at golden hour and
    -0.9 at dusk, where the HDRI sun is behind cloud.
  - Screenshots of every preset were reviewed while tuning (`scripts/tools/shot.mjs`).
- Defects the enforced gate caught and that were fixed: dusk clipped about 3 percent of
  pixels; the exposure controller gave up on a near-black frame, so switching from midday to
  night left a black screen (this would have hit the live game too).
- Honest limits:
  - The HDRI sun elevation only matches as closely as each photograph allows: 13 degrees
    lower than the game sun at midday. The night HDRI's brightest region is a horizon glow,
    not a high moon, so night ambient light does not come from the moon's direction.
  - Meeting a 140 to 160 mean luma at dusk and dawn means those presets are brighter than a
    physically exposed photograph would be. They carry the mood through color, not darkness.
  - Clouds are a single lit layer, not volumetric. Water has no planar reflection of trees.
  - Light shafts, GTAO, and depth of field ran without errors on the high tier in headless
    Chrome, but how they look on a real GPU at full resolution has not been judged.

## Stage 5: vegetation and props

- `render/vegetation.js`: GPU-instanced trees from the downloaded models with per-instance
  scale, rotation, and tint, wind sway in the vertex shader from the game wind vector, two
  mesh LODs plus a billboard impostor baked at load from the same model (four views), and
  per-instance frustum culling on the CPU. Placement is deterministic per hole from the
  terrain's tree density field, so tree lines follow the corridor. Species come in stands.
  A ring of impostor-only forest continues over the outer landscape so the woods do not stop
  at the edge of the mapped ground. Understory (shrubs, ferns), ground cover (tall grass
  clumps, wildflowers in drifts), reeds at the water's edge, and rocks use the same system.
- Tree shadows are cast by two crossed alpha-tested cards per tree textured from the baked
  impostor. Drawing each tree mesh into every shadow cascade had tripled the triangle count.
- Foliage shading: softened normals, back-lit translucency, and reduced specular, so leaves do
  not go black on the shaded side.
- `render/grass.js`: near-camera instanced blades in a square that wraps around the camera.
  Each blade is placed on the GPU from the terrain height texture, sized by the surface masks
  (none on greens, sand, or paths; short on fairway; tall in deep rough), colored from the
  ground beneath it, lit with the ground's up-facing normal, and bent by the wind.
  Checked in screenshots at address and in the rough on all three courses: it reads as grass
  (the links fescue especially), not spikes. Blade density is about 60 per square meter on the
  high tier, which is still sparse next to real turf.
- `render/proceduralPlants.js`: palms, a columnar cactus, and reeds built in code, because
  neither source has CC0 models of them.
- `render/props.js`: tee markers, a hole sign with live text, a bench, ball washer and bin,
  yardage posts, sprinkler heads, footbridges where the path crosses a stream, a clubhouse
  with out-buildings on the opening and closing holes, grandstands with an instanced crowd
  that bobs when it cheers on tournament holes, distant flags, and a flock of birds. Static
  pieces are merged into one vertex-colored mesh.
- Budgets per tier and measured `renderer.info` on parkland hole 1 at midday, before and
  after vegetation, grass, and props (`npm run perf`, `qa/perf.json`). Counts include shadow
  and post passes.

  | Tier | Budget (draws / triangles) | Before | After | Within budget |
  | --- | --- | --- | --- | --- |
  | low | 140 / 220k | 26 / 33k | 59 / 214k | yes |
  | medium | 220 / 500k | 36 / 62k | 78 / 421k | yes |
  | high | 320 / 1,100k | 41 / 66k | 106 / 928k | yes |
  | ultra | 420 / 2,000k | 44 / 91k | 111 / 1,592k | yes |

- Defects found by measurement and fixed: a bright patch on the ground under a low sun turned
  out to be three things added together (screen-space light shafts over near ground, sun-side
  haze applied at close range, and the grazing-angle highlight on grass), each isolated by
  switching one term off and reading back the same pixels; the HDRI's own sun disc is now
  clamped in the asset pipeline because the game's sun already supplies it; a mesa slab that
  floated over the desert fairway was the outer landscape overlapping the play area.
- Verify: 185 tests, build, and smoke all pass; 24 of 24 combinations inside the luma bands.
- Honest limits: trees are young scanned specimens scaled up, so canopies are thinner than a
  mature course's; LOD1 is visibly sparser than LOD0 and the switch to impostors is a pop,
  not a blend; props are simple procedural shapes; the crowd is flat cards; cart path edges
  have no curbs; low tier sits within 3 percent of its triangle budget on parkland.

## Stage 6: ball, flight, cameras

- `render/ballView.js`: a PBR ball with a procedural dimple normal map, a contact shadow that
  softens with height, an optional spin stripe (Settings, Show ball spin), impact debris per
  surface (turf, sand, water spray), and a camera-facing tracer that thins with distance,
  with apex and landing markers.
- `render/decals.js`: divots on turf shots with irons, pitch marks on greens, sand craters,
  and raked footprints in bunkers. They persist per hole for the round.
- `render/cameras.js`: address (a lower, closer framing for putts), a six second flyover of
  each new hole, ball follow (offset to the side so the arc of the tracer reads), a camera
  waiting at the landing area for long shots, a green camera for putts, free look, impact
  shake, and replay angles (follow, landing, side, high). Reduced motion turns off the
  flyover, the landing cut, and shake; it follows the setting or the operating system.
- `render/overlays.js`: an aim line that starts a few meters ahead of the ball and widens
  with distance, a landing ring sized from the expected dispersion for this club, lie, wind,
  and shot type, which turns amber over water, sand, or out of bounds (the HUD names the
  hazard); on the green, a slope grid colored by steepness with a colorblind-safe ramp per
  palette, downhill arrows that pulse toward the low side (direction does not depend on
  color), all lines and arrows merged into one mesh, faded near the camera so it never
  fills the screen; and the predicted roll for the current aim and pace.
- `game/controller.js`: the round state machine (intro, aim, flight, settle, summary,
  replay) driving the world, rig, ball, and overlays, emitting events for the UI and audio.
  The whole shot is simulated at the strike and played back, so the result, the replay, and
  a shared round are identical.
- `game/planner.js`: `solvePower` finds the power for the chosen target by bisection on the
  same prediction the overlay draws (with lie, wind, and shot type). It replaced a closed
  form that ignored lie loss and suggested a 6 percent swing for a bunker shot. The putt
  read is solved once per ball position, not on every aim change (it cost about 130 ms of
  CPU per drag event on the green).
- HUD (`ui/hud.js`), hole map with rangefinder (`ui/map.js`: drawn from the same terrain
  functions as the physics; tap anywhere to read distance from the ball, distance to the
  pin, and elevation, then "Aim here"), putt read (break and elevation), replay bar.
- Evidence (headless Chrome, real input events through the DevTools Input domain, the same
  path Playwright uses, with planned timestamps; see below):
  - Landscape, mouse, parkland hole 3: drag-to-aim moved the aim and the reset button put it
    back; the map rangefinder read "323 yd from ball, 113 yd to pin, up 1 ft"; the drive
    graded Perfect (tempo 3.37) and carried 257 yd, total 289; the 8 iron was flagged
    "Careful: bunker" before the swing and finished in that bunker.
  - Portrait, touch, parkland hole 4 (par 3): tee shot to the green, two putts, par. An
    earlier run (before the chip and putt fixes below) made bogey.
  - Contact sheets: `qa/proof/stage6/landscape-mouse-shots.jpg`,
    `portrait-touch-hole.jpg`, `putting-read.jpg`, `menus.jpg`.
- Why planned timestamps: SwiftShader blocks the page for hundreds of milliseconds per
  frame, so events paced in real time arrived 600 to 800 ms apart and a 0.8 s backswing
  was cancelled by the 6 s swing timeout. With planned timestamps the gesture saw the
  intended timing (a 780/260 ms swing graded at a 3.29 to 3.37 ratio).
- Design changes made because of play testing (recorded, with the tests that pin them
  updated or added):
  - Power floor 0.3 to 0.12 (`physics/shot.js`): a 13 m chip had needed under 6 percent of
    the stick, below the gesture's minimum. Full-power carries are unchanged (factor 1).
  - Chip launch 0.62 to 0.85 of full loft and chip spin 0.5 to 0.8; a base turf
    deformation loss on every landing (`ball.js`). Measured carry to roll on a green, power
    0.5: lob wedge 5.1 to 10.4 m total (was 4.1 to 22.8), sand wedge 6.0 to 14.0 (was 4.8 to
    30.2), pitching wedge 7.3 to 22.6, 8 iron 7.4 to 33.2. Full-shot rollout on fairway
    dropped about 2 to 3 yards (driver 14.8 to 12.3 yd), still inside the tested range.
  - AI execution errors widened. Before, AI skill 0.8 averaged 0.78 under par per hole
    (about 14 under for 18) and could not be beaten. Measured on parkland holes 1 to 6:
    skill 0.3 about +1.2 per hole, 0.5 about +0.6, 0.8 about -0.2.
- Tests: 208 plus new UI formatting and map transform tests; all pass.
- Replay, palettes, reduced motion (`scripts/tools/replay.mjs`, production build, added
  after the replay bar was built): the replay button entered the replay; Follow, Landing,
  Side, and High each switched the camera rig; Done returned to aiming. Three defects found
  and fixed from these frames: the side camera sat inside the tree line (it now picks the
  side and distance with the fewest trees and lifts over canopy), the club card stayed visible
  during replays, and changing the color palette rebuilt the putting grid hidden. With reduce
  motion on, a new round went straight to the shot with no flyover. Frames:
  `qa/proof/stage6/replay-angles-and-grid-palettes.jpg`.
- Not verified: feel on a real touch screen and real frame pacing; haptics (headless has no
  vibration); the bot's putt read by dragging overshoots (it applies the aim it reads back,
  so this is a driver accuracy issue, revisited in Stage 15).

## Stage 7: golfer

- Not shipped. The brief allowed evaluating the old project's Mixamo golfer only if present.
  The old repository was empty (see PLAN.md), so there is no golfer model to evaluate, and
  the brief says not to fake one. The game is ball-first: the camera frames the ball and the
  line. `settings.showGolfer` stays false and is not offered in the settings screen.
- What a human would need to do: supply a rigged, licensed golfer with a swing animation;
  the camera rig already has an address framing that would leave room for it.

## Stage 8: swing and controls

- `ui/swingStick.js`: the stick is a DOM view over the tested gesture logic. It docks to the
  bottom right, or the bottom left with "Swing stick on the left". Its travel scales with
  screen height (27 percent, 96 to 190 px) and the stick size setting, so a thumb reaches
  full power on a small phone. Coalesced pointer samples are fed in order. A green mark
  shows the power this shot needs (from `solvePower`), the knob and fill follow the thumb,
  and the result shows the tempo grade. Left-handed golfers get mirrored face and path
  (tested in `tests/gesture.test.js`).
- `ui/input.js`: drag on the course to aim, with pointer acceleration (slow drags are five
  times finer), the mouse wheel for fine aim, hold-to-repeat nudge buttons (0.25 degrees),
  "Aim here" from the map, free look, keyboard (arrows or WASD aim and club, Shift for 0.1
  degree steps, Space for a three-press meter, 1 to 4 shot type, M map, R replay, L look,
  C recenter, Escape back), and gamepad (A meter, B back, X map, Y replay, bumpers club,
  triggers shot type, d-pad and left stick aim, right stick look, Start pause). Haptics use
  `navigator.vibrate` and gamepad rumble when present. Every handler checks for finite
  input before it reaches the game; the game re-checks.
- First-run tutorial: three short steps (aim, backswing, strike) that advance on the real
  action, can be skipped, and can be shown again from Settings.
- Evidence (`scripts/tools/controls.mjs`, headless Chrome, 640x360):
  - Keyboard through the DevTools Input domain: Down changed Driver to 3 wood, Up twice
    returned to Driver (clamped), two Right presses turned the aim exactly 1.0 degree
    (0.0174 rad), 2 selected Punch, M opened the map, Escape closed it, and Space three
    times (0.8 s, then the strike as the marker returned) gave 73 percent power graded
    Perfect and launched the shot.
  - Gamepad: browser automation cannot emulate a controller, so the tool replaces
    `navigator.getGamepads` with a scripted pad. This proves the mapping, not real hardware:
    right and left bumpers changed club, the left stick turned the aim, X opened the map, B
    closed it, Start paused, B resumed, and three A presses gave 64 percent power, Perfect,
    and launched the shot. The meter reads the pad's own timestamps (`Gamepad.timestamp`).
  - Touch and mouse swings: see Stage 6 (portrait touch round, landscape mouse shots).
  - Screenshots: `qa/proof/stage8/`.
- Not verified: real controllers, real vibration, thumb reach on physical phones of
  different sizes, and how the stick feels at 120 Hz.

## Stage 9: game modes and career

- Modes: quick round (9 or 18 holes; stroke, match, skins, closest to the pin; optional
  computer rival), driving range, daily challenge, pass and play, challenge links (Stage 12),
  and a career. Rounds save after every hole and can be resumed from the main menu.
- `game/career.js` (pure functions): golfer creation, five attributes (50 is the neutral
  golfer and gives exactly the base physics profile, so the calibrated carry ladder is
  untouched for a new player), equipment with a gain and a cost on every non-standard item and
  unlocks by level, XP and levels with three attribute points per level, a season of nine
  events in three tiers (club series of 9 holes, regional and championship of 18) with
  qualification (top three, or any event winner, move up; a failed tier is replayed next
  season), eleven invented rivals with persistent skill, form, and wins, ranking points, and
  a seeded statistical model for the rest of the field.
- The rival model was fitted to the planner's own AI on real holes (parkland 1 to 6, three
  seeds per skill) and a test keeps them within 0.35 strokes per hole of each other.
- `game/save.js`: versioned save (v3) with step-by-step migrations from v1 and v2, validation
  of every field (a corrupt, future, or tampered save falls back cleanly), history of the last
  100 rounds, aggregate stats (scoring, putts, fairways, greens in regulation, birdies, longest
  drive), the daily challenge's best score and attempts per day, twelve achievements, and the
  resumable round.
- Tests: `tests/career.test.js` (16) and the round rules in `tests/game.test.js`.
- Browser evidence, the QA bot tapping real buttons on the production build
  (`qa/bot/career-landscape.json`): Career, Begin, Play event; nine holes of the Spring Medal
  at Saltmarrow Links against a computer rival who played visible turns (the rival shot 41,
  +5, including an 8 on a par 5); the bot shot 34 (-2) and won. The save afterwards showed
  level 2, 209 XP, 3 points to spend, the event result (1st of 8), the round in history, and
  four achievements (first round, birdie, under par, career win), and no round in progress.
- Difficulty note from the bots: a player who pulls exactly to the green power mark controls
  distance almost perfectly, so the bot scores under par. That suits a calm game; a "Power
  guide" setting now turns the mark off for a harder game.

## Stage 10: interface, settings, accessibility, audio

- Phone-first HUD (`ui/hud.js`, `ui/styles.css`): hole card, score pill, distance to the
  pin with elevation, wind arrow relative to the aim with a plain label (helping, into, left
  to right), map and pause buttons, hazard warning, shot result toasts, club card, shot-type
  segments, fine-aim row, putt read. Glass panels from CSS design tokens, system fonts, safe
  area insets, compact rules for short landscape screens and narrow portrait screens.
- Menus (`ui/screens.js`, `ui/menus.js`): main menu, quick-round setup with course cards,
  pause, scorecard, hole summary, round end, settings, stats and history with achievements,
  daily challenge, pass and play, career hub, attributes, equipment, standings, challenge
  links. Sheets scroll when taller than the screen (a centered sheet had cut off its top).
- Settings: name, golfer handedness, stick on the left, stick size, power guide, aim
  sensitivity, units (yards and feet or meters), graphics quality (automatic or a fixed tier,
  applied live), color vision palette for the green grid and warnings, reduce motion (also
  follows the operating system), ball spin display, vibration, master, effects, ambience,
  and music volumes. Verified through real controls: changing units to meters and the stick
  side updated the game and was persisted (`qa/proof/stage6/menus.jpg`).
- Accessibility, checked by `tests/a11y.test.js`: body text on the glass is at least 7:1 and
  secondary text at least 4.5:1 against the worst case (the glass over a pure white or pure
  black scene; the first check failed at 6.76:1 and the glass was made slightly more opaque);
  primary buttons are at least 7:1; every button style is at least 44 px tall (two were 38 and
  40). Every icon button has an `aria-label`; toasts and the putt read are live regions;
  focus is visible for keyboard users. The putting grid's slope direction is carried by
  moving pulses, not by color alone.
- Audio (`audio/audio.js`): every sound is generated (noise and oscillators), so no audio
  asset needed licensing. Ambience: wind that follows the hole's wind, birds by day,
  crickets at dusk and night, water when the camera is near it, a crowd murmur on tournament
  holes. Effects: strikes by club type, landings by surface, the cup, lip-outs, splashes, a
  swing whoosh, cheers. Optional generative music, off by default.
- Audio evidence: headless Chrome has no speakers, so each sound was rendered into an
  OfflineAudioContext and measured (`scripts/tools/menus.mjs`): driver peak 0.47 (RMS
  0.024), iron 0.51, putt 0.30, landing on the green 0.07, in sand 0.18, splash 0.41, cup
  0.25, whoosh 0.04; a silent control measured exactly 0. The live context reached the
  running state after a tap. Nothing about how it sounds was checked by ear.

## Stage 11: performance

Method: `npm run perf` on the production build, headless Chrome, SwiftShader, parkland hole 1
at midday, 640x360, a fresh browser context per run (no cache, no service worker). Draw calls
and triangles from `renderer.info`, CPU time per system from the game loop's own timers.
Frame time on a real GPU was not measured: SwiftShader rasterizes on the CPU inside the
render call, so its render time says nothing about a phone or a laptop GPU.

| Tier | Draw calls | Triangles | Budget | Texture MB (GPU) | Render targets MB | JavaScript per frame | SwiftShader render |
| --- | --- | --- | --- | --- | --- | --- | --- |
| low | 60 | 214k | 140 / 220k | 34 | 3 | 0.55 ms | 34 ms |
| medium | 79 | 421k | 220 / 500k | 34 | 7 | 0.57 ms | 58 ms |
| high | 107 | 928k | 320 / 1,100k | 114 | 14 | 0.86 ms | 110 ms |
| ultra | 112 | 1,592k | 420 / 2,000k | 114 | 14 | 0.77 ms | 209 ms |

"JavaScript per frame" is the game, camera, world (vegetation LOD, grass, water, sky, props),
UI, and audio systems together: under 1 ms on this machine at every tier, so the CPU side
leaves the whole frame budget to the GPU.

Download size (build output 42 MB after the change below):

| Tier | Bytes before the first frame, 20 Mbps link | First frame at | Everything for the hole |
| --- | --- | --- | --- |
| low | 5.6 MB (app 1.0, tree models 4.0, textures 0.6) | 4.0 s | 8.7 MB, settled at 8.9 s |
| high | 3.6 MB | 2.8 s | 18.5 MB, settled at 25.9 s |

The first frame needs the app and the trees' low-detail models; terrain textures, high-detail
tree models, and the HDRI stream in after it and cross-fade in. Other courses' assets load
only when that course is played. Target "first load under 10 MB": met on every tier. Target
"total shipped under 60 MB": met (about 43 MB).

- Change: the 2048 px fairway and green textures (8 MB) were shipped but no tier used them.
  At 1024 px they give about 465 texels per meter, about one texel per pixel at the closest
  putting camera on a 1080p screen, so 2048 was dropped from the asset catalog instead of
  adding a second texture array to the terrain shader.
- Change: the putt read is solved once per ball position (it had been solved on every aim
  change, about 130 ms each).
- Targets not verifiable here: 60 fps on a mid-range laptop at high and 30 fps on a phone at
  low. The counts above sit inside the per-tier budgets that were set for those targets, and
  the CPU side is under 1 ms, but only a real device can confirm the frame rate.

## Stage 12: multiplayer

- Challenge links (`game/share.js`): the round setup (course, holes, seed, time of day) and
  every player's scores, packed into the URL hash (never sent to a server). Wind, pins, and
  lies are seeded from the round, so everyone who opens the link plays the same conditions.
  Opening a link shows the standings and offers to play; at the end the player sends the
  merged scores back the same way (up to four players). A pasted link in an open tab also
  works (hash change).
- Validation: every field is checked (version, course, hole indices, seed, score range per
  hole par, number of players, duplicate names; markup is stripped from names), and a
  checksum catches damage and casual edits. It is not security: the checksum key ships with
  the game, so a determined player can forge a link. That is stated in the code and here.
- Tests: `tests/share.test.js` (round trip, edits detected, nine kinds of impossible content
  rejected, merging and standings).
- Browser evidence (`scripts/tools/menus.mjs`, `qa/proof/stage12/`): a valid link opened to the
  challenge screen ("Cinder Mesa, 3 holes, Golden hour", Sam 12 (E) through 3); a link with
  two characters changed, pasted into an open tab, showed "This link was changed or damaged,
  so its scores cannot be trusted."; Share this round from the pause menu produced a
  145-character link that opened in a new tab to the challenge screen. A bug found here: the
  link carried the sharer's own URL parameters, so it started a quick round instead; links are
  now built from the page address alone.
- Pass and play (`qa/bot/passplay-landscape.json`): set up through the real controls (three
  holes of skins, two players on one device). The game announced each player's turn, the
  bot played both, holes 1 and 2 were halved and carried, and Player 2 won all three skins
  on hole 3 with a birdie.
- Resume (`qa/bot/resume-portrait.json`): a quick round saved after hole 1; the page was
  reloaded; the menu offered "Resume round" first; the round continued at hole 2 and finished
  (33, -3); the save then held the round in history and no round in progress.
- Real-time play: not available. A static site has no server to relay live turns. Behind
  `?online` the main menu shows "Online play (experimental)", which explains this and points
  to challenge links and pass and play.

## Stage 13: PWA and iOS packaging

- `manifest.webmanifest` with procedural icons (including maskable ones), standalone display,
  theme colors; iOS meta tags in `index.html`.
- Service worker (`src/sw/sw-template.js`, written into `dist/sw.js` at build time with the
  exact list of files in that build): the app shell is precached on install; game assets are
  cached the first time they load, so a hole played once can be played offline; old shells
  and assets from an older asset build are dropped on activation. Every asset URL now carries
  the asset build's stamp (`?v=`), so the host can cache them as immutable. The worker is not
  registered in QA runs (`smoke`, `bot`) so those always measure a cold load.
- Evidence (`scripts/tools/offline.mjs`): after one online visit the worker was active and
  controlling the page with 10 shell files and 41 game assets cached. With the network cut,
  a reload booted, sent zero requests to the server, rendered the course with its HDRI
  lighting from the cache (luma 148.6, no clipping), and showed the main menu, with no
  console errors.
- iOS: `capacitor.config.json` and `IOS.md` (prerequisites, build and sync commands, Xcode
  settings, behavior inside the app, privacy answers, submission steps, and what to check on
  a real phone), and a 1024 px opaque App Store icon (`ios-assets/AppIcon-1024.png`). Not built:
  an iOS build needs a Mac with Xcode and an Apple Developer account, which this Linux
  machine does not have. Capacitor itself was not installed.

## Stage 14: hosting and deploy

- Static site, as required. `vercel.json`: immutable caching for `/assets/*` (hashed bundles
  and version-stamped game assets), revalidation for the HTML, manifest, and service worker,
  explicit types for `.glb` and `.hdr`, an SPA fallback that leaves missing assets as real
  404s, and basic security headers. `scripts/lib/serve.mjs` applies the same headers locally,
  so the smoke test, bot, offline test, and perf runs all exercise them.
- Vercel limits read from Vercel's documentation on 2026-11-17 (limits page last updated
  2026-09-16; Hobby and fair-use pages 2026-11-12): CLI uploads 100 MB on Hobby, 15,000 files
  per CLI deployment, no per-file limit stated, 45-minute builds, 100 GB fast data transfer as
  a fair-use guideline. This build is about 43 MB in about 170 files. Details in `DEPLOY.md`.
- Deployment: not done. `vercel --version` reported 65.17.0; `vercel whoami` reported
  "Logged out."; `vercel --prod` failed with "Error: No existing credentials found." (full
  output in `DEPLOY.md`). The CLI suggested `vercel deploy --temporary`, which publishes to a
  public URL outside your account; that was not used. `DEPLOY.md` has the exact commands,
  including why a Git-connected build would ship without the downloaded assets and how to
  avoid it. `npm run smoke` can be pointed at a live URL with `FAIRWAY_URL`.
- README written. No live URL exists to test.

## Stage 15: QA bot, contact sheets, realism review

### QA bot

`scripts/bot.mjs` plays complete rounds on the production build (`dist/`, served with the
`vercel.json` headers). Portrait runs (390x844) use touch, landscape runs (844x390) use the
mouse, both through the DevTools Input domain with planned timestamps. Every shot is a pull
and push on the swing stick: power from the green mark with a 3 percent random spread, tempo
between about 2.5 and 3.6, a small sideways drift; putts are read by dragging the aim (slow
drags get the fine gain) and finishing with the fine-aim buttons. The bot never calls a game
method to act. Low tier, render scale 0.6, game time running four times faster per frame
(`?timescale=4`) so a round fits in under an hour of software rendering. Reports are in
`qa/bot/*.json`, screenshots in `qa/bot/shots/`.

| Run | Input | Holes | Score | Shots | Putts | Putt reads within 0.25 deg | Perfect tempo | Stuck | Console errors | Guard errors | Minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alpine-landscape | mouse | 18 | 69 (-3) | 69 | 24 | 23/24 | 40 of 69 | 0 | 0 | 0 | 50.1 |
| alpine-portrait | touch | 18 | 65 (-7) | 65 | 28 | 23/28 | 40 of 65 | 0 | 0 | 0 | 71.8 |
| career-landscape | mouse | 9 | 34 (-2) | 34 | 13 | 13/13 | 13 of 34 | 0 | 0 | 0 | 15.4 |
| daily-portrait | touch | 3 | 14 (+3) | 14 | 6 | 5/6 | 6 of 14 | 0 | 0 | 0 | 14.8 |
| desert-landscape | mouse | 18 | 66 (-6) | 66 | 27 | 26/27 | 29 of 66 | 0 | 0 | 0 | 35.1 |
| desert-portrait | touch | 18 | 70 (-2) | 70 | 29 | 24/29 | 41 of 70 | 0 | 0 | 0 | 45 |
| links-landscape | mouse | 18 | 72 (E) | 72 | 31 | 30/31 | 34 of 72 | 0 | 0 | 0 | 42.3 |
| links-portrait | touch | 18 | 72 (E) | 72 | 30 | 24/30 | 51 of 72 | 0 | 0 | 0 | 48.5 |
| parkland-landscape | mouse | 18 | 65 (-7) | 65 | 27 | 26/27 | 31 of 65 | 0 | 0 | 0 | 57.5 |
| parkland-portrait | touch | 18 | 65 (-7) | 65 | 23 | 22/23 | 35 of 65 | 0 | 0 | 0 | 65.7 |
| passplay-landscape | mouse | 3 | 12 (-1) | 23 | 9 | 9/9 | 12 of 23 | 0 | 0 | 0 | 15.1 |
| resume-portrait | touch | 9 | 33 (-3) | 33 | 12 | 12/12 | 18 of 33 | 0 | 0 | 0 | 31.4 |
| tropical-landscape | mouse | 18 | 72 (E) | 72 | 26 | 26/26 | 35 of 72 | 0 | 0 | 0 | 49.2 |
| tropical-portrait | touch | 18 | 64 (-8) | 64 | 25 | 21/25 | 38 of 64 | 0 | 0 | 0 | 41.8 |

- Every course was played for a full 18 holes in both orientations: zero stuck states, zero
  console errors, zero guard errors in 14 runs and 784 shots.
- The bot finishes well under par on most courses because it pulls exactly to the power
  mark. Distance control is therefore easy for anyone who follows the mark; the Power guide
  setting turns it off. Real players' scores are unknown.
- Putt reads: the bot's own drag correction landed within 0.25 degrees of the solved line on
  most putts; the misses were drags that overshot and were not fully corrected (a limit of
  the bot, not the game).

### Contact sheets

`npm run contact` (`scripts/contact-sheet.mjs`): every course at every time-of-day preset
from the address view (medium tier), and close-ups of the green, a bunker, water, the tree
line, the rough, and the flyover at each of the four tiers, on hole 1 of each course. Sheets
are in `qa/contact/` (`<course>-times.jpg`, `<course>-closeups.jpg`); raw frames are not
committed. Where hole 1 has no water, that panel shows the nearest view instead.

Luma and clipping of the 3D view per course and preset (`qa/contact/luma.json`, medium tier;
bands: day 140 to 160 with at most 2 percent clipped, night 50 to 76):

| Course | Dawn | Morning | Midday | Golden | Dusk | Night |
| --- | --- | --- | --- | --- | --- | --- |
| parkland | 148.9, 0% | 150, 0% | 149.9, 0% | 149, 0.05% | 148.8, 0.01% | 61.8, 0.01% |
| links | 149.3, 0.02% | 150.3, 0.01% | 150.9, 0% | 149.3, 0.01% | 149.4, 0% | 62.2, 0.01% |
| desert | 149.4, 0% | 150.4, 0% | 150.5, 0% | 149.4, 0.11% | 149.5, 0.02% | 61.9, 0.01% |
| alpine | 149.6, 1.11% | 150.6, 0.18% | 150.5, 0% | 149.3, 1.3% | 149.4, 0.86% | 61.9, 0.45% |
| tropical | 149, 0% | 149.6, 0% | 149.7, 0% | 148.8, 0% | 149.1, 0.01% | 61.6, 0.01% |

All 30 inside their bands. Each cell is mean luma (0 to 255) and the percentage of clipped pixels. Alpine clips most (1.3 percent at golden hour: bright snow), still under the 2 percent limit.

### What is not realistic (most noticeable first)

From the contact sheets and the bot screenshots:

1. Bunkers: flat, evenly bright sand laid on the grass like a decal, on every course. No lip,
   no face, no shadowed edge, no depth; links pot bunkers in particular should be deep with
   steep revetted faces.
2. Vegetation: the scanned trees are young specimens scaled up, so canopies are thin and
   tree lines read as a uniform wall from the tee; the switch from mesh to impostor is a
   visible pop; the procedural palms, saguaros (a plain green tube), and reeds (plastic-looking
   spikes) are simple shapes.
3. Short grass: the fairway and green have no blades (blades grow only off the short grass),
   so at the putting camera the green looks like printed carpet, and the mowing checkerboard
   is far too strong on every course.
4. Water: tropical ponds read as pale, milky blue with a white rim; all water is a flat plane
   with normal maps, with no wet margins and no foam where the sea meets the links shore.
5. Props and people: tee markers are plain boxes; the clubhouse, benches, and signs are
   simple shapes; the crowd is flat cards; there is no golfer, caddie, cart, or rake.
6. Distant terrain: alpine mountain faces show vertical streaks where the texture stretches
   down steep slopes; dunes and mesas are smooth heightfield forms with no cliffs.
7. Night: exposure is lifted on purpose so the ball and flag stay legible (frame luma about
   62), which reads as a moonlit long exposure rather than real darkness. No lights anywhere.
8. Pale rocks along the parkland tree line read as grey blobs from the tee.
9. Sky: one procedural cloud layer, no volumetric clouds; the sky near the horizon is washed
   out at midday; dawn fog is heavy.
10. Ball physics simplifications: rigid bounce with a turf-softness term, no grain on the
    greens, no moisture, one green speed per course all day.
11. The low tier uses a single shadow cascade, so shadows are soft and short-ranged.
12. Sounds are synthesized and have not been heard by a person.

Also seen, not realism but QA tooling: the close-up camera used for contact sheets is placed
by script and can end up inside a plant (desert high-tier bunker, tropical ultra-tier water).
The game's own cameras were not seen doing this, apart from the replay side angle fixed in
Stage 6.

## Final report

### Stages

| Stage | What changed | Evidence | Commit |
| --- | --- | --- | --- |
| 0 Recon and plan | Old repository empty: everything written fresh. Plan, core math and physics with tests, `npm run verify` gate | PLAN.md; gate output | 581c957 |
| 1 Engine | Linear HDR pipeline, tiers, debug overlay, resize/DPR/orientation/context loss | smoke engine checks (context loss restored, tiers, orientation) | 44e2d01 |
| 2 Assets | Poly Haven and ambientCG pipeline, CC0 confirmed per asset, procedural fallback | ASSETS.md, license check | a8d6bb7 |
| 3 Terrain and courses | Heightfield and masks shared by renderer and physics; three flagship courses (later five) | 99.97 to 99.98 percent renderer and physics agreement | 23afafd |
| 4 Sky, light, atmosphere | Sky, clouds, six presets, cascaded shadows, AO, IBL aligned to the sun, fog, shafts, water, grade | enforced luma bands | 02dea8f |
| 5 Vegetation and props | Instanced trees with LODs and impostors, grass, props, per-tier budgets | renderer.info before and after, within budgets | f4a26c3 |
| 6 Ball, flight, cameras | Ball, tracer, decals, camera rig, replay, aim and putting overlays, controller, HUD, map | real-input runs, `qa/proof/stage6/` | 8e9ade0, 97f1661 |
| 7 Golfer | Not shipped: no model to evaluate, not faked | REPORT.md Stage 7 | 8e9ade0 |
| 8 Swing and controls | Stick, touch, mouse, keyboard, gamepad, haptics, tutorial | `scripts/tools/controls.mjs`, `qa/proof/stage8/` | 522667c |
| 9 Modes and career | Modes, career, versioned saves, stats, achievements | career, daily, pass-and-play bot runs; 16 career and save tests | f1644a6, 60b70c7 |
| 10 Interface and audio | Menus, settings, accessibility checks, procedural audio | `tests/a11y.test.js`, offline-rendered audio levels | 60b70c7 |
| 11 Performance | Measured per tier, first frame and settled bytes, dropped unused 2048 textures | `qa/perf.json`, `qa/perf-20mbps.json` | 60b70c7 |
| 12 Multiplayer | Challenge links, pass and play, resume; real-time behind a flag only | `tests/share.test.js`, bot runs, `qa/proof/stage12/` | aa552bc |
| 13 PWA and iOS | Service worker, offline play, Capacitor config, IOS.md | offline test (zero requests while offline) | f1644a6, 60b70c7 |
| 14 Hosting | vercel.json, limits checked, deploy attempted, DEPLOY.md, README | CLI output recorded | f1644a6, 60b70c7 |
| 15 QA | Bot rounds on every course in both orientations, contact sheets, realism review | `qa/bot/`, `qa/contact/` | final commit on the branch |

### Numbers

- Tests: 243 unit tests, all passing (`npm test`).
- Gate: `npm run verify` passes: tests, build, and the headless smoke over all five courses,
  six presets each, landscape and portrait (40 of 40 combinations inside the luma bands).
- Shipped: about 43 MB in `dist/` (42 MB of processed assets). First frame needs 3.6 to
  5.6 MB on a 20 Mbps link; one hole's full set is 8.7 MB (low) to 18.5 MB (high).
- Live URL: none. Not deployed (no Vercel login on this machine; see DEPLOY.md).

### Needs a human eye or a real device (most important first)

1. Frame rate and heat on real phones (low and medium tiers) and laptops (high). Only
   software rendering was measured; JavaScript per frame is under 1 ms, the rest is the GPU.
2. The swing stick under a real thumb: comfort, reach, and whether tempo grading feels fair
   at 60 and 120 Hz.
3. Rendering on real GPUs and browsers (iOS Safari, Android Chrome, desktop): shading
   precision, antialiasing, texture arrays, banding.
4. Difficulty and pacing with real players (the bots shoot between 8 under par and even par).
5. Sound, by ear: balance, loudness, and whether the synthesized strikes sound like golf.
6. Layout on notched phones and short landscape screens with real safe-area insets.
7. Haptics on Android (iOS Safari has no vibration API).
8. Real gamepads.
9. Installing as an app and playing offline on iOS and Android.
10. The deployed site's headers and caching once it is on Vercel.
11. Color-vision palettes with people who have those color vision types.

### Known gaps

- No golfer model (Stage 7). The camera is ball-first.
- Not deployed; iOS app not built (needs a Mac, Xcode, and an Apple Developer account).
- No real-time multiplayer (a static site has no server); challenge links are asynchronous.
- Challenge-link integrity is a checksum, not security.
- Saves live in the browser only; clearing site data deletes progress; no cloud sync.
- The AI aims to land short of the pin with part of the roll allowed for, while the
  player's power hint solves for where the ball stops; the AI was left on its calibrated
  method because the rival score model is fitted to it.
- Career rivals not on screen are scored by a statistical model, not simulated shot by shot.
- Ultra tier uses the same 1024 px terrain textures as high (2048 was dropped as unused).
- Contact-sheet close-ups use hole 1 of each course; courses whose hole 1 has no water repeat
  the nearest view in that panel.
- The bot's drag-based putt read sometimes overshoots by up to about 4 degrees.
- Real GPU frame rates, touch feel, haptics, and audio are unverified (see the list above).
- The realism gaps listed in Stage 15.

## Second brief: HUD, first-person club, controls, surfaces, deploy

All screenshots and measurements in this part were made with headless Chrome using SwiftShader
(software rendering). They are valid for what is on screen, for layout boxes, for exposure and
clipping, and for draw calls and triangles. Frame rate was not measured on a real GPU.

"Before" shots come from a separate copy of the code at 231aa31 (the end of the first brief),
built and shot with the same QA camera views as "after".

Work order note: the bunker, tree, and surface and grass work (this brief's Stages 4 and 5) was
already done and gated under the previous brief when this brief arrived, so it was committed
first (dc9a373, 4c0b448, 4fe3ba4). Stages 1, 2, 3, then 6, 7, 8 followed in order.

### Stage 0: find the code

- The project is this repository (`/home/user/Fairway`, remote `https://github.com/GBrodie6/Fairway`),
  branch `claude/fairway-next-golf-game-a7fzjc`, the only branch locally and on the remote. The
  Windows paths in the brief (`C:\Users\gb1\...`) do not exist: this is a Linux container, and
  no other `fairway-next` folder exists under the home directory or `/`.
- REPORT.md, PLAN.md and the realism list (REPORT.md, Stage 15) were read first.
- `npm install`: up to date, 66 packages audited; npm reports 5 high severity advisories in dev
  dependencies (not fixed: `npm audit fix --force` would change major versions).
- `npm run verify` before any change in this brief (at 4fe3ba4): 244 unit tests passed, build
  43.07 MB (45.16 million bytes), headless smoke 40 of 40 course and preset combinations inside the luma and clipping
  bands, renderer and physics agreement 99.97 to 99.98 percent.

### Stage 1: HUD layout, portrait first (e1c8d5f)

- Top left, three tabs flush to the left edge (rounded on the right only), each an icon and one
  value: the lie (it shows the live power percentage while the drag is in progress), the
  distance to the pin with the elevation adjustment in brackets (yards for full shots, inches
  on the green; uphill plays longer so it reads "+"), and the wind speed with an arrow relative
  to the shot plus a small time-of-day icon. The hazard warning and the putt break appear as
  chips under the tabs.
- Top right: hole number with par and yardage, beside a score box with the score to par and
  "1st shot", "2nd shot", and so on. Under it a position badge ("T2  Thru 3" in multi-player
  stroke play, the match or skins state in those modes, "Thru 3" solo), then a round map
  button, and the replay button when a replay exists.
- Right side, mid screen: a round look-around button. Holding it sends the camera up and
  forward over the hole toward the landing area; releasing it returns to the ball.
- Bottom row, left to right: settings (opens the pause and settings sheet), previous club, a
  large round club button with the club letter and carry, next club, and a round button that
  resets the aim to the target line. Tapping the club button opens a compact club list with
  carries and the shot type; swiping across it changes club.
- The old swing stick panel is gone. Its place is a swing zone between the ball and the
  bottom row (nothing else is placed there), marked by a chevron at the start line. The same
  gesture code and the three-press meter drive it.
- The address camera now sits low behind the ball and solves its pitch so the ball lands just
  above the swing zone, wherever the layout puts it.
- Safe-area insets on every edge piece; every control at least 48 px (enforced in
  tests/a11y.test.js); landscape moves the club controls to the bottom-left corner and keeps the
  same hierarchy; the left-handed layout mirrors the bottom row and moves the look button left.
- Original icons drawn for this game (src/ui/dom.js), the existing system font stack, and the
  existing green-charcoal glass palette. Nothing from any other game.
- Evidence: qa/proof/next-n1-hud/ (390x844, 360x640, 844x390, 1024x768, and left-handed in
  both orientations). scripts/tools/hud.mjs measured every HUD box, the ball, and the swing
  zone for overlap at all four sizes: none.
- Bugs found on the way and fixed: in landscape the look button covered the replay button
  (the layout now measures the panels and reserves room for buttons that come and go); and a
  relayout during a swing replaced the gesture mid-drag (the zone now defers layout until the
  swing ends).
- Verify: 247 tests, build 43.08 MB, smoke 40/40 in band.

### Stage 2: first-person club swing, no human figure (b5ebcc3)

- Only a club is drawn: no hands, arms, or body. It is built in code (src/render/clubModel.js):
  a tapered steel shaft, a ferrule, a grip with an end cap, and a head per kind. The driver and
  fairway woods are pear-shaped bodies with a flat lofted face and sole; the irons and wedges
  are blades with a rounded toe, a cavity-thick lower back, and grooves; the putter is a low
  mallet with a sight line. Each club has its own loft, lie angle, and length. The colors are
  original (satin steel, a deep green crown, a charcoal grip) and carry no marks. For
  readability on a phone the head is drawn 25 percent larger than life and the shaft and grip
  thicker.
- Path math (src/game/clubPath.js): the club turns about a pivot above and to the player's side
  of the ball, in a tilted plane that holds the shaft and the target line, plus a hinge at the
  grip. Progress 0 is address, 0.5 the top of a full backswing, 1 impact, 1.5 the finish. The
  backswing maps to the first half of the drag one to one (stopping holds the club); the
  downswing maps to the second half on a quarter sine, so for a steady drag the head is fastest
  at impact; a partial backswing enters the downswing at the point with the same angle.
- Impact: the frame after the drag crosses the start line shows the club at the ball and the
  ball still at rest (the shot is launched on that event, and the flight is held one frame);
  the existing impact particles fire on that frame. Then the club follows through to the target
  side over half a second while the address camera holds, and fades. The tempo grade shows
  briefly under the start line.
- Feel: a few degrees of extra shaft lag in the middle of the downswing (more when the head is
  fast), a short additive speed streak behind the head near impact, and soft contact shadows.
- Face and path: sideways drift during the upstroke turns the face and the swing plane live,
  using the same rules the gesture applies at impact, drawn at twice the true angle so it reads.
  The face angle on a small head was still too subtle at phone size, so a face line runs from
  the ball along where the face points during the second half of the downswing: orange when
  open, blue when closed (a colorblind-safe pair), white when square.
- Framing: the camera distance is solved per screen so the driver's top and finish stay on
  screen and clear of the HUD corner on the player's side (5.1 m at 390x844, 4.5 m at 844x390,
  6.2 m at 360x640).
- Aim fan: a wedge on the ground from the ball to the predicted landing, two standard
  deviations of the club, lie, and wind dispersion wide, tinted per vertex by the surface under
  it (short grass pale, rough straw, sand, water blue, out of bounds red), with brighter rims and
  a tick every 50 yards. When the shot is committed a clean launch line rises from the ball
  along the launch direction and fades.
- Tests (tests/clubPath.test.js, 12): head within 2 cm of the ball at impact with a square face
  for every club and both hands; open and closed faces turn the right way; an in-to-out path
  arrives from inside; head speed peaks within 3 percent of the impact frame (with and without
  lag); the top is above address; the finish is on the target side; the backswing is one to one;
  partial swings are continuous; progress maps as specified; the downswing at a 3:1 drag tempo
  runs about three times faster; the camera fit finds a distance at all four sizes and both
  hands. The swing, physics, career, and share-link tests all still pass.
- Evidence: qa/proof/next-n2-club/ (address, top, impact, follow-through in portrait and
  landscape through a real touch drag; closed, square, and open downswings and impacts; the fan
  on two courses; the putter). Overlap check at all four moments: none.
- Verify: 259 tests, build 43.13 MB, smoke 40/40 in band.

### Stage 3: controls (cd81d83)

- Drag on the course view (anywhere outside the swing zone and the controls) turns the aim;
  slow drags are fine adjustments, as before. Tap or swipe the club arrows or swipe across the
  club button to change club; tap the club button for the compact club list with carries and the
  shot type. Keyboard: arrows aim and change club, Shift for fine aim, Space for the three-press
  meter, 1 to 4 shot type, M map, B club list, R replay, L look, C aim reset, Escape back.
  Gamepad: A meter, B back, X map, Y replay, LB and RB club, LT and RT shot type, Select club
  list, d-pad and left stick aim, right stick look, Start pause.
- Left-handed layout: mirrors the bottom row (reset on the left, settings on the right, the
  outer arrow on the settings side is always "longer club"), moves the look button left, and
  mirrors the meaning of sideways drift in the swing drag. Choosing a left-handed golfer turns
  it on.
- Evidence (qa/proof/next-n3-controls/): real touch input on the production build at 390x844
  through scripts/tools/touch.mjs: the course drag turned the aim from 0.004 to 0.365 rad; the
  right arrow gave 3W and the left DR; a swipe gave 3W; the list opened with all 13 clubs and
  picked 7i; holding the look button set the camera to the look-around view and releasing
  returned it to address; the map opened and closed; aim reset returned to the target line; a
  right-handed swing with drift gave face +5, path +7 and the same drift in the left-handed
  layout gave -5, -7; the settings button sat to the right of reset and the look button on the
  left. Keyboard and gamepad results in keyboard-gamepad.txt (the gamepad is scripted, so it
  proves the mapping, not real hardware). Zero console errors.
- Bug found and fixed: the club list showed carries formatted from the yardage table as if it
  were meters (the driver read 273 yd against 250 on the button).
- Verify: 259 tests, build 43.13 MB, smoke 40/40 in band.

### Stage 4: bunkers and surfaces (dc9a373, 6d1ef42, 4fe3ba4)

- Bunkers are geometry now, carved into the one heightfield that the renderer and the physics
  share: a depressed bowl with a steep high face toward the green, a raised grassy lip with a
  sharp clean edge, an edge broken by noise (no saw teeth), raked sand with ridges and grain in
  the normal detail, a darker damp band at the base, a cut edge only where the face is steep,
  and sky-only cavity light with a warm bounce so the shade in a bowl is sand-colored, not blue.
  The interior distance is stored in the terrain's spare texture channel. Deeper bowls on links.
- Renderer and physics still agree on elevation: agreement 99.97 to 99.98 percent in every
  gate, and a new test checks bunker shape (floor below the surround, lip above it).
- Mowing: the checkerboard is now a subtle stripe along the line of play (a few percent of
  contrast). Greens get grain streaks and view-dependent grain shading; the fringe is a darker,
  coarser collar. Each hole carries a seeded layer of old filled divots and healed ball marks
  (plus the round's own divots and marks). The alpine backdrop no longer stretches its texture
  on steep faces (slope-sheared lookup, capped cell size per tier), and snow only settles on
  gentler slopes, which also brought the alpine dusk preset back under the 2 percent clipping
  limit (1.58 percent worst case in the gate).
- Evidence: qa/proof/next-s1-bunkers/ (all courses before and after; address, mid-distance and
  from above), and the surfaces contact sheets in Stage 7.

### Stage 5: trees and grass (4c0b448, 4fe3ba4)

- Tree lines: per-tree height factor and trunk and canopy variation, mixed species per course,
  clumps and clearings, specimen trees, a taller second forest layer behind, understory shrubs
  and fallen logs, fuller canopies; procedural palms with fuller fronds, saguaros with ribs and
  arms, reeds in clumps. Instancing and LOD kept.
- Draw calls and triangles per tier, before and after, measured at the address view (headless
  software rendering, qa/perf-trees-before.json and qa/perf-trees-after.json):

  | Course | Tier | Draw calls before | after | Triangles before | after |
  | --- | --- | --- | --- | --- | --- |
  | parkland | low | 60 | 70 | 214,194 | 177,459 |
  | parkland | medium | 79 | 95 | 421,481 | 420,173 |
  | parkland | high | 107 | 128 | 928,249 | 953,415 |
  | parkland | ultra | 112 | 142 | 1,591,540 | 1,580,442 |
  | tropical | low | 65 | 75 | 124,048 | 128,504 |
  | tropical | medium | 84 | 92 | 278,824 | 321,311 |
  | tropical | high | 92 | 106 | 482,194 | 543,855 |
  | tropical | ultra | 104 | 122 | 734,220 | 893,342 |

  All within the per-tier budgets. Only parkland (the densest broadleaf course) and tropical
  (the densest palm course) were measured.
- Grass: instanced blades around the camera, fading with distance, colored from the terrain
  under each blade, swaying with the wind vector; short grass (fairway, first cut, fringe, tee)
  now carries short blades too. Blades are lit with the ground's normal, so they cannot turn
  into dark spikes.
- Evidence (qa/proof/next-n45-grass/, 2879388): the portrait address view on all five courses
  through a real round, where the ground at the ball reads as fine turf with no spikes, and the
  close view at ball height on each course, where the blades read as grass (luma 145.6 to 148,
  no clipping). Tree-line before and after: qa/proof/next-s2-trees/.

### Stage 6: water and props (9543fab)

- The milky look and the white rim had two causes, both measured with a probe on the tropical
  pond: the shore surface was 85 percent specular (a mirror for the bright sky all round the
  pond), and pond water reflected the full sky at full strength, while a real pond mirrors its
  dark banks and trees. Fixes: the shore is now damp and dark (20 percent specular, rougher, and
  a wet-ground field from the terrain darkens the bank and the bed under shallow water); the
  water's depth colors are darker, with the shallow tone never paler than the bank; the water
  surface fades out over the last few centimeters of depth so the bank shows through (a soft
  shoreline); foam is a thin broken line at the bank (more on the sea); pond reflections are
  at 62 percent and darkened toward foliage where they point near the horizon, while the sea
  keeps its horizon. Fresnel comes from the standard physically based material, and the ripples
  are the existing three scrolling normal layers that travel with the game wind.
- Props: the box tee markers are replaced by ball-shaped markers on short spikes; square white
  yardage stakes with colored tops at the fairway edge; concrete edging along both sides of the
  cart paths; a bench and a direction sign by each green on the path side (in addition to the
  hole sign, bench, ball washer, and sprinkler heads already at the tees and in the fairways).
- Evidence (qa/proof/next-n6-water-props/): water and tee views on all five courses, before and
  after, from the same QA cameras. Close-up QA views are measured with a short exposure settle
  and are not part of the luma gate; three of them clip 2.4 to 2.6 percent (bright sky in a
  low view on alpine and tropical), while every gate view stays under 2 percent.

### Stage 8: deploy and link (05524ad, 756496a, 60bf98d)

- Hard requirement met: a static site with no server. Size against the limits: 45.2 MB in 167
  files, largest 1.7 MB (GitHub Pages: 1 GB site, 100 MB per file; Vercel Hobby: 100 MB CLI
  upload, 15,000 files). Heavy textures, models, and the full skies already stream in after
  first paint, so no change was needed.
- Route A, Vercel: failed. No `VERCEL_TOKEN` in the environment; `vercel --version` 65.17.0;
  `vercel whoami` "Logged out."; `vercel --prod` "Error: No existing credentials found." The
  anonymous `--temporary` mode was not used.
- Route B, GitHub Pages: worked. The `gh` CLI is restricted to search in this environment, but
  the git remote is pushable. The build (relative base path, so it works under `/Fairway/`) was
  pushed with `.nojekyll` to a new `gh-pages` branch; GitHub enabled Pages from it on its own
  (the repository is public, so no paid plan was involved), and the site answered about 30
  seconds later at https://gbrodie6.github.io/Fairway/.
- Route C: not needed, and there are no Netlify or Cloudflare tokens in the environment anyway.
- The processed CC0 assets are now in the repository (05524ad), so the one-tap Vercel import
  also builds the full game: a clean clone with `npm ci` and `npm run build` produced a `dist/`
  byte-identical to the verified build.
- Live checks in headless Chrome at 390x844 (touch) and 1366x768: zero console errors, every
  request over HTTPS (201 and 202 requests, none failed), HTTP redirects to HTTPS with HSTS,
  8.5 MB loaded to the settled main menu on a cold cache, the service worker active with scope
  `/Fairway/` and controlling the page after a reload, and Chrome's own installability check
  (in a normal profile) reporting no errors. GitHub Pages sends `cache-control: max-age=600` on
  everything and allows no custom headers, so the immutable caching in `vercel.json` only
  applies on Vercel; the service worker covers repeat visits.
- The live tap-through found a real bug: during the hole flyover the HUD is invisible but its
  buttons still took taps, and the "Skip flyover" button sat exactly over the round club
  button. A tap on Skip could open the club list, which then covered the swing zone, so no
  swing could start (the bot made 30 attempts on the first tee). Fixed: a hidden HUD takes no
  taps, and Skip moved to the top center where no HUD control lives. The QA driver also closes
  an open club list before a swing, as a player would.

### Stage 7: proof

- Swing moments: address, top of backswing, impact, and follow-through on every course in
  portrait (390x844) and landscape (844x390), reached with a real touch drag on the production
  build (qa/proof/next-n7-proof/swing-moments-every-course-*.jpg). For impact the game clock is
  slowed so the frame right after the crossing can be captured; the club reads p = 1.004 to
  1.006 there (1 is exactly at the ball).
- Layout: 56 checks (every course in both orientations at four moments, parkland at 360x640 and
  1024x768 at four moments, and the left-handed layout in both orientations at four moments).
  HUD controls, the ball, the swing zone, the aim fan (as its real wedge, not its bounding box),
  and the club (head corners and points along the shaft) were tested for overlap, off-screen
  parts, and tap targets under 48 px: 0 issues (qa/proof/next-n7-proof/layout-checks.txt).
- Contact sheets (qa/proof/next-n7-proof/contact/): every course at every time of day from the
  address view, and close-ups of the tee view, green, bunker, water, tree line, rough, and the
  flyover at the medium tier, before (231aa31) and after (9543fab), side by side. Luma and
  clipping of the 3D view, measured after the preset's lighting has settled: day presets 148.7
  to 151.0 with at most 1.51 percent clipped (band 140 to 160, at most 2 percent), night 61.5 to
  62.3 (band 50 to 76); 30 of 30 inside the bands after, and 30 of 30 before. The gate's own
  smoke run (which measures straight after switching presets, the harder case) was 40 of 40 at
  every stage, worst clipping 1.58 percent. Holes without water show the nearest view in the
  water panel, labeled as such.
- Grass at address on every course and the close grass view: Stage 5 evidence above.

### What is still not realistic (most noticeable first)

From the new contact sheets, the close-ups, the swing moments, and the live tap-throughs:

1. No golfer, by design: only a floating club is drawn, larger and thicker than life so it
   reads on a phone, with its face and path angles drawn at twice their true size and a colored
   face line. It reads clearly but is a game aid, not a picture of a real swing.
2. Distant terrain: the alpine peaks no longer streak, but they are sharp low-poly spikes with
   flat shading; dunes, mesas, and hills are smooth heightfield forms with no cliffs or erosion.
3. Bunker edges at very close range: the 1 m heightfield grid shows as a zigzag along a steep
   wall when the camera is within a few meters (seen on parkland at ball height). From the
   address view and the mid-distance they read well.
4. Trees: canopies are alpha-cut cards, so edges against the sky look speckled; the impostor
   swap at distance is still a visible change; some boulders behind the parkland tree line seem
   to float.
5. Crowd stands and some props are simple shapes (the grandstand behind the parkland bunker
   reads as white blocks); no carts, rakes, or people.
6. Water: still a plane with scrolling normal maps; the reflection is the sky map darkened near
   the horizon, so it never shows the actual trees or banks; no refraction of the bed beyond a
   tint.
7. The aim fan's far end steps along bumpy ground (links), because it is laid on the terrain in
   48 rows that are packed near the ball.
8. Night: exposure is lifted on purpose so the ball and flag stay readable (frame luma about
   62), a moonlit long-exposure look rather than real darkness.
9. Sky: one procedural cloud layer, a washed horizon at midday, heavy dawn fog.
10. At the low address camera the ball is small on a phone (about 5 to 8 px at 390x844) and the
    short grass blades on a tee are too short to see from there; the ground reads as fine turf
    rather than individual blades.
11. Physics simplifications are unchanged (rigid bounce with a turf term, no green grain,
    one green speed per course); not touched by this brief.
12. Sounds are synthesized and have not been heard by a person.


## Final report (second brief)

### Stages

| Stage | What changed | Evidence | Commit | Tests | Build |
| --- | --- | --- | --- | --- | --- |
| 0 Find the code | Nothing changed. Repository, branch, and remote confirmed; reports read; baseline gate run | `npm run verify` at 4fe3ba4: 244 tests, smoke 40/40 | 4fe3ba4 (baseline) | 244 | 43.07 MB |
| 1 HUD layout | Left tabs (lie or live power, distance with adjustment, wind with time of day), hole and score panel, position badge, map, hold-to-look, bottom row (settings, arrows, club button, aim reset), swing zone with chevron, address camera framing | qa/proof/next-n1-hud/; overlap check at four sizes | e1c8d5f | 247 | 43.08 MB |
| 2 First-person club | Procedural clubs per type, arc about a pivot keyframed 0 to 1.5, impact on the crossing frame, follow-through, lag, streak, face and path, face line, aim fan, launch line, tempo label | qa/proof/next-n2-club/; 12 club path tests | b5ebcc3 | 259 | 43.13 MB |
| 3 Controls | Course drag aims, arrows and swipe, club list (B, Select), keyboard and gamepad, left-handed mirror of the bottom row and the drag | qa/proof/next-n3-controls/ (real touch and key events) | cd81d83 | 259 | 43.13 MB |
| 4 Bunkers and surfaces | Carved bunkers with lips, faces, raked and damp sand; subtle line-of-play mowing, green grain, fringe, divots and ball marks; alpine backdrop without streaks | qa/proof/next-s1-bunkers/, contact sheets | dc9a373, 6d1ef42, 4fe3ba4 | 244 | 43.06 to 43.07 MB |
| 5 Trees and grass | Varied, mixed, layered tree lines with understory and logs; better palms, saguaros, reeds; blades on short grass | qa/proof/next-s2-trees/, qa/proof/next-n45-grass/, per-tier draws and triangles | 4c0b448, 4fe3ba4, 2879388 | 244 | 43.07 MB |
| 6 Water and props | Depth color, soft shore, foam, damp banks, darker pond reflections; ball tee markers, stakes, path edging, bench and sign by the green | qa/proof/next-n6-water-props/ | 9543fab | 259 | 43.13 MB |
| 7 Proof | Swing moments on every course in both orientations, 56 layout checks, before and after contact sheets and close-ups, realism list | qa/proof/next-n7-proof/ | 64abdff and the commit that adds this report | 259 | 43.13 MB |
| 8 Deploy | Route A failed (no Vercel credentials), Route B GitHub Pages live, assets committed for a one-tap Vercel import, live checks and tap-throughs, one bug found live and fixed | DEPLOY.md, qa/proof/next-n8-live/ | 05524ad, 756496a, 60bf98d; site on `gh-pages` 5465571 | 259 | 43.13 MB |

Asset size: the shipped build is 45.2 million bytes (43.13 MB) in 167 files; the processed CC0
assets in `public/assets/` are 43.9 million bytes in 153 files (largest 1.7 MB), all listed with
source and license in ASSETS.md. Nothing new was downloaded in this brief: the clubs, the fan, the
props, and the icons are drawn in code. No human figure, likeness, or third-party art.

Headless rendering here is software (SwiftShader). Every screenshot and measurement above is
valid for layout, exposure, clipping, draw calls, and triangles; none of it is a frame rate on
a real GPU, which was not measured.

### Needs a human eye or a real device (most important first)

1. Frame rate, heat, and battery on real phones and laptops, especially with the club, the fan,
   and grass blades on the short grass added. Only software rendering was measured.
2. The swing drag under a real thumb: whether starting at the chevron is natural, whether the
   full drag length (up to 190 px on tall phones) is comfortable, whether the club feels one to
   one with the thumb, and tempo grading at 60 and 120 Hz.
3. How the floating club reads at real phone resolution and pixel density (QA shots ran at a
   reduced render scale), and whether the doubled face and path angles and the face line feel
   right or too strong.
4. Notched and Dynamic Island phones with real safe-area insets, and landscape with a home
   indicator: the layout uses the insets, but every check here ran with insets of zero.
5. Installing from https://gbrodie6.github.io/Fairway/ on iOS Safari and Android Chrome and
   playing offline (Chrome's installability check passed headless; a real install was not done).
6. Real GPU differences: transparent water and its soft shore, the additive speed streak, the
   fan's blending over grass, shadows, antialiasing.
7. Left-handed players trying the mirrored layout and drag.
8. Sound by ear, haptics on Android, real gamepads (only a scripted pad was used).
9. Color-vision checks of the fan tints and the orange and blue face line.
10. Whether the 10 minute cache on GitHub Pages matters in practice (repeat visits are served
    by the service worker); on Vercel the long caching in `vercel.json` would apply instead.

## Final report (third brief: accounts, swing, carry rule, ball control, shot types, pros, real courses, community holes)

### Parts

| Part | What changed | Evidence | Commit | Tests | `npm run verify` |
| --- | --- | --- | --- | --- | --- |
| Carry rule | A Pured strike carries the club's table carry at that power for every tier; the guide's mark is exact. Rarity changes only the sweet spot and the difficulty (risk and control). The old carry perk became "Clean speed" (profile power) | `qa/balance.md`, `qa/balance-tiers.md` (tables below) | ea53db4 | 364 | pass |
| Accounts | Username and password, no email; a robot-check picture at sign-up; the shared project's `fairway_` tables; Delete my data | `qa/proof/accounts/`, live in `qa/proof/live-d88848a/` | 174c241 | 375 | pass |
| Better swing | Spring-smoothed club, eased motion, trail, docked stick, hit-stop and camera punch at impact; swing math unchanged | `qa/proof/swing-feel/` (backswing stutter 28 of 66 frames before, 2 after) | d88848a | 383 | pass |
| Deploy (brief B) | GitHub Pages; accounts checked live end to end | `qa/proof/live-d88848a/` | 67796d7 (site 80f653b) | 383 | pass |
| Ball contact control | A pad for draw, fade, backspin and topspin with a carry guard (never longer than neutral); range by tier, archetype and perk | `qa/proof/spin-shots/`; draw 179.9, fade 179.7, stinger 168.1 yd carry with a 5-iron (local) | 333299f | 400 | pass |
| Shot types | Ten shot types as data (normal, stinger, knockdown, punch, high, flop, pitch, chip, bump and run, bunker splash) with club and lie rules, unlocks and AI use | same | 333299f | 400 | pass |
| Twelve original pros | Invented names, emblems and archetypes; Play as, rival, Tournament field, Campaign mentor | `qa/proof/pros/`, `qa/balance-pros.md` (every pro within 1.5 strokes of the pros' average) | 82096c1 | not run on its own; 409 at cd4fbae | covered by the cd4fbae and a4fbc48 runs |
| Augusta National and St Andrews | Procedural approximations on the official cards (7,565 and 7,313 yards), looks, conditions | `qa/proof/real-courses/` | cd4fbae | 409 | failed: smoke clipped 2.6 percent on Augusta at golden hour and dusk |
| Augusta clipping fix | Pines a little further back and shorter, turf a touch lighter (look only): golden 1.14, dusk 1.63 percent | the a4fbc48 smoke | e64571a | 409 committed | covered by the a4fbc48 run |
| Community holes | Create tile, templates, top-down editor, test play, publish, New, Top and Mine, likes, plays, reports, share links, best scores, drafts, offline publish; strict versioned format with a fuzz test | `qa/proof/levels/` (both sizes), `qa/proof/levels-live-api/` | ab5da59 | 424 | unit tests and build passed; smoke stopped when the next fix landed |
| Board name fix | Best scores on `lvl:<id>` (the server allows 40 characters; found against the real project) | `qa/proof/levels-live-api/` | a4fbc48 | 424 | pass (56 of 56 smoke rows in band) |
| Deploy and live check | Route A (Vercel) unavailable; GitHub Pages; live checks below | `qa/proof/live-a4fbc48/`, DEPLOY.md | site 3025a4b | 424 | deployed build is the one verify passed |

Live on https://gbrodie6.github.io/Fairway/ at 390x844 with the throwaway account fwlv988645:
a draw carried 180.2 yd, a fade 182.4 yd and a stinger 168.1 yd (5-iron, all Pured). A hole
made from the short par 3 template was test played (holed in 2), published, found in New,
liked, played from its share link (best score shown), deleted, and then Delete my data removed
the account. Zero console errors in that run and in the clean loads.

### Balance (simulated golfer, strokes per 18 against Common, 3,000 rounds per cell)

| Tier | Poor swing | Average swing | Skilled swing |
| --- | --- | --- | --- |
| Uncommon | +0.31 | +0.02 (-0.09 to 0.12) | +0.02 |
| Rare | +0.69 | +0.29 | +0.06 |
| Epic | +1.12 | +0.53 | +0.10 |
| Legendary | +1.76 | +0.97 | +0.17 |

No tier beats Common for an average swing (every 95 percent interval reaches 0 or above).
Archetypes at levels 5, 15 and 30 are within 1.5 strokes of their level's average, and the 12
pros within 1.5 of the pros' average at both a tour swing and an average swing. Difficulty
settings with Common clubs: relaxed 6.33, standard 6.67, pro 7.48 over par per 18.

### Ease of the level creator

From the Create tile to a published hole, from a template, signed in: 11 taps at 390x844 and 10
at 844x390 in the demo runs, 10 on the live site, counting every swing, putt nudge, the flyover
skip and the first-run tip. Five of them are menu taps. The target was 25.

### Could not verify

Frame rate and feel on a real phone GPU (all rendering here is software); haptics; iOS Safari
and Android installs; a real offline publish on a phone (the offline path was exercised with
the browser's offline mode); two different people liking and reporting the same hole on the
live project (one account at a time was used, and five-report hiding was tested only against
the in-memory stand-in); Vercel (no credentials).

### Needs a human eye or a real phone (most important first)

1. The editor under real fingers: dragging small handles, the two-finger pinch, and how small
   pieces get on a long par 5 at phone size.
2. Moderation of community holes: names pass a profanity filter, but 400 trees can draw a
   picture or words on the map. Someone should decide whether that needs review or limits.
3. Using the real names Augusta National and St Andrews (Old Course) in a shipped game, and
   whether the approximations read as respectful.
4. The swing on a real phone at 60 and 120 Hz: the spring smoothing, the hit-stop and the
   camera punch.
5. The robot-check picture for people: I misread some digits at small size in earlier runs.
6. The ball contact pad and the ten shot types by feel: whether the carry costs and curves are
   readable and fair.
7. The twelve pros' names, emblems and bios: a check that none resembles a real golfer.
8. Augusta's pines after the clipping fix, at golden hour on a real screen.
9. Whether tiers above Common should feel riskier than they do for skilled players (+0.17 for
   Legendary is close to nothing).
10. The latent stream bug on the invented courses (documented in OVERHAUL.md), left for a human
    decision because fixing it adds hazards to existing holes.

https://gbrodie6.github.io/Fairway/

## Club tier benefits (fourth brief)

Higher club tiers now have three bounded benefits that never add carry (`src/data/tierBenefits.js`,
caps documented there): a crosswind moves the ball less (Legendary 20 percent, the cap; head and
tail winds act in full), rough, sand and bad lies cost less (Legendary 30 percent, the cap: the
lie's speed loss, its spin loss and the strike model's lie and slope terms), and the existing
wider spin and shape range (Legendary 2x). The cost stays: a smaller sweet spot and harsher
mishits, retuned to Legendary 0.80 and 3.2. A Pured strike from a good lie in calm air carries
the table carry with every tier; the existing carry tests are unchanged. The gear card and the
compare view show all three. Commit 5ec8117, 431 tests, `npm run verify` passed (56 of 56 smoke
rows), deployed to GitHub Pages (gh-pages ea5db3d; Vercel unavailable), checked live.

Legendary against Common, strokes per 18, 3,000 paired rounds per cell on all seven courses
(qa/balance-tiers.md):

| Swing | Calm fairway play | Normal | Wind and rough |
| --- | --- | --- | --- |
| Poor | +0.58 | +0.33 | +0.14 |
| Average | +0.21 | +0.21 | -0.01 |
| Skilled | +0.02 | -0.17 | -0.81 |

All three targets are met. On the 1,000-round subset in qa/balance.md the skilled wind-and-rough
value is -1.00, right at the edge of the target, so the true value sits in the upper part of
the range.

https://gbrodie6.github.io/Fairway/
