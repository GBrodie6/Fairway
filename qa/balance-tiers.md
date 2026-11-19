# Balance tables

Simulated golfer: plans like the AI and swings with a fixed human-like error model (skill 0.35 poor, 0.6 average, 0.9 skilled). 9-hole rounds across all seven courses (front and back nines alternate); paired random draws per round index (strike dice on their own stream); 3000 rounds per cell; per-18 values are twice the 9-hole means. Tier differences are paired against Common with the same swing, planning and conditions. Conditions: calm fairway play (no wind, every lie through the green played as a flat fairway lie), normal (each course's own wind and the real lies), and wind and rough (a 10 to 20 mph gusty wind and every fairway lie played as rough). Archetypes, settings and pros play normal conditions. Tier benefits (data/tierBenefits.js) apply to the shots and the plan: a crosswind moves a higher tier's ball less and rough, sand and bad lies cost it less; the golfer does not use the spin pad, so the third benefit, the wider spin and shape range, is not in these numbers. Every tier carries the table carry in this build and the guide shows it, so the golfer plans the same way with every tier.

## Club tiers, calm fairway play: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 11.36 over par | common | 0 | 21.5 | 6.1 |
|  | uncommon | +0.04 (-0.1 to 0.18) | 19.5 | 6.8 |
|  | rare | +0.16 (0.01 to 0.32) | 17.9 | 7.5 |
|  | epic | +0.46 (0.28 to 0.63) | 16.1 | 8.3 |
|  | legendary | +0.58 (0.39 to 0.77) | 14.4 | 9.4 |
| average (0.6), Common 4.78 over par | common | 0 | 36.8 | 2.7 |
|  | uncommon | +0.05 (-0.03 to 0.14) | 34.2 | 3.1 |
|  | rare | +0.11 (0.02 to 0.21) | 31.5 | 3.6 |
|  | epic | +0.13 (0.02 to 0.24) | 28.8 | 4.1 |
|  | legendary | +0.21 (0.08 to 0.33) | 26.3 | 4.7 |
| skilled (0.9), Common -3.25 over par | common | 0 | 82.5 | 0.4 |
|  | uncommon | -0.01 (-0.04 to 0.03) | 80 | 0.4 |
|  | rare | +0.02 (-0.02 to 0.05) | 77.4 | 0.5 |
|  | epic | +0.02 (-0.02 to 0.06) | 74.3 | 0.6 |
|  | legendary | +0.02 (-0.02 to 0.06) | 71.1 | 0.7 |

## Club tiers, normal conditions: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 18.04 over par | common | 0 | 9.9 | 9 |
|  | uncommon | -0.06 (-0.31 to 0.18) | 9.1 | 9.8 |
|  | rare | +0.02 (-0.25 to 0.28) | 8.3 | 10.6 |
|  | epic | +0.26 (-0.01 to 0.53) | 7.4 | 11.6 |
|  | legendary | +0.33 (0.05 to 0.6) | 6.6 | 12.8 |
| average (0.6), Common 9.12 over par | common | 0 | 22.4 | 4.2 |
|  | uncommon | -0.06 (-0.25 to 0.13) | 20.8 | 4.6 |
|  | rare | -0.09 (-0.3 to 0.12) | 18.9 | 5.1 |
|  | epic | +0.03 (-0.19 to 0.24) | 17 | 5.7 |
|  | legendary | +0.21 (-0.01 to 0.44) | 15.3 | 6.2 |
| skilled (0.9), Common -0.2 over par | common | 0 | 72.1 | 0.6 |
|  | uncommon | -0.04 (-0.17 to 0.08) | 69.7 | 0.7 |
|  | rare | -0.13 (-0.28 to 0.01) | 67.1 | 0.8 |
|  | epic | -0.22 (-0.36 to -0.07) | 64.3 | 0.8 |
|  | legendary | -0.17 (-0.32 to -0.01) | 61.5 | 0.9 |

## Club tiers, wind and rough: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 23.8 over par | common | 0 | 6.5 | 10.4 |
|  | uncommon | -0.2 (-0.47 to 0.07) | 5.8 | 11.2 |
|  | rare | -0.14 (-0.42 to 0.14) | 5.3 | 12 |
|  | epic | +0.03 (-0.25 to 0.32) | 4.8 | 13.1 |
|  | legendary | +0.14 (-0.16 to 0.43) | 4.2 | 14.3 |
| average (0.6), Common 15.33 over par | common | 0 | 14.1 | 5.4 |
|  | uncommon | +0.04 (-0.2 to 0.27) | 13 | 5.8 |
|  | rare | -0.16 (-0.41 to 0.09) | 11.7 | 6.3 |
|  | epic | -0.01 (-0.26 to 0.24) | 10.5 | 7 |
|  | legendary | -0.01 (-0.27 to 0.25) | 9.7 | 7.7 |
| skilled (0.9), Common 6.2 over par | common | 0 | 51.9 | 1 |
|  | uncommon | -0.31 (-0.5 to -0.12) | 49.9 | 1.2 |
|  | rare | -0.52 (-0.73 to -0.32) | 47.8 | 1.3 |
|  | epic | -0.65 (-0.86 to -0.44) | 45.2 | 1.5 |
|  | legendary | -0.81 (-1.02 to -0.6) | 42.8 | 1.5 |

Targets for Legendary against Common (negative is better than Common):

- Skilled swing in wind and rough, 0.3 to 1.0 strokes better: -0.81 (-1.02 to -0.6), met.
- Poor swing no better than Common: calm fairway +0.58, normal +0.33, wind and rough +0.14, met.
- Average swing on calm fairway play within 0.3 strokes: +0.21 (0.08 to 0.33), met.

Run time 1493 s.
