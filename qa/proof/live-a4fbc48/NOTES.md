# Live checks of a4fbc48 on https://gbrodie6.github.io/Fairway/

Headless Chrome (SwiftShader) at 390x844 through real touch input, against the live site and
the real Supabase project.

- Clean loads (`l.json`): phone 390x844 and desktop 1366x768, 0 console errors, 0 failed
  requests, every request HTTPS, the service worker in control, and Chrome's installability
  check with no errors.
- One throwaway account, `fwlv988645`, for everything below (`lv-live-390x844.json` and the
  `lv-live-390x844-*.png` screenshots). Sign-up passed the robot check on the first picture
  (`lv-live-390x844-pic-1-large.png`, read by eye as 29343).
- On the range with that account, a 5-iron each, real swing drags, all three struck Pured:

  | Shot | Carry | Total | Side at landing | Apex |
  | --- | --- | --- | --- | --- |
  | Draw | 180.2 yd | 189.2 yd | 0.1 yd left of the aim | 24.0 yd |
  | Fade | 182.4 yd | 192.1 yd | 13.8 yd right of the aim | 24.0 yd |
  | Stinger | 168.1 yd | 183.7 yd | 4.5 yd right of the aim | 14.1 yd |

  The draw starts right of the aim and bends back to it; the side numbers include the
  scripted swing's own small push.
- Community holes: Create, "Short par 3 over water", Test play (holed in 2), Back to the
  editor, Publish: `Published "Island Carry". Find it under New.` Ten taps from the Create tile
  counting the two swings and two putt nudges (5 menu taps). The hole was in New with its
  author, liked ("Liked (1)", "1 like"), in Top and Mine; the share link `#level=<id>` opened a
  preview; playing it from there holed out in 2 and the end screen read "Best: 2 by fwlv988645.
  Your best: 2." (the score saved on board `lvl:<id>`); the card then showed "1 play". Delete
  in Mine removed it from Mine and New. The editor steps (drags, pinch from 5 to 9 m, the bin,
  undo and redo, "The pin is in the water.", the link-name check) behaved as in the demo runs.
- Delete my data: signed out, no account on the device, none of the player's holes left in New.
  (The Node check in `qa/proof/levels-live-api/` also confirmed signing in fails after it.)
- Console: 0 errors for the whole run.
