// Solves the ball speed for each club so a full, clean, calm, flat shot carries the ladder
// distance. Prints the table that is pasted into src/physics/clubs.js. The test suite then
// measures carry independently and asserts the ladder within 0.2 yards.
import { simulateShot, flatEnv } from '../../src/physics/ball.js';
import { DEG, YARD } from '../../src/core/math.js';
import { CLUB_SPECS } from '../../src/physics/clubs.js';

const env = flatEnv();
const rows = [];
for (const c of CLUB_SPECS) {
  if (c.putter) continue;
  let lo = 10, hi = 110;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = simulateShot({ x: 0, z: 0, speed: mid, vAngle: c.launch * DEG, heading: 0, spin: (c.spinRpm * 2 * Math.PI) / 60 }, env);
    if (r.carry / YARD < c.carry) lo = mid; else hi = mid;
  }
  const speed = (lo + hi) / 2;
  const r = simulateShot({ x: 0, z: 0, speed, vAngle: c.launch * DEG, heading: 0, spin: (c.spinRpm * 2 * Math.PI) / 60 }, env);
  rows.push(`  ${c.id}: ${speed.toFixed(4)}, // ${(speed / 0.44704).toFixed(1)} mph, carry ${(r.carry / YARD).toFixed(2)} yd, apex ${(r.apex / YARD).toFixed(1)} yd, hang ${r.hang.toFixed(2)} s, total ${(r.total / YARD).toFixed(1)} yd`);
}
console.log(rows.join('\n'));
