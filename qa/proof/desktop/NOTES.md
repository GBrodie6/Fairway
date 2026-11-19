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

## Part 3: keyboard and shortcuts

`node scripts/tools/keys.mjs qa/proof/desktop/p3 1920x1080` (`p3-1920x1080.json`,
`p3-1920x1080-*.jpg`), real key and mouse events through the browser: 29 of 29 checks pass.

- The Controls screen (Settings, the pause menu, or the ? key from anywhere) lists every
  shortcut in five groups: swing, club and shot, views and menus, the level editor, and a
  controller. ? opens it and closes it again.
- In a round: A and D aim (Shift for fine steps), the left and right arrows aim, W and S or the
  up and down arrows change club, Q and E change shot type (1 to 4 pick one), Shift and the
  arrows move the ball contact dot on the spin pad, Shift and R centre it, R aims back at the
  target, B opens the club list, Tab opens and closes the scorecard, M opens and closes the
  map, C looks around (and in a replay changes the angle), Z replays the last shot and ends the
  replay, Esc pauses, F is fullscreen.
- Space swings without the mouse: hold for the backswing, release at the top, press again for
  impact (the existing three-press meter). A Space swing at the guide launched with power 0.90,
  tempo Perfect.
- The level editor: the mouse wheel zooms about the cursor, the middle button or Space and drag
  pans (Space and drag moves no piece), 0 fits the hole again, Ctrl+Z and Ctrl+Y (or
  Ctrl+Shift+Z) undo and redo, Delete or Backspace removes the selected piece, 1 to 8 pick the
  palette tools (1 placed a bunker, 2 placed water).
- No shortcut fires while typing: letters, digits and ? typed into the editor's name field
  stayed in the field and changed nothing else.
- Tooltips: every icon button in the HUD and the map has a title naming its shortcut, and the
  editor tools show their number keys.
- Fixed along the way:
  - The editor's name field took focus when the editor opened, so number keys typed into it.
    On a desktop the map canvas now takes focus instead (phones keep the old behaviour).
  - After quitting a round to the menu, the HUD could stay drawn behind the menus (this was in
    the deployed build too). The HUD now hides whenever the game is in its menu phase.
- Console errors: 0.

## Part 4: desktop graphics and performance

`scripts/tools/graphics.mjs` in parts (PARTS=settings, fps, gpu, bench, overlay, vsync), on the
production build at 1920x1080, with real mouse and keyboard events on the Settings screen.
Headless Chrome here renders with SwiftShader (on the CPU), so its frame times are not a real
GPU's; see the benchmark below.

- Automatic tier: a desktop GPU (a dedicated card, Apple silicon, Intel Arc, a recent strong AMD
  integrated GPU, or Safari on a Mac, which only says "Apple GPU") starts on High or Ultra:
  with "NVIDIA GeForce RTX 3070" reported to the page, Automatic picked Ultra and the Settings
  label read "Automatic (Ultra)"; choosing High rebuilt the world on High
  (`p4-gpu-1920x1080.json`, `p4-gpu-1920x1080-3-desktop-gpu-settings.jpg`). This machine's
  software GPU still gets Low. Older integrated GPUs (Intel UHD and HD) keep Medium or Low.
- New Settings, Graphics section (`p4-1920x1080-1-settings-graphics.jpg`): the GPU name and the
  measured refresh rate, Graphics quality, Shadow quality (Match the graphics quality, Off, Low,
  Medium, High, Ultra), Resolution scale (50 to 100 percent), Frame rate cap (Uncapped, 144,
  120, 60, 30) and V-Sync (On, Off).
  - Shadow quality Off turned the shadow maps off; Ultra on the Low tier gave 4 cascades and
    left the rest Low.
  - Resolution scale with the keyboard: Home gave 50 percent and a 960 px wide drawing buffer
    in a 1920 window (`p4-1920x1080-2-scale-50.jpg`), End gave 100 percent and 1920 again.
  - V-Sync Off: kept, a toast says it applies after a reload, and after the reload the canvas is
    created with the low-latency (desynchronized) hint. Headless Chrome did not grant the hint
    (`getContextAttributes` reports false), so whether it lowers latency on a real monitor is
    unverified. Browsers draw at most once per display refresh either way, which the setting
    says.
- The frame loop and the display refresh rate: the loop runs on the browser's frame callbacks
  (once per refresh) and now measures the refresh rate (the median interval). The cap draws on
  the refresh nearest each due time, so a 60 cap on a 144 Hz display averages 60 (unit tests:
  every cap on 60, 120, 144, 165 and 240 Hz within 2 percent). In the browser, with drawing
  switched off for the measurement (software rendering draws this scene at about 7 frames a
  second, slower than any cap): uncapped 55 to 60, cap 60 gave 60.2, cap 30 gave 30.2, display
  59.9 Hz (`p4-fps-1920x1080.json`). The game advances by the real time between frames; the
  ball flight is computed in advance with its own fixed step and played back by time, and the
  swing reads the input events' timestamps, so neither changes with the refresh rate (unit
  tests: 10 s of play at 60 to 240 Hz with and without caps adds up to 10 s; a driver's flight
  at 30, 60, 144 and 240 Hz has the same events and the same rest point).
