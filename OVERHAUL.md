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
  without one). A duplicate converts to shards (5, 10, 20, 40, 80 by tier), and shards buy a
  chosen club. Starter bag: the 14 common clubs. The bag holds 14 clubs, a putter included.
- Balls by rarity trade spin for roll; gloves add a small forgiveness boost (a larger sweet
  spot, at most +8 percent).

## Stage 4: the range

A separate scene: a wide flat field with a tee line of five bays (mats, a grass tee option),
a 50-ball bucket or unlimited practice, a picker cart, side nets, a clubhouse, evening lights,
yardage signs every 25 yards to 300, and target greens with flags at 75, 125, 175, 225, and
275 yards. A readout per shot (carry, total, ball speed, launch, spin, apex, offline, strike), a
top-down dispersion map with every shot and a group ellipse, per-club averages, and a session
summary. Modes: free practice, target points, long drive, wedge ladder, shape shots, pressure
streak, and a club test lane that replays the same swing with two clubs.

## Stage 5: campaign and archetypes

- Six archetypes, each with a description, starting stats, a signature perk, and a weakness:
  Power Hitter, Sharpshooter, Short Game Artist, Putting Specialist, Links Player, All-Rounder.
  Evolutions at levels 10 and 25 follow where points were spent.
- Levels to 40, one skill point per level. Five stat lines from 0 to 100: driving, approach,
  short game, putting, course management. A 20-node tree per archetype: stat upgrades, shot
  unlocks (punch, high, flop, bump and run), and perks with tradeoffs. Every modifier is capped
  (driving distance at most +6 percent from stats and perks together) and the caps are tested.
- Six chapters across the five courses: Club, Regional, Tour, Majors, Rivalry, Final. Four to
  six events each, with objectives (finish top 3, make 4 birdies, hit 70 percent of
  fairways) and a boss match against a named rival with an archetype, a signature shot, and a
  personality line. Short plain story lines.
- Screens: campaign hub with a chapter map, character sheet, skill tree, event briefing,
  level-up popup, post-round XP breakdown.

## Stage 6 to 8: fun, presentation, first minute

- Game feel: camera punch on contact, a short slow-motion beat on Pured strikes (off with
  reduced motion), streaks for consecutive fairways and greens, level-up and drop animations.
- Daily and weekly quests, the daily course with a shared seed, a weekly long drive, and a
  rotating mini-game (closest to the pin, par 3 contest, target practice, trick shot hole).
  More than 50 achievements, cosmetics earned by play (ball trails, club skins, emblem
  frames, banners), and a free season track that resets each season. Async head-to-head
  through the existing share links. Rivals adapt a little to the player's level. 3 and 6 hole
  quick rounds. An optional ambient music loop.
- Broadcast: lower thirds, a leaderboard overlay with movement arrows, a hole intro card over
  the flyover, a shot card, slow-motion replays with angles, an original commentary line for
  notable moments, a round recap, and a tournament mode with a cut, a purse, and a trophy.
- First minute: a skippable three-prompt tutorial (swing, strike result, club choice), a main
  menu with Quick Play, Campaign, Range, Daily, and Profile, and settings for quality, units,
  handedness, sound, difficulty, color-blind palette, and reduced motion.

## Stage 9: balance method

The browser bot plays a hole in about three minutes under software rendering, far too slow for
thousands of rounds. The balance runs use a headless round player (`scripts/sim/`) built from
the game's own modules: the same terrain, planner, `computeLaunch`, strike model, rarity and
archetype modifiers, and `simulateShot`. Its swing comes from a fixed human-like error model
(power, tempo, face, and path spreads), so every configuration sees the same swing quality.
Runs are spread over worker threads. Targets: no archetype more than 1.5 strokes from the mean
at matched levels; no rarity tier better than Common for an average swing. A browser bot run
spot-checks the result.

## Stage 10: proof and deploy

Screenshots of every new screen at 360x640, 390x844, 844x390, and 1024x768 with the layout
check; a range session, a campaign event, and a daily challenge played through real taps;
the same deploy routes as before (Vercel with existing credentials, then the GitHub Pages
flow, then another host with credentials already in the environment), Supabase values passed at
build time when present, and a live test at phone size.
