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
