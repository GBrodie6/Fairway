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
never longer (the existing flier lie is the only exception). A higher tier costs risk: a
smaller sweet spot (more mishits) and harsher mishits (severity times the square root of its
difficulty). In return it gets three bounded benefits, none of which adds carry (`src/data/
tierBenefits.js`, see "Tier benefits" below): a crosswind moves its ball less, rough, sand and
bad lies cost it less, and the ball-contact dot reaches further for draw, fade, backspin and
topspin (`src/data/spinControl.js`).

| Tier | Difficulty (mishit severity) | Sweet spot | Crosswind push | Lie penalties | Spin dot reach | Carry |
| --- | --- | --- | --- | --- | --- | --- |
| Common | 1.0 | 1.00 | full | full | 50 percent of the pad | the table carry |
| Uncommon | 1.5 | 0.95 | 5 percent less | 8 percent smaller | 60 percent | the table carry |
| Rare | 2.0 | 0.90 | 10 percent less | 15 percent smaller | 70 percent | the table carry |
| Epic | 2.6 | 0.85 | 15 percent less | 22 percent smaller | 80 percent | the table carry |
| Legendary | 3.2 | 0.80 | 20 percent less (the cap) | 30 percent smaller (the cap) | 100 percent | the table carry |

The difficulty and sweet spot values were retuned with the tier benefits (they were 1.25 to
2.2 and 0.92 to 0.68); see "Tier benefits" for why and for the balance tables.

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
- Tiers, with tier benefits (current): see "Tier benefits" below. The runs now cover all seven
  courses and three conditions (calm fairway play, normal, wind and rough).
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

## Tier benefits

Higher club tiers now give real benefits that never add carry. All values and caps are in one
file, `src/data/tierBenefits.js`; the cost stays in `src/game/strike.js` (RARITY).