- Fixed: the ball tracer kept at most 420 points spaced 0.35 m or more, and the game offers one
  every frame, so above about 100 Hz a long drive's tracer stopped before the ball landed. It
  now keeps up to 1000 points at 0.5 m; a 10 percent longer than table drive reaches the landing
  at 30 to 360 Hz (unit test).
- ?debug overlay (`p4-overlay-1920x1080-5-debug-overlay.jpg`): frame time average, slowest 5 and
  1 percent, the measured refresh rate, the cap, V-Sync and scale, and a Run benchmark button.
  The benchmark (`?debug&bench` runs it on load) rebuilds the world on each tier, draws at
  1920x1080 and 2560x1440 whatever the window, times whole frames in batches each ending with a
  one-pixel read (so the GPU has finished), and keeps the result in the browser.
  Result on this machine (`p4-bench-1920x1080.json`, software rendering on 4 CPU cores, so
  seconds per frame; the order is right, the size is not a GPU's):

  | tier | 1080p ms per frame | 1440p ms per frame | triangles |
  | --- | --- | --- | --- |
  | Low | 7278 | 12300 | 244k |
  | Medium | 11672 | 18693 | 450k |
  | High | 17663 | 27855 | 957k |
  | Ultra | 21550 | 49664 | 1610k |

  Real GPU numbers need the button pressed on a real machine.
- Console errors: 0 in every part.

## Part 5: controller

No physical controller is attached to this machine. `node scripts/tools/pad.mjs
qa/proof/desktop/p5 1920x1080` injects a standard-mapping gamepad into the page
(`navigator.getGamepads` returns it, as Chrome does for a pad plugged in before the page
opened) and sets its buttons and sticks between frames: 18 of 18 checks pass
(`p5-1920x1080.json`, `p5-1920x1080-*.jpg`).

- Found without the connect event (a pad plugged in before the page opened), with a toast.
- Button hints while a controller is in use (`p5-1920x1080-1-hints.jpg`): a badge on each HUD
  button (X map, Y replay, Menu, View club list, LB and RB on the club arrows, swapped in the
  left-handed layout, L3 look, LT RT on the shot button), a line in the swing zone ("A hold, let
  go at the top, A again to hit") and a bar of hints at the foot of menus and the editor. The
  mouse or the keyboard hides them; the pad brings them back.
- In a round: the left stick and the d-pad aim (the d-pad in 0.25 degree steps, repeating when
  held), LB and RB and the d-pad up and down change club, LT and RT the shot type, the right
  stick moves the ball contact dot (up adds backspin) and R3 centres it
  (`p5-1920x1080-2-spin-dot.jpg`), X opens the map and B closes it, View opens the club list and
  the d-pad and A pick a club (`p5-1920x1080-4-club-list.jpg`), L3 looks around.
- The swing with A: hold for the backswing, release at the top, press again for impact, the same
  meter as Space. The check's swing launched the ball at power 0.90. On this software renderer
  a frame takes about a second, so the impact press was polled after the meter's own window
  closed and the meter's late strike hit it (tempo Late); with a frame every 16 ms the press
  lands in time (the keyboard check in Part 3 got Perfect on the same meter).
- Menus: Menu pauses with Resume focused (a new screen focuses its main action), the d-pad
  moves the focus with a clear ring (`p5-1920x1080-6-pause-menu.jpg`), A chooses, B goes back,
  left and right change a select or a slider (Screen size changed and changed back on the
  Settings screen, `p5-1920x1080-7-settings.jpg`), the right stick scrolls.
- The level editor: the d-pad and A use its buttons (A on Bunker placed one, X deleted it), LB
  and RB select the tee, the pin, the bends and the pieces, the left stick moves the selected
  piece and the whole move is one undo step, Y undoes and View redoes, LT and RT zoom, the right
  stick pans, B leaves.
- Found and fixed while checking:
  - The editor's hint bar was wider than a 1920 window at the desktop scale and covered the
    bottom edge of the map (`p5-1920x1080-8-editor.jpg`). It now wraps when it has to, sits
    centred inside the window, and menus and the editor map leave room for it
    (`p5-padbar-fixed-1366x768.jpg`, `-1920x1080.jpg`, `-3440x1440.jpg`: at 1920x1080 the
    editor ends at y 974 and the bar starts at 1030).
  - On a very slow machine a quick d-pad tap seen on two polls a frame apart could count as a
    hold and repeat; a repeat now also needs the button seen held on two more polls.
- Console errors: 0.
