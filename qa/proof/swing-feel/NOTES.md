# Swing look and feel: proof

Captured with `scripts/tools/swingframes.mjs` on the production build in headless Chrome
(SwiftShader), through real touch drags (DevTools touch events) with the frame loop stepped
by hand on the same clock as the touches, so each frame lands on a known moment. The finger is
sampled like a real one: uneven gaps of 6 to 26 ms and a pixel or two of wobble, the same
seeded wobble before and after. Before is commit 174c241, after is this commit.

Frames (address, 25 percent, 50 percent, top after a 110 ms pause, mid-downswing, the impact
frame, follow-through): `before-*-390x844.png`, `after-*-390x844.png`, and strips for
390x844, 844x390 and 390x844 left-handed (`strip-before-*.png`, `strip-after-*.png`).

| | Before | After |
| --- | --- | --- |
| Backswing frames where the club's step changed by more than 60 percent (stutter) | 28 of 66 (390x844), 34 of 65 (844x390) | 2 of 66, 2 of 65 |
| Downswing frames that slowed to under half the previous step | 5 of 14 | 2 of 14 |
| Mean head acceleration over the drag (second difference, m/s^2) | 228 | 109 |
| Club head on the crossing frame | at the ball (0.3 cm from its surface) | at the ball (0.3 cm from its surface) |
| Swing result for the same recorded drag | power 0.994, ratio 2.51, Good | power 0.994, ratio 2.51, Good (unchanged) |

The peak head acceleration after the change (about 3500 m/s^2) is in the last frames before
impact, where the eased downswing accelerates into the ball on purpose; before, the peaks were
the steps of the raw drag.

Layout (`layout-right.json`, `layout-left.json`, from `scripts/tools/hud.mjs` with the docked
track measured as a box): 390x844, 360x640, 844x390 and 1024x768, right- and left-handed, at
address, top, impact and follow-through: no overlap between the track and any control, the
ball or the club, nothing off screen, no console errors.