| Tier | Crosswind push | Rough, sand and bad lies | Spin and shape range | Sweet spot (cost) | Mishit severity (cost) |
| --- | --- | --- | --- | --- | --- |
| Common | full | full | 1x (50 percent of the pad) | 1.00 | 1.0 |
| Uncommon | 5 percent less | 8 percent smaller | 1.2x | 0.95 | 1.5 |
| Rare | 10 percent less | 15 percent smaller | 1.4x | 0.90 | 2.0 |
| Epic | 15 percent less | 22 percent smaller | 1.6x | 0.85 | 2.6 |
| Legendary | 20 percent less | 30 percent smaller | 2x (the edge) | 0.80 | 3.2 |
| Cap | 20 percent (WIND_CAP) | 30 percent (LIE_CAP) | 2x (RANGE_CAP; the pad's edge also caps it) | | |

- Wind: the part of the wind blowing across the line of the shot is scaled by (1 - wind) for
  that shot (`tierWind`, by the launch heading); the part along the line acts in full. A first
  version scaled the whole wind, which let a Legendary ball carry further than a Common one into
  a headwind; that is extra carry, so only the crosswind is reduced. Measured: an 18 mph
  crosswind pushes a Common 7 iron 20.8 yd offline and a Legendary one 16.6 yd (20 percent
  less; a driver 28.3 and 22.6 yd), and the Legendary carry is 0.3 yd shorter, never longer; with
  the wind straight behind or in front, both carry the same to 0.1 yd (tests allow 0.01 m).
- Lies: the speed a lie takes away (through the profile's existing `recovery`) and the spin it
  takes away (a new optional `profile.lieRelief`, 0 by default, so the base swing math is
  unchanged) shrink by the same share, and so do the lie and slope terms of the strike model
  (more and worse mishits from a bad lie). The carry moves toward the clean carry and never past
  it: a flyer lie in the rough, where a wedge already carries a little past its table carry with
  less spin, gains nothing (a test checks every club, lie and lie roll for every tier).
- Spin and shape range: the existing wider reach of the ball-contact dot, now the table's third
  value (`data/spinControl.js` reads it).
- Pured carry: from a fairway or a tee in calm air, a Pured strike carries exactly the table
  carry with every tier (tests/tierBenefits.test.js, and the existing carry tests unchanged).
  Common shots go through the same code bit for bit (the same wind function and profile).
- Shown: the gear card and the compare view have Wind and Bad lies bars with the real
  percentages, the Spin range bar, and the two costs (Forgiveness, Mishit cost), plus three
  plain lines ("Crosswind moves the ball 20 percent less", "Rough, sand and bad lies cost 30
  percent less", "Spin and shape range 2x"). The power guide and the aim fan use the tier's wind
  and lie, so the mark stays exact in wind and rough too.
- Cost retuned: with the benefits, the old cost (Legendary sweet spot 0.68, severity 2.2) left
  an average swing on calm fairways 0.52 strokes worse than Common, outside the 0.3 target. The
  sweet spot is the lever that reaches an average swing; severity mostly reaches a poor swing
  (it mishits two to four times as often). Legendary is now sweet spot 0.80 and severity 3.2.

### Balance (qa/balance-tiers.md, 3,000 paired rounds per cell, all seven courses)

Conditions: calm fairway play (no wind, every lie through the green played as a flat fairway
lie), normal (each course's wind and lies), wind and rough (a 10 to 20 mph gusty wind and every
fairway lie played as rough). Legendary against Common, strokes per 18 (negative is better):

| Swing | Calm fairway play | Normal | Wind and rough |
| --- | --- | --- | --- |
| Poor (0.35) | +0.58 (0.39 to 0.77) | +0.33 (0.05 to 0.60) | +0.14 (-0.16 to 0.43) |
| Average (0.6) | +0.21 (0.08 to 0.33) | +0.21 (-0.01 to 0.44) | -0.01 (-0.27 to 0.25) |
| Skilled (0.9) | +0.02 (-0.02 to 0.06) | -0.17 (-0.32 to -0.01) | -0.81 (-1.02 to -0.60) |

Targets: Legendary 0.3 to 1.0 strokes better for a skilled swing in wind and rough (-0.81,
met); no better than Common for a poor swing (+0.58, +0.33, +0.14, met); within 0.3 of Common
for an average swing on calm fairway play (+0.21, met). For a skilled swing in wind and rough
every step helps a little more: Uncommon -0.31, Rare -0.52, Epic -0.65. For a poor swing in
wind and rough, Uncommon (-0.20) and Rare (-0.14) come out slightly better than Common, both
within noise (their intervals reach 0). The simulated golfer does not use the spin pad, so the
third benefit is not in these numbers. Tuning notes: with the whole wind scaled, a skilled
swing gained 1.86 strokes in a 15 to 25 mph test wind (wind alone 1.56, lies alone 0.53); the
crosswind-only rule and a 10 to 20 mph windy round brought it into the target.

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

## Course scenery 1: how a hole stands alone (before)

- Holes: `generateHole` (course/layout.js) builds each hole alone from the course seed and its index (the card yardage and a spec per hole on the two real courses), in its own frame: back tee at the origin, tee to green turned to run down -Z. No hole knows where another one is; `bearing` only turns the sun.
- Ground: `buildTerrain` makes one 1 m heightfield, shared by the ball and the renderer, over the hole's bounds (the corridor plus 92 m a side, 70 m more on a sea side, 112 m behind the tee, 150 m past the green); past them plus 6 m the ball is out of bounds. Drawn as 96 m chunks with 1 to 16 m LOD steps and skirts.
- Around it: one outer mesh of the same macro function on cells growing from 10 m to 110, 160 or 220 m (high, medium, low) out to about 6.6 km, starting 4 m inside the grid so the seam matches. The backdrop (hills, mesas, mountains) rises from 380 m to 2.4 km from the hole's center, coastal holes fall to a beach and the sea, wooded courses get a canopy and a ring of impostor trees, and 4 stand-in flags stand at random 170 to 420 m out. Post-pass height fog and aerial perspective (about 0.0006 per m, capped at 0.85) fade the distance; the far plane is 14 km.
- Cost, parkland hole 1, 960x540 drawing buffer, headless Chrome with SwiftShader (CPU rendering: compare rows, not devices), renderer.info and the median ms per frame of 6 batches of 3 synced frames after the draw counts settle (`scripts/tools/scenery-bench.mjs`, `qa/proof/scenery/bench-before.json`):

| tier | tee (address) | flyover | green |
| --- | --- | --- | --- |
| low | 111 draws, 248k tris, 1,205 ms | 106 draws, 223k tris, 1,324 ms | 106 draws, 197k tris, 1,197 ms |
| medium | 112 draws, 455k tris, 3,555 ms | 119 draws, 404k tris, 2,750 ms | 96 draws, 448k tris, 3,116 ms |
| high | 135 draws, 1,009k tris, 5,713 ms | 131 draws, 927k tris, 4,125 ms | 117 draws, 814k tris, 5,237 ms |
| ultra | 147 draws, 1,640k tris, 7,255 ms | 151 draws, 1,569k tris, 4,993 ms | 141 draws, 1,431k tris, 6,185 ms |

## Course scenery 2: one world for all 18 holes (the routing)

`course/routing.js` gives every built-in course a routing: for each hole a world position for
its back tee and a heading for its frame, plus the clubhouse. Hole definitions do not change
(pars, yardages, shapes, hazards, pins and the physics ground are the same; a test checks the
definitions and the ground before and after the routing is built). The rules, checked by
`routingProblems` and `tests/routing.test.js`:

- No two playing corridors overlap and at least 60 m separate any two. A corridor is the
  centerline from 10 m behind the back tee to the green, out to the widest fairway half-width
  (or the green) plus the hole's `corridorExtra` (rough, deep rough and tree margin: the band
  the terrain builder treats as the hole's own).
- Each hole's back tee is 24 to 100 m from the edge of the previous green. Where two holes meet
  (the last 150 m of one and the first 150 m of the next, at most half a hole), and where the
  1st and 10th tees and the 9th and 18th greens gather at the clubhouse, the corridors may come
  closer; along the rest of each hole the 60 m holds.
- On the invented courses no corridor reaches the coastline beside a coastal hole (along that
  hole's length), so the sea one hole shows is never where another hole lies.
- Deterministic: a seeded search with no clock or Math.random.

The search places hole after hole: for each, tee spots around the last green (3 walk lengths,
11 directions) and every 15 degrees of heading, cheapest first; a candidate that breaks a rule
is skipped, and a dead end backs up. Invented courses pay for wandering from the clubhouse late
in each nine and for boxing in the next green. The search takes 66 ms to 1.6 s in Node here,
so a phone never runs it: the frames of the 7 built-in courses are stored in
`course/routingData.js` (`scripts/tools/routing-build.mjs`) and a test solves them again and
requires an exact match. A community level (one hole) is solved on the spot.

Augusta National and the Old Course use the real routing from OpenStreetMap (the mapped tee to
green line of each hole and the clubhouse; data (c) OpenStreetMap contributors, ODbL; see
`course/realRouting.js`). The same search runs with a cost that keeps each hole's real turn from
the hole before, its real direction and its real walk from the last green, with a pull toward
its real position spread out by 1.35 from the clubhouse (the 60 m rule needs more room than the
real courses have). Results (`qa/proof/routing/`, maps with the real lines dashed in red; the
least gap is measured as the rules measure it, joints and clubhouse ends left out):

| course | source | least gap (holes) | walks, green edge to next tee | 18th green to 1st tee | size | real direction within 10 / 30 degrees |
| --- | --- | --- | --- | --- | --- | --- |
| parkland | generated | 62.3 m (8, 9) | 24 to 100 m | 432 m | 1428 x 1572 m | generated |
| links | generated | 60.9 m (14, 15) | 24 to 100 m | 3066 m | 1874 x 3488 m | generated |
| desert | generated | 60.5 m (2, 3) | 24 to 100 m | 576 m | 1285 x 1344 m | generated |
| alpine | generated | 60.6 m (5, 6) | 24 to 100 m | 324 m | 1352 x 1273 m | generated |
| tropical | generated | 63.4 m (3, 4) | 24 to 100 m | 1776 m | 2700 x 1541 m | generated |
| augusta | OpenStreetMap | 60.4 m (8, 9) | 24 to 100 m | 962 m | 1639 x 1625 m | 11 / 16 of 18 |
| standrews | OpenStreetMap | 60.4 m (9, 10) | 24 to 100 m | 513 m | 2174 x 2723 m | 6 / 11 of 18 |

What does not match the real courses, plainly: the corridors of both real courses are closer
than 60 m in places and the Old Course shares fairways and double greens, so holes move apart.
On the Old Course the real 11th crosses the 7th, which corridors that may not overlap cannot do,
so the loop at the far end turns the other way and the inbound nine comes back on the east side
of the outbound nine instead of the west. The game's specs for the Old Course put the sea on
the left of the 10th and 11th, which faces inland on the real routing, so the real courses are
not held to the coastline rule; the scenery does not draw other holes inside the current hole's
sea. The 18th green does not come back to the clubhouse on most courses (from 324 m on the alpine
course to 3.1 km on the links, where every coastal hole must keep the others off its sea side,
so the course runs along the coast as a long chain); coming home is not one of the rules, and
the clubhouse is drawn where the round starts. On Augusta 11 holes keep the real direction
within 10 degrees and 16 within 30 (the 17th is turned 115 degrees); on the Old Course the first
six follow the real line exactly, 11 are within 30 degrees, and the 10th and 11th turn the
other way (105 and 120 degrees).

## Course scenery 3: the other holes around the one in play

`render/scenery.js`, built when a hole starts (`world.loadHole`) and freed when it ends. Each
other hole is a flat, vertex-colored drape laid on the outer ground: its rough corridor (not on
Low), fairway, green, tees, bunkers, ponds and streams, and a flag at its pin, plus a few cone
trees (a 6-sided cone over a 3-sided trunk, sized and colored per course) along its tree line
and behind its green. No textures, grass, shadows, particles or props. Colors are the terrain's
own far-distance averages for each surface, so a far fairway matches a near one.

- Two draw calls whatever the number of holes: one mesh holds every hole's drape, one instanced
  mesh every tree. Each frame a bounding sphere per hole decides which holes are within the
  distance limit (1,400 m Low, 2,000 m Medium, 2,700 m High and Ultra) and in view; only when
  that set changes are their index ranges and tree instances copied into what is drawn.
- Far holes fade out before the limit (the drape's alpha from 72 percent of it, the trees
  shrink from 78 percent), so nothing pops, and the post pass's aerial perspective and fog fade
  them on the way. Trees within 14 to 24 m of the camera shrink away, so no camera ends up
  inside one.
- Shadows skip both meshes, and so does the AO pass's own scene render (`post.state.noAo`), so
  they cost two draw calls on every tier.
- The budget is enforced on what is built, so whatever is drawn fits: trees go first from the
  farthest holes, then whole far holes, until the triangles fit.
- Ground: with the scenery on, the outer landscape (the same macro function as the hole's
  grid) flattens the mesas and ridges near the other holes' corridors and lets the backdrop
  relief rise beyond them, and clears the forest canopy and the outer ring of impostor trees
  off their corridors; within 10 m of the detailed grid nothing changes, so the seam is
  untouched, and with the scenery off the ground is exactly as before. The drape is laid on the
  outer mesh's own triangles (`outerSurfaceAt`), 0.35 m up with a polygon offset.
- Woods: the first look showed the current hole's own woods standing where the other holes'
  rough is (the hole's grid reaches about 30 m into the next corridor) and a solid wall across
  the 60 m between holes. With the scenery on, this hole's trees now stop at the other holes'
  corridors and thin toward them across the gap (to 40 percent at the far side, full near this
  hole). Trees take no part in the ball's flight, so this changes only what is drawn.
- Colors: the plain lighting of the drape came out brighter than the terrain shader, so the
  turf colors are taken down by a fifth to sit with the hole's own far fairway (by eye).
- What shows where: from the flyover and other high views the other holes show on the
  desktop; on wooded courses (parkland, alpine, Augusta) the woods between holes hide them at
  eye level from the tee and the green, as on a real wooded course, and a portrait phone sees
  only about 27 degrees across, so it shows fewer of them than a desktop. From a coastal hole,
  holes that lie in its sea are not drawn: its coastline runs on past its ends (the game draws
  the sea to the horizon), and the routing keeps other holes out of it only along the hole's
  own length. How many other holes have anything drawable, per hole
  (`qa/proof/scenery/drawable-holes.json`): all 17 from every hole of parkland, desert, alpine
  and Augusta; links 11.3 on average (1 from the 18th, 3 from the 2nd and the 17th);
  tropical 15.7 (2 from the 9th); the Old Course 15.3 (2 from the 1st, whose sea in the game's
  spec lies to the north, where the real outward nine runs). A cost in the search for
  avoiding coastal holes' seas past their ends was tried and did not help (links 11.0,
  tropical 15.2), so it was left out.
- Physics: nothing here touches it. The drape stops at the edge of the current hole's grid (2 m
  out) and outside its coastline, so where the ball can land on this hole's own ground nothing
  else is drawn; a ball that flies onto another hole lands where it always did (out of bounds
  past the grid). The stand-in flags of the old outer ground are left out when the real holes
  are drawn.
- Setting: Settings, Graphics, Show other holes: On or Off. Until it is changed it follows the
  quality: On for Medium and up, Off for Low. Changing it (or the quality) rebuilds the world,
  as a quality change always has. `?scenery=1` or `0` overrides it for QA.

Checks (`qa/proof/scenery/`): the renderer and physics agreement check, with the other holes
forced on at Medium, passes on all 7 courses (99.96 to 99.99 percent of 27,648 surface
samples, mesh heights within 0.1 mm; `agreement.json`), and the smoke test's own run (Low,
other holes off) passed in every verify. Cameras (`cameras/`, 390x844, Medium, a real swing
aimed off the hole at the nearest other hole): over the whole flight the ball-follow camera
stayed 1.2 m or more above the ground drawn under it on every course (28 to 48 of its frames
were past the hole's grid, over the other holes' ground), and the nearest full-size tree of
another hole was 10 m or more away on 6 courses; on Augusta one came within 2 m, which is
inside the 14 m where trees shrink to nothing, so the camera was never inside one. The
address, flyover and green views drew 0 to 7 other holes depending on the course and the
woods; on links hole 1 none (the holes near it lie in its sea), so that course fails the
tool's own "the flyover draws another hole" line. Settings (`setting.json`, real mouse at
1920x1080 and touch at 390x844): Low shows Off and draws nothing, On draws 17 holes, Off
removes them, Medium defaults to On, no console errors. Build time when a hole starts, headless Chrome here: the scenery itself 13 to
25 ms, and the outer ground takes 8 to 59 ms longer with the other holes' footprint (for
example 83 against 40 ms on parkland; `agreement.json`).

