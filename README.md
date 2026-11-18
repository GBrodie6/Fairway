# Fairway Next

A calm, mobile-first golf game for the browser. One gesture per shot: drag down from the
chevron under the ball to take the club back, push up through the line to strike. Only the club
is drawn, never a golfer. Play it at https://gbrodie6.github.io/Fairway/. Five original courses (three flagship), six
times of day, a career, daily challenges, pass and play, and challenge links you can send to a
friend. Built with three.js and Vite; no server.

## Run it

```
npm ci
npm run dev        # http://127.0.0.1:5173
```

The processed CC0 assets are in the repository (`public/assets/`, listed in ASSETS.md).
`npm run assets` downloads and processes them again from their sources.

## Controls

| | Touch | Mouse | Keyboard | Gamepad |
| --- | --- | --- | --- | --- |
| Aim | drag across the course (slow drags are fine adjustments); reset button | drag, wheel | arrows or A/D, Shift for small steps; C resets | left stick, d-pad |
| Club | arrows or swipe on the club button; tap it for the club list | | up and down; B for the list | bumpers; Select for the list |
| Shot type | in the club list | | 1 to 4 | triggers |
| Swing | drag down from the chevron, push up through the line | same | Space three times (start, power, strike) | A three times |
| Look around | hold the eye button | | L | right stick |
| Map and rangefinder | map button, then tap the map | | M | X |
| Replay | replay button | | R | Y |
| Settings and pause | gear button | | Escape | Start |

The gold mark on the swing rail is the power this shot needs. A smooth tempo, about three
times slower back than through, flies straightest.

## Modes

Quick round (9 or 18 holes, stroke, match, skins, closest to the pin, optional computer
rival), career (club, regional, and championship tiers; rivals; attributes, equipment, XP),
daily challenge (three holes chosen by date, the same for everyone), driving range, pass and
play for up to four, and challenge links (scores travel inside the link; nothing is uploaded).
Rounds can be resumed after leaving mid-round.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build into `dist/` (static; includes the service worker) |
| `npm test` | unit tests (vitest) |
| `npm run smoke` | headless Chrome over every course and time of day on the production build: console errors, luma and clipping of the 3D view, renderer and physics agreement, context loss, tiers, orientation |
| `npm run verify` | tests, build, and smoke: the gate every stage had to pass |
| `npm run bot -- --course parkland --holes 18 --view portrait` | QA bot: plays a full round through real touch or mouse input |
| `npm run contact` | contact sheets of every course and time of day |
| `npm run perf` | renderer and CPU measurements per quality tier |
| `npm run assets` | asset download and processing, with license checks |
| `npm run icons` | procedural app icons |

## Layout

```
src/core      math, seeded random, guards, settings, quality tiers, game loop
src/physics   ball flight (drag and lift), bounce and roll, wind, clubs, shot launch, aim
src/course    course definitions, hole layout generator, heightfield terrain and surface masks
src/render    engine (linear HDR, post), terrain, sky, water, vegetation, grass, props, ball, cameras, overlays
src/game      round rules, scoring, planner and AI, controller, career, saves, share links
src/ui        HUD, swing zone, map, menus, input
src/audio     procedural Web Audio
scripts       asset pipeline, smoke, verify, bot, perf, contact sheets
tests         unit tests
qa            gate settings, proof images, bot reports, contact sheets
```

## Documents

- `PLAN.md`: the plan and the lessons carried into it.
- `REPORT.md`: what each stage changed, with evidence, and what is not verified.
- `ASSETS.md`: every external asset with source, URL, and license.
- `DEPLOY.md`: the live site (https://gbrodie6.github.io/Fairway/, GitHub Pages), a one-tap Vercel import, and what happened when deploying.
- `IOS.md`: packaging for the App Store with Capacitor (needs a Mac).

## Honest limits

Rendering was only ever checked in headless Chrome with a software rasterizer. Frame rates on
real GPUs and phones, touch feel, haptics, and audio through speakers have not been measured.
See the final section of `REPORT.md` for the full list.
