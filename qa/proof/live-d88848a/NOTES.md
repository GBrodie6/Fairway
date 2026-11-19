# Live checks of d88848a on https://gbrodie6.github.io/Fairway/

All in headless Chrome at phone size (390x844, plus 844x390 for the swing), through real touch
input, against the live site and the real Supabase project.

- Accounts (`a-live-390x844.json` and screenshots), throwaway username fwtest827695:
  - Sign-up screen: username, password, the picture (alt "Security picture with 5 digits"),
    "Type the 5 digits you see", the no-reset line; no email anywhere.
  - A wrong code (00000): "That code was wrong or expired. Here is a new picture." and a new
    picture appeared.
  - Sign-up: the picture (`a-live-390x844-pic-1.png`) read from the screenshot as 24446,
    entered more than 2 seconds after it appeared: account created on the first try, with
    `app_metadata.fairway = true`.
  - Save: a marker written into the save and synced ("Synced.").
  - Leaderboard: a weekly long drive score (287 yd) posted and shown on the board as this
    player's row.
  - Sign out, the device's save wiped, a wrong password ("That username and password do not
    match."), then sign in: the marker came back from the cloud save.
  - Delete my data: signed out, session and sync queue cleared; signing in again with the same
    username and password failed ("That username and password do not match.").
  - Console: only the server replies to the three deliberate failures (500 for the wrong code,
    400 for the wrong password and for the deleted account), plus one 503 from GitHub Pages for
    a tree model in the first seconds after the deploy; the same file returned 200 a minute
    later.
- Clean loads (`l.json`): phone 390x844 and desktop 1366x768, 0 console errors, 0 failed
  requests, every request HTTPS, the service worker active.
- Swing (`swing-*.json`): the seven-frame touch drag at 390x844 and 844x390 on the live site:
  the impact frame draws the head at the ball, the same swing result as locally (power 0.994,
  ratio 2.51, Good at 390x844), 0 console errors.
