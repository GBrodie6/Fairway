# Desktop: proof

Headless Chrome 153 (SwiftShader, so the frame rates here are not a real GPU's), the production
build, a mouse (no touch) driven through the Chrome DevTools input domain.

## Part 1: layout at desktop sizes

`node scripts/tools/desktop.mjs qa/proof/desktop/p1` (`p1.json`, `p1-*.jpg`) and
`node scripts/tools/hud.mjs` for the before and after HUD at address.

- Before (`p1-before-hud-*.jpg`): at 1920x1080 and above the HUD kept its phone size: small
  tabs and buttons pinned to the far corners, on the 3440x1440 ultrawide tiny and far from the
  ball; the level editor was a narrow phone column; the pro strip on Daily scrolled sideways
  (no sideways swipe on a mouse).
- After: in a desktop-sized window (1180x640 CSS pixels or more, landscape) each HUD group scales
  from its own corner with the window height (1.0 at 768, 1.2 at 1080, 1.6 at 1440 and above),
  times the Screen size setting (Small 0.85, Normal 1, Large 1.2). The menu cards zoom the same
  way (capped at 1.45) inside their existing width caps. On an ultrawide the HUD corners come in
  to a 1.9 to 1 frame around the centre (352 px in from each edge at 3440x1440). The editor is
  side by side on a desktop. The pro strip wraps. A fullscreen button sits under the map button
  (desktop only), and F toggles fullscreen anywhere; Settings has Screen size and Fullscreen.
- Checks, every one with no overlap between any HUD control, the ball, the swing zone, the aim
  fan (its real wedge) and the club, and nothing off screen:
  - 1366x768, 1920x1080, 2560x1440, 3440x1440 at address;
  - the window resized live during the round: 1920x1080, 1366x768, 2560x1440, 3440x1440,
    1280x720, back to 1920x1080 (no reload);
  - Screen size Small, Large and Normal, changed through the Settings screen during the round;
  - browser zoom 75 and 150 percent at 1366x768 and 1920x1080 (emulated as a browser does it:
    the CSS viewport divided by the zoom and a device pixel ratio equal to it). Zoom 150 at
    1366x768 gives a 911x512 CSS viewport, which is the phone landscape layout, as on any
    small window. Zooming out does not shrink the HUD below its 1080p size, so nothing becomes
    tiny; Screen size Small is the way to make it smaller.
  - the smallest HUD text: 11.7 CSS px at 768 tall (the phone sizes), 14 at 1080, 18.7 at 1440.
- Fullscreen: the button entered fullscreen, F left it, F entered it again.
- Phones and tablets unchanged: the HUD boxes and the swing zone from the last deployed build
  (5ec8117) and this one are identical to the pixel at 390x844, 844x390, 360x640 and 1024x768
  (`p1-phone-layout-before.json`, `p1-phone-layout-after.json`), and the fullscreen button does
  not show there.
- Console errors: 0.

## Part 2: mouse swing

`node scripts/tools/mouseswing.mjs qa/proof/desktop/p2 1920x1080` (`p2-1920x1080.json`,
`p2-1920x1080-*.jpg`), real mouse events with planned timestamps.

- Mouse mode: a fine primary pointer starts in it, and the pointer actually used switches it
  (a touch laptop moves between the two). Phones never see a mouse, so touch is unchanged.
- On a desktop-sized window the swing zone is a wide band (614x148 at 1920x1080) right under
  the ball, and a press anywhere in it starts the swing; the drag may run below it (the pointer
  is captured) and the band ends where a full backswing still fits in the window. The swing
  track rests beside the ball, away from the club (76 px right of it for a right-hander) and
  jumps beside the press point when the button goes down (press 1083,760, track 1119,760).
- Hover: the start line and chevron follow the cursor (the start point preview), the band shows
  faintly, the cursor is a grab hand; during the swing it is a closed hand (grabbing).
- The same gesture: drag down for the backswing, back up through the start line for impact. A
  real mouse swing at the power guide launched the ball.
- Polling rates: the same swing sent at 60, 144 and 240 Hz: power 0.6 at all three, tempo ratio
  3.05, 3.19 and 3.14 (all Perfect), path within 0.08 degrees. The swing math is unchanged; a
  refiner in front of it (`src/ui/mouseRefine.js`) adds two interpolated samples (the dead zone
  edge and the moment the drag leaves the top), which removes the bias a coarse mouse had (in
  the unit test the worst 60 Hz tempo error against a 1000 Hz mouse fell from 6.7 to under 5
  percent; power, face and path are exact). The track's fill follows through the same exact
  spring as the club, so it is smooth at any frame rate.
- The pointer leaving the window mid backswing: cancelled, still at address, no stroke taken,
  "Swing cancelled" shown. The window losing focus or the tab being hidden also cancels.
- Left-handed: the track sits left of the press point (853 against 899) and the swing works.
- Console errors: 0.