Cost (`qa/proof/scenery/bench-after.json`, the same tool, hole, views and 960x540 buffer as
the before table in part 1, on SwiftShader). "Scenery off" is the same world with the two
scenery meshes hidden (the ground and woods changes stay), measured in batches alternating with
"on", so the last column is the scenery's own cost, as the median of the six on/off batch
pairs (each pair's ratio in brackets, to show the noise of a CPU rasterizer). The before column
is the old build: the after columns differ from it also because the woods between holes are
thinner. Budgets: added draw calls at most 2, 4 and 6 (Low, Medium, High) and triangles at most
8,000, 25,000 and 60,000: the scenery adds 2 draw calls on every tier, and at most 2,142,
5,165 and 10,055 triangles in these views (3,378, 7,781 and 14,067 built in all on parkland). Frame
cost limits: 10 percent on Low (the largest median is +6.2 percent) and 5 percent on High
(+3.2 percent), so no detail had to be cut. The first run of this table found 3 draw calls,
not 2: three.js draws a transparent double-sided material in two passes, and the drape now
forces one.

| tier | view | before: draws, tris, ms | after, scenery off | after, scenery on | added | frame cost, on / off (median of paired batches) |
| --- | --- | --- | --- | --- | --- | --- |
| low | address | 111, 248k, 1,205 | 107, 257k, 1,146 | 109, 259k, 1,127 | +2 draws, +1,990 tris (9 holes) | +0.0% (-2.5 to +8.8) |
| low | flyover | 106, 223k, 1,324 | 110, 230k, 1,116 | 112, 232k, 1,153 | +2 draws, +2,142 tris (10 holes) | +3.3% (-3.7 to +6.6) |
| low | green | 106, 197k, 1,197 | 98, 196k, 952 | 100, 197k, 1,001 | +2 draws, +1,264 tris (6 holes) | +6.2% (-1.6 to +9.6) |
| medium | address | 112, 455k, 3,555 | 114, 459k, 3,491 | 116, 464k, 3,422 | +2 draws, +4,453 tris (9 holes) | +2.1% (-2.3 to +3.1) |
| medium | flyover | 119, 404k, 2,750 | 113, 392k, 2,572 | 115, 398k, 2,602 | +2 draws, +5,165 tris (11 holes) | +0.8% (-3.2 to +10.6) |
| medium | green | 96, 448k, 3,116 | 96, 445k, 2,735 | 98, 448k, 2,713 | +2 draws, +2,857 tris (6 holes) | -0.8% (-4.0 to +8.1) |
| high | address | 135, 1009k, 5,713 | 135, 951k, 5,571 | 137, 959k, 5,691 | +2 draws, +7,969 tris (9 holes) | +3.2% (-0.4 to +4.0) |
| high | flyover | 131, 927k, 4,125 | 132, 930k, 3,944 | 134, 940k, 3,825 | +2 draws, +10k tris (12 holes) | +0.5% (-5.6 to +1.6) |
| high | green | 117, 814k, 5,237 | 109, 708k, 4,765 | 111, 713k, 4,693 | +2 draws, +5,161 tris (6 holes) | +0.6% (-3.8 to +9.3) |
| ultra | address | 147, 1640k, 7,255 | 151, 1578k, 6,955 | 153, 1586k, 7,054 | +2 draws, +7,969 tris (9 holes) | +1.7% (-1.7 to +9.2) |
| ultra | flyover | 151, 1569k, 4,993 | 157, 1565k, 5,021 | 159, 1575k, 4,978 | +2 draws, +10k tris (12 holes) | +2.1% (-11.2 to +4.6) |
| ultra | green | 141, 1431k, 6,185 | 136, 1363k, 5,754 | 138, 1368k, 5,801 | +2 draws, +5,161 tris (6 holes) | -0.1% (-4.3 to +4.5) |

## Course scenery 4: the course map

`ui/courseMap.js`: a flat drawing of the whole course from the routing and each hole's own
definition, north up: every hole's rough corridor, fairway, green, tees, bunkers, ponds and
streams, a flag on every green, the walks between holes (faint dashes), the clubhouse, and a
number for every hole. In a round the hole in play is outlined in gold, the others are dimmed a
little, and the ball and a dashed line to the pin are drawn, with the distance below.

- Open it from the hole map's Hole and Course toggle (and M: the first M opens the hole map,
  the second the course map, the third closes it), from the scorecard (Course map), and from
  Quick Play's course select (Course map, beside the course cards).
