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

- Guest by default. After the first finished round, and from settings, a small card offers an
  account: "Keep your progress on any device". Never a wall.
- Auth through Supabase's REST endpoints: sign up and sign in with email and password, magic
  link, password reset, sign out, and delete account and data (an RPC with security definer
  that removes the caller's rows and their auth user; see `supabase/schema.sql`).
- Tables: `profiles(user_id, display_name, updated_at)`, `saves(user_id, data jsonb,
  version, updated_at)`, `scores(id, user_id, board, period, value, display_name,
  created_at)`. Row level security: everyone may read `scores` and `profiles`' display names;
  only the owner may write their own rows.
- Sync: the full save is pushed (debounced by 4 seconds) on round end, level-up, gear change,
  and sign-in. Conflict: compare `updated_at`; the newer save wins and the other is kept as a
  local backup for 30 days, restorable from settings. On sign-up the guest save merges into
  the account (progress-wise maximum: higher level and XP, union of gear and achievements,
  better bests).
- Offline: every push goes into a queue in local storage and is retried with backoff when the
  network returns. Plain messages for expired sessions ("Please sign in again"), rate limits
  ("Too many tries, wait a minute"), and network errors ("Offline: saved on this device").
- Leaderboards: daily challenge, weekly long drive, range target points, campaign level.
  Readable by everyone, written only when signed in, and values are bounded client-side
  before upload. The board says plainly that it is casual and not cheat-proof.
- Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time, the account UI says
  cloud sync is off and the game is fully playable as a guest.

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
  degrees off line at half speed. A Pured strike gets the club's rarity bonus (Common 0).
  Carry never drops below 40 percent of the clean value and never exceeds the cap (+10
  percent at most from every source together).
- Shown: a strike label with the tempo label, a dot on the club face where it made contact,
  a haptic and sound per kind, and a post-shot card with carry, offline, and the cause in plain
  words ("too fast on the way down", "face open at impact", "heavy, hit the ground first").
- Mulligan: an earned item (quests, levels, season track) that undoes one shot per round.

## Stage 3: club rarities

| Tier | Difficulty | Pured carry bonus | Spin | Sweet spot |
| --- | --- | --- | --- | --- |
| Common | 1.00 | 0 | 1.00 | 1.00 |
| Uncommon | 1.25 | +2 % | 1.02 | 0.92 |
| Rare | 1.50 | +4 % | 1.04 | 0.84 |
| Epic | 1.80 | +6 % | 1.06 | 0.76 |
| Legendary | 2.20 | +8 % | 1.08 | 0.68 |

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
  spot 0.05 to 0.07) and softer weakness caps (short game 78, putting 82). Final: every
  archetype within 1.33 strokes of its level's average.
- Tiers: none is better than Common for an average swing (the Legendary costs about 1.2 strokes
  per 18). A pured higher-tier strike now also flies straighter (up to a third less sideways
  error), a bounded change that leaves Common untouched. Even so, in simulation higher tiers
  also cost a skilled golfer strokes on target golf, because pured-only bonus carry adds
  distance scatter; their reward is maximum distance. That is reported as a design point for
  human review rather than changing the specified numbers.
- Settings: mishits for an average swing are 0.4 percent on relaxed, 3.7 on standard, 10.3 on
  pro, in line with the request for only a little more challenge on standard.

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
