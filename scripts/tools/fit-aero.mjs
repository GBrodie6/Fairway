// Fits the aerodynamic model to published tour launch-monitor averages.
// Run: node scripts/tools/fit-aero.mjs
// Rows: ball speed mph, launch deg, spin rpm, carry yd, apex yd, landing angle deg.
import { simulateShot, flatEnv, AERO } from '../../src/physics/ball.js';
import { MPH, DEG, YARD } from '../../src/core/math.js';

const REF = [
  ['Driver', 167, 10.9, 2686, 275, 32, 38],
  ['3W', 158, 9.2, 3655, 243, 30, 43],
  ['5W', 152, 9.4, 4350, 230, 31, 47],
  ['4i', 137, 11.0, 4836, 203, 28, 48],
  ['5i', 132, 12.1, 5361, 194, 31, 49],
  ['6i', 127, 14.1, 6231, 183, 30, 50],
  ['7i', 120, 16.3, 7097, 172, 32, 50],
  ['8i', 115, 18.1, 7998, 160, 31, 50],
  ['9i', 109, 20.4, 8647, 148, 30, 51],
  ['PW', 102, 24.2, 9304, 136, 29, 52],
];
const env = flatEnv();
function run(aero, row) {
  const r = simulateShot({ x: 0, z: 0, speed: row[1] * MPH, vAngle: row[2] * DEG, heading: 0, spin: (row[3] * 2 * Math.PI) / 60 }, env, { aero });
  return { carry: r.carry / YARD, apex: r.apex / YARD, hang: r.hang };
}
function cost(aero) {
  let c = 0;
  for (const row of REF) {
    const r = run(aero, row);
    c += ((r.carry - row[4]) / 3) ** 2 + ((r.apex - row[5]) / 3) ** 2;
  }
  return c;
}
let best = { ...AERO }, bestC = cost(best);
if (process.argv.includes('--fit')) {
  for (let cd0 = 0.16; cd0 <= 0.27; cd0 += 0.01)
    for (let cd1 = 0.0; cd1 <= 0.8; cd1 += 0.05)
      for (let clMax = 0.2; clMax <= 0.6; clMax += 0.025)
        for (let clK = 0.04; clK <= 0.4; clK += 0.02) {
          const a = { cd0, cd1, clMax, clK, spinDecay: AERO.spinDecay };
          const c = cost(a);
          if (c < bestC) { bestC = c; best = a; }
        }
  console.log('best', JSON.stringify(best), 'cost', bestC.toFixed(2));
}
console.log('club   carry(ref)  apex(ref)  hang');
for (const row of REF) {
  const r = run(best, row);
  console.log(row[0].padEnd(7), r.carry.toFixed(1).padStart(6), `(${row[4]})`, r.apex.toFixed(1).padStart(6), `(${row[5]})`, r.hang.toFixed(2));
}
