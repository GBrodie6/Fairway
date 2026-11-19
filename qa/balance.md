# Balance tables

Simulated golfer: plans like the AI and swings with a fixed human-like error model (skill 0.35 poor, 0.6 average, 0.9 skilled). 9-hole rounds across all seven courses (front and back nines alternate); paired random draws per round index (strike dice on their own stream); 1000 rounds per cell; per-18 values are twice the 9-hole means. Tier differences are paired against Common with the same swing, planning and conditions. Conditions: calm fairway play (no wind, every lie through the green played as a flat fairway lie), normal (each course's own wind and the real lies), and wind and rough (a 10 to 20 mph gusty wind and every fairway lie played as rough). Archetypes, settings and pros play normal conditions. Tier benefits (data/tierBenefits.js) apply to the shots and the plan: a crosswind moves a higher tier's ball less and rough, sand and bad lies cost it less; the golfer does not use the spin pad, so the third benefit, the wider spin and shape range, is not in these numbers. Every tier carries the table carry in this build and the guide shows it, so the golfer plans the same way with every tier.

## Archetypes at level 5 (average 8.63 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 8.72 | +0.09 | 24.4 | 3.7 | 17.13 | yes |
| Sharpshooter | 8.1 | -0.54 | 24.2 | 3.8 | 17.09 | yes |
| Short Game Artist | 8.87 | +0.23 | 22.8 | 4.1 | 17.05 | yes |
| Putting Specialist | 8.75 | +0.12 | 22.7 | 4.1 | 16.96 | yes |
| Links Player | 8.81 | +0.18 | 22.6 | 4.2 | 17.03 | yes |
| All-Rounder | 8.56 | -0.07 | 23.4 | 4.1 | 17.04 | yes |

## Archetypes at level 15 (average 7.96 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 8.19 | +0.23 | 26.1 | 3.3 | 17.16 | yes |
| Sharpshooter | 7.15 | -0.81 | 26.6 | 3.4 | 16.92 | yes |
| Short Game Artist | 8.3 | +0.34 | 24.9 | 3.6 | 16.93 | yes |
| Putting Specialist | 8.29 | +0.33 | 24.6 | 3.6 | 16.94 | yes |
| Links Player | 8.11 | +0.15 | 24.5 | 3.7 | 16.94 | yes |
| All-Rounder | 7.72 | -0.24 | 25.5 | 3.5 | 16.95 | yes |

## Archetypes at level 30 (average 6.78 over par per 18)

| Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| Power Hitter | 6.33 | -0.45 | 28.3 | 2.9 | 16.92 | yes |
| Sharpshooter | 6.56 | -0.22 | 28 | 3.1 | 16.94 | yes |
| Short Game Artist | 6.86 | +0.08 | 27.5 | 3.1 | 16.89 | yes |
| Putting Specialist | 7.06 | +0.28 | 27.5 | 3.2 | 16.97 | yes |
| Links Player | 7.05 | +0.27 | 27.4 | 3.2 | 17.06 | yes |
| All-Rounder | 6.81 | +0.03 | 27.4 | 3.3 | 17.09 | yes |

## Club tiers, calm fairway play: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 11.42 over par | common | 0 | 21.7 | 6.1 |
|  | uncommon | -0.03 (-0.27 to 0.21) | 19.8 | 6.6 |
|  | rare | +0.22 (-0.05 to 0.48) | 18.1 | 7.3 |
|  | epic | +0.5 (0.2 to 0.8) | 16.4 | 8.2 |
|  | legendary | +0.48 (0.14 to 0.82) | 14.7 | 9.2 |
| average (0.6), Common 4.76 over par | common | 0 | 36.8 | 2.7 |
|  | uncommon | +0.08 (-0.06 to 0.22) | 34.2 | 3.1 |
|  | rare | +0.08 (-0.1 to 0.27) | 31.3 | 3.6 |
|  | epic | +0.04 (-0.16 to 0.24) | 28.8 | 4.1 |
|  | legendary | +0.04 (-0.18 to 0.26) | 26 | 4.6 |
| skilled (0.9), Common -3.11 over par | common | 0 | 82.8 | 0.3 |
|  | uncommon | -0.06 (-0.13 to 0.02) | 80.1 | 0.4 |
|  | rare | +0.02 (-0.05 to 0.09) | 77.5 | 0.5 |
|  | epic | +0.01 (-0.06 to 0.09) | 74.5 | 0.6 |
|  | legendary | +0.02 (-0.07 to 0.11) | 71.2 | 0.7 |

## Club tiers, normal conditions: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 18.07 over par | common | 0 | 9.9 | 9.2 |
|  | uncommon | -0.06 (-0.5 to 0.37) | 8.8 | 9.8 |
|  | rare | -0.2 (-0.68 to 0.28) | 8.2 | 10.8 |
|  | epic | +0.29 (-0.19 to 0.77) | 7.4 | 11.9 |
|  | legendary | +0.32 (-0.16 to 0.8) | 6.6 | 12.7 |
| average (0.6), Common 8.99 over par | common | 0 | 22.5 | 4.1 |
|  | uncommon | -0.09 (-0.42 to 0.24) | 21.3 | 4.6 |
|  | rare | -0.08 (-0.43 to 0.27) | 18.9 | 5.1 |
|  | epic | +0.07 (-0.28 to 0.43) | 17.1 | 5.6 |
|  | legendary | +0.25 (-0.13 to 0.63) | 15.3 | 6.2 |
| skilled (0.9), Common -0.25 over par | common | 0 | 72 | 0.6 |
|  | uncommon | +0.05 (-0.16 to 0.26) | 69.5 | 0.6 |
|  | rare | -0.1 (-0.35 to 0.14) | 66.7 | 0.7 |
|  | epic | -0.15 (-0.41 to 0.11) | 63.9 | 0.8 |
|  | legendary | -0.27 (-0.56 to 0.02) | 61.2 | 0.9 |

## Club tiers, wind and rough: strokes per 18 against Common

| Swing | Tier | Strokes per 18 vs Common (95 percent interval) | Pured % | Mishit % |
| --- | --- | --- | --- | --- |
| poor (0.35), Common 23.75 over par | common | 0 | 6.4 | 10.3 |
|  | uncommon | -0.32 (-0.82 to 0.17) | 5.8 | 11.3 |
|  | rare | -0.15 (-0.64 to 0.35) | 5.1 | 12 |
|  | epic | -0.08 (-0.6 to 0.43) | 4.6 | 13 |
|  | legendary | +0.07 (-0.42 to 0.57) | 4.1 | 14.1 |
| average (0.6), Common 15.13 over par | common | 0 | 14.3 | 5.4 |
|  | uncommon | +0.29 (-0.11 to 0.69) | 13.3 | 5.8 |
|  | rare | -0.01 (-0.45 to 0.43) | 11.4 | 6.2 |
|  | epic | +0.1 (-0.33 to 0.53) | 10.4 | 6.9 |
|  | legendary | +0.28 (-0.17 to 0.73) | 9.7 | 7.8 |
| skilled (0.9), Common 6.18 over par | common | 0 | 52.2 | 1.1 |
|  | uncommon | -0.47 (-0.8 to -0.14) | 50 | 1.2 |
|  | rare | -0.69 (-1.03 to -0.35) | 48.1 | 1.2 |
|  | epic | -0.59 (-0.94 to -0.24) | 45.5 | 1.6 |
|  | legendary | -1 (-1.36 to -0.65) | 42.9 | 1.6 |

## Pros, tour swing (skill 0.85), matched level (average -0.25 over par per 18)

| Pro | Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Teodor Kellbrook | power | -0.81 | -0.56 | 70.1 | 0.6 | 15.17 | yes |
| Rook Tavenner | power | -0.9 | -0.65 | 70.2 | 0.6 | 15.02 | yes |
| Amara Quellwood | sharp | -0.06 | +0.19 | 69.1 | 0.6 | 15.04 | yes |
| Saskia Ferroway | sharp | 0.1 | +0.35 | 68.3 | 0.6 | 15.09 | yes |
| Iker Solvane | short | -0.35 | -0.1 | 64.3 | 0.7 | 14.99 | yes |
| Ezio Marchbank | short | -0.35 | -0.1 | 64.4 | 0.7 | 14.96 | yes |
| Pell Greywater | putt | -0.48 | -0.23 | 64.1 | 0.7 | 14.95 | yes |
| Wynn Kesterton | putt | 0.44 | +0.69 | 65.2 | 0.6 | 15.07 | yes |
| Maeve Duncairn | links | 0.89 | +1.14 | 65 | 0.7 | 15.31 | yes |
| Ottilie Strand | links | -0.48 | -0.23 | 64 | 0.7 | 15.13 | yes |
| Juniper Ashcombe | all | -0.63 | -0.38 | 64.7 | 0.7 | 15.06 | yes |
| Kofi Brightwater | all | -0.32 | -0.07 | 64.3 | 0.6 | 15.18 | yes |

## Pros, average swing (skill 0.6), matched level (average 6.98 over par per 18)

| Pro | Archetype | Over par per 18 | vs average | Pured % | Mishit % | Putts per 9 | Within 1.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Teodor Kellbrook | power | 6.34 | -0.64 | 28 | 3 | 16.83 | yes |
| Rook Tavenner | power | 6.54 | -0.44 | 28.4 | 2.9 | 17.02 | yes |
| Amara Quellwood | sharp | 6.82 | -0.16 | 28.5 | 2.9 | 16.89 | yes |
| Saskia Ferroway | sharp | 6.89 | -0.09 | 28.6 | 2.8 | 16.86 | yes |
| Iker Solvane | short | 6.84 | -0.14 | 25.9 | 3.5 | 16.77 | yes |
| Ezio Marchbank | short | 7.24 | +0.26 | 25.7 | 3.7 | 16.98 | yes |
| Pell Greywater | putt | 6.88 | -0.1 | 24.9 | 3.7 | 16.88 | yes |
| Wynn Kesterton | putt | 7.64 | +0.66 | 26 | 3.5 | 16.77 | yes |
| Maeve Duncairn | links | 7.93 | +0.95 | 25.7 | 3.4 | 16.88 | yes |
| Ottilie Strand | links | 6.99 | +0.01 | 25.7 | 3.7 | 17.02 | yes |
| Juniper Ashcombe | all | 6.89 | -0.09 | 25.6 | 3.6 | 17.05 | yes |
| Kofi Brightwater | all | 6.8 | -0.18 | 26 | 3.6 | 17.01 | yes |

## Difficulty settings (Common clubs, level 1, average swing)

| Setting | Over par per 18 | Pured % | Mishit % | Shank % |
| --- | --- | --- | --- | --- |
| relaxed | 8.58 | 59.5 | 0.6 | 0 |
| standard | 8.99 | 22.5 | 4.1 | 0 |
| pro | 9.9 | 8.9 | 10.2 | 0.1 |

Targets for Legendary against Common (negative is better than Common):

- Skilled swing in wind and rough, 0.3 to 1.0 strokes better: -1 (-1.36 to -0.65), met.
- Poor swing no better than Common: calm fairway +0.48, normal +0.32, wind and rough +0.07, met.
- Average swing on calm fairway play within 0.3 strokes: +0.04 (-0.18 to 0.26), met.

Archetypes within 1.5 strokes of their level's average: yes.
Pros within 1.5 strokes of the pros' average: yes.
Run time 1124 s.
