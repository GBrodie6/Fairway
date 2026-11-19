# Community holes against the real Supabase project (server contract)

`node scripts/tools/levelsApi.mjs qa/proof/levels-live-api/api`, run from Node with the
build's public anon key and a throwaway account (`api.json`). The robot-check picture
(`api-pic-1.png`) was read by eye and answered in `api-answer-1.txt`.

Every step passed: sign-up with the game flag; New readable without a session; publish of a
template; the row back from New and by id without a session; like, unlike and like again (the
count went 1, 0, 1); Top and Mine; a counted play; a report (and a second report from the same
account accepted without hiding the hole); a best score posted and read back; an anonymous
delete refused by the server; the owner's delete; then Delete my data (scores, saves, profile,
holes, the account) and signing in again failed.

Found on the way: the first run of this check (before the fix) had the score refused with
`fairway_scores_board_check`. A probe with a second throwaway account showed the server allows
board names up to 40 characters ("level:" plus a uuid is 42). The board is now `lvl:<id>`,
exactly 40, and the in-memory stand-in enforces the same limit so the tests catch it.
