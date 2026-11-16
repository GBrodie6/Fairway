// Prints carry, roll, and total per club for fairway and green landings.
import { simulateShot, flatEnv } from '../../src/physics/ball.js';
import { CLUBS } from '../../src/physics/clubs.js';
import { SURFACES } from '../../src/physics/surfaces.js';
import { YARD } from '../../src/core/math.js';
for (const surf of [SURFACES.FAIRWAY, SURFACES.GREEN, SURFACES.ROUGH]) {
  console.log('surface', surf);
  for (const c of CLUBS) {
    if (c.putter) continue;
    const r = simulateShot({ x: 0, z: 0, speed: c.speed, vAngle: c.launchRad, heading: 0, spin: c.spin }, flatEnv(surf));
    console.log(c.short.padEnd(4), 'carry', (r.carry / YARD).toFixed(1), 'roll', ((r.total - r.carry) / YARD).toFixed(1), 'total', (r.total / YARD).toFixed(1), 'bounces', r.events.filter((e) => e.type === 'bounce' || e.type === 'land').length, 'dur', r.duration.toFixed(1));
  }
}
