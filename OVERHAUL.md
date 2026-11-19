# Fairway Next overhaul: design

The goal: the calm one-gesture swing of a casual mobile golf game, with the depth,
progression, and broadcast presentation of a sim. This document is the plan; REPORT.md records
what was built and the evidence.

## Ground rules this design keeps

- The base physics tuning and the swing gesture math do not change. Every new effect is a
  bounded modifier applied to the launch inputs (speed, launch angle, spin, face, side spin)
  after `computeLaunch` and before `simulateShot`. A neutral level 1 golfer with common clubs
  and a perfect strike reproduces the existing carry ladder exactly (tested).
- Every existing physics, swing, career, and share-link test keeps passing unchanged.
- Original names, art, icons, text, and audio only. No human figure. No real people.
- No real money, no ads, no gambling mechanics. Everything is earned by playing. Wherever a
  random reward exists, its odds are shown next to it.
- Personal data is minimal: an email, a display name, and game data. No tracking.

## Code map (what exists and what is added)

Existing and kept:

- `src/game/career.js`: XP and levels, five attributes mapped to a bounded physics profile
  (`profileFor`), equipment with tradeoffs, invented rivals with a seeded statistical round
  model, tiered seasons. Pure functions, tested.
- `src/game/save.js`: versioned local save (v3) with step migrations, stats, achievements,
  daily results, a resumable round.
- `src/game/share.js`: challenge links (scores travel inside the link).
- `src/game/controller.js`: the round state machine; the launch is built in `launchShot`.

Added (all pure modules with tests, then thin UI over them):

| Module | Stage | Role |
| --- | --- | --- |
| `src/net/supabase.js` | 1 | A small fetch-based client for Supabase Auth and REST (no SDK). Dormant when no URL and key are configured. |
| `src/net/sync.js` | 1 | Guest-to-account merge, conflict rule, 30-day backups, offline queue, debounce. |
| `src/net/leaderboard.js` | 1 | Board definitions, value sanity bounds, reads and writes. |
| `src/game/names.js` | 1 | Display name validation and a small profanity filter. |
| `src/game/strike.js` | 2 | Contact model: strike result and bounded launch modifiers. |
| `src/game/gear.js` | 3 | Rarity tiers, club instances, balls, gloves, drops, pity, shards, loadout. |
| `src/game/rangeModes.js` | 4 | Range session stats, dispersion ellipse, drills and scoring. |
| `src/render/rangeScene.js` | 4 | The range dressing: bays, mats, nets, signs, target greens, cart, lights. |
| `src/game/archetypes.js` | 5 | Six archetypes, stat lines, skill trees, evolutions, caps. |
| `src/game/campaign.js` | 5 | Six chapters of events with bosses, objectives, rewards. |
| `src/game/progress.js` | 6 | Quests, achievements (50+), cosmetics, season track, streaks. |
| `src/game/broadcast.js` | 7 | Commentary lines, lower-third data, recap highlights, tournament cut and purse. |

## Save v4

`save.version` goes to 4. The migration from v3 keeps everything and adds:

```
profile: { archetype, emblem, banner, frame, level, xp, skillPoints, stats{5}, nodes[], evolution }
wallet: { coins, shards, mulligans }
gear: { clubs[{uid, clubId, rarity}], bag[uid x 14], balls[{uid, rarity}], gloves[{uid, rarity}], ball, glove, pity{} }
campaign: { chapter, events{ id: result }, bosses{} }
range: { sessions, best{ targetPoints, longDrive }, clubAvg{} }
quests: { daily{ key, list }, weekly{ key, list } }, season: { id, xp, claimed[] }
cosmetics: { owned[], trail, clubSkin }, streaks{}, account: { userId, updatedAt, lastSync }
settings mirror for sync: units, handedness, difficulty (device-only settings stay local)
```

An existing v1 career migrates into the new profile: level and XP are kept (the curve is
re-based so nobody loses a level), attributes map onto the five stat lines (power to driving,
accuracy to approach, short game, putting, recovery to course management), equipment choices
map onto starter items, titles and history are kept, and the archetype defaults to
All-Rounder (changeable once for free).

## Stage 1: accounts and cloud save

Revised: accounts are a username and a password with a robot check, and there is no email
anywhere. The first version used email and password with a magic link and password reset; all
of that is gone (no email field, no magic link, no reset, no `VITE_EMAIL_FLOWS` flag).

The design, and why:

- Shared project. The Supabase project is shared with another app, so every table and
  procedure of ours carries the `fairway_` prefix, and the names live in one file
  (`src/net/tables.js`). The game never runs SQL; the server contract is in
  `supabase/README.md`. Build-time settings: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  in `.env.production` (committed; the anon key is public by design, and no service role key
  is used, requested or stored).
- Usernames. 3 to 16 of a to z, 0 to 9 and _, lowercased from whatever is typed, and run
  through the profanity filter. Every auth call maps the username to a private address,
  `username@fairway.invalid` (a reserved domain that cannot receive mail). That address is
  never shown and never kept on the device (the stored session keeps the user id, the username
  and the game flag only). Passwords are 8 to 72 characters and at most 72 bytes. Validation
  and mapping are pure functions in `src/net/account.js`.
