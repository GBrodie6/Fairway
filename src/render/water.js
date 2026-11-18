// Water: a physically based surface built on MeshStandardMaterial, so it takes the engine's
// sun, cascaded shadows, and the image-based sky reflection with Fresnel for free. On top:
//   depth color      shallow water shows the tinted bed, deep water goes dark (Beer-Lambert)
//   ripples          three scrolling normal-map layers that travel with the game wind
//   foam             a broken white line where the water meets the bank, surf bands on the sea
// Depth comes from the terrain itself: each water vertex stores level minus ground height.
import * as THREE from 'three';
import { fin } from '../core/guards.js';

const PARS = /* glsl */ `
varying vec3 vWaterPos;
varying float vWaterDepth;
uniform sampler2D tWaterN;
uniform float uHasWaterN;
uniform float uWaterTime;
uniform vec2 uWaterWind;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uChop;
uniform float uClarity;
uniform float uSea;
uniform vec4 uGridRect;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const MAIN = /* glsl */ `
  vec3 wNormal = vec3(0.0, 1.0, 0.0);
  float wFoam = 0.0;
  {
    vec2 p = vWaterPos.xz;
#ifdef SEA_OUTER
    if (p.x > uGridRect.x && p.x < uGridRect.z && p.y > uGridRect.y && p.y < uGridRect.w) discard;
#endif
    // Depth is interpolated from the true ground heights, so this also hides water wherever
    // a coarser terrain LOD would otherwise let the surface poke through a bank.
    if (vWaterDepth < -0.015) discard;
    float depth = max(vWaterDepth, 0.0);
    float wl = length(uWaterWind);
    vec2 wd = wl > 0.01 ? uWaterWind / wl : vec2(1.0, 0.0);
    vec2 wp = vec2(-wd.y, wd.x);
    float t = uWaterTime;
    vec2 n = vec2(0.0);
    float vdist = length(cameraPosition - vWaterPos);
    if (uHasWaterN > 0.5) {
      n += (texture2D(tWaterN, p / 6.5 + wd * t * (0.05 + wl * 0.012)).xy * 2.0 - 1.0) * 0.55;
#if WATER_QUALITY > 0
      n += (texture2D(tWaterN, p / 2.3 - wp * t * 0.035 + wd * t * 0.06).xy * 2.0 - 1.0) * 0.3 * (1.0 - smoothstep(60.0, 220.0, vdist));
#endif
#if WATER_QUALITY > 1
      n += (texture2D(tWaterN, p / 23.0 + wd * t * 0.022 + 0.5).xy * 2.0 - 1.0) * 0.45;
#endif
    } else {
      n.x = sin(dot(p, wd) * 1.7 - t * 2.1) * 0.25 + sin(dot(p, wp) * 3.1 + t * 1.3) * 0.12;
      n.y = cos(dot(p, wd) * 2.3 - t * 1.7) * 0.2;
    }
    // Calm near the bank, rougher in open water and with stronger wind.
    float chop = uChop * (0.35 + 0.65 * smoothstep(0.0, 1.2, depth)) * (0.55 + wl * 0.11);
    wNormal = normalize(vec3(n.x * chop, 1.0, n.y * chop));
    // Depth color: light leaving the bed is absorbed on the way up.
    float absorb = 1.0 - exp(-depth * uClarity);
    vec3 col = mix(uShallow, uDeep, absorb);
#if WATER_QUALITY > 0
    // Foam where water meets land, broken up by noise and breathing slowly.
    float fn = wNoise(p * 2.6 + t * 0.25) * 0.6 + wNoise(p * 7.0 - t * 0.4) * 0.4;
    // A thin, broken line of foam right at the bank (ponds are calm; the sea makes more).
    float edge = 1.0 - smoothstep(0.02, 0.09 + 0.04 * sin(t * 0.9 + p.x * 0.4), depth);
    wFoam = edge * smoothstep(0.45, 0.8, fn) * (uSea > 0.5 ? 1.0 : 0.6);
    if (uSea > 0.5) {
      // Surf: bands that roll shoreward over the shallows.
      float band = sin(depth * 5.5 + t * 1.25 + fn * 1.6);
      wFoam = max(wFoam, smoothstep(0.82, 0.98, band) * (1.0 - smoothstep(0.25, 1.6, depth)) * smoothstep(0.3, 0.6, fn + 0.25));
    }
    col = mix(col, vec3(0.78, 0.8, 0.8), clamp(wFoam, 0.0, 1.0) * 0.7);
#endif
    diffuseColor.rgb = col;
    // Soft shoreline: the surface fades out over the last few centimeters of depth, so the
    // wet bank shows through instead of a hard edge.
    diffuseColor.a = smoothstep(0.0, 0.07, depth) * (1.0 - wFoam * 0.2) + wFoam * 0.2;
  }
