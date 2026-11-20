# Swing box: proof

The default swing guide is now a box (Settings, Swing guide: Box or Classic track). Code:
`src/ui/swingBox.js` (geometry and states, pure), `src/ui/swingZone.js` (the view and the
pointer handling), `tests/swingBox.test.js`. The swing math, the gesture, power, tempo, face,
path, launch timing and every existing swing test are unchanged.

## How it was checked

`node scripts/tools/swingbox.mjs <prefix> <sizes> [extras]` on the production build, in headless
Chrome with software rendering, through the DevTools input domain: real touch events on
390x844, 844x390 and 360x640, real mouse events on 1366x768, 1920x1080 and 2560x1440. One swing
per size with planned timestamps (900 ms back, a short excursion outside the box at the top,
300 ms up through the start line), with a screenshot and the overlap check at five moments:
address, mid backswing, the top, the thumb outside the box, impact. The overlap check takes
every HUD box, the power number, the ball, the aim fan, the club and the swing area from the
game's own layout hook, as the earlier overlap tools do.

"Before" is the build that was live (3c0a275, the classic track), run the same way without the
box-only checks: `before-<size>-<n>-<moment>.jpg`. "After" is this build:
`after-<size>-<n>-<moment>.jpg`. `compare-<size>.jpg` puts the two rows side by side.

## Results

| size | input | after: problems | after: checks | before: problems | swing result (same input, before and after) |
| --- | --- | --- | --- | --- | --- |
| 390x844 | touch | 0 | 9 of 9 | 0 | power 0.9, Perfect, face 0, path 0 |
| 844x390 | touch | 0 | 8 of 8 | 0 | power 0.9, Perfect, face 0, path 0 |
| 360x640 | touch | 0 | 9 of 9 | 0 | power 0.9, Perfect, face 0, path 0 |
| 1366x768 | mouse | 0 | 8 of 8 | 0 | power 0.9, Perfect, face 0, path 0 |
| 1920x1080 | mouse | 0 | 8 of 8 | address: ball x swingArea, address: club x swingArea | power 0.9, Perfect, face 0, path 0 |
| 2560x1440 | mouse | 0 | 8 of 8 | address: ball x swingArea, address: club x swingArea | power 0.9, Perfect, face 0, path 0 |

Checks on the box build at every size (`after.json`): the outline lights when the thumb leaves the
box at the top and goes quiet when it comes back; the swing launches; a press outside the box
(18 px past its edge, at the start line) does not start a swing; more than 1.5 box widths outside
cancels the swing with no stroke ("Swing cancelled"); the left-handed layout mirrors the box (the
power number and the guide notch move to the other side) with no overlaps; Settings, Swing guide:
Classic track brings the old stick back with no box and no overlaps; and on the portrait phones the
first-run tutorial says "Press in the box and pull down", then "Swipe up through the ring" once the
backswing starts. 0 console errors at every size, before and after.

The existing overlap tools agree: `node scripts/tools/hud.mjs` at 390x844, 844x390 and 360x640
(address, the top, impact) found no overlaps, nothing off screen and no small targets, and
`node scripts/tools/deskproof.mjs` at 1366x768, 1920x1080 and 2560x1440 (the menu, address,
mid-swing, the spin pad, the shot selector, the scorecard, the level editor and the community
browser, through real mouse events) found 0 problems at each size with 0 console errors
(`overlap-phones-hud.json`, `overlap-desk-<size>.json`).

## Box size

The brief asked for the box's half-width to equal the drift at which the strike model starts to
penalize face and path. The gesture's own face dead zone is 2.5 percent of the drag length,
about 4 to 5 px, which would make a box under 10 px wide. The box uses the strike model instead:
the sideways drift at which a full swing with a perfect tempo first carries a mishit chance (the
strike model's free threshold, Standard setting, the hardest club to strike), computed from the
real gesture and strike functions: 16.8 px at the phone drag length (170 px) and 18.6 px at the
desktop drag length (190 px). Since that is narrower than a thumb, the box is never narrower
than a 44 px touch target, so at the default drag length the box is 44 px wide and its edge is 3
to 5 px past the threshold. With a longer drag (Swing drag length above about 1.2) the box grows
with the threshold.

## Overlaps found and fixed

1. At 1366x768 (desktop HUD scale 1) the club head's sole at address came to within 2 px of the
   swing box's top (the ball sat 18 px above it). On a desktop the ball now sits at least 24 px
   above the box (0abbf48); 0 problems at 1366x768 after.
2. In the build that was live, the wide mouse swing area reached the ball and the club head at
   address at 1920x1080 and 2560x1440 (the before rows above). The box and the 24 px gap clear
   both; 0 problems after.
3. Not an overlap, but found in the first after run: the power number stayed on screen for a
   moment after impact. It now shows only while a swing is under way.
4. The controller's swing hint used to sit inside the swing area; with the narrow box it is placed
   beside the box. This was not re-checked with the controller tool on this build.

No overlap with the ball, the aim fan, the club, the shot panel, the spin pad or the HUD remains at
any of the six sizes.