- Robot check. Sign-up calls `rpc('fairway_new_challenge')` for `{ id, svg }` and shows the
  svg only as an img data URL (`encodeURIComponent`), never as markup, with the alt text
  "Security picture with 5 digits" and the line "Type the 5 digits you see". A New picture
  button works at most once every 3 seconds. The server accepts a picture once, for 10 minutes,
  and not within 2 seconds of issuing it, so the screen waits out the rest of the 2 seconds
  before it sends the answer.
- Sign-up is `signUp({ email, password, options: { data: { app: 'fairway', username,
  challenge_id, challenge_answer } } })`. `app: 'fairway'` tells the shared project's trigger
  that this is a game account. Email confirmation is off, so a session comes back at once (and
  if one does not, the screen signs in with the same details).
- The player flag. The server sets `app_metadata.fairway = true` on accounts that passed the
  check, and every write needs it. After sign-up or sign-in the client checks
  `session.user.app_metadata.fairway === true` (one user fetch and token refresh if it is not
  there yet). Without it the screen says "Cloud save is not available for this account" and the
  game stays local-only. With it, sign-up creates the `fairway_profiles` row with
  `display_name` set to the username as typed (at most 20 characters).
- No password reset. With no email there is nothing to send a reset to, and the sign-up screen
  says so in one line before the account is made: "There is no email on this account, so a
  forgotten password cannot be reset." The account screen has Download backup (the save as a
  JSON file) and Restore from file (the replaced save is kept as a backup on the device).
- Errors are plain words, never raw server text: a wrong or expired code ("Robot check failed"
  or "Database error saving new user") becomes "That code was wrong or expired. Here is a new
  picture." and loads a new one; "User already registered" becomes "That username is taken.";
  rate limits and network errors get their own plain lines.
- Delete my data: the player's rows in `fairway_scores`, `fairway_saves` and
  `fairway_profiles` (and, from the level creator on, their published holes), then
  `rpc('fairway_delete_my_account')`, then sign out and clear this device's sync state (queue,
  backups) and progress.
- Columns are the server's: `fairway_profiles(id, display_name, created_at)`,
  `fairway_saves(user_id, version, data, updated_at)`, `fairway_scores(id, user_id,
  display_name, board, value, meta, created_at)`. The first client wrote `profiles.user_id`,
  `profiles.updated_at` and `scores.period`, which the shared tables do not have, so the
  profile row is keyed by `id` and a board's period (a day, an ISO week, or all time) travels
  in `meta.period`, which the board filters on (`meta->>period=eq.<period>`).

Unchanged from the first version:

- Guest by default. After the first finished round, and from settings, a small card offers an
  account: "Keep your progress on any device". Never a wall.
- Sync: the full save is pushed (debounced by 4 seconds) on round end, level-up, gear change,
  and sign-in. Conflict: compare `updated_at`; the newer save wins and the other is kept as a
  local backup for 30 days, restorable from the account screen. On sign-up the guest save
  merges into the account (progress-wise maximum: higher level and XP, union of gear and
  achievements, better bests).
- Offline: every push goes into a queue in local storage and is retried with backoff when the
  network returns. Plain messages for expired sessions, rate limits and network errors.
- Leaderboards: daily challenge, weekly long drive, range target points, campaign level.
  Readable by everyone, written only by signed-in game accounts, and values are bounded
  client-side before upload. The board says plainly that it is casual and not cheat-proof.
- Without the two build-time values, the account UI says cloud sync is off and the game is
  fully playable as a guest. `?cloud=demo` runs the same screens against an in-memory stand-in
  that follows the server's rules (`src/net/fakeSupabase.js`); nothing leaves the device.

## Stage 2: strike quality

Inputs: tempo quality and grade, face drift at the crossing, path, crossing speed, overswing
(full backswing with a rushed tempo), the lie (rough, deep rough, sand, slope), the club's
difficulty (club type times rarity), the glove, the player's stats, and the difficulty setting.

```
error  = 0.55 (1 - tempo quality) + 0.35 min(1, |face| / 8) + 0.25 min(1, |path| / 7)
       + 0.35 overswing + lie term (rough 0.05, deep 0.15, sand 0.2, slope up to 0.12)
mishit = clamp(error x setting x club difficulty / sweet spot - 0.05, 0, 0.9)
```

- Setting: relaxed 0.6, standard 1, pro 1.5. Club type: driver 1.0, woods 0.9, long irons
  0.85, mid irons 0.75, short irons 0.65, wedges 0.55, putter 0.3. Rarity multiplies it.