- Drag to move and pinch to zoom on touch (the two fingers' midpoint stays on the same spot),
  the wheel zooms about the pointer on a desktop, + and - and 0 (fit) on the keyboard, and the
  + and - and Fit buttons on screen. Zoom runs from 0.6 to 14 times the fitted size.
- Quick Play: tap a hole (its number or anywhere in its corridor) and Start on hole N sets the
  round's first hole (the round then runs on in order and wraps after the 18th, as Quick
  Play's start hole always has); the setup screen shows Starting on hole N. Closest to the pin
  (par 3s only) has no start hole, so there the map is for looking only.
- Readable at every size: hole numbers are placed in screen space, each trying spots behind its
  tee, beside it and then along its line, and taking the first that overlaps no other label and
  stays inside the part of the screen the controls leave free (measured from the controls
  themselves, so wrapped text along the bottom is allowed for). A label that finds no free spot
  is left out rather than drawn over another (at the fitted zoom every course placed all 19
  labels at 360x640 and 2560x1440: see the proof).

Checked with `scripts/tools/coursemap-check.mjs` on the production build (`qa/proof/coursemap/`):
real touch at 360x640 (taps, a drag, a two-finger pinch through DevTools touch points) and a real
mouse at 2560x1440 (clicks, a drag, the wheel, the M key), on every course: Quick Play's course
card and Course map button, the map fitted (every label placed, no label over another or over a
control, every control on screen and 44 px or more), a drag (the map follows the pointer exactly:
94.3 px for a 94.3 px drag), the pinch or wheel (zoom 3 times or more about the fingers), Fit and
+, a tap on hole 7, Start on hole 7, the setup screen then reading Starting on hole 7, Tee off and
the round starting on hole 7, in the round the hole map's Course toggle (the hole in play
outlined, the ball and its line drawn), Hole back to the hole map, M three times on the desktop
(hole map, course map, closed), and the scorecard's Course map button: 273 of 273 checks passed, 0
console errors. Labels placed (19 is all 18 holes and the clubhouse):

