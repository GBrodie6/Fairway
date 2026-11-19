# Live checks of 5ec8117 (club tier benefits) on https://gbrodie6.github.io/Fairway/

Headless Chrome, real taps, against the live site.

- Clean loads (`l.json`): phone 390x844 and desktop 1366x768, 0 console errors, 0 failed
  requests, every request HTTPS; Chrome's installability check in a persistent profile: no
  errors (the two "in-incognito" notes come from the throwaway profiles of the first two runs).
- Gear screens (`g-390x844*`, `g-844x390*`, from `scripts/tools/gear.mjs` with URL=...), 0
  console errors at both sizes:
  - Compare, a Rare 7 iron against the Common one in the bag: Wind "10% less (+10)", Bad lies
    "15% less (+15)", Spin range "70 (+20)", Forgiveness "90 (-10)", Mishit cost "63 (+32)",
    and the lines "Crosswind moves the ball 10 percent less", "Rough, sand and bad lies cost 15
    percent less", "Spin and shape range 1.4x: the spin dot reaches 70 percent of the way to the
    edge (Common 50)".
  - The Legendary driver's card: Wind "20% less", Bad lies "30% less", Spin range 100,
    Forgiveness 80, Mishit cost 100.
