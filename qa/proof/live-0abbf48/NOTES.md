# Live check of 0abbf48 (gh-pages 19bfb81)

https://gbrodie6.github.io/Fairway/ in headless Chrome (software rendering) with
`node scripts/tools/swingbox.mjs` and URL set to the live site (`swing.json`,
`swing-<size>-*.jpg`): real touch events at 390x844, real mouse events at 1920x1080.

- 390x844: five moments (address, mid backswing, the top, outside the box, impact) with 0 overlap
  problems; the outline lit outside the box and went quiet back inside; the swing launched (power
  0.90, Perfect); a press outside the box did not start a swing; more than 1.5 box widths outside
  cancelled with no stroke; the left-handed mirror had no overlaps; Classic track brought the old
  stick back; Settings lists Box and Classic track; the tutorial said "Press in the box and pull
  down", then "Swipe up through the ring". 9 of 9 checks, 0 console errors.
- 1920x1080: the same with the mouse (the tutorial check runs on portrait phones only). 8 of 8
  checks, 0 overlap problems, 0 console errors.