| course | 360x640: labels fitted, zoomed (off screen), in a round | 2560x1440: the same |
| --- | --- | --- |
| parkland | 19, 5 (14), 19 | 19, 9 (10), 19 |
| links | 19, 0 (19), 19 | 19, 8 (11), 19 |
| desert | 19, 4 (15), 19 | 19, 8 (11), 19 |
| alpine | 19, 6 (13), 19 | 19, 8 (11), 19 |
| tropical | 19, 4 (15), 19 | 19, 4 (15), 19 |
| augusta | 19, 7 (12), 19 | 19, 8 (11), 19 |
| standrews | 19, 5 (14), 19 | 19, 6 (13), 19 |

Found and fixed on the way: zoomed in, a hole at the very edge of the screen got no number (its
spots on screen were too close to the edge for the label to fit), so a label now slides inside
the edge; and on the Old Course at 360x640 the long title chip ran into the close button (its
padding was not counted in its width), so it is now sized with its padding and the title is
shorter ("St Andrews (Old Course), par 72"; recheck: `title-recheck/`, 19 of 19). Two failures in
the first runs were the check tool's own timing (a fixed pause after a tap, when a 2560x1440
frame takes seconds on a software renderer) and a button below the fold; the tool now waits for
each expected result and scrolls buttons into view.

Found later, in part 5's live check at 844x390 (a phone on its side, a size this check had not
covered): on the fitted map every course left 1 to 5 hole numbers out, because the map was fitted
into the full-width band between the buttons along the top and the full-width start button and
details along the bottom, about 150 px tall there. Fixed in part 5 (`freeRect`, buttons as
obstacles for the labels, a one-row bottom on short landscape screens); the rerun of this check
at five sizes is in part 5.


## The aim preview leaves the wind out

