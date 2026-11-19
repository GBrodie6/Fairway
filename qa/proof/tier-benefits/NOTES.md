# Tier benefits on the gear screens

`node scripts/tools/gear.mjs qa/proof/tier-benefits/g <size>` on the production build, real taps,
390x844 and 844x390. Zero console errors at both sizes, no horizontal overflow.

- `g-<size>-compare.png`: the 7 iron in the bag (Common) against a Rare one. Rows: Wind "10%
  less (+10)", Bad lies "15% less (+15)", Spin range "70 (+20)", Forgiveness "90 (-10)", Mishit
  cost "63 (+32)", with the in-bag value as a marker on each bar, then three plain lines:
  "Crosswind moves the ball 10 percent less", "Rough, sand and bad lies cost 15 percent less",
  "Spin and shape range 1.4x: the spin dot reaches 70 percent of the way to the edge (Common
  50)".
- `g-844x390-card-legendary.png`: the Legendary driver's card: Wind "20% less", Bad lies "30%
  less", Spin range 100, Forgiveness 80, Mishit cost 100, the same three lines, and "Carry about
  250 yd, Good or Pured, the same as Common. The cost: a sweet spot 80 percent of Common's and
  harsher mishits."
- `g-390x844-card-legendary.png`: in this run a gear drop had produced an Epic driver and the tool
  equipped that one first, so the card shows Epic: Wind "15% less", Bad lies "22% less", Spin
  range 80, Forgiveness 85, Mishit cost 81.
