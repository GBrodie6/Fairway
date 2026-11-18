// Broadcast commentary: short original lines for notable moments, picked deterministically
// from small pools so the same shot always reads the same. No real commentator's phrasing or
// catchphrases; plain golf talk.
import { hashString } from '../core/rng.js';

const LINES = {
  drivePured: ['That is right out of the middle.', 'Struck. Listen to that.', 'Flushed down the middle.', 'A proper strike, and it is still going.'],
  driveLong: ['That one has gone a long way.', 'Big drive. Short iron in from there.', 'They will need a car to get to that one.'],
  driveFairway: ['Safely on the short grass.', 'Fairway found. Job done.', 'In position off the tee.'],
  driveRough: ['Just off the fairway, in the light rough.', 'Missed the fairway, but there is a shot from there.'],
  mishit: ['Not the contact they wanted.', 'Caught that one off the face.', 'A little loose with that swing.'],
  approachClose: ['Oh, that is close!', 'Stiff. That is a tap-in birdie look.', 'Right at it. What a shot.'],
  approachGreen: ['On the green, a putt for birdie.', 'Safely on the putting surface.', 'Green found. Now for the putt.'],
  bunker: ['That is in the sand.', 'Found the bunker. Tricky from there.'],
  water: ['Oh no, that is wet.', 'In the water. That will cost a stroke.'],
  oob: ['Out of bounds. Reload.', 'That has gone out of play.'],
  chipIn: ['It is in! Chipped in!', 'Holed from off the green!', 'What a touch. In the hole!'],
  longPutt: ['From way downtown. In it goes!', 'Rolled it in from distance!', 'That putt never left the hole.'],
  shortMiss: ['Oh, that should have dropped.', 'Lipped away. Frustrating.', 'Pushed that one past the edge.'],
  ace: ['Hole in one! Unbelievable!', 'It is gone in! An ace!', 'In the cup off the tee!'],
  eagle: ['Eagle! Two under on the hole.', 'An eagle. That is a big move.'],
  birdie: ['Birdie. Moving the right way.', 'One under on that hole.', 'Birdie, and the confidence is building.'],
  par: ['A solid par.', 'Par, and on to the next.', 'Steady. Par.'],
  bogey: ['A dropped shot there.', 'Bogey. Time to bounce back.'],
  double: ['A tough hole, that one.', 'Two over. Shake it off.'],
  lead: ['And that puts them in the lead.', 'Top of the leaderboard now.'],
  climb: ['Climbing up the leaderboard.', 'Moving up the board.'],
};
export const COMMENTARY_KEYS = Object.keys(LINES);
export function line(key, salt = '') {
  const pool = LINES[key];
  if (!pool) return null;
  return pool[hashString(`${key}:${salt}`) % pool.length];
}

/**
 * A line for a finished shot, or null for routine shots. s: { tee, par, putt, holed, chip,
 * fromDist (m), carry (m), lie (surface name), water, oob, toPin (m), strike, onGreen }.
 */
export function shotLine(s, salt) {
  if (s.holed) {
    if (s.tee && s.par === 3) return line('ace', salt);
    if (!s.putt) return line('chipIn', salt);
    if (s.fromDist > 6) return line('longPutt', salt);
    return null;
  }
  if (s.oob) return line('oob', salt);
  if (s.water) return line('water', salt);
  if (s.putt) return s.fromDist < 2 && s.toPin > 0.3 ? line('shortMiss', salt) : null;
  if (s.strike && ['thin', 'fat', 'shank', 'heel', 'toe'].includes(s.strike.kind) && s.strike.severity > 0.45) return line('mishit', salt);
  if (s.tee && s.par > 3) {
    if (s.carry > 250 * 0.9144) return line('driveLong', salt);
    if (s.strike && s.strike.kind === 'pured') return line('drivePured', salt);
    if (s.lie === 'Fairway') return line('driveFairway', salt);
    if (/rough/i.test(s.lie || '')) return line('driveRough', salt);
  }
  if (s.lie === 'Bunker') return line('bunker', salt);
  if (s.onGreen && s.toPin < 3) return line('approachClose', salt);
  if (s.onGreen && !s.tee && s.fromDist > 60) return line('approachGreen', salt);
  return null;
}
export function holeLine(toPar, salt) {
  if (toPar <= -2) return line('eagle', salt);
  if (toPar === -1) return line('birdie', salt);
  if (toPar === 0) return line('par', salt);
  if (toPar === 1) return line('bogey', salt);
  return line('double', salt);
}
// A short description of a hole for the intro card.
export function holeIntro(hole) {
  const bits = [];
  const yd = hole.yards;
  const kind = hole.par === 3 ? (yd < 150 ? 'A short par 3' : yd > 200 ? 'A long par 3' : 'A mid-length par 3') : hole.par === 5 ? (yd < 520 ? 'A reachable par 5' : 'A three-shot par 5') : yd < 360 ? 'A short par 4' : yd > 430 ? 'A long par 4' : 'A par 4';
  bits.push(kind);
  const water = (hole.water || []).length + (hole.sea ? 1 : 0);
  if (water) bits.push(hole.sea ? 'with the sea alongside' : 'with water in play');
  const bunkers = (hole.bunkers || []).length;
  if (bunkers >= 3) bits.push(`and ${bunkers} bunkers`);
  else if (bunkers) bits.push(`and ${bunkers === 1 ? 'a bunker' : 'two bunkers'}`);
  if ((hole.bends || []).length && Math.abs(hole.bends[0]) > 0.15) bits.push(hole.bends[0] > 0 ? 'turning right' : 'turning left');
  return `${bits.join(' ')}.`;
}
