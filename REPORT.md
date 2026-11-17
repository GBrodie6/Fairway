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