The preview of where the ball lands (the landing ring at the end of the aim fan, the hole map's
line and ring, the look-ahead camera's landing point, the hazard warning that reads it) and the
HUD's suggested power used to fly the ball in the round's wind, so the player only had to follow
them. Both now fly in still air (`game/controller.js`: `predictShot` and `solvePower` get no wind);
the wind readout stays, and judging the difference is the player's job. The shot itself still
flies in the real wind (each club tier's wind benefit included), the computer players still plan
with the wind, and the fan's width still grows with the wind (it shows how uncertain the shot is,
not which way it goes). Nothing in the ball physics, the swing or the carry rules changed.

Checked in the game (`scripts/tools/wind-preview.mjs`, 390x844, real touch for the swing; `qa/proof/wind/`): in
a windy round the preview and the suggested power are read, then read again with the wind
replaced by still air, then with the wind back; then a real swing at the suggested power.

| course, wind | before: preview moves with the wind | before: power moves | before: shot lands from the preview | after: preview moves | after: power moves | after: shot lands from the preview |
| --- | --- | --- | --- | --- | --- | --- |
| links, 18 mph | 14.7 m | 0.024 | 1.2 m | 0.0 m | 0.000 | 19.6 m |
| standrews, 20 mph | 34.2 m | 0.116 | 2.7 m | 0.0 m | 0.000 | 17.5 m |
| parkland, 7 mph | 7.3 m | 0.035 | 0.8 m | 0.0 m | 0.000 | 9 m |

Before, the preview moved 7 to 34 m with the wind and the shot landed within 3 m of it, so the
preview gave the answer away. Now the preview and the power do not move at all, the preview
with wind is exactly the old build's still-air preview, and the shots landed 9 to 20 m from
it: the wind and the strike are the player's to judge. 0 console errors on both builds. A unit
test (`tests/aimPreview.test.js`) pins the controller to no wind for the preview and the
power and the real wind for the shot, and checks that no wind means still air.


## Course scenery 5: proof, bot rounds and deploy

Screenshots, cut down at the owner's request to a small set: Augusta National, the Old Course
and parkland, hole 1, at address on the tee and on the green, at 390x844 and 1920x1080, Low
tier, one browser job at a time (`qa/proof/scenery/small/`). "Before" is the build of 5b3556b
(the last commit before the scenery), "after" this build with Show other holes forced on
(`?scenery=1`; Low leaves it off by default). `compare-<course>-h1-<size>.jpg` puts the pairs
side by side. The first, larger "before" run (Medium, holes 1, 7 and 14, every course) was
stopped part way when the set was cut down; the 99 pictures it had taken are kept in
`qa/proof/scenery/shots/` (its 30th row, desert hole 14 at 1920x1080, was cut off by the stop;
0 console errors in the rest), and no "after" run of that larger set was made.

| Course | Size | View | Draws before | Draws after | Triangles before | Triangles after | Other holes drawn |
|---|---|---|---|---|---|---|---|
| Augusta National | 390x844 | Tee | 82 | 82 | 212k | 211k | 1 |
| Augusta National | 390x844 | Green | 48 | 50 | 134k | 124k | 0 |
| Augusta National | 1920x1080 | Tee | 88 | 86 | 244k | 239k | 7 |
| Augusta National | 1920x1080 | Green | 52 | 58 | 158k | 152k | 1 |
| Old Course | 390x844 | Tee | 56 | 54 | 130k | 130k | 0 |
| Old Course | 390x844 | Green | 42 | 37 | 122k | 124k | 0 |
| Old Course | 1920x1080 | Tee | 66 | 66 | 176k | 179k | 0 |
| Old Course | 1920x1080 | Green | 46 | 41 | 159k | 166k | 0 |
| Parkland | 390x844 | Tee | 113 | 119 | 215k | 221k | 4 |
| Parkland | 390x844 | Green | 91 | 91 | 156k | 166k | 2 |
| Parkland | 1920x1080 | Tee | 123 | 121 | 251k | 261k | 9 |
| Parkland | 1920x1080 | Green | 108 | 101 | 197k | 197k | 6 |

0 console errors in both runs. The totals move both ways because more than the scenery's two
draw calls changes with it on: the woods thin toward the other holes, the outer canopy and
impostor trees clear off their corridors and the old stand-in flags are left out (Part 3), so
other draw calls drop as the scenery's are added. The budgeted cost of the scenery itself is the
Part 3 table. What the pictures show, looked at by eye: at eye level on these wooded holes the
change is mostly that the woods are thinner; the other holes, though counted as drawn (9 from
parkland's 1st tee on the desktop, 7 from Augusta's), sit low behind the trees and show only
in glimpses through the gaps. From the Old Course's 1st nothing else is drawn, because the
holes near it lie in its sea (Part 3), so its before and after look the same. The other holes
read clearly only from high views (the flyover pictures of Part 3).

An 18-hole bot round on every course (`qa/proof/scenery/bot/`, `node scripts/bot.mjs --course
<id> --holes 18 --view portrait --tier low --scenery 1`), one after another with one browser at a
time: production build, 390x844, real touch through the DevTools input domain, Low tier with Show
other holes forced on, so the scenery is built and torn down on every hole. At the end of each
round the bot checks every hole's score on the round's scorecard (the game's own score list)
against the strokes it counted itself (one per swing, plus one per penalty the game announced)
and against the score in that hole's summary.

| Course | Holes | Strokes | To par | Shots | Minutes | Stuck | Console errors | Scorecard |
|---|---|---|---|---|---|---|---|---|
| Parkland | 18 | 66 | -6 | 66 | 33.9 | 0 | 0 | matches |
| Links | 18 | 72 | 0 | 72 | 34 | 0 | 0 | matches |
| Desert | 18 | 69 | -3 | 69 | 34 | 0 | 0 | matches |
| Alpine | 18 | 68 | -4 | 68 | 43 | 0 | 0 | matches |
| Tropical | 18 | 64 | -8 | 64 | 32.8 | 0 | 0 | matches |
| Augusta National | 18 | 83 | +11 | 83 | 47.6 | 0 | 0 | matches |
| Old Course | 18 | 81 | +9 | 81 | 34.2 | 0 | 0 | matches |

No round had a penalty stroke, so the scorecard check did not exercise penalties this time. The
bot swings at the HUD's suggested power, which now leaves the wind out, and makes no allowance
for the wind itself, so its scores say little about how hard a course is. One hole to look at:
on Augusta's 17th a putt from 0.67 m lipped out and ran on 10 m into the rough, and the hole
ended at the stroke limit (9). Nothing in the ball physics, the putting, the course data or the
hole definitions changed in this work (`git diff --stat 5b3556b HEAD -- src` touches none of
them), so this is the existing putting on that green, not something the scenery caused; it was
not looked into further.

The community creator, rerun on this build with the same tool as its own proof
(`node scripts/tools/levels.mjs qa/proof/scenery/creator/run <size> demo`, the build's
in-memory cloud, real touch including a two-finger pinch), at 390x844 and 844x390
(`qa/proof/scenery/creator/`): sign up, a template to a published hole, find it under New, like,
Top, Mine, share link, play it from the card, delete it; every editor control (tee, pin and
bend drags, the palette, a bunker dragged and pinched, delete, undo, redo, the pin dragged into
water, a bad name); publish while offline and out when back; Delete my data. Everything came out
as in the earlier proof (`qa/proof/levels/`) except the test shots' distances and Decorate's
random count; taps to a published hole 11 at 390x844 and 13 at 844x390 (10 before: the putt read
took 4 nudges instead of 1, which depends on where the test shot stopped). 0 console errors at
both sizes. The creator's own code did not change in this work.

A community hole is a course of one hole, so no other holes are built around it, and its course
map shows that one hole and the clubhouse. `node scripts/tools/level-maps.mjs` checks it in the
game at 390x844 (Low with Show other holes forced on, touch) and 1920x1080 (Medium, where it is
on by default, mouse): Create, the par 3 template, Test play, then the map button, the hole map's
Course toggle, Hole back, and close; the scenery reports nothing built, the course map labels the
one hole and the clubhouse, play goes on afterwards, 0 console errors
(`qa/proof/scenery/creator/maps/`, 9 of 9 checks at each size).

Full verify on 6db3896 (the commit with this section's first part), in a separate worktree:
495 of 495 unit tests (42 files), the production build (43.49 MB), and the smoke run over every
course and time of day, 56 of 56 combinations inside the luma and clipping bands, with the
renderer and physics agreement at 99.97 to 99.99 percent on all seven courses. Its `dist` is
byte-identical (SHA-256 of all 168 files) to the one the bot rounds and the creator checks above
ran on.

Deploy, the same routes in order: Vercel had no `VERCEL_TOKEN` and no stored login, and the
temporary mode was not used; the GitHub Pages flow worked: the verified `dist` went to the
`gh-pages` branch (a430eaa), the staged tree's hashes matched it before the push, and once the
site served the new bundle all 168 files were fetched from it and matched the verified build
byte for byte. Live checks (`qa/proof/live-6db3896/`, `NOTES.md` there): the live tool at
390x844 and 1366x768, the course map at 390x844 and 1920x1080 (78 of 78), the desktop proof at
1920x1080 (8 screens), the other holes at Medium with their course maps, the maps inside a
community hole (9 of 9 at each size), and 3 holes of Augusta National played by the bot through
real touch. 0 console errors in every one.

The same live checks at 844x390 (`qa/proof/live-6db3896/*-844`), the one size of the three
asked for that the earlier checks of the scenery and the course map had not covered, found a
real fault: the course map check failed 13 of 133, all the same, a fitted map leaving 1 to 5 hole
numbers out on every course (and the Old Course's 18 in a round). Everything else at 844x390
passed on the live site: the other holes at Medium (the course map opened in a round placed
all 19 labels on parkland and Augusta; the commit message of 534b1cf wrongly says it left labels
out, corrected in 94690dd), the maps inside a community hole (9 of 9), and 3 holes of the Old
Course played by the bot with the mouse in landscape (13 strokes, 0 stuck, 0 console errors,
scorecard matches).

The fix (`ui/courseMap.js`, `ui/styles.css`): the map was fitted into the full-width band
between the buttons along the top and the full-width start button and details along the
bottom, about 150 px tall on a phone on its side. Now:

- `freeRect` fits the map into the free rectangle it is drawn biggest in, from the real boxes
  of the buttons: on an upright phone that is still the band between them; on a short, wide
  screen a full-height column between the buttons in the corners.
- `placeLabels` takes the buttons as obstacles, so labels may go anywhere the buttons leave
  free; a hole whose spots are all under a button is not on view, and a label whose spot sits
  just beside a button is set just clear of it.
- On short landscape screens (520 px high or less) the details sit bottom left and the start
  button bottom right, each only as wide as it needs.

The first version of the fix passed 844x390 (133 of 133) but its regression run at the other
sizes failed 4 of 546, all one zoomed view each on a portrait phone (a hole just beside the
title, whose label was left out rather than set beside it; `coursemap-fix/sizes/`); setting such
a label clear of the button fixed it. The rerun on the final build (`qa/proof/coursemap-fix/final/`,
every course at five sizes) passed 679 of 679 with 0 console errors. Labels placed (19 is all
18 holes and the clubhouse), fitted, zoomed in (off screen in brackets), in a round:

| course | 360x640 | 390x844 | 844x390 | 1920x1080 | 2560x1440 |
|---|---|---|---|---|---|
| parkland | 19, 7 (12), 19 | 19, 8 (11), 19 | 19, 5 (14), 19 | 19, 10 (9), 19 | 19, 8 (11), 19 |
| links | 19, 0 (19), 19 | 19, 2 (17), 19 | 19, 0 (19), 19 | 19, 8 (11), 19 | 19, 7 (12), 19 |
| desert | 19, 5 (14), 19 | 19, 7 (12), 19 | 19, 5 (14), 19 | 19, 10 (9), 19 | 19, 8 (11), 19 |
| alpine | 19, 8 (11), 19 | 19, 8 (11), 19 | 19, 7 (12), 19 | 19, 9 (10), 19 | 19, 8 (11), 19 |
| tropical | 19, 4 (15), 19 | 19, 6 (13), 19 | 19, 6 (13), 19 | 19, 6 (13), 19 | 19, 5 (14), 19 |
| augusta | 19, 7 (12), 19 | 19, 8 (11), 19 | 19, 7 (12), 19 | 19, 8 (11), 19 | 19, 7 (12), 19 |
| standrews | 19, 7 (12), 19 | 19, 7 (12), 19 | 19, 5 (14), 19 | 19, 5 (14), 19 | 19, 6 (13), 19 |

The maps inside a community hole on this build passed 9 of 9 at 390x844, 844x390 and 1920x1080
(`qa/proof/coursemap-fix/levelmaps/`). Unit tests for `freeRect` and the obstacles (498 tests).
Nothing outside the course map changed.

Full verify on 7f6266a (the fix and this write-up): 498 of 498 unit tests, the production build
(43.49 MB), and the smoke run, 56 of 56 combinations inside their bands, agreement 99.97 to
99.99 percent on all seven courses; its `dist` is byte-identical to the one the course map
reruns used. Redeployed the same way (Vercel still had no token or login): the verified `dist`
went to `gh-pages` (4bc8631), the staged tree matched it, and all 168 files the site then served
matched it byte for byte. Live checks on it (`qa/proof/live-7f6266a/`, `NOTES.md` there), real
touch and mouse events: the live tool at 390x844 and 1366x768; the course map at 390x844 and
1920x1080 (78 of 78) and on every course at 844x390 (133 of 133); the desktop proof at
1920x1080 (8 screens); the other holes at Medium at 390x844, 844x390 and 1920x1080; the maps
inside a community hole at the same three sizes (9 of 9 each); and 3 holes each of Augusta
National (touch, portrait) and the Old Course (mouse, landscape) played by the bot. 0 console
errors in every one. Live at https://gbrodie6.github.io/Fairway/.

## Augusta's 17th: the short putt that ran 10 m

In the part 5 bot round a putt of 0.67 m on Augusta National's 17th lipped out and stopped about
10 m away in the rough. Reproduced in Node and in `tests/putting.test.js`, with the cup the
round had (x 7.380, z -409.044) and the bot's putt: 0.67 m east of it, the direct line (the HUD
showed no break), power 0.681 against the suggested 0.69.

- Cup capture (`physics/ball.js`, unchanged): on each 1/120 s roll step, a ball within the cup's
  radius (5.4 cm) drops if its speed is at most 1.63 m/s times sqrt(1 - (d / radius)^2), d its
  distance from the center (the dead-center limit is from Holmes; it falls to 0 at the edge).
  Faster, it lips out once: turned aside by up to about 0.45 radians (more the nearer the
  edge) and slowed to 72 percent. A lipped ball can still drop if it comes back slowly enough.
- The putt: it entered the cup at 99 percent of the radius (5.35 cm from the center) at
  0.717 m/s, where the limit is 0.214 m/s, so it lipped out per the rule and left at 0.51 m/s.
- The slope: the cup was cut on 4.50 percent ground, falling toward 129 degrees, 4.3 to
  5.1 percent within 0.67 m and up to 8.7 percent within 3 m. Augusta's greens run at green
  speed 1.28, so their rolling friction is 0.429 m/s^2; gravity along a 4.50 percent slope is
  0.440 m/s^2. A ball moving downhill there does not slow down: after the lip it fell to
  0.1 m/s, then sped up down the fall line for about 13 s (to 1.7 m/s) and ran off the green.
  Missed without a lip (power 0.60 to 0.67) it runs the same 10.2 to 10.5 m. The suggested
  power, 0.69, only holes because the ball lips out and drops on its way back; 0.681 misses.
- Verdict: the cup rule and the roll did what their rules say, but the cup should not have
  been there. Cups were cut on ground under 4.5 percent, a limit set for the usual green
  speed (friction 0.549 m/s^2, which holds a rolling ball up to 5.6 percent). Course conditions
  later made Augusta's greens 1.28 times faster, and the cup rule did not follow, so it allowed
  cups on ground (4.50 percent) steeper than those greens hold a rolling ball on (4.38
  percent). That is the bug.
- Fix (`course/terrain.js`, `maxCupSlopeFor`): the limit is divided by the course's green speed
  (3.52 percent at Augusta, 4.29 at the Old Course), the same margin against a ball running
  away on every course; courses at the usual speed and slower keep 4.5 percent. Nothing in the
  ball physics, the capture rule or the putt solver changed. Of 126 holes only Augusta's
  change: 10 holes lose steep cup candidates and the cup the round uses moves on 5 (holes 3,
  6, 12, 14 and 17; the 17th's is now on 2.78 percent). Every other course's cups are
  unchanged and its survey numbers below are identical.

Putts of 0.3 to 2 m on the 3 steepest greens of every course (`scripts/tools/putt-survey.mjs`,
`qa/proof/putting/`): 6 distances, 24 directions, each putted with the solver's read (the HUD's
line and pace) at pace x0.95, x1 and x1.05 and line -1, 0 and +1 degree, plus the direct line
at the solver's pace: 1,440 putts a green, 4,320 a course.

| course | green speed | rolling ball held up to | steepest 3 pins | holed | lip-outs | longest lip-out run | misses past 2 m | past 5 m | off the green |
|---|---|---|---|---|---|---|---|---|---|
| parkland | 1 | 5.6% | 3.1, 3.0, 2.84% | 77% | 19 | 0.35 m | 0 | 0 | 0 |
| links | 1 | 5.6% | 2.99, 2.71, 2.67% | 78% | 20 | 0.3 m | 0 | 0 | 0 |
| desert | 1 | 5.6% | 3.11, 3.03, 2.83% | 77% | 17 | 0.36 m | 0 | 0 | 0 |
| alpine | 1 | 5.6% | 3.74, 3.13, 2.99% | 76% | 19 | 0.67 m | 0 | 0 | 0 |
| tropical | 1 | 5.6% | 3.09, 2.98, 2.69% | 78% | 15 | 0.37 m | 0 | 0 | 0 |
| Old Course | 1.05 | 5.33% | 4.28, 3.12, 2.72% | 74% | 12 | 0.64 m | 23 | 0 | 0 |
| Augusta before | 1.28 | 4.38% | 4.5, 3.97, 3.86% (17, 6, 12) | 53% | 17 | 10.9 m | 729 | 478 | 521 |
| Augusta after | 1.28 | 4.38% | 3.42, 3.08, 3.06% (2, 14, 9) | 71% | 26 | 1.68 m | 43 | 0 | 0 |

By distance, lip-outs are rare everywhere (0 from 0.3 m; 0 to 9 per course at each other
distance) and on the usual greens a lip-out or miss stops within 1.8 m. On Augusta's former
17th, 6th and 12th the same putts now hole 74, 82 and 81 percent (was 40, 56 and 65), with no
miss past 2 m (was 403, 284 and 42) and none off the green (was 250, 271 and 0). What remains
for a decision, not a bug: on Augusta's and the Old Course's steepest fast greens a missed putt
of 1 to 2 m can still finish 2 to 4.5 m away (43 and 23 of 4,320), and the putt solver accepts
a pace that holes only by lipping out and dropping back (the 0.69 above). Neither was changed.

Tests: `tests/putting.test.js` reproduces the putt at the old cup (it lips out at the edge at
0.65 to 0.8 m/s and finishes more than 9 m away in the rough) and shows the cause (gravity at
that cup above the green's friction); the regression tests check that every cup on every course
is under its limit with gravity there under 85 percent of the green's friction, and that short
putts at Augusta's 17th now stay within 2 m when missed. Run against the old rule, the
three regression tests fail. The existing putting tests pass (503 tests).
