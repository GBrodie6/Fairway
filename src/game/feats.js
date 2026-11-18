// Achievements beyond the original dozen (game/save.js ACHIEVEMENTS): 54 more, each a check
// over the save, so they are found the same way whenever the save changes (on this device or
// after a cloud merge). Some award a cosmetic (game/cosmetics.js).
import { levelForXp, CHAPTERS, ALL_EVENTS } from './campaign.js';
import { TIERS } from './gear.js';
import { MEDALS } from './range.js';
import { tierFor } from './season.js';

const YD = 0.9144;
const c = (s, k) => (s.counters && s.counters[k]) || 0;
const st = (s, k) => (s.stats && s.stats[k]) || 0;
const cleared = (s, id) => !!(s.campaign && s.campaign.progress && s.campaign.progress[id] && s.campaign.progress[id].cleared);
const chapterCleared = (s, ci) => CHAPTERS[ci].events.every((e) => cleared(s, e.id));
const ownsTier = (s, t) => !!(s.gear && s.gear.clubs.some((x) => TIERS.indexOf(x.rarity) >= TIERS.indexOf(t)));
const played = (s, course) => (s.history || []).some((h) => h.courseId === course);
const medal = (s, mode) => (s.range && s.range.medals && s.range.medals[mode]) || 'none';

