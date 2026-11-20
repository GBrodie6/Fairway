import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { COURSES } from '../src/course/courses.js';
import { getHole } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { createScenery, sceneryFootprint, SCENERY_BUDGET, SCENERY_DETAIL } from '../src/render/scenery.js';
import { footprintDistance } from '../src/render/terrainView.js';
import { layersFor } from '../src/render/terrainLayers.js';
import { otherHolesOn, TIER_ORDER } from '../src/core/quality.js';
import manifest from '../src/render/assets.manifest.json';

// The scenery is laid on the outer ground; here the macro function stands in for that mesh.
function make(courseId, index, tierId) {
  const course = COURSES.find((c) => c.id === courseId), hole = getHole(course, index), terrain = buildTerrain(course, hole);
  const view = { outerSurfaceAt: (x, z) => terrain.macro(x, z, 1) };
  const { surfaces } = layersFor(course.look || course.id, manifest);
  return { course, terrain, scenery: createScenery({ course, index, terrain, view, tier: { id: tierId }, surfaces }) };
}

describe('other holes as scenery', () => {
  it('Show other holes: On by default on Medium and up, Off on Low; the setting wins', () => {
    expect(otherHolesOn('auto', 'low')).toBe(false);
    for (const t of ['medium', 'high', 'ultra']) expect(otherHolesOn('auto', t)).toBe(true);
    expect(otherHolesOn('on', 'low')).toBe(true);
    expect(otherHolesOn('off', 'ultra')).toBe(false);
    for (const t of TIER_ORDER) expect(SCENERY_BUDGET[t] && SCENERY_DETAIL[t]).toBeTruthy();
    expect(SCENERY_BUDGET.high).toEqual({ tris: 60000, draws: 6 });
    expect(SCENERY_BUDGET.medium).toEqual({ tris: 25000, draws: 4 });
    expect(SCENERY_BUDGET.low).toEqual({ tris: 8000, draws: 2 });
  });

  // A parkland hole, a links hole and the Old Course's 10th (a coastal hole).
  for (const [courseId, index] of [['parkland', 0], ['links', 4], ['standrews', 9]]) {
    it(`${courseId} hole ${index + 1}: inside the budgets on every tier, never on the hole's own ground or in its sea`, () => {
      for (const tierId of ['low', 'medium', 'high']) {
        const { terrain, scenery } = make(courseId, index, tierId);
        const st = scenery.stats(), b = SCENERY_BUDGET[tierId];
        expect(st.holes).toBeGreaterThan(0);
        expect(st.tris).toBeLessThanOrEqual(b.tris);
        expect(st.draws).toBeLessThanOrEqual(b.draws);
        expect(scenery.meshes.length).toBe(2);
        // Every flat triangle faces up, so the double-sided lighting never flips it dark.
        const faces = scenery.facingDown();
        expect(faces.flat).toBeGreaterThan(50);
        expect(faces.down).toBe(0);
        for (const m of scenery.meshes) { expect(m.castShadow).toBe(false); expect(m.receiveShadow).toBe(false); }
        // One draw each: the transparent double-sided drape must not be split into two passes.
        expect(scenery.meshes[0].material.forceSinglePass).toBe(true);
        // Every corner that can be drawn lies off the current hole's grid (where the ball plays
        // this hole's own ground) and out of its sea.
        const corners = scenery.corners();
        expect(corners.length).toBeGreaterThan(100);
        for (const [x, z] of corners) {
          const inGrid = x > terrain.x0 && x < terrain.maxX && z > terrain.z0 && z < terrain.maxZ;
          expect(inGrid).toBe(false);
          if (terrain.seaDistAt) expect(terrain.seaDistAt(x, z)).toBeLessThan(-9);
        }
        scenery.dispose();
      }
    }, 60000);
  }

  it('draws only the holes within the distance limit and in view, and two draw calls at most', () => {
    const { terrain, scenery } = make('parkland', 0, 'high');
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
    // Far above and away from the course, looking away: nothing.
    cam.position.set(60000, 400, 60000); cam.lookAt(120000, 400, 120000); cam.updateMatrixWorld(true);
    scenery.update(cam);
    expect(scenery.stats().drawnHoles).toBe(0);
    expect(scenery.meshes.every((m) => !m.visible)).toBe(true);
    // The flyover from the tee: some holes, inside the budget.
    cam.position.set(terrain.tee.x, 70, terrain.tee.z + 70); cam.lookAt(terrain.hole.green.x, 0, terrain.hole.green.z); cam.updateMatrixWorld(true);
    scenery.update(cam);
    const st = scenery.stats();
    expect(st.drawnHoles).toBeGreaterThan(0);
    expect(st.drawnHoles).toBeLessThanOrEqual(st.holes);
    expect(st.drawnTris).toBeLessThanOrEqual(SCENERY_BUDGET.high.tris);
    // Turned off: nothing drawn.
    scenery.setVisible(false);
    expect(scenery.meshes.every((m) => !m.visible)).toBe(true);
    scenery.dispose();
  }, 60000);

  it('the footprint: other holes only, as segments with their corridor widths', () => {
    const course = COURSES.find((c) => c.id === 'parkland');
    const fp = sceneryFootprint(course, 3);
    expect(fp.length % 5).toBe(0);
    expect(fp.length).toBeGreaterThan(17 * 5);
    const d = footprintDistance(fp);
    // The current hole's own centerline is well clear of every other corridor (60 m gap rule).
    const hole = getHole(course, 3);
    const mid = hole.line[Math.floor(hole.line.length / 2)];
    expect(d(mid.x, mid.z)).toBeGreaterThan(40);
    expect(footprintDistance(null)).toBe(null);
    expect(sceneryFootprint({ ...course, id: 'lvl:scenery-test', pars: [4] }, 0)).toBe(null);
  });
});