- Feel target (the player's request: only a little harder than before): on standard, a
  decent swing mishits rarely and most mishits are mild; relaxed stays close to the old game;
  pro is the setting with real bite. The balance runs check the mishit rate per setting.
- No mishit: Pured when the error is inside the sweet spot's pure window, otherwise Good.
- Mishit kind follows the cause: face drift gives Heel or Toe (by side), a rushed or
  overswung tempo gives Thin or Fat (Fat more likely from sand and deep rough), and a rare
  Shank needs a large face and path error together.
- Effects (carry relative to the same swing struck clean): Thin and Fat lose 10 to 40 percent
  by severity; Heel and Toe lose 8 to 25 percent and add side spin; a Shank goes about 30
  degrees off line at half speed. Pured and Good fly exactly the clean launch with every club
  tier (the carry rule, Stage 3). Carry never drops below 40 percent of the clean value and no
  strike result ever carries further than the clean shot (`CARRY_CAP` is 0).
- Shown: a strike label with the tempo label, a dot on the club face where it made contact,
  a haptic and sound per kind, and a post-shot card with carry, offline, and the cause in plain
  words ("too fast on the way down", "face open at impact", "heavy, hit the ground first").
- Mulligan: an earned item (quests, levels, season track) that undoes one shot per round.

## Stage 3: club rarities

The carry rule (current): no club tier adds distance. A Pured strike carries exactly the
club's table carry at the chosen power, identical for every tier, so the power guide's mark is
exact; a Good strike flies the same; every other strike carries shorter and/or goes offline,
never longer (the existing flier lie is the only exception). Rarity changes risk and control
only: a higher tier has a smaller sweet spot (more mishits) and harsher mishits (severity times
the square root of its difficulty), and in return a wider range on the ball-contact dot for
draw, fade, backspin and topspin (`src/data/spinControl.js`, Part 2 of the next run).

| Tier | Difficulty (mishit severity) | Sweet spot | Spin dot reach | Carry |
| --- | --- | --- | --- | --- |
| Common | 1.00 | 1.00 | 50 percent of the pad | the table carry |
| Uncommon | 1.25 | 0.92 | 60 percent | the table carry |
| Rare | 1.50 | 0.84 | 70 percent | the table carry |
| Epic | 1.80 | 0.76 | 80 percent | the table carry |
| Legendary | 2.20 | 0.68 | 100 percent | the table carry |

What this replaced: earlier versions gave Pured strikes (and later Good strikes, at half
strength) a tier carry bonus of up to 8 percent, a pured higher tier a straighter flight, and a
guide that showed the tier's carry at the player's own Pured rate. All of that is removed: the
`bonus` and `spin` fields, `goodStrikeFactor`, `tierCarryFactor`, `guideShare`, the Pured-rate
tracking (`strikeMix`), and the straighter pured flight. The power guide now folds only the
golfer's profile and the ball into its mark: a ball's small speed and spin factors are linear
in the launch, so the guide includes them and a Pured strike lands on the mark with any ball
(tests/strike.test.js). The golfer perk that added carry on pured strikes (Pure contact) now
adds half its value as ball speed on every full swing through the golfer's profile ("Clean
speed"), so the guide shows it too; its node values and caps are unchanged.

- Original model names per tier (Meadow, Harrow, Kingfisher, Ember, Solstice) with their own
  head finish and glow on the swinging club, the club button ring, and the gear screen (stat
  bars and a side-by-side compare).
- Sources: campaign chapters and level milestones (fixed rewards), challenges and range drills,
  and gear drops with odds printed on the screen (Common 50, Uncommon 28, Rare 14, Epic 6,
  Legendary 2 percent) and a pity counter (an Epic or better is guaranteed by the 20th drop
  without one; that drop is Epic 75 or Legendary 25 percent). Each drop is a club (70 percent),
  a ball (15) or a glove (15). A duplicate converts to shards (5, 10, 20, 40, 80 by tier), and
  shards raise a chosen club one tier (40, 100, 250, 600). Starter bag: the 14 common clubs,
  one of each type, which is also the 14-club limit; the bag screen swaps versions in and out.
- Gear tokens open drops and are only earned: 1 per finished round of 3 or more holes (up to 3
  a day), 1 more for the first daily challenge each day, 1 or 2 per career or campaign event,
  plus range drills and milestones. One copy of each club per tier is kept, so a save merged
  from two devices cannot hold the same club twice.
- Balls by rarity trade spin for roll; gloves add a small forgiveness boost (a larger sweet
  spot, at most +8 percent).

## Stage 4: the range

A separate scene (course/range.js): a wide flat field 360 yards long with a tee line of five
open bays (turf mats with rubber tees, dividers, ball baskets), a grass strip in front of the
bays for hitting off turf, side nets on tall poles, a clubhouse with a veranda, six light
towers that glow at dusk and night ("Evening lights" in the lobby), yardage signs every 25
yards to 300, five target greens with flags at 75, 125, 175, 225 and 275 yards, practice balls
on the grass, and a picker cart driving its loop. It has the same shape as a generated hole,
so the terrain builder, physics and renderer work on it unchanged; range-only parts are extra
fields (targets, bays, signs, clearings).

- Every ball is teed up again in the same bay; the club stays as chosen. A 50-ball bucket or
  unlimited balls in free practice.
- Per-shot readout on the shot card: carry, total, offline, ball speed, launch, spin, apex and
  the strike. The map button (or the pause menu) opens the dispersion map: every landing,
  a ring holding about two thirds of each club's shots (1.5 standard deviations), and a table
  of per-club averages. Ending a session shows the summary with the same map and table.
- Drills, each with fixed medals (no randomness): Target points (10 balls, two per target,
  scored where the ball lands: 100 within 3 yd down to 10 within 25, +10 on the green;
  bronze 200, silver 380, gold 560), Long drive (6 drives, best total inside a 60-yard grid;
  235, 252, 268), Wedge ladder (carry 50 to 100 yd in 10-yard steps within 5 yd, 12 balls;
  3, 5, 6 rungs), Shape shots (draw, fade or straight on request; 2, 4, 6) and Pressure streak
  (land on a chosen target green in a row; 3, 6, 10). Drills that ask for a distance suggest a
  club that reaches it. The Club test lane replays each swing with a second tier of the same
  club (any tier, only simulated) and shows both results.
- Rewards: XP for every session (more for better medals), and a gold medal earns a gear token
  once per drill per day. Range bests feed the target and long drive leaderboards; per-club
  range averages show in the club list during rounds, and the campaign reads range medals.

## Stage 5: campaign and archetypes

As built (game/campaign.js, ui/campaignUi.js):

- Six archetypes, each with an innate perk that never changes a pured carry (so a level 1
  golfer of any archetype keeps the calibrated carry ladder), a weakness as a lower cap on
  one or two stats, and evolutions at levels 10 and 25 with new titles: Power Hitter (Long
  Baller, Thunder Driver), Sharpshooter (Pin Seeker, Flag Hunter), Short Game Artist (Wedge
  Wizard, Greenside Maestro), Putting Specialist (Green Reader, Silk Stroke), Links Player
  (Wind Cheater, Storm Rider) and All-Rounder (Complete Golfer, Total Player). Each evolution
  grows the innate perk (1.5x, then 2x) and adds 4 to the signature stat.
- Levels 1 to 40 (about 10 events to level 10 and 90 to level 40), one skill point per level
  (the All-Rounder gets two extra). Five stats from 30 to 95, starting at 50: driving,
  approach, short game, putting, course management. They map to the physics profile with the
  same formula and bounds as the old career (ball speed at most +8 percent, the rest within
  0.45 to 1.3), and perks are capped in total (pured carry at most +4 percent, inside the
  strike cap).
- A 20-node tree per archetype in four branches (off the tee, approach, short game, on the
  green): stat nodes, perks, and the shot unlocks punch, high, flop and bump and run. Respec
  is free. Campaign events offer only unlocked shots; other modes offer every shot.
- Six chapters (The Club, Regional Circuit, The Tour, The Majors, Rivalry, The Final) with 4 to
  5 events each, 28 in all: 3, 6 or 9 holes, a main objective that clears the event and two
  star objectives (top finishes, birdies, fairways, greens, putts, no doubles, a long drive,
  range medals, beating the boss). Each chapter has a named boss (invented people, shown as
  initials only); the Rivalry chapter is match play against the boss, who plays on screen.
  Events unlock in order, the next chapter after the boss event. First clears give a gear
  token (two for a boss event) and the chapter's final event gives a fixed club.
- XP breakdown per event: holes played, scoring, birdies and eagles, objectives, finish,
  first clear, and a 10 percent practice bonus while you hold a silver range medal. Quick
  rounds and range sessions give smaller XP. Level-ups show a card from the round-end and
  range summary screens.
- Your golfer's stats and perks apply in campaign events, solo quick rounds and the range;
  daily challenges, challenge links and multiplayer stay level.
- Save v6: the golfer (XP, archetype, skills) and campaign progress. A career save keeps its
  experience; the archetype is chosen when the campaign first opens. The old career screens
  are no longer in the menu.

## Stage 6 to 8: fun, presentation, first minute

As built:

- Stage 6, fun layer: daily and weekly quests (three each, the same for everyone, weekly ones
  pay a gear token); a free 30-tier season track over four weeks with fixed rewards; 57 new
  achievements (69 in all) checked over the save, several unlocking cosmetics; ball and tracer
  colors in a locker; streaks (pars, birdies, pured strikes, fairways in a row) with a HUD chip
  and announcements; confetti for a birdie or better (off with reduced motion); this week's
  rotating mini-game and weekly long drive on the Daily screen; 3 and 6 hole quick rounds; a
  quick-round rival that adapts to recent form and leans slightly toward winning. The
  existing optional ambient music loop stays.
- Stage 7, broadcast: a hole intro card over the flyover (course, hole, par, length, a short
  description of the hole, the leader); a lower third as each hole starts (score and
  position); a live leaderboard with movement arrows in the hole summary and a position badge
  in the HUD for campaign events and tournaments (the field's rounds are seeded so the live
  board and the final result agree); an original commentary line on notable shots and holes;
  replay controls for angle (follow, landing, side, high) and speed (half, quarter); a round
  recap (score by hole, fairways, greens, putts, pured strikes, longest drive and putt); and
  tournaments: four rounds of six holes against 29 rivals, a cut to the top 15 and ties after
  round two, a purse in coins (earned only; 300 coins trade for a gear token) and a trophy
  cabinet. New elements share the shot card's dock under the tabs, so they cannot overlap the
  HUD.
- Stage 8, first minute: the main menu is Quick Play, Campaign, Range, Daily and Profile (with
  Settings and Leaderboards); tournaments, pass and play and online live on the Quick Play
  screen; Profile gathers the golfer, gear, locker, achievements, stats, quests, season,
  trophies and the account. The tutorial is three skippable prompts at their moments: the
  swing (first address), the strike result (after the first shot) and club choice (the next
  address). Settings already covered quality, units, handedness, sound, difficulty,
  color-blind palettes and reduced motion.

## Stage 9: balance method

The browser bot plays a hole in about three minutes under software rendering, far too slow for
thousands of rounds. The balance runs use a headless round player built from the game's own
modules (`src/game/simGolfer.js`, `scripts/sim/`): the same terrain, planner, `computeLaunch`,
strike model, tier and archetype modifiers, and `simulateShot`. It plans like the AI and
swings with a fixed human-like error model (power, tempo, face, and path spreads; skill 0.6 is
the average swing). 9-hole rounds rotate through all five courses and both nines, and round i
uses the same course, wind and dice in every cell (strike dice on their own stream), so
differences come from the cells. Four worker threads; the full run takes about a minute.

Cells: each archetype at levels 5, 15 and 30 (skills bought by the recommended path, Common
clubs), each tier for an average swing, each tier for a skilled swing (0.9) with and without
planning for the tier's extra carry, and each difficulty setting; 200 rounds per cell.

Outcome (tables in qa/balance.md):

- First run: the Sharpshooter was 1.9 to 3.0 strokes per 18 better than its level's average.
  Face and path accuracy is the strongest lever in play (about 0.17 strokes per 18 for each
  percent), so its accuracy gains were cut (innate 0.05 to 0.015, tree perks 0.06 to 0.012 and
  0.02, approach nodes +4 to +3, approach-to-accuracy coefficient 0.35 to 0.2), and the Power
  Hitter got a little more from driving (ball speed coefficient 0.05 to 0.07, innate wood sweet
  spot 0.05 to 0.07) and softer weakness caps (short game 78, putting 82). At 400 rounds per
  cell the Sharpshooter was again just out at level 15 (-1.56), so its innate accuracy went to
  0.01 and its last tree perk to 0.015. At 400 rounds every archetype was within 1.29 strokes
  of its level's average. With the carry rule and per-shot strike dice (1000 rounds per cell,
  qa/balance.md) every archetype is within 0.72.
