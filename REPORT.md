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
