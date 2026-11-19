// Shot types: every one is a set of bounded multipliers on the launch (ball speed, launch
// angle, spin) that computeLaunch reads before the unchanged simulation, plus the rules for
// when it can be played. Normal is the physics module's Full shot, unchanged.
//
//   speed, launch, spin   multipliers (each 0.3 to 1.5; speed never above 1)
//   power                 [min, max] swing power the shot accepts (a knockdown is three-quarter)
//   clubs                 club ids that can play it
//   lies                  surfaces it can be played from (a flop needs a decent lie)
//   mishit                multiplier on the strike model's error (0.5 to 2): a flop is risky
//   roll                  'more', 'normal' or 'less' than Normal from the same club (tested)
//   unlock                in Campaign: 'base' (always), or the skill tree shot that unlocks it
//   auto                  chosen by the game on its own (the bunker splash in sand)
import { SHOT_TYPES } from '../physics/shot.js';
import { SURFACES as S } from '../physics/surfaces.js';

const LONG = ['DR', 'W3', 'W5', 'I4', 'I5'];
const IRONS = ['I4', 'I5', 'I6', 'I7', 'I8', 'I9'];
const WEDGES = ['PW', 'GW', 'SW', 'LW'];
const ALL = ['DR', 'W3', 'W5', ...IRONS, ...WEDGES];
const GOOD = [S.TEE, S.FAIRWAY, S.FIRST_CUT];
const ANY = [S.TEE, S.FAIRWAY, S.FIRST_CUT, S.ROUGH, S.DEEP_ROUGH, S.BUNKER, S.FRINGE, S.WASTE, S.DIRT, S.WETLAND, S.PATH, S.ROCK];

export const SHOT_DATA = Object.freeze([
  { ...SHOT_TYPES.FULL, name: 'Normal', power: [0, 1], clubs: ALL, lies: ANY, mishit: 1, roll: 'normal', unlock: 'base', text: 'The full swing.' },
  { id: 'stinger', name: 'Stinger', speed: 0.98, launch: 0.72, spin: 0.65, power: [0.6, 1], clubs: LONG, lies: GOOD, mishit: 1.25, roll: 'more', unlock: 'punch', text: 'Low and boring under the wind, runs out a long way.' },
  { id: 'knockdown', name: 'Knockdown', speed: 1, launch: 0.82, spin: 0.82, power: [0, 0.85], clubs: [...IRONS, 'PW', 'GW'], lies: [...GOOD, S.ROUGH], mishit: 0.9, roll: 'more', unlock: 'punch', text: 'A three-quarter swing, lower and steadier in the wind.' },
  { ...SHOT_TYPES.PUNCH, power: [0, 1], clubs: ['W5', ...IRONS, ...WEDGES], lies: ANY.filter((l) => l !== S.BUNKER), mishit: 1, roll: 'more', unlock: 'punch', text: 'Keeps it low under branches, out of trouble.' },
  { id: 'high', name: 'High', speed: 0.97, launch: 1.2, spin: 1.1, power: [0, 1], clubs: ['W5', ...IRONS, ...WEDGES], lies: [...GOOD, S.ROUGH], mishit: 1.15, roll: 'less', unlock: 'high', text: 'Up and over, lands soft.' },
  { ...SHOT_TYPES.FLOP, power: [0, 1], clubs: ['SW', 'LW'], lies: [S.FAIRWAY, S.FIRST_CUT, S.FRINGE, S.ROUGH], mishit: 1.8, roll: 'less', unlock: 'flop', text: 'Very high and short, stops almost dead. Needs a decent lie; a miss costs a lot.' },
  { id: 'pitch', name: 'Pitch', speed: 0.6, launch: 1.15, spin: 1.2, power: [0, 1], clubs: WEDGES, lies: [S.TEE, S.FAIRWAY, S.FIRST_CUT, S.ROUGH, S.DEEP_ROUGH, S.FRINGE], mishit: 1.05, roll: 'normal', unlock: 'base', text: 'A partial wedge that carries most of the way and checks.' },
  { ...SHOT_TYPES.CHIP, power: [0, 1], clubs: ['I7', 'I8', 'I9', ...WEDGES], lies: [S.FAIRWAY, S.FIRST_CUT, S.FRINGE, S.ROUGH, S.DEEP_ROUGH], mishit: 0.8, roll: 'more', unlock: 'base', text: 'A short, low shot that releases toward the hole.' },
  { id: 'bump', name: 'Bump and run', speed: 0.46, launch: 0.5, spin: 0.4, power: [0, 1], clubs: ['I5', 'I6', 'I7', 'I8', 'I9', 'PW'], lies: [S.FAIRWAY, S.FIRST_CUT, S.FRINGE], mishit: 0.85, roll: 'more', unlock: 'bump', text: 'Lands short and rolls out like a putt.' },
  { id: 'splash', name: 'Bunker splash', speed: 0.55, launch: 1.3, spin: 0.7, power: [0, 1], clubs: ['GW', 'SW', 'LW'], lies: [S.BUNKER], mishit: 1, roll: 'less', unlock: 'base', auto: true, text: 'Splashes the sand and the ball out together. Chosen for you in a greenside bunker.' },
]);

export const SHOT_BY_ID = Object.freeze(Object.fromEntries(SHOT_DATA.map((s) => [s.id, s])));
export const shotData = (id) => SHOT_BY_ID[id] || SHOT_BY_ID.full;
// Can this club play this shot from this lie?
export const shotFitsData = (shot, clubId, lie) => !!(shot && shot.clubs.includes(clubId) && (lie == null || shot.lies.includes(lie)));
// The swing power the shot accepts.
export const shotPower = (shot, power) => Math.min(shot ? shot.power[1] : 1, Math.max(shot ? shot.power[0] : 0, power));
// A greenside bunker: the splash is chosen for a wedge within this distance of the pin.
export const SPLASH_RANGE = 55;
