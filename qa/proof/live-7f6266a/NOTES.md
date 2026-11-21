# Live check of 7f6266a (gh-pages 4bc8631)

https://gbrodie6.github.io/Fairway/ after the course map fix for short landscape screens, in
headless Chrome (software rendering), one browser job at a time, real input through the Chrome
DevTools input domain (touch on phones, the mouse on the desktop and in the landscape bot
round). Before the checks, all 168 files the site serves were fetched with a cache-busting
query and their SHA-256 hashes matched the verified build of 7f6266a exactly.

- `live.mjs` (`l.json`): 390x844 and 1366x768, 0 console errors, every request over HTTPS (202
  and 201), none failed, the service worker active and in control after a reload, Chrome's
  installability check clean in a persistent profile.
- `coursemap-check.mjs` (`coursemap/`): Augusta National and the Old Course at 390x844 and
  1920x1080, 78 of 78 checks, 0 console errors.
- `coursemap-check.mjs` (`coursemap-844/`): every course at 844x390, 133 of 133 checks (the
  6db3896 site failed 13 of these: hole labels left out of the fitted map), 0 console errors.
- `deskproof.mjs` (`d-1920x1080*`): 8 screens with the mouse at 1920x1080, 0 layout problems,
  0 console errors.
- `scenery-shots.mjs` (`scenery/`): parkland hole 1 at Medium, where Show other holes is on by
  default, at 390x844, 844x390 and 1920x1080: 17 other holes built in 2 draw calls; other holes
  drawn from the flyover 5, 11 and 11; course map labels 19 of 19 at each size; 0 console errors.
- `level-maps.mjs` (`levelmaps/`): the maps inside a community hole, 9 of 9 at 390x844, 844x390
  and 1920x1080, 0 console errors (the build's in-memory cloud, nothing written to the real
  project).
- `bot.mjs --url ...` (`bot/`, `bot-844/`): 3 holes of Augusta National through real touch at
  390x844 (14 strokes) and 3 holes of the Old Course with the mouse at 844x390 (13 strokes),
  the other holes on in both: 0 stuck, 0 console errors, scorecards match.