const F = (id, name, text, check, extra = {}) => ({ id, name, text, check, ...extra });
export const FEATS = [
  F('rounds-10', 'Regular', 'Finish 10 rounds.', (s) => st(s, 'rounds') >= 10),
  F('rounds-50', 'Member', 'Finish 50 rounds.', (s) => st(s, 'rounds') >= 50),
  F('rounds-100', 'Lifer', 'Finish 100 rounds.', (s) => st(s, 'rounds') >= 100),
  F('birdies-10', 'Birdie watch', 'Make 10 birdies.', (s) => st(s, 'birdies') >= 10),
  F('birdies-50', 'Flock', 'Make 50 birdies.', (s) => st(s, 'birdies') >= 50, { cosmetic: 'ball-pink' }),
  F('birdies-100', 'Aviary', 'Make 100 birdies.', (s) => st(s, 'birdies') >= 100),
  F('eagles-5', 'Eagle eye', 'Make 5 eagles.', (s) => st(s, 'eagles') >= 5),
  F('par-train-5', 'Par train', 'Make par or better on 5 holes in a row.', (s) => c(s, 'parStreakBest') >= 5),
  F('par-train-9', 'Express', 'Make par or better on 9 holes in a row.', (s) => c(s, 'parStreakBest') >= 9, { cosmetic: 'trail-sky' }),
  F('birdie-run-2', 'Back to back', 'Make birdies on two holes in a row.', (s) => c(s, 'birdieStreakBest') >= 2),
  F('birdie-run-3', 'Hat trick', 'Make birdies on three holes in a row.', (s) => c(s, 'birdieStreakBest') >= 3),
  F('pured-50', 'Sweet spot', 'Pure 50 shots.', (s) => c(s, 'pured') >= 50),
  F('pured-250', 'Middle of the face', 'Pure 250 shots.', (s) => c(s, 'pured') >= 250, { cosmetic: 'trail-mint' }),
  F('pure-run-5', 'In the zone', 'Pure 5 shots in a row.', (s) => c(s, 'pureStreakBest') >= 5),
  F('one-putts-25', 'Silk', 'One-putt 25 greens.', (s) => c(s, 'onePutts') >= 25),
  F('drive-280', 'Big stick', 'Hit a drive of 280 yards.', (s) => st(s, 'longestDrive') >= 280 * YD),
  F('drive-320', 'Launch code', 'Hit a drive of 320 yards.', (s) => st(s, 'longestDrive') >= 320 * YD, { cosmetic: 'ball-orange' }),
  F('course-parkland', 'Alderwick regular', 'Finish a round at Alderwick Park.', (s) => played(s, 'parkland')),
  F('course-links', 'Saltmarrow regular', 'Finish a round at Saltmarrow Links.', (s) => played(s, 'links')),
  F('course-desert', 'Cinder regular', 'Finish a round at Cinder Mesa.', (s) => played(s, 'desert')),
  F('course-alpine', 'Larchfall regular', 'Finish a round at Larchfall Summit.', (s) => played(s, 'alpine')),
  F('course-tropical', 'Coralline regular', 'Finish a round at Coralline Bay.', (s) => played(s, 'tropical')),
  F('range-first', 'Range rat', 'Finish a session on the practice ground.', (s) => ((s.range && s.range.sessions) || 0) >= 1),
  F('range-10', 'Bucket list', 'Finish 10 range sessions.', (s) => ((s.range && s.range.sessions) || 0) >= 10),
  F('medal-gold', 'Gold standard', 'Win a gold medal in a range drill.', (s) => Object.values((s.range && s.range.medals) || {}).includes('gold')),
  F('medal-all-gold', 'Complete practice', 'Win gold in every range drill.', (s) => Object.keys(MEDALS).every((m) => medal(s, m) === 'gold'), { cosmetic: 'ball-lime' }),
  F('drop-first', 'Unboxed', 'Open a gear drop.', (s) => ((s.gear && s.gear.opened) || 0) >= 1),
  F('own-rare', 'Rare find', 'Own a Rare club or better.', (s) => ownsTier(s, 'rare')),
  F('own-epic', 'Epic find', 'Own an Epic club or better.', (s) => ownsTier(s, 'epic')),
  F('own-legendary', 'Legend', 'Own a Legendary club.', (s) => ownsTier(s, 'legendary')),
  F('upgrade-first', 'Tinkerer', 'Upgrade a club with shards.', (s) => c(s, 'upgrades') >= 1),
  F('level-5', 'Getting going', 'Reach level 5.', (s) => levelForXp((s.profile && s.profile.xp) || 0) >= 5),
  F('level-10', 'Evolved', 'Reach level 10 and your first evolution.', (s) => levelForXp((s.profile && s.profile.xp) || 0) >= 10),
  F('level-20', 'Seasoned', 'Reach level 20.', (s) => levelForXp((s.profile && s.profile.xp) || 0) >= 20),
  F('level-25', 'Fully evolved', 'Reach level 25 and your second evolution.', (s) => levelForXp((s.profile && s.profile.xp) || 0) >= 25),
  F('level-40', 'Top of the ladder', 'Reach level 40.', (s) => levelForXp((s.profile && s.profile.xp) || 0) >= 40),
  F('event-first', 'On the circuit', 'Clear a campaign event.', (s) => ALL_EVENTS.some((e) => cleared(s, e.id))),
  ...CHAPTERS.map((ch, i) => F(`chapter-${i + 1}`, `${ch.name} done`, `Clear every event in ${ch.name}.`, (s) => chapterCleared(s, i))),
  F('chapter-perfect', 'Perfect chapter', 'Earn every star in a chapter.', (s) => CHAPTERS.some((ch) => ch.events.every((e) => ((s.campaign && s.campaign.progress[e.id]) || {}).stars === 3))),
  F('boss-3', 'Giant killer', 'Beat three chapter bosses.', (s) => CHAPTERS.filter((ch) => cleared(s, ch.events[ch.events.length - 1].id)).length >= 3),
  F('campaign-complete', 'Champion', 'Clear every campaign event.', (s) => ALL_EVENTS.every((e) => cleared(s, e.id)), { cosmetic: 'trail-violet' }),
  F('quests-10', 'Errand runner', 'Complete 10 quests.', (s) => ((s.quests && s.quests.done) || 0) >= 10),
  F('quests-50', 'Quest master', 'Complete 50 quests.', (s) => ((s.quests && s.quests.done) || 0) >= 50),
  F('daily-7', 'Every day', 'Play the daily challenge on seven days.', (s) => Object.keys(s.daily || {}).length >= 7),
  F('match-win', 'Head to head', 'Win a match against a rival.', (s) => c(s, 'matchWins') >= 1),
  F('match-10', 'Match player', 'Win 10 matches.', (s) => c(s, 'matchWins') >= 10),
  F('season-10', 'Season ticket', 'Reach tier 10 of a season track.', (s) => tierFor((s.season && s.season.xp) || 0) >= 10),
  F('season-30', 'Season complete', 'Reach the last tier of a season track.', (s) => tierFor((s.season && s.season.xp) || 0) >= 30),
  F('mulligan', 'Second chance', 'Take a Mulligan.', (s) => c(s, 'mulligans') >= 1),
  F('locker-6', 'Collector', 'Own six cosmetics beyond the defaults.', (s) => ((s.cosmetics && s.cosmetics.owned) || []).length >= 11),
  F('tournament-cut', 'Weekend golfer', 'Make the cut in a tournament.', (s) => c(s, 'cutsMade') >= 1),
  F('tournament-win', 'Trophy', 'Win a tournament.', (s) => c(s, 'tournamentWins') >= 1),
];

// Ids met by this save that are not unlocked yet.
export function newFeats(save) {
  const have = save.achievements || {};
  return FEATS.filter((f) => !have[f.id]).filter((f) => { try { return f.check(save); } catch { return false; } }).map((f) => f.id);
}
export const featById = (id) => FEATS.find((f) => f.id === id) || null;
