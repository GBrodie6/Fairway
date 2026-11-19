# Community holes: proof

Production build, headless Chrome (SwiftShader), real touch through the Chrome DevTools input
domain: taps, one-finger drags and a two-finger pinch. The cloud is the build's in-memory
stand-in (`?cloud=demo`), which follows the same rules the real project enforces (sign-in for
writes, 10 holes a day and 100 in all, a hole hidden at 5 reports). The live run against the
real project is in `qa/proof/live-*/`.

Run: `node scripts/tools/levels.mjs qa/proof/levels/run <size> demo`. Files are
`run-demo-<size>-*.png` and `run-demo-<size>.json`.

## Tap count, Create tile to a published hole, from a template, signed in

| | 390x844 | 844x390 |
|---|---|---|
| Menu taps (Create, the template, Test play, Back to the editor, Publish) | 5 | 5 |
| Skip flyover | 1 | 1 |
| First-run tip (only on a brand new save) | 1 | 1 |
| Swings (a 6 or 7 iron and a putt) | 2 | 2 |
| Putt read nudges | 2 | 1 |
| Total | 11 | 10 |

Target: 25 or fewer. A player who has played before saves the tip; a test that needs more
strokes adds one per swing.

## What each run checked (both sizes, all passed, zero console errors)

- Count: the template opens with "Test play the hole once to publish it.", Publish is off until
  a finished test, the test holed out in 2 and came back to the editor ("Tested. Ready to
  publish."), and Publish answered `Published "Island Carry". Find it under New.`
- Browse: the hole is in New with its author, par, length, likes and plays; Like turned into
  "Liked (1)" and the card shows "1 like"; Top and Mine list it; Share copied the link; the
  `#level=<id>` link opened a preview; Play from the preview holed out and the end screen showed
  "Best: 2 by <name>. Your best: 2."; the card then showed "1 play"; Delete in Mine removed it
  from Mine and New.
- Editor (Dogleg par 4): the tee, the pin and the bend handle each moved with a drag (par and
  length updated: "Par 4, 437 yd"); Bunker, Water, Rough and Hills each added one piece, Trees
  added a clump of six, Green size went 13 to 17 m, Add bend added the second bend; a placed
  bunker moved with a drag and a pinch grew it from 5 to 9 m (the cap); Delete removed the
  selected bunker, Undo brought it back, Redo removed it again; Decorate added about 70 trees
  and 3 to 5 rough patches; the pin dragged onto a pond gave "The pin is in the water." with
  Test play and Publish off, and Undo fixed it; the name "www.spam.com" gave "Links are not
  allowed in names." with Publish off. The decorated hole is about 1.4 KB of the 20 KB allowed.
- Offline: with the connection off, Publish answered "You are offline. The hole is saved here
  and will be published when you are back online."; back online it published by itself and the
  hole was in New.
- Delete my data: signed out, the account gone, and none of the player's holes left in New.
