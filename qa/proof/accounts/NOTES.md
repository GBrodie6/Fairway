# Accounts proof

- `a-demo-*`: the full flow against the in-memory stand-in (`?cloud=demo`) at 390x844 and
  844x390, through real touch taps and typing: a wrong code (the friendly line and a new
  picture), sign-up, cloud save, a leaderboard score, sign out, the device save wiped, sign in
  with the save restored, Delete my data, and a failed sign-in for the deleted account. No
  console errors.
- `a-live-390x844*`: the same flow from the local production build against the real Supabase
  project, before deploy, with the throwaway username fwtest381601 (deleted at the end).
  Every step passed: the wrong code gave the friendly line and a new picture; the first real
  picture (`a-live-390x844-pic-1.png`) was misread and refused; the second (`pic-2`, read as
  75313) created the account with `app_metadata.fairway = true`; the cloud save came back after
  the device save was wiped; the score showed on the weekly long drive board; Delete my data
  removed the account and signing in then failed.
- Console entries in that run were all HTTP replies to deliberate failures: two 500s for the
  wrong and misread codes, 400s for the wrong password and the sign-in after delete, and one
  403 from the sign-out call after the account was deleted. That last one is fixed: after
  `fairway_delete_my_account` the client now forgets the session on the device instead of
  calling the server. The tool now separates deliberate failures from unexpected errors.
- `misread-picture-93664.png`: a picture fetched directly to check a refusal. I read it as
  8 3 6 5 4; its dot grid decodes to 9 3 6 6 4, and the server's "Robot check failed" was right.
  Reading these pictures from a screenshot is not reliable for me at small size (a 9 looks like
  an 8, a 6 like a 5); checking each glyph against the 5 by 7 dot grid worked.
