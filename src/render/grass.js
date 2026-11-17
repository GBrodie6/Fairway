// Near-camera grass: instanced blades in a square around the camera that wraps as it moves.
// Each blade is placed on the GPU: it reads the terrain height texture for its base, the
// surface masks for how tall it should be (none on greens, sand, and paths, short on the
// fairway, tall in the deep rough), and takes its color from the ground beneath it.
//
// Lesson from the old project (grass that rendered as black spikes): blades are lit with the
// ground's own up-facing normal, never with their thin geometric normal, and their base color
// is the terrain's color, so a blade can only ever be a slightly lighter or darker piece of
// the ground it stands on.
import * as THREE from 'three';
import { SURFACE_SLOTS } from './terrainLayers.js';
import { fin } from '../core/guards.js';

// Blade height in meters per surface slot (painter's order, same as the terrain shader).
const HEIGHTS = {
  default: { rough: 0.075, deep: 0.2, waste: 0.05, dirt: 0, shore: 0.0, rock: 0, firstCut: 0.036, fairway: 0.015, path: 0, fringe: 0.02, tee: 0.012, green: 0, bunker: 0 },
  links: { rough: 0.07, deep: 0.3, waste: 0.0 },
  desert: { rough: 0.06, deep: 0.1, waste: 0.0 },
  alpine: { rough: 0.08, deep: 0.22, waste: 0.03 },
  tropical: { rough: 0.085, deep: 0.2, waste: 0.07 },
};