- Tiers, first version (pured-only bonus): none was better than Common for an average swing,
  but every tier cost every swing strokes, a skilled one most (Legendary +5.1 per 18), because
  pured-only carry adds distance scatter on target golf. Tables in qa/balance-before.md.
- Tiers, second version (half the tier carry on Good strikes and a guide at the player's Pured
  rate): Legendary was +0.89, +0.12 and -0.70 per 18 for poor, average and skilled swings, and
  Rare helped an average swing (-0.79). Tables in qa/balance-tier-carry.md.
- Tiers, current (the carry rule, Stage 3): every tier carries the table carry, so the golfer
  plans the same way with every tier. Strike dice are now drawn fresh per shot from the strike
  stream, so a tier's different outcome on one shot no longer shifts the dice of the next. At
  3000 rounds per cell (qa/balance-tiers.md), against Common per 18: average swing Uncommon
  +0.02 (-0.09 to +0.12), Rare +0.29, Epic +0.53, Legendary +0.97; poor swing +0.31 to +1.76;
  skilled swing +0.02 to +0.17. No tier is better than Common for an average swing (the
  target); higher tiers cost a poor swing most and a skilled one least. Until the spin dot
  ships, a higher tier is pure risk.
- Settings: mishits for an average swing are 0.4 percent on relaxed, 3.7 on standard, 10.3 on
  pro, in line with the request for only a little more challenge on standard.

