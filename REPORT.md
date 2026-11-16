# Fairway Next: stage report

Running log, one section per stage: what changed, evidence, commit, test counts, asset size.
Evidence is always a test, a measurement, or a headless Chrome run. Headless Chrome uses
SwiftShader (software rendering), so frame times from it are not representative of a real GPU.

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
