// The first-person club path (game/clubPath.js): a tilted arc about a pivot, keyframed by
// progress 0 (address) to 0.5 (top) to 1 (impact), then the follow-through to 1.5.
import { describe, it, expect } from 'vitest';
import { swingFrame, clubPose, faceYawDeg, progressFromDrag, downswingStart, followProgress, CLUB_GEOMETRY, BALL_R, arcAngles, ARC, cameraBack } from '../src/game/clubPath.js';

const ball = { x: 3, y: 10 + BALL_R, z: -4 };
const heading = 0.4;
const f = { x: Math.sin(heading), z: -Math.cos(heading) };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ids = Object.keys(CLUB_GEOMETRY);

// A drag at a steady speed: backswing over backMs, downswing over downMs, sampled at hz.
function simulate(id, { lefty = false, depth = 1, backMs = 780, downMs = 260, hz = 240, lag = 0 } = {}) {
  const fr = swingFrame(ball, heading, id, { lefty });
  const out = [];
  const nb = Math.round((backMs / 1000) * hz), nd = Math.round((downMs / 1000) * hz);
  for (let i = 0; i <= nb; i++) out.push(clubPose(fr, progressFromDrag('back', depth * (i / nb), depth * (i / nb)), { top: depth * (i / nb) }));
  for (let i = 1; i <= nd; i++) {
    const d = depth * (1 - i / nd);
    const p = progressFromDrag('down', d, depth);
    const u = i / nd;
    out.push(clubPose(fr, p, { top: depth, lagDeg: lag * Math.sin(Math.PI * u) }));
  }
  return { fr, poses: out, impactIndex: out.length - 1, dt: 1 / hz, nb, nd };
}