## Swing look and feel

Visual and input smoothing only. The gesture math (power, tempo, face, path), the moment the
shot launches (the touch event that crosses the start line), and every swing test are
unchanged; the same recorded drag gives the same power, tempo ratio and strike before and after
(qa/proof/swing-feel).

- Smoothing (`src/game/swingMotion.js`): the floating club no longer follows the raw drag. The
  drag depth goes through a critically damped spring (exact step, about a 40 ms time constant),
  so uneven touch sampling and a pixel of wobble never step or jitter the club. In the last 10
  percent before impact the spring is stiffer (90 rad/s) and its lag is capped at half the
  remaining depth, so the drawn club reaches the ball with the drag. The frame on which the
  drag crosses the start line draws the impact pose exactly: the head sits 0.3 cm from the
  ball's surface on that frame in every capture (2.44 cm from the ball's center). Face and path
  drift are smoothed the same way so the face never flickers.
- Easing: the backswing is the spring (unhurried); when a moving backswing comes to rest the
  club carries on a touch and settles back (at most 0.014 of the swing's progress, once per
  rest) and then holds still while the finger rests. The downswing is eased in (half linear,
  half ease-in, so it accelerates without hanging at the top) with a gentle speed-based shaft
  lag (up to 7 degrees). The follow-through decelerates (cubic ease-out over 0.5 s) and fades.
- Swing trail: one ribbon mesh over a fixed ring buffer of 32 head samples (no allocation per
  frame), laid down through the downswing and the first part of the finish, each sample fading
  out 0.3 s after it was laid, additive glow. Tint by strike at impact: white for Pured, amber
  for Good, red for any mishit.
