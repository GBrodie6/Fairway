# Live check of 3c0a275 (gh-pages 07b17cc)

https://gbrodie6.github.io/Fairway/ at 1920x1080 in headless Chrome (software rendering), with
the mouse driven through real input events.

- `node scripts/tools/deskproof.mjs` with URL set to the live site (`d-1920x1080.json`,
  `d-1920x1080-*.jpg`): the main menu, a hole at address, mid-swing and a safe cancel when the
  pointer leaves the window, the spin pad, the shot selector, the scorecard, the level editor and
  the community browser (the live list is empty: the earlier live check deleted its own test hole
  and account). 8 screens, 0 overlap or readability problems, 0 console errors.
- `node scripts/tools/mouseswing.mjs` with URL set to the live site, run twice:
  - second run (`m2-1920x1080.json`, `m2-1920x1080-*.jpg`): hover preview and grab cursor; a
    swing at the power guide launched the ball; the same swing at 60, 144 and 240 Hz gave power
    0.60 at all three, tempo ratio 3.05, 3.19 and 3.14 (all Perfect), path within 0.08 degrees;
    the pointer leaving the window mid backswing cancelled with no stroke ("Swing cancelled");
    left-handed, the track sat left of the press point (853 against 899) and the swing launched.
    0 console errors.
  - first run (`m-1920x1080.json`): the same, except the 60 Hz swing on its freshly loaded round
    returned no result (the 144 and 240 Hz swings and the full swing worked; 0 console errors).
    It did not happen again in the second run, and the cause was not found.
