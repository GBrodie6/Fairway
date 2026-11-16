// The club set. carry is the full-swing carry in yards on flat ground with no wind from a
// clean lie. speed values (m/s) are solved by scripts/tools/calibrate-clubs.mjs so the flight
// model reproduces the ladder, and tests/physics.test.js asserts it within 0.2 yards.
import { DEG } from '../core/math.js';

const SOLVED_SPEED = {
  DR: 70.5768, // 157.9 mph
  W3: 65.5862, // 146.7 mph
  W5: 61.9552, // 138.6 mph
  I4: 58.4960, // 130.9 mph
  I5: 56.0982, // 125.5 mph
  I6: 53.8900, // 120.5 mph
  I7: 51.6988, // 115.6 mph
  I8: 49.3395, // 110.4 mph
  I9: 46.8422, // 104.8 mph
  PW: 44.2986, // 99.1 mph
  GW: 40.8278, // 91.3 mph
  SW: 36.9872, // 82.7 mph
  LW: 32.8881, // 73.6 mph
};

export const CLUB_SPECS = [
  { id: 'DR', name: 'Driver', short: 'DR', carry: 250, launch: 12.0, spinRpm: 2700, tiltGain: 3.2, kind: 'wood' },
  { id: 'W3', name: '3 Wood', short: '3W', carry: 228, launch: 11.0, spinRpm: 3600, tiltGain: 3.0, kind: 'wood' },
  { id: 'W5', name: '5 Wood', short: '5W', carry: 212, launch: 11.5, spinRpm: 4300, tiltGain: 2.8, kind: 'wood' },
  { id: 'I4', name: '4 Iron', short: '4i', carry: 196, launch: 12.0, spinRpm: 4800, tiltGain: 2.6, kind: 'iron' },
  { id: 'I5', name: '5 Iron', short: '5i', carry: 185, launch: 13.0, spinRpm: 5350, tiltGain: 2.5, kind: 'iron' },
  { id: 'I6', name: '6 Iron', short: '6i', carry: 174, launch: 14.5, spinRpm: 6200, tiltGain: 2.4, kind: 'iron' },
  { id: 'I7', name: '7 Iron', short: '7i', carry: 163, launch: 16.5, spinRpm: 7050, tiltGain: 2.3, kind: 'iron' },
  { id: 'I8', name: '8 Iron', short: '8i', carry: 151, launch: 18.5, spinRpm: 7900, tiltGain: 2.2, kind: 'iron' },
  { id: 'I9', name: '9 Iron', short: '9i', carry: 139, launch: 20.5, spinRpm: 8600, tiltGain: 2.1, kind: 'iron' },
  { id: 'PW', name: 'Pitching Wedge', short: 'PW', carry: 127, launch: 24.0, spinRpm: 9300, tiltGain: 2.0, kind: 'wedge' },
  { id: 'GW', name: 'Gap Wedge', short: 'GW', carry: 112, launch: 27.0, spinRpm: 9800, tiltGain: 1.9, kind: 'wedge' },
  { id: 'SW', name: 'Sand Wedge', short: 'SW', carry: 96, launch: 30.5, spinRpm: 10200, tiltGain: 1.8, kind: 'wedge' },
  { id: 'LW', name: 'Lob Wedge', short: 'LW', carry: 80, launch: 34.0, spinRpm: 10500, tiltGain: 1.7, kind: 'wedge' },
  { id: 'PT', name: 'Putter', short: 'PT', carry: 0, launch: 0, spinRpm: 0, tiltGain: 0, kind: 'putter', putter: true },
];

export const CLUBS = CLUB_SPECS.map((c, index) => Object.freeze({
  ...c,
  index,
  speed: SOLVED_SPEED[c.id] || 0,
  launchRad: c.launch * DEG,
  spin: (c.spinRpm * 2 * Math.PI) / 60,
}));

export const CLUB_BY_ID = Object.freeze(Object.fromEntries(CLUBS.map((c) => [c.id, c])));
export const PUTTER = CLUB_BY_ID.PT;
export const clubById = (id) => CLUB_BY_ID[id] || CLUBS[0];