describe('club path', () => {
  it('at impact the head is within 2 cm of the ball for every club and both hands', () => {
    for (const id of ids) for (const lefty of [false, true]) {
      const fr = swingFrame(ball, heading, id, { lefty });
      const pose = clubPose(fr, 1, { top: 1 });
      // Gap between the contact point on the face and the ball's surface.
      expect(dist(pose.head, ball) - BALL_R).toBeLessThan(0.02);
      expect(dist(pose.head, ball) - BALL_R).toBeGreaterThanOrEqual(0);
    }
  });

  it('the face is square at impact for a square swing', () => {
    for (const id of ids) for (const lefty of [false, true]) {
      const fr = swingFrame(ball, heading, id, { lefty });
      expect(Math.abs(faceYawDeg(clubPose(fr, 1, { top: 1 }), fr))).toBeLessThan(0.5);
    }
  });

  it('an open face turns the face right and a closed one left, for either hand', () => {
    for (const lefty of [false, true]) {
      const fr = swingFrame(ball, heading, 'I7', { lefty });
      expect(faceYawDeg(clubPose(fr, 1, { top: 1, faceDeg: 6 }), fr)).toBeGreaterThan(3);
      expect(faceYawDeg(clubPose(fr, 1, { top: 1, faceDeg: -6 }), fr)).toBeLessThan(-3);
    }
  });

  it('an in-to-out path brings the head into the ball moving right of the target line', () => {
    for (const lefty of [false, true]) {
      const fr = swingFrame(ball, heading, 'I7', { lefty, pathDeg: 6 });
      const a = clubPose(fr, 0.999, { top: 1 }).head, b = clubPose(fr, 1, { top: 1 }).head;
      const right = { x: -f.z, z: f.x };
      const vx = b.x - a.x, vz = b.z - a.z;
      const along = vx * f.x + vz * f.z, side = vx * right.x + vz * right.z;
      expect(along).toBeGreaterThan(0);
      expect((Math.atan2(side, along) * 180) / Math.PI).toBeGreaterThan(3);
    }
  });

  it('head speed peaks within 3 percent of the impact frame', () => {
    for (const id of ['DR', 'I7', 'SW', 'PT']) for (const lag of [0, 9]) {
      const { poses, impactIndex, dt } = simulate(id, { lag });
      const speed = poses.map((p, i) => (i ? dist(p.head, poses[i - 1].head) / dt : 0));
      let best = 0;
      for (let i = 1; i < speed.length; i++) if (speed[i] > speed[best]) best = i;
      expect(Math.abs(best - impactIndex) / poses.length).toBeLessThanOrEqual(0.03);
    }
  });

  it('the top of the backswing is above the address height', () => {
    for (const id of ids) {
      const fr = swingFrame(ball, heading, id);
      const addr = clubPose(fr, 0, { top: 1 }).head, top = clubPose(fr, 0.5, { top: 1 }).head;
      expect(top.y).toBeGreaterThan(addr.y + (id === 'PT' ? 0.03 : 0.8));
    }
  });

  it('the finish is on the target side of the ball', () => {
    for (const id of ids) for (const lefty of [false, true]) {
      const fr = swingFrame(ball, heading, id, { lefty });
      const fin = clubPose(fr, 1.5, { top: 1 }).head;
      const ahead = (fin.x - ball.x) * f.x + (fin.z - ball.z) * f.z;
      expect(ahead).toBeGreaterThan(id === 'PT' ? 0.1 : 0.2);
    }
  });

  it('the backswing angle follows the drag one to one, and stopping holds the club', () => {
    const arc = ARC.iron;
    for (const d of [0.1, 0.35, 0.6, 0.9]) {
      expect(arcAngles(progressFromDrag('back', d, d), d, arc).turn).toBeCloseTo(arc.top * d, 6);
    }
    const fr = swingFrame(ball, heading, 'I7');
    const a = clubPose(fr, progressFromDrag('back', 0.5, 0.5), { top: 0.5 }), b = clubPose(fr, progressFromDrag('back', 0.5, 0.5), { top: 0.5 });
    expect(dist(a.head, b.head)).toBe(0);
  });

  it('a partial backswing turns into the downswing without a jump', () => {
    for (const d of [0.25, 0.5, 0.8, 1]) {
      const fr = swingFrame(ball, heading, 'I7');
      const top = clubPose(fr, progressFromDrag('back', d, d), { top: d }), start = clubPose(fr, progressFromDrag('down', d, d), { top: d });
      expect(dist(top.head, start.head)).toBeLessThan(1e-6);
      expect(progressFromDrag('down', d, d)).toBeCloseTo(downswingStart(d), 9);
    }
  });

  it('progress maps the backswing to the first half and the downswing to the second', () => {
    expect(progressFromDrag('back', 0, 0)).toBe(0);
    expect(progressFromDrag('back', 1, 1)).toBe(0.5);
    expect(progressFromDrag('down', 1, 1)).toBe(0.5);
    expect(progressFromDrag('down', 0, 1)).toBe(1);
    expect(followProgress(0)).toBe(1);
    expect(followProgress(0.5)).toBe(1.5);
    expect(followProgress(9)).toBe(1.5);
  });

  it('the downswing at the drag tempo runs about three times faster than the backswing', () => {
    // At a 3:1 drag tempo the club covers the same arc in a third of the time.
    const { poses, nb, nd } = simulate('I7', { backMs: 780, downMs: 260 });
    const len = (a, b) => { let s = 0; for (let i = a + 1; i <= b; i++) s += dist(poses[i].head, poses[i - 1].head); return s; };
    const back = len(0, nb), down = len(nb, nb + nd);
    const ratio = (back / nb) / (down / nd);
    expect(down / back).toBeGreaterThan(0.9);
    expect(1 / ratio).toBeGreaterThan(2.5);
  });

  it('the address camera finds a distance that keeps a full swing on screen at phone sizes', () => {
    const fov = (a) => (a >= 1 ? 55 : Math.min(88, (2 * Math.atan(Math.tan((55 * Math.PI) / 360) / Math.max(a, 0.45) * 0.72) * 180) / Math.PI));
    // Viewport, ball height, and the HUD corner (tabs) measured from the real layout.
    for (const [W, H, bf, kx, ky] of [[390, 844, 0.569, 156, 184], [844, 390, 0.495, 150, 160], [360, 640, 0.5, 147, 140], [1024, 768, 0.635, 156, 184]]) {
      for (const lefty of [false, true]) {
        const keep = lefty ? { x: (W - 200) / W, y: 170 / H } : { x: kx / W, y: ky / H };
        const back = cameraBack({ aspect: W / H, fovDeg: fov(W / H), ballFrac: bf, up: W < H ? 1.5 : 1.45, keep, lefty });
        expect(back).toBeGreaterThanOrEqual(3.2);
        expect(back).toBeLessThan(8);
      }
    }
  });
});
