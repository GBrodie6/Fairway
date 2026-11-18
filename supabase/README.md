# The server contract

The game's Supabase project is shared with another app and was set up outside this repository.
Nothing here is meant to be run against it: the game never runs SQL, and the old schema file
that used to live here (unprefixed tables) was removed so it cannot be run by mistake in the
shared project.

What the client expects (names in `src/net/tables.js`):

| Table | Columns | Who may read | Who may write |
| --- | --- | --- | --- |
| fairway_profiles | id, display_name, created_at | the owner | the owner |
| fairway_saves | user_id, version, data (jsonb), updated_at | the owner | the owner |
| fairway_scores | id, user_id, display_name, board, value, meta (jsonb), created_at | everyone | the owner |
| fairway_levels | id, user_id, author, name, par, data (jsonb, under 20 KB), plays, likes, reports, hidden, created_at | everyone (hidden rows excepted) | the owner (insert: user_id, author, name, par, data; update: name, par, data) |
| fairway_level_likes, fairway_level_reports | through the procedures below | | |

Every write needs an account that passed the robot check at sign-up (the server sets
`app_metadata.fairway = true`).

Procedures:

- `fairway_new_challenge()` returns `{ id, svg }` (anyone): a picture of 5 digits. It works
  once, expires after 10 minutes, and cannot be answered within 2 seconds of being issued.
- `fairway_delete_my_account()` deletes the signed-in game account.
- `fairway_level_like(p_level uuid)` returns boolean, `fairway_level_report(p_level uuid,
  p_reason text)`, `fairway_level_played(p_level uuid)`: signed-in game accounts only.

A sign-up that declares `data.app = 'fairway'` is refused unless it carries a valid
`challenge_id` and `challenge_answer`. Email confirmation is off. The server limits publishing
to 10 holes a day and 100 in total, and hides a hole at 5 reports.