- Swing stick: the rail under the finger is replaced by a slim rounded track docked to the
  screen edge away from the club (right for a right-handed golfer, left for a left-handed
  one), stepping inward past any button on that edge (the look and aim buttons in landscape).
  A soft gradient fill follows backswing power, a warm mark is the power guide, a short tick
  marks the top of the backswing, and the start marker (on the track and the start line under
  the ball) glows and pulses as the drag comes back to it. The tempo cue is a small ring: it
  fills during the backswing and empties three times as fast after the top, so it is empty at
  the line on a 3 to 1 swing. No text. The layout check measures it with every HUD control,
  the ball and the club at four sizes for both hands: no overlaps.
- Impact: a 60 ms hit-stop on the club only, a camera punch toward the ball scaled by power
  (0.05 to 0.15 m, in fast and out over 0.22 s), a soft shock ring on the ground under the ball
  (0.35 s, larger and brighter with power), plus the existing sound, debris and haptics (a tick
  at the crossing, then the strike pattern). Reduced motion turns off the punch, the hit-stop
  and the pulsing animations.

## Ball contact (spin and shape)

A golf ball diagram with a draggable dot (`src/ui/spinPad.js`), opened from a small ball
button beside the bottom row (above the settings button in landscape; mirrored for the
left-handed layout). The center is neutral. Left and right curve the ball (labelled Draw and
Fade for the golfer's hand), up adds backspin and launch (More backspin), down takes spin off
and launches lower for more roll (Topspin). Quick buttons set Draw, Straight and Fade (80
percent of the club's reach). A setting chooses whether the dot goes back to the middle after
each shot (default) or is remembered.

- Physics (`src/game/spin.js`): bounded modifiers on the launch after the strike and before
  the unchanged simulation: spin axis tilt up to 16 degrees at the edge, the start line 1.4
  degrees the other way so the ball bends back toward the aim, backspin +30 to -50 percent,
  launch +10 to -16 percent. Neutral returns the launch object untouched, so the carry ladder
  is exact (tested). `SPIN_SIGN` is the one place the curve direction is fixed (a positive tilt
  curves right, checked against the real simulation in tests/spin.test.js); the dot's x is in
  world terms and only the labels follow the hand.
- Carry: never more than neutral. A carry guard sets the ball speed so the flat, calm carry is
  exactly (1 - 0.06 r^2) of neutral, r being the distance from the center (about 6 percent less
  at the edge), found by bisection on the real simulation per club, shot type and dot position
  and cached. Roll is free to change: that is the point of topspin and backspin.
- Risk: the strike model's error grows by 0.14 r^2, so a big shape raises the mishit chance a
  little; neutral is unchanged.
- Reach (`src/data/spinControl.js`, every multiplier and cap in one file): a Common club
  reaches half way to the edge; Uncommon 60, Rare 70, Epic 80, Legendary 100 percent (the
  reward for the tier's smaller sweet spot); a golfer perk by archetype adds up to 25 percent
  (Links Player most, Power Hitter and Putting Specialist least), never past the edge.
- Shown: the aim fan bends along the predicted flight (its sideways offset read off the
  prediction's points) and the landing marker moves with it; the panel reads "Curves 8 yd
  left. Rolls about 8 yd. Carry 181 yd." and updates while the dot moves (the prediction once
  per frame, the power guide when the finger lifts). The power guide includes the dot.
- Checked through real touch on the range with a Common 5 iron (qa/proof/spin-shots): the
  Draw quick button moved the planned landing 7 yd left of neutral, the Fade 7 yd right; a real
  swing with each (pured) carried 179.5 and 181.9 yd against a neutral 183, finishing 0.7 and
  16 yd right of the aim in a crosswind that pushed the neutral shot 9 yd right. Backspin cut
  the roll from 8.6 to 8.0 yd, topspin raised it to 11.7 yd.

## Shot types

`src/data/shotTypes.js` holds every type as data: launch, spin and speed multipliers, the power
range, the clubs, the lies, a mishit multiplier for the strike model, the roll it promises
against Normal, and how Campaign unlocks it. Normal is the physics module's Full shot,
unchanged (tested against the carry ladder).

| Type | Clubs | Lies | Speed, launch, spin | Power | Mishit | Roll | Campaign |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal | all | all but green and water | 1, 1, 1 | 0 to 1 | 1 | normal | always |
| Stinger | DR, 3W, 5W, 4i, 5i | tee, fairway, first cut | 0.98, 0.72, 0.65 | 0.6 to 1 | 1.25 | more | Punch node |
| Knockdown | 4i to GW | tee, fairway, first cut, rough | 1, 0.82, 0.82 | 0 to 0.85 | 0.9 | more | Punch node |
| Punch | 5W, irons, wedges | all but sand | 0.9, 0.58, 0.75 | 0 to 1 | 1 | more | Punch node |
| High | 5W, irons, wedges | tee, fairway, first cut, rough | 0.97, 1.2, 1.1 | 0 to 1 | 1.15 | less | High node |
| Flop | SW, LW | fairway, first cut, fringe, rough | 0.72, 1.4, 1.05 | 0 to 1 | 1.8 | less | Flop node |
| Pitch | PW, GW, SW, LW | all but sand | 0.6, 1.15, 1.2 | 0 to 1 | 1.05 | normal | always |
| Chip | 7i to LW | fairway, cuts, fringe, rough | 0.42, 0.85, 0.8 | 0 to 1 | 0.8 | more | always |
| Bump and run | 5i to PW | fairway, first cut, fringe | 0.46, 0.5, 0.4 | 0 to 1 | 0.85 | more | Bump node |
| Bunker splash | GW, SW, LW | sand only | 0.55, 1.3, 0.7 | 0 to 1 | 1 | less | always, automatic |

- Flat, calm, from a pure strike (yards): Driver Normal carries 250 and rolls 12 with a 33 yd
  apex, the Stinger 216, 23 and 16; a 7 iron Normal 163 (apex 26), Knockdown 131 (13), High 155
  (29), Punch 127 (9); a sand wedge Flop carries 56 with an 18 yd apex and 2 yd of roll.
- The shot row (in the shot panel and the club list) shows only what the club in hand can play
  from this lie, each with its carry, and scrolls sideways. In a greenside bunker (within 55 m
  of the pin) a wedge splashes automatically.
- Quick Play offers every type by default; a setting ("Every shot type in Quick Play") switches
  Quick Play to the Campaign's unlocks. Campaign unlocks through the existing skill tree, with
  no new nodes: the Stinger and Knockdown come with the Punch node, Pitch, Chip and the splash
  are always there.
- The computer players use them (in rounds; the balance simulator keeps its plain plan so its
  numbers compare across builds): a splash from a greenside bunker, a pitch from 30 to 70 m, a
  stinger off the tee and a knockdown approach into a headwind stronger than 5.5 m/s.
- The old extra shot list (`src/game/shots.js`) is folded into the data file; the ids stay the
  same, so saves and skill trees are unaffected.

## The pros

Twelve invented tour pros in `src/data/pros.json`, two for each archetype, each with a color
and an emblem (a plain geometric mark; no faces or figures), a signature shot, five stats on
the campaign scale, club preferences and a short bio. The names, bios and colors can be edited
in that file (its note says so); ids are what saves refer to and stay fixed. None is based on
a real person.

- Matched level: every pro's five stats add up to 340, inside the archetype's caps, and the
  innate perks grow as for a level 30 golfer. The profile comes from the campaign golfer's own
  mapping and caps (`profileFromStats`, factored out of `golferProfile` with identical
  results), so no pro can exceed what a campaign golfer can reach.
- Playable: Quick Play, the Daily challenge and Tournaments have a "Play as" row (you, or any
  pro): the round then uses the pro's profile, perks, spin reach and name. Your own golfer and
  gear progress are untouched.
- Opponents and rivals: Quick Play's rival can be any pro (or the adaptive rival as before);
  a computer pro flies with its own profile and perks, uses the shot types, and follows its club
  preferences (a 3 wood off the tee where it prefers one, its own wedge for pitches and
  splashes). All twelve play every tournament, except the one you play as.
- Campaign: your golfer stays your own; one pro can be your mentor (Character, Choose a
  mentor), which unlocks that pro's signature shot in every event. You can change mentor at
  any time and the shot changes with them.
- Balance (`node scripts/sim/balance.mjs 200 4 pros`, qa/balance-pros.md; and
  tests/pros.test.js, which plays 200 rounds per pro on every verify): with a tour swing (skill
  0.85) the pros average 2.85 under par per 18 and every one is within 0.71 of that average;
  with an average swing (0.6) they average 4.13 over and every one is within 0.84. The rule is
  1.5.
- The round keeps a pro player's id, archetype and club preferences (bounded and checked) so
  saved rounds resume with them.

## Augusta National and St Andrews

Two real courses built as procedural approximations in the same hole format as the invented
ones (`src/course/realCourses.js`; names in `REAL_COURSE_NAMES`, sources in ASSETS.md).

- Cards: each hole plays its official yardage and par (Augusta National at the 2026 Masters,
  7,565 yards; the Old Course at the 150th Open, 7,313 yards; both par 72). The Old Course has
  two par 3s and two par 5s; Closest to the Pin plays both par 3s there.
- Hole specs: the generator (`course/layout.js`) reads an optional spec per hole: dogleg
  direction and size, water ('front', 'greenside', 'along'), a burn or creek across the hole,
  the sea side, a double green (half as large again, long across the line), bunker counts and a
  named big bunker. Courses without specs take the same random draws in the same order, so the
  five invented courses are unchanged (the course tests pin them).
- Looks: Augusta has tall pines over pink and white azaleas in bloom (two new procedural
  flowering shrubs), lush green turf, pine straw, dark still ponds, and big, steeply tilted
  greens. St Andrews has no trees: gorse with yellow flowers (a third procedural shrub) in
  clumps, browned fescue, pot bunkers, a sea shore on several holes, wide fairways, and a
  stronger, gustier wind.
- Conditions (`course/conditions.js`, bounded): green speed 0.8 to 1.35 (green roll
  deceleration divided by it) and firmness 0.8 to 1.4 (fairway, first cut and tee roll
  deceleration divided by it, a livelier and less soft bounce; rough gets half). Augusta: green
  speed 1.28, firmness 1.08. St Andrews: green speed 1.05, firmness 1.35. The five invented
  courses have no conditions, and the ball then reads the base surface table exactly as before;
  only a course that sets conditions passes a surface lookup to the simulation (`env.props`).
- Everywhere courses appear: Quick Play, the Daily challenge's pick, Tournaments, the map, the
  time-of-day presets, quality tiers (they follow the same tier settings), the smoke test gate
  (`qa/gate.json`) and the course invariant tests (18 holes, par 72, the official card, cups on
  greens, physics and renderer agreement, and the signature features above).
- A latent bug found on the way: the terrain sets a stream's water level from its outline, and
  for any stream wider than 2 m every outline point was skipped, so the stream was never carved.
  It silently removes most streams on the invented courses. The real courses' burns use a
  corrected rule; the invented courses keep the old one so they stay exactly as they were.
  Fixing it for them is a one-line change, left for a human decision because it adds hazards to
  existing holes.

- Golden hour and dusk: the first verify of this part failed its smoke because Augusta clipped
  2.6 percent of the frame (the limit is 2): the pines cast long low-sun shadows over the
  fairway and the meter raised the exposure until the sky blew out. The pines now stand a
  little further back and a little shorter, and the turf is a touch lighter (golden 1.1
  percent, dusk 1.6 percent). Look only.

## Community holes (the level creator)

Anyone can make a hole, test it and share it. Reading is public; publishing, liking, reporting
and counting plays need a signed-in game account (the server checks it and limits publishing to
10 a day and 100 in all, and hides a hole at 5 reports).

- Format (`src/game/level.js`): compact JSON with a version field: `{ v, name, theme, seed,
  tee, pin, bend (0 to 2 points), green, bunkers, water, rough, hills, trees }`, positions in
  meters with the tee near the origin. `parseLevel` is strict and never throws: unknown fields
  or a wrong version are refused, numbers are clamped to the play area and the size limits,
  lists are capped (40 hazards, 400 trees), names go through the profanity filter, and the whole
  hole must fit in 20 KB. A fuzz test throws 4,000 random and broken inputs at it.
- Par comes from the distance along the tee, the bends and the pin (up to 250 yards par 3, up to
  470 par 4, else par 5). Plain problems block a test: "The pin is in the water.", a bunker on
  the green, a tee in the water, too short, too long.
- The same hole builder: a level becomes a one-hole course on its theme's look; the hole
  generator (`course/layout.js`) follows the level's route and places its hazards, the terrain
  adds its hills, rough and trees, and the physics, renderer and map read it like any hole.
- Create (main menu): six templates (a short par 3 over water, a dogleg par 4, a long par 5,
  links, desert, alpine), a random hole and a blank one, plus your drafts.
- Editor: a top-down map. Drag the tee, the pin and the bend handles. Big buttons place a
  bunker, water, trees, rough or a hill beside the fairway; drag a piece to move it, pinch with
  two fingers to resize the selected one, and Delete removes it. Green size cycles small,
  medium and large; Add bend adds a second corner; Decorate lines the hole with trees and rough.
  Undo and redo, the name box, par and length, and the first problem under the map.
- Test play starts the hole at once and comes back to the editor. Publishing needs one finished
  test (holed, not picked up) of the hole exactly as it is now; any change needs a new test.
- Community holes: New, Top and Mine, with a drawn thumbnail, name, author, par, length, likes
  and plays. Play, Like, Report (three plain reasons), Share (a `#level=<id>` link that opens a
  preview) and Delete for your own. Play random. Finishing a community hole posts your strokes
  to the scores table on the board `lvl:<id>` (the server allows board names up to 40
  characters; this is exactly 40) and shows the best and your best.
- Drafts are kept on the device (20). A publish made offline waits and goes out when the
  connection is back. Delete my data also removes your holes.
- Ease: from the Create tile to a published hole, from a template, signed in: Create, the
  template, Test play, Skip flyover, the swings and any putt read, Back to the editor, Publish.
  Measured with real taps at both phone sizes (`scripts/tools/levels.mjs`): 11 taps at 390x844
  and 10 at 844x390, counting every swing and aim nudge, the flyover skip and the first-run tip;
  5 of them are menu taps. The target was 25.

## Stage 10: proof and deploy

Screenshots of every new screen at 360x640, 390x844, 844x390, and 1024x768 with the layout
check; a range session, a campaign event, and a daily challenge played through real taps;
the same deploy routes as before (Vercel with existing credentials, then the GitHub Pages
flow, then another host with credentials already in the environment), Supabase values passed at
build time when present, and a live test at phone size.

As done: 22 screens at all four sizes with no overflow, buttons under 40 px, clipped text or
overlapping controls, and the tutorial completed at every size; a Target points session, the
first campaign event and the daily challenge through real touch on the gated build. Vercel had
no login or token (the `--temporary` mode was not used); the gated build went to the
`gh-pages` branch and is live, built without Supabase values, so cloud sync is dormant there.
Live checks and a live 3-hole tap-through at 390x844 found no errors.