export function createGrass(world, engine) {
  const tier = engine.tier;
  const N = tier.grassBlades, R = tier.grassRadius;
  if (!N || !R) return { group: new THREE.Group(), update() {}, loadHole() {}, dispose() {}, blades: 0 };
  const NS = SURFACE_SLOTS.length;

  // One blade: three segments tapering to a point.
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.4, 0.34, 0, 0.4, 0.34, 0, -0.24, 0.68, 0, 0.24, 0.68, 0, 0, 1, 0], 3));
  base.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  const seeds = new Float32Array(N * 4);
  // A fixed pseudo-random pattern (the same on every device).
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < N * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    tGrassH: { value: null }, tGM1: { value: null }, tGM2: { value: null }, tGM3: { value: null },
    uGGrid: { value: new THREE.Vector4() }, uGCenter: { value: new THREE.Vector2() }, uGRadius: { value: R },
    uGTime: { value: 0 }, uGWind: { value: new THREE.Vector2(1, 0) },
    uGHeights: { value: new Array(NS).fill(0) }, uGColors: { value: Array.from({ length: NS }, () => new THREE.Vector3(0.1, 0.2, 0.05)) },
  };

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  world.lighting.setup(material, [(shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        #define GNS ${NS}
        attribute vec4 aSeed;
        uniform highp sampler2D tGrassH;
        uniform sampler2D tGM1; uniform sampler2D tGM2; uniform sampler2D tGM3;
        uniform vec4 uGGrid; uniform vec2 uGCenter; uniform float uGRadius; uniform float uGTime; uniform vec2 uGWind;
        uniform float uGHeights[GNS]; uniform vec3 uGColors[GNS];
        varying vec3 vGColor; varying float vGY;
        float gH(ivec2 p) { return texelFetch(tGrassH, clamp(p, ivec2(0), ivec2(int(uGGrid.z) - 1, int(uGGrid.w) - 1)), 0).r; }
        float gW(float m) { return smoothstep(0.42, 0.58, m); }`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', /* glsl */ `
        float GR = uGRadius;
        vec2 gTile = aSeed.xy * (2.0 * GR);
        vec2 gRel = mod(gTile - uGCenter + GR, 2.0 * GR) - GR;
        vec2 gWp = uGCenter + gRel;
        float gDist = length(gRel);
        vec2 gG = gWp - uGGrid.xy;
        ivec2 gI = ivec2(floor(gG));
        vec2 gF = fract(gG);
        float gGround = mix(mix(gH(gI), gH(gI + ivec2(1, 0)), gF.x), mix(gH(gI + ivec2(0, 1)), gH(gI + ivec2(1, 1)), gF.x), gF.y);
        vec2 gUv = (gG + 0.5) / uGGrid.zw;
        vec4 gm1 = textureLod(tGM1, gUv, 0.0), gm2 = textureLod(tGM2, gUv, 0.0), gm3 = textureLod(tGM3, gUv, 0.0);
        // Same painter's order as the terrain: each surface overrides the ones beneath.
        float gHt = uGHeights[0]; vec3 gCol = uGColors[0]; float gw;
        gw = gW(gm1.r); gHt = mix(gHt, uGHeights[1], gw); gCol = mix(gCol, uGColors[1], gw);
        gw = gW(gm1.g); gHt = mix(gHt, uGHeights[2], gw); gCol = mix(gCol, uGColors[2], gw);
        gw = gW(gm1.b); gHt = mix(gHt, uGHeights[3], gw); gCol = mix(gCol, uGColors[3], gw);
        gw = gW(gm1.a); gHt = mix(gHt, uGHeights[4], gw); gCol = mix(gCol, uGColors[4], gw);
        gw = gW(gm2.r); gHt = mix(gHt, uGHeights[5], gw); gCol = mix(gCol, uGColors[5], gw);
        gw = gW(gm2.g); gHt = mix(gHt, uGHeights[6], gw); gCol = mix(gCol, uGColors[6], gw);
        gw = gW(gm2.b); gHt = mix(gHt, uGHeights[7], gw); gCol = mix(gCol, uGColors[7], gw);
        gw = gW(gm2.a); gHt = mix(gHt, uGHeights[8], gw); gCol = mix(gCol, uGColors[8], gw);
        gw = gW(gm3.r); gHt = mix(gHt, uGHeights[9], gw); gCol = mix(gCol, uGColors[9], gw);
        gw = gW(gm3.g); gHt = mix(gHt, uGHeights[10], gw); gCol = mix(gCol, uGColors[10], gw);
        gw = gW(gm3.b); gHt = mix(gHt, uGHeights[11], gw); gCol = mix(gCol, uGColors[11], gw);
        gw = gW(gm3.a); gHt = mix(gHt, uGHeights[12], gw); gCol = mix(gCol, uGColors[12], gw);
        // Fade out toward the edge of the patch and where the surface carries no blades.
        float gFade = 1.0 - smoothstep(GR * 0.62, GR * 0.97, gDist);
        float gLen = gHt * (0.7 + 0.6 * aSeed.w) * gFade;
        float gAlive = step(0.004, gLen);
        float gWide = (0.011 + gHt * 0.17) * (0.7 + 0.6 * aSeed.z);
        float gAng = aSeed.z * 6.2831853;
        vec2 gSide = vec2(cos(gAng), sin(gAng));
        float y = position.y;
        // Lean: a fixed random lean plus the wind, growing with the square of height.
        float gWv = length(uGWind);
        float gGust = sin(uGTime * (1.6 + gWv * 0.12) + gWp.x * 0.35 + gWp.y * 0.27) * 0.6 + sin(uGTime * 3.7 + gWp.x * 1.3) * 0.4;
        vec2 gLean = (vec2(aSeed.x, aSeed.y) - 0.5) * 0.5 + normalize(uGWind + vec2(1e-4)) * (0.12 + gWv * 0.055) * (0.6 + 0.4 * gGust);
        vec3 transformed = vec3(
          gWp.x + gSide.x * position.x * gWide + gLean.x * y * y * gLen,
          gGround + y * gLen * gAlive - (1.0 - gAlive) * 4.0,
          gWp.y + gSide.y * position.x * gWide + gLean.y * y * y * gLen);
        vGY = y;
        // Tips catch more light and dry out a little: lighter and a touch yellower.
        vGColor = gCol * mix(vec3(0.84, 0.86, 0.82), vec3(1.2, 1.22, 1.04), y);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGColor;\nvarying float vGY;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vGColor;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.directSpecular *= 0.04;\n  reflectedLight.indirectSpecular *= 0.04;\n  reflectedLight.indirectDiffuse *= 0.72 + 0.28 * vGY;');
  }], 'grass');

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  const group = new THREE.Group();
  group.add(mesh);
  let heightTex = null;

  const grass = {
    group, mesh, blades: N, radius: R, triangles: N * 5,
    loadHole(w) {
      const t = w.terrain, v = w.terrainView;
      if (heightTex) heightTex.dispose();
      heightTex = new THREE.DataTexture(t.height, t.nx, t.nz, THREE.RedFormat, THREE.FloatType);
      heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter;
      heightTex.needsUpdate = true;
      uniforms.tGrassH.value = heightTex;
      uniforms.tGM1.value = v.tex.m1; uniforms.tGM2.value = v.tex.m2; uniforms.tGM3.value = v.tex.m3;
      uniforms.uGGrid.value.set(t.x0, t.z0, t.nx, t.nz);
      const hs = { ...HEIGHTS.default, ...(HEIGHTS[w.courseId] || {}) };
      v.surfaces.forEach((surf, i) => {
        uniforms.uGHeights.value[i] = hs[surf.slot] || 0;
        uniforms.uGColors.value[i].set(surf.avg[0], surf.avg[1], surf.avg[2]);
      });
    },
    update(dt, t, w) {
      const c = w.grassCenter || w.camera.position;
      uniforms.uGCenter.value.set(fin(c.x, 0), fin(c.z, 0));
      uniforms.uGTime.value = fin(t, 0) % 3600;
      const wind = w.wind || { x: 1, z: 0 };
      uniforms.uGWind.value.set(fin(wind.x, 1), fin(wind.z, 0));
    },
    dispose() { geo.dispose(); base.dispose(); material.dispose(); if (heightTex) heightTex.dispose(); },
  };
  return grass;
}
