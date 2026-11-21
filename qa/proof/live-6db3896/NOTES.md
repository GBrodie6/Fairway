# Live check of 6db3896 (gh-pages a430eaa)

https://gbrodie6.github.io/Fairway/ in headless Chrome (software rendering), one browser job
at a time, real input events through the Chrome DevTools input domain (touch on the phone, the
mouse on the desktop). Before the checks, all 168 files the site serves were fetched (with a
cache-busting query) and their SHA-256 hashes matched the verified build of 6db3896 exactly.

- `node scripts/tools/live.mjs` (`l.json`, `l-*-menu.png`): 390x844 and 1366x768, 0 console
  errors, 202 requests all over HTTPS, none failed, the service worker active and controlling
  the page after a reload, the manifest read and Chrome's installability check clean in a
  persistent profile (a throwaway profile reports only "in-incognito").
- `coursemap-check.mjs` with URL set to the live site (`coursemap/`): Augusta National and the
  Old Course at 390x844 (taps, a two-finger pinch, drags) and 1920x1080 (clicks, the wheel, the
  M key): Quick Play's Course map, labels and controls with no overlaps, zoom, Fit, pick a hole
  and Start on hole N, the hole map's Course toggle, the scorecard's Course map. 78 of 78
  checks, 0 console errors.
- `deskproof.mjs` with URL set (`d-1920x1080*`): the main menu, a hole at address, mid-swing,
  the spin pad, the shot selector, the scorecard, the level editor and the community browser
  at 1920x1080 with the mouse. 8 screens, 0 layout problems, 0 console errors.
- `scenery-shots.mjs` with URL set (`scenery/`): parkland and Augusta National hole 1 at
  390x844 and 1920x1080 on Medium, where Show other holes is on by default: the tee, the green,
  the flyover and the course map. 17 other holes built each time in 2 draw calls; other holes
  drawn from the flyover 5 (parkland) and 2 (Augusta) on the phone, 11 and 8 on the desktop;
  course map labels 19 of 19 (18 holes and the clubhouse). 0 console errors.
- `level-maps.mjs` with URL set (`levelmaps/`): a community hole from Test play, no other holes
  built, the hole map's Course toggle shows that one hole, Hole goes back, play goes on. 9 of 9
  checks at 390x844 and at 1920x1080, 0 console errors. Run with the build's in-memory cloud
  (`?cloud=demo`), so nothing was written to the real project.
- `node scripts/bot.mjs --url ... --course augusta --holes 3 --view portrait --scenery 1`
  (`bot/`): 3 holes of Augusta National through real touch at 390x844 with the other holes on,
  14 strokes, 0 stuck, 0 console errors, the scorecard matches.