`;

// Grid-aligned water surface for one body. step coarsens large bodies (the sea).
export function waterGeometry(terrain, body, step = 1) {
  const { nx, nz, x0, z0, bodyId, height } = terrain;
  const pos = [], dep = [], idx = [];
  const vmap = new Map();
  const vert = (ix, iz) => {
    const key = iz * nx + ix;
    let v = vmap.get(key);
    if (v === undefined) { v = pos.length / 3; vmap.set(key, v); pos.push(x0 + ix, 0, z0 + iz); dep.push(body.level - height[key]); }
    return v;
  };
  const ix0 = Math.max(0, body.ix0 ?? 0), ix1 = Math.min(nx - 1, body.ix1 ?? nx - 1);
  const iz0 = Math.max(0, body.iz0 ?? 0), iz1 = Math.min(nz - 1, body.iz1 ?? nz - 1);
  for (let iz = iz0; iz < iz1; iz += step) {
    for (let ix = ix0; ix < ix1; ix += step) {
      const ixb = Math.min(ix + step, nx - 1), izb = Math.min(iz + step, nz - 1);
      let hit = false;
      for (let a = iz; a <= izb && !hit; a++) for (let b = ix; b <= ixb; b++) if (bodyId[a * nx + b] === body.id) { hit = true; break; }
      if (!hit) continue;
      const a = vert(ix, iz), b = vert(ixb, iz), c = vert(ix, izb), d = vert(ixb, izb);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(dep), 1));
  g.setIndex(idx);
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

// deep: color of the water column; shallow: the bed seen through a little water; clarity:
// how fast light is absorbed with depth (per meter). The shallow tones are the bed's color
// darkened by water, never paler than the bank, so a pond reads as water, not milk.
const LOOKS = {
  parkland: { deep: [0.012, 0.04, 0.038], shallow: [0.075, 0.095, 0.055], clarity: 1.6, chop: 0.5 },
  links: { deep: [0.01, 0.04, 0.062], shallow: [0.1, 0.13, 0.11], clarity: 1.1, chop: 1.0 },
  desert: { deep: [0.01, 0.05, 0.06], shallow: [0.12, 0.13, 0.09], clarity: 1.3, chop: 0.45 },
  alpine: { deep: [0.008, 0.045, 0.062], shallow: [0.07, 0.11, 0.1], clarity: 1.0, chop: 0.5 },
  tropical: { deep: [0.006, 0.05, 0.07], shallow: [0.09, 0.18, 0.15], clarity: 1.25, chop: 0.8 },
};

export function createWater(world, engine) {
  const tier = engine.tier;
  const group = new THREE.Group();
  group.name = 'water';
  const shared = {
    tWaterN: { value: null }, uHasWaterN: { value: 0 }, uWaterTime: { value: 0 }, uWaterWind: { value: new THREE.Vector2(1, 0) },
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uChop: { value: 0.6 }, uClarity: { value: 1.2 },
    uGridRect: { value: new THREE.Vector4() },
  };
  const mats = [];
  function makeMaterial({ sea, outer }) {
    // Ponds reflect less of the sky: the environment map holds only sky, while a real pond
    // mirrors its dark banks and trees too, so full-strength sky made ponds look milky.
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: sea ? 0.1 : 0.07, metalness: 0, envMapIntensity: sea ? 1.25 : 0.62, transparent: !outer, depthWrite: true });
    m.defines = { ...(m.defines || {}), WATER_QUALITY: tier.waterQuality };
    if (outer) m.defines.SEA_OUTER = 1;
    const uSea = { value: sea ? 1 : 0 };
    world.lighting.setup(m, [(shader) => {
      Object.assign(shader.uniforms, shared, { uSea });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying vec3 vWaterPos;\nvarying float vWaterDepth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWaterDepth = aDepth;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <map_fragment>', MAIN)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.85, clamp(wFoam, 0.0, 1.0));')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);')
        // The sky map holds only sky. A pond's low reflections would show its banks and the
        // trees around it, which are dark, so reflections that point near the horizon are
        // darkened and tinted toward foliage. The open sea keeps its horizon.
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    vec3 vw = normalize(vWaterPos - cameraPosition);
    vec3 rw = reflect(vw, wNormal);
    float bank = (1.0 - uSea) * (1.0 - smoothstep(0.03, 0.42, rw.y));
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, reflectedLight.indirectSpecular * vec3(0.09, 0.12, 0.08), bank);
  }`);
    }], `water:${tier.waterQuality}:${sea ? 1 : 0}:${outer ? 1 : 0}`);
    mats.push(m);
    return m;
  }
  let pondMat = null, seaMat = null, seaOuterMat = null;

  const water = {
    group,
    unloadHole() { for (const c of [...group.children]) { c.geometry.dispose(); group.remove(c); } },
    async loadHole(w) {
      water.unloadHole();
      const t = w.terrain;
      const look = LOOKS[w.courseId] || LOOKS.parkland;
      shared.uDeep.value.setRGB(...look.deep); shared.uShallow.value.setRGB(...look.shallow);
      shared.uClarity.value = look.clarity; shared.uChop.value = look.chop;
      shared.uGridRect.value.set(t.x0 + 2, t.z0 + 2, t.maxX - 2, t.maxZ - 2);
      for (const b of t.bodies) {
        if (b.type === 'sea') {
          seaMat = seaMat || makeMaterial({ sea: true, outer: false });
          const g = waterGeometry(t, b, 4);
          if (g) { const m = new THREE.Mesh(g, seaMat); m.position.y = b.level; m.receiveShadow = true; m.userData.water = true; group.add(m); }
          // The open sea beyond the mapped ground, out to the horizon.
          seaOuterMat = seaOuterMat || makeMaterial({ sea: true, outer: true });
          const og = new THREE.PlaneGeometry(36000, 36000, 1, 1).rotateX(-Math.PI / 2);
          og.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(4).fill(9), 1));
          const om = new THREE.Mesh(og, seaOuterMat);
          om.position.set((t.x0 + t.maxX) / 2, b.level, (t.z0 + t.maxZ) / 2);
          om.userData.water = true;
          group.add(om);
        } else {
          pondMat = pondMat || makeMaterial({ sea: false, outer: false });
          const g = waterGeometry(t, b, 1);
          if (!g) continue;
          const m = new THREE.Mesh(g, pondMat);
          m.position.y = b.level;
          m.receiveShadow = true;
          m.userData.water = true;
          group.add(m);
        }
      }
      if (world.assets && world.assets.enabled && !shared.tWaterN.value) {
        water.loading = world.assets.texture('procedural', 'water_normal', { repeat: true, anisotropy: Math.min(8, tier.anisotropy) }).then((tex) => {
          if (tex) { shared.tWaterN.value = tex; shared.uHasWaterN.value = 1; }
        });
      }
    },
    whenSettled: async () => { if (water.loading) await water.loading; },
    update(dt, t, w) {
      shared.uWaterTime.value = fin(t, 0) % 3600;
      const wind = w.wind || { x: 1, z: 0 };
      shared.uWaterWind.value.set(fin(wind.x, 1), fin(wind.z, 0));
    },
    dispose() { water.unloadHole(); for (const m of mats) m.dispose(); },
  };
  return water;
}
