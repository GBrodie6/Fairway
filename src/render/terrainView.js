// Terrain rendering: chunked LOD mesh over the terrain heightfield, the outer landscape, and
// the splat material. All data comes straight from the terrain arrays that the physics reads.
import * as THREE from 'three';
import { MASKS, CELL } from '../course/terrain.js';
import { layersFor, SURFACE_SLOTS } from './terrainLayers.js';
import { SURFACES } from '../physics/surfaces.js';
import { clamp, smoothstep } from '../core/math.js';

const CHUNK = 96;
const STEPS = [1, 2, 4, 8, 16];
const LOD_DIST = [42, 105, 230, 480]; // distance at which each coarser step takes over
const MOW_WIDTH = 5.6; // fairway stripe width in meters

// ---------------------------------------------------------------------------------------
// Data textures built from the terrain arrays.
// ---------------------------------------------------------------------------------------
function dataTex(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function buildTerrainTextures(terrain) {
  const { nx, nz, masks, sField, tField, normalX, normalZ, trees, bunkerIn, wetIn } = terrain;
  const n = nx * nz;
  const pack = (a, b, c, d) => {
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = a[i]; out[i * 4 + 1] = b[i]; out[i * 4 + 2] = c[i]; out[i * 4 + 3] = d[i]; }
    return out;
  };
  const m = masks;
  const tri = (v) => { const f = v / (2 * MOW_WIDTH); return Math.abs((f - Math.floor(f)) * 2 - 1); };
  const mow = new Uint8Array(n * 4), aux = new Uint8Array(n * 4);
  const r2 = Math.SQRT1_2;
  for (let i = 0; i < n; i++) {
    const s = sField[i], t = tField[i];
    mow[i * 4] = Math.round(tri(t) * 255);
    mow[i * 4 + 1] = Math.round(tri(s) * 255);
    mow[i * 4 + 2] = Math.round(tri((s + t) * r2) * 255);
    mow[i * 4 + 3] = Math.round(tri((s - t) * r2) * 255);
    aux[i * 4] = Math.round((normalX[i] * 0.5 + 0.5) * 255);
    aux[i * 4 + 1] = Math.round((normalZ[i] * 0.5 + 0.5) * 255);
    aux[i * 4 + 2] = trees[i];
    // Bunker interior (distance from the edge in wall widths) inside bunkers; elsewhere how wet
    // the ground is at the water's edge.
    aux[i * 4 + 3] = bunkerIn && bunkerIn[i] ? bunkerIn[i] : wetIn ? wetIn[i] : 0;
  }
  const tex = {
    m1: dataTex(pack(m.deep, m.waste, m.dirt, m.shore), nx, nz),
    m2: dataTex(pack(m.rock, m.firstCut, m.fairway, m.path), nx, nz),
    m3: dataTex(pack(m.fringe, m.tee, m.green, m.bunker), nx, nz),
    mow: dataTex(mow, nx, nz),
    aux: dataTex(aux, nx, nz),
  };
  tex.bytes = n * 4 * 5 * 1.33;
  tex.dispose = () => { for (const k of ['m1', 'm2', 'm3', 'mow', 'aux']) tex[k].dispose(); };
  return tex;
}

// ---------------------------------------------------------------------------------------
// Shader. Injected into MeshStandardMaterial so the terrain gets the engine's lights,
// cascaded shadows, and image-based lighting like every other object.
// ---------------------------------------------------------------------------------------
const NS = SURFACE_SLOTS.length; // 13

const FRAG_PARS = /* glsl */ `
#define NS ${NS}
varying vec3 vWPos;
#ifdef OUTER_LAND
varying vec3 vONormal;
varying vec4 vOWeights;
#else
uniform sampler2D tM1;
uniform sampler2D tM2;
uniform sampler2D tM3;
uniform sampler2D tMow;
uniform sampler2D tAux;
#endif
uniform highp sampler2DArray tAlb;
uniform highp sampler2DArray tNR;
uniform sampler2D tDetail;
uniform vec4 uGrid;
uniform float uLayer[NS];
uniform float uScale[NS];
uniform vec3 uTint[NS];
uniform vec3 uAvg[NS];
uniform float uRoughAvg[NS];
uniform float uTexMix;
uniform float uHasDetail;
uniform float uMow;
uniform float uGreenMow;
uniform vec4 uGreen;
uniform vec4 uTee;
uniform vec2 uPlayDir;
uniform vec3 uSunDirW;
uniform vec3 uSunCol;
uniform float uDew;
uniform float uSnowLine;
uniform vec3 uCanopy;
uniform vec3 uCup;

float tHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Anti-aliased threshold at the exact mask edge (0.5).
float tEdge(float m) {
  float w = clamp(fwidth(m) * 0.85, 0.006, 0.35);
  return smoothstep(0.5 - w, 0.5 + w, m);
}
// Soft, noise-broken threshold for natural transitions.
float tSoft(float m, float n) {
  return smoothstep(0.34, 0.66, m + (n - 0.5) * 0.34);
}
// Signed pattern in -1..1 from a triangle wave, anti-aliased.
float tBand(float v) {
  float w = clamp(fwidth(v) * 1.1, 0.02, 0.5);
  return smoothstep(0.5 - w, 0.5 + w, v) * 2.0 - 1.0;
}
float tTri(float v) { return abs(fract(v) * 2.0 - 1.0); }
`;

const FRAG_MAIN = /* glsl */ `
  vec3 tAlbedo = vec3(0.0);
  vec3 tNormalW = vec3(0.0, 1.0, 0.0);
  float tRough = 0.9;
  float tOcc = 1.0;
  vec3 tCav = vec3(1.0);
  float tSpec = 0.2;
  vec3 tEmis = vec3(0.0);
  {
    vec2 pw = vWPos.xz;
#ifndef OUTER_LAND
    // The cup is a real hole in the green: the liner mesh shows through it.
    vec2 cupD = pw - uCup.xy;
    if (dot(cupD, cupD) < uCup.z * uCup.z) discard;
#endif
    float vdist = length(cameraPosition - vWPos);
    vec2 ddx = dFdx(pw), ddy = dFdy(pw);
    // Low-frequency variation breaks up the tiling and keeps big areas from reading flat.
    float nA = 0.5, nB = 0.5, nC = 0.5;
    vec2 pwN = pw;
#ifdef OUTER_LAND
    // On steep mountain faces a plan-view lookup smears one texel down the whole slope into
    // vertical streaks. Shift the lookup along the slope by the height so the noise follows
    // the distance over the surface.
    vec3 onrm = normalize(vONormal);
    vec2 sdir = onrm.xz / max(length(onrm.xz), 1e-3);
    pwN = pw - sdir * vWPos.y * smoothstep(0.08, 0.45, 1.0 - onrm.y);
#endif
    if (uHasDetail > 0.5) {
      vec4 d1 = texture2D(tDetail, pwN / 143.0);
      vec4 d2 = texture2D(tDetail, pwN / 37.0 + 0.37);
      nA = d1.r; nB = d2.g; nC = d2.b;
    } else {
      nA = tHash(floor(pwN / 9.0)); nB = tHash(floor(pwN / 2.3) + 7.0);
    }
    float a[NS];
#ifdef OUTER_LAND
    vec3 baseN = normalize(vONormal);
    float canopy = vOWeights.z;
    float slopeO = 1.0 - baseN.y;
    a[0] = 1.0;
    a[1] = vOWeights.x; a[2] = vOWeights.y; a[3] = 0.0; a[4] = vOWeights.w;
    a[5] = smoothstep(0.2, 0.42, slopeO + (nB - 0.5) * 0.12);
    a[6] = 0.0; a[7] = 0.0; a[8] = 0.0; a[9] = 0.0; a[10] = 0.0; a[11] = 0.0; a[12] = 0.0;
    vec4 mow = vec4(0.5);
    vec4 aux = vec4(0.5, 0.5, 0.0, 0.0);
    float bunkerM = 0.0;
#else
    vec2 guv = (pw - uGrid.xy + 0.5) * uGrid.zw;
    vec4 m1 = texture2D(tM1, guv);
    vec4 m2 = texture2D(tM2, guv);
    vec4 m3 = texture2D(tM3, guv);
    vec4 mow = texture2D(tMow, guv);
    vec4 aux = texture2D(tAux, guv);
    vec2 nxz = aux.rg * 2.0 - 1.0;
    vec3 baseN = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.02)), nxz.y);
    float canopy = aux.b;
    a[0] = 1.0;
    a[1] = tSoft(m1.r, nB); a[2] = tSoft(m1.g, nB); a[3] = tSoft(m1.b, nC); a[4] = smoothstep(0.25, 0.75, m1.a);
    a[5] = smoothstep(0.3, 0.7, m2.r + (nB - 0.5) * 0.3);
    a[6] = tEdge(m2.g); a[7] = tEdge(m2.b); a[8] = tEdge(m2.a);
    a[9] = tEdge(m3.r); a[10] = tEdge(m3.g); a[11] = tEdge(m3.b); a[12] = tEdge(m3.a);
    float bunkerM = m3.a;
#endif
    // Painter's order: each surface covers what is beneath it.
    float wgt[NS];
    float rem = 1.0;
    for (int i = NS - 1; i >= 0; i--) { wgt[i] = a[i] * rem; rem *= 1.0 - a[i]; }

    // Mowing patterns. Fairway bands follow the centerline (triangle waves baked per texel),
    // green and tee bands are straight lines in their own frame.
    // Mowing: only stripes along the line of play, softened. Checkerboards and diagonals read
    // as a printed pattern from the tee, so they are no longer used.
    float pFair = tBand(mow.r) * 0.75 + (mow.r - 0.5) * 0.5;
    vec2 gp = pw - uGreen.xy;
    float gu = dot(gp, uGreen.zw), gv = dot(gp, vec2(-uGreen.w, uGreen.z));
    float pGa = tBand(tTri(gu / 2.7)), pGb = tBand(tTri(gv / 2.7));
    float pGreen = pGa;
    vec2 tp = pw - uTee.xy;
    float pTee = tBand(tTri(dot(tp, vec2(-uTee.w, uTee.z)) / 2.2));

    vec3 nAcc = vec3(0.0);
    float rAcc = 0.0;
    float sAcc = 0.0;
    float farK = smoothstep(22.0, 150.0, vdist);
    float sandMatte = 1.0;
    float detailK = 1.0 - smoothstep(160.0, 420.0, vdist);
    for (int i = 0; i < NS; i++) {
      float w = wgt[i];
      if (w < 0.004) continue;
      vec3 c = uAvg[i];
      vec2 tn = vec2(0.0);
      float r = uRoughAvg[i];
      if (uTexMix > 0.001) {
        float sc = uScale[i];
        float L = uLayer[i];
        vec4 cs; vec4 ns;
#ifndef OUTER_LAND
        if (i == 5) {
#else
        if (i == 5 || i == 0 || i == 1 || i == 2) {
#endif
          // Triplanar on steep ground so the texture does not stretch down a slope.
          vec3 bw = pow(abs(baseN), vec3(5.0));
          bw /= (bw.x + bw.y + bw.z);
          cs = textureGrad(tAlb, vec3(pw / sc, L), ddx / sc, ddy / sc) * bw.y;
          ns = textureGrad(tNR, vec3(pw / sc, L), ddx / sc, ddy / sc) * bw.y;
          if (bw.x > 0.02) {
            vec2 u = vWPos.zy / sc;
            cs += textureGrad(tAlb, vec3(u, L), dFdx(u), dFdy(u)) * bw.x;
            ns += textureGrad(tNR, vec3(u, L), dFdx(u), dFdy(u)) * bw.x;
          }
          if (bw.z > 0.02) {
            vec2 u = vWPos.xy / sc;
            cs += textureGrad(tAlb, vec3(u, L), dFdx(u), dFdy(u)) * bw.z;
            ns += textureGrad(tNR, vec3(u, L), dFdx(u), dFdy(u)) * bw.z;
          }
        } else {
          vec2 uv = pw / sc;
          cs = textureGrad(tAlb, vec3(uv, L), ddx / sc, ddy / sc);
          ns = textureGrad(tNR, vec3(uv, L), ddx / sc, ddy / sc);
#ifdef TWO_SCALE
          // A second, larger, rotated copy takes over with distance to hide the repeat.
          float s2 = sc * 4.3;
          vec2 uv2 = vec2(pw.x * 0.866 - pw.y * 0.5, pw.x * 0.5 + pw.y * 0.866) / s2 + 0.31;
          vec4 c2 = textureGrad(tAlb, vec3(uv2, L), ddx / s2, ddy / s2);
          vec4 n2 = textureGrad(tNR, vec3(uv2, L), ddx / s2, ddy / s2);
          float k2 = 0.22 + farK * 0.58;
          cs = mix(cs, c2, k2);
          ns = mix(ns, n2, k2 * 0.7);
#endif
        }
        vec3 ct = cs.rgb * uTint[i];
        c = mix(c, ct, uTexMix);
        tn = (ns.xy * 2.0 - 1.0) * uTexMix * detailK;
        r = mix(r, ns.b, uTexMix);
      }
      // Tonal variation: a little brightness and a little hue.
      float vary = 0.84 + 0.32 * nA + (nB - 0.5) * 0.14;
      c *= vary;
      c.r *= 1.0 + (nC - 0.5) * 0.1;
      if (i == 7) {
        c *= 1.0 + pFair * 0.032;
        tn += uPlayDir * pFair * 0.028;
      } else if (i == 11) {
        // Green: faint mowing lines, and grain: fine streaks along the grain direction that
        // look lighter looking down-grain and darker looking into it.
        c *= 1.0 + pGreen * 0.026;
        tn += uGreen.zw * pGreen * 0.018;
        vec2 gdir = uGreen.zw, gperp = vec2(-gdir.y, gdir.x);
        vec2 gq = vec2(dot(pw, gdir) * 9.0, dot(pw, gperp) * 70.0);
        float gfade = 1.0 - smoothstep(0.25, 0.7, max(fwidth(gq.x), fwidth(gq.y)) / 9.0);
        float streak = (tHash(floor(gq)) - 0.5) * gfade;
        c *= 1.0 + streak * 0.07;
        vec3 vdirG = normalize(vWPos - cameraPosition);
        c *= 1.0 + 0.045 * dot(normalize(vdirG.xz + 1e-4), gdir);
        tn += gperp * streak * 0.08;
        tn *= 0.55;
        r = mix(r, 0.8, 0.5);
      } else if (i == 10) {
        c *= 1.0 + pTee * 0.03;
        tn *= 0.6;
      } else if (i == 9) {
        // Fringe: a collar of slightly longer, darker grass with its own coarser grain.
        c *= 0.93 + (tHash(floor(pw * 22.0)) - 0.5) * 0.04 * (1.0 - smoothstep(0.3, 0.9, fwidth(pw.x) * 22.0));
        tn *= 0.7;
      } else if (i == 12) {
        // Sand. aux.a is the distance in from the edge, in wall widths (0.5 = the foot of the
        // face where it meets the floor).
        float inB = aux.a;
        vec2 across = vec2(-uPlayDir.y, uPlayDir.x);
        // Raked sand: fine tine marks and broader furrows, both along the line of play, with a
        // slow wander. Each fades before it would alias.
        float ph = dot(pw, across) / 0.085 + (nA - 0.5) * 22.0 + (nB - 0.5) * 5.0;
        float rk = cos(ph * 6.2832) * (1.0 - smoothstep(0.22, 0.6, fwidth(ph)));
        float ph2 = dot(pw, across) / 0.34 + (nA - 0.5) * 6.0;
        float rk2 = cos(ph2 * 6.2832) * (1.0 - smoothstep(0.25, 0.65, fwidth(ph2)));
        // Raking stops short of the face: the wall is smooth and slumped.
        float rakeK = smoothstep(0.3, 0.5, inB);
        // Rake strokes come in patches: some sand is freshly raked, some trodden smooth.
        float stroke = smoothstep(0.25, 0.65, nB) * 0.8 + 0.2;
        tn = tn * 0.5 + across * (rk * 0.24 + rk2 * 0.12 * stroke) * rakeK;
        // Grain: one facet per 2 cm, faded as soon as it is smaller than a pixel.
        vec2 gc = floor(pw * 48.0);
        float gfade = 1.0 - smoothstep(0.3, 0.8, max(fwidth(pw.x), fwidth(pw.y)) * 48.0);
        tn += (vec2(tHash(gc), tHash(gc + 5.3)) - 0.5) * 0.5 * gfade;
        // Sand is never paper white: a warmer, slightly darker tone with patchy dampness.
        c *= 0.84 * (1.0 + rk * 0.03 + rk2 * 0.02 * rakeK * stroke);
        c *= 1.0 - 0.07 * smoothstep(0.55, 0.85, nA);
        // Damp, darker band at the foot of the face, where water collects.
        float wet = smoothstep(0.34, 0.47, inB) * (1.0 - smoothstep(0.52, 0.72, inB));
        c *= 1.0 - wet * 0.3;
        // Damp sand is darker and matte. A glossier band reflected the blue sky and read as
        // puddles once the albedo was darkened.
        r = mix(r, 0.9, wet);
        sandMatte = 1.0 - wet * 0.85;
        // The cut edge: a thin strip of shadowed soil right under the turf.
        // Only where the face is steep does the edge show bare soil; the shallow entry side
        // runs straight from turf to sand.
        float steep = smoothstep(0.12, 0.38, 1.0 - baseN.y);
        float cut = smoothstep(0.5, 0.51, bunkerM) * (1.0 - smoothstep(0.52, 0.56, bunkerM)) * steep;
        c = mix(c, c * vec3(0.42, 0.36, 0.3), cut);
      } else if (i == 4) {
        // Wet shore: dark and damp. (It was 85 percent specular at roughness 0.42, a mirror
        // for the bright sky that read as a white rim around every pond.)
        c *= 0.55;
        r = 0.6;
      } else if (i == 2) {
        c *= 0.86 + 0.14 * nB;
      }
      // A field of grass scatters light in every direction: almost no mirror-like sheen, even
      // at grazing angles. Sand, paths, and rock keep a little, wet ground keeps most.
      // (Measured: at grazing angles toward a low sun, 10 percent of the highlight still
      // equalled the whole diffuse term and read as a white sheen, so grass keeps 3 percent.)
      float sp = (i == 4) ? 0.2 : (i == 12 || i == 8 || i == 5 || i == 3) ? 0.22 : (i == 2 ? 0.1 : 0.03);
      if (i == 12) sp *= sandMatte;
      tAlbedo += c * w;
      nAcc.xy += tn * w;
      rAcc += r * w;
      sAcc += sp * w;
    }
    // Specular anti-aliasing: grass blades are glossy up close but a field of them is matte,
    // and sub-pixel normal detail would otherwise sparkle.
    tSpec = sAcc;
    tRough = clamp(rAcc, 0.05, 1.0);
    tRough = mix(tRough, 1.0, 0.35 + 0.45 * smoothstep(12.0, 110.0, vdist));
    // Grass lip around a bunker catches the light.
    // The grassy lip: a collar of longer, darker grass around the sand.
    float lipOut = smoothstep(0.34, 0.47, bunkerM) * (1.0 - smoothstep(0.49, 0.505, bunkerM));
    tAlbedo *= 1.0 - lipOut * 0.12;
    float grassW = wgt[0] + wgt[1] + wgt[6] + wgt[7] + wgt[9] + wgt[10] + wgt[11];
#ifdef OUTER_LAND
    // Far woodland reads as canopy, and high ground carries snow.
    float can = canopy * smoothstep(120.0, 420.0, vdist) * (1.0 - a[5]);
    tAlbedo = mix(tAlbedo, uCanopy * (0.7 + 0.6 * nB), can * 0.9);
    tRough = mix(tRough, 0.92, can);
    if (uSnowLine < 90000.0) {
      float sn = smoothstep(uSnowLine - 60.0, uSnowLine + 120.0, vWPos.y + (nA - 0.5) * 160.0) * smoothstep(0.42, 0.18, slopeO); // snow slides off steep faces, where rock shows through
      // Old snow on distant peaks, not fresh paper white: low sun on it clipped the frame.
      tAlbedo = mix(tAlbedo, vec3(0.5, 0.53, 0.58), sn);
      tRough = mix(tRough, 0.55, sn);
    }
#else
    // Ground under dense trees sits in shade beyond the reach of the shadow maps, and the
    // foot of a bunker face sees less sky.
    tOcc = 1.0 - canopy * 0.38;
    // The foot of a bunker face sees less sky. Only sky light is reduced: sunlight is the
    // shadow map's job, and dimming it too left the blue sky light dominant (bluish sand).
    // Wet bank and the bed under shallow water: darker, browner, and a little glossy above
    // the water line, so the edge of a pond reads as a soft wet margin rather than a pale rim.
    float wetBed = bunkerM < 0.4 ? aux.a : 0.0;
    tAlbedo = mix(tAlbedo, tAlbedo * vec3(0.42, 0.4, 0.33), wetBed);
    tRough = mix(tRough, 0.55, wetBed * (1.0 - smoothstep(0.6, 0.9, wetBed)));
    float cavity = smoothstep(0.08, 0.42, aux.a) * (1.0 - smoothstep(0.5, 0.95, aux.a));
    // Sand in shade is lit by the sky and by warm light bounced off the sand around it, so
    // its shadows read grey rather than sky blue.
    tCav = mix(vec3(1.0), vec3(1.12, 1.0, 0.8), wgt[12]) * (1.0 - cavity * 0.35 * wgt[12]);
#endif
    tNormalW = normalize(baseN + vec3(nAcc.x, 0.0, nAcc.y) * 0.85);
#ifdef USE_DEW
    if (uDew > 0.001 && vdist < 46.0 && grassW > 0.2) {
      // Dew: sparse droplets, each with its own facet, glinting toward the sun.
      vec2 cell = floor(pw * 70.0);
      float h1 = tHash(cell);
      // One droplet per cell, a point rather than a tile.
      float pt = smoothstep(0.4, 0.05, length(fract(pw * 70.0) - 0.5));
      // Droplets only read as points while a droplet is bigger than a pixel. Past that the
      // glints would average into a false sheen under the sun, so they fade out.
      pt *= 1.0 - smoothstep(0.35, 0.9, max(fwidth(pw.x), fwidth(pw.y)) * 70.0);
      if (h1 > 0.985 && pt > 0.0) {
        vec3 fn = normalize(tNormalW + (vec3(tHash(cell + 3.1), 0.0, tHash(cell + 9.7)) - vec3(0.5, 0.0, 0.5)) * 1.3);
        vec3 V = normalize(cameraPosition - vWPos);
        float sp = pow(max(dot(fn, normalize(V + uSunDirW)), 0.0), 90.0);
        tEmis = uSunCol * sp * pt * uDew * 5.0 * grassW * (1.0 - smoothstep(26.0, 46.0, vdist));
      }
    }
#endif
  }
  diffuseColor.rgb = tAlbedo;
`;

function patchTerrainShader(shader, uniforms, outer) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${outer ? 'attribute vec4 oWeights;\nvarying vec3 vONormal;\nvarying vec4 vOWeights;' : ''}`)
    .replace('#include <beginnormal_vertex>', outer ? '#include <beginnormal_vertex>' : 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${outer ? '  vONormal = normal;\n  vOWeights = oWeights;' : ''}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
    .replace('#include <map_fragment>', FRAG_MAIN)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
    .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
    .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= tOcc * tCav;\n  reflectedLight.directDiffuse *= mix(1.0, tOcc, 0.55);\n  reflectedLight.directSpecular *= tSpec;\n  reflectedLight.indirectSpecular *= tSpec;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += tEmis;');
}

// Flat surface-id output, used only by the QA check that the renderer and the physics agree.
// It applies the same rule as terrain.groundSurfaceAt: the top-most mask at or above 0.5.
const ID_ORDER = [
  ['m3', 'a', SURFACES.BUNKER], ['m3', 'b', SURFACES.GREEN], ['m3', 'g', SURFACES.TEE], ['m3', 'r', SURFACES.FRINGE],
  ['m2', 'a', SURFACES.PATH], ['m2', 'b', SURFACES.FAIRWAY], ['m2', 'g', SURFACES.FIRST_CUT], ['m2', 'r', SURFACES.ROCK],
  ['m1', 'a', SURFACES.WETLAND], ['m1', 'b', SURFACES.DIRT], ['m1', 'g', SURFACES.WASTE], ['m1', 'r', SURFACES.DEEP_ROUGH],
];
export function createSurfaceIdMaterial(tex, grid) {
  let chain = `float id = ${SURFACES.ROUGH}.0;\n`;
  for (let i = ID_ORDER.length - 1; i >= 0; i--) chain += `  if (${ID_ORDER[i][0]}.${ID_ORDER[i][1]} >= 0.5) id = ${ID_ORDER[i][2]}.0;\n`;
  return new THREE.ShaderMaterial({
    uniforms: { tM1: { value: tex.m1 }, tM2: { value: tex.m2 }, tM3: { value: tex.m3 }, uGrid: { value: grid } },
    vertexShader: 'varying vec3 vWPos; void main(){ vWPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWPos, 1.0); }',
    fragmentShader: `uniform sampler2D tM1; uniform sampler2D tM2; uniform sampler2D tM3; uniform vec4 uGrid; varying vec3 vWPos;
      void main(){ vec2 guv = (vWPos.xz - uGrid.xy + 0.5) * uGrid.zw; vec4 m1 = textureLod(tM1, guv, 0.0); vec4 m2 = textureLod(tM2, guv, 0.0); vec4 m3 = textureLod(tM3, guv, 0.0);
      ${chain} gl_FragColor = vec4(id / 255.0, 0.0, 0.0, 1.0); }`,
  });
}

// ---------------------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------------------
// The other holes' corridors in this hole's frame (render/scenery.js, from the course routing):
// a flat list of segments, five numbers each (ax, az, bx, bz, corridor half-width). Returns the
// distance from (x, z) to the nearest corridor's edge (negative inside one), or Infinity.
export function footprintDistance(segs) {
  if (!segs || !segs.length) return null;
  const n = segs.length / 5;
  return (x, z) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 5, ax = segs[o], az = segs[o + 1], vx = segs[o + 2] - ax, vz = segs[o + 3] - az;
      const l2 = vx * vx + vz * vz || 1e-9;
      let u = ((x - ax) * vx + (z - az) * vz) / l2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const d = Math.hypot(x - ax - vx * u, z - az - vz * u) - segs[o + 4];
      if (d < best) best = d;
    }
    return best;
  };
}

export function createTerrainView({ terrain, course, lighting, tier, assets, manifest, engine, footprint = null }) {
  const footAt = footprintDistance(footprint);
  const group = new THREE.Group();
  group.name = 'terrain';
  const { nx, nz, x0, z0, height } = terrain;
  const tex = buildTerrainTextures(terrain);
  const { surfaces, sets } = layersFor(course.look || course.id, manifest);

  // 1x1 placeholder arrays so the samplers are always bound to something valid.
  const mkArray = (size, layers, srgb) => {
    const t = new THREE.DataArrayTexture(new Uint8Array(size * size * 4 * layers).fill(128), size, size, layers);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(tier.anisotropy, engine.renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  };
  let albArr = mkArray(1, sets.length, true), nrArr = mkArray(1, sets.length, false);

  const hole = terrain.hole;
  const playDir = new THREE.Vector2(hole.green.x - hole.tees[0].x, hole.green.z - hole.tees[0].z).normalize();
  const uniforms = {
    tM1: { value: tex.m1 }, tM2: { value: tex.m2 }, tM3: { value: tex.m3 }, tMow: { value: tex.mow }, tAux: { value: tex.aux },
    tAlb: { value: albArr }, tNR: { value: nrArr }, tDetail: { value: null },
    uGrid: { value: new THREE.Vector4(x0, z0, 1 / nx, 1 / nz) },
    uLayer: { value: surfaces.map((s) => s.layer) },
    uScale: { value: surfaces.map((s) => s.scale) },
    uTint: { value: surfaces.map((s) => new THREE.Vector3(...s.tint)) },
    uAvg: { value: surfaces.map((s) => new THREE.Vector3(...s.avg)) },
    uRoughAvg: { value: surfaces.map((s) => s.rough) },
    uTexMix: { value: 0 }, uHasDetail: { value: 0 },
    uMow: { value: ['stripes', 'checker', 'diagonal'].indexOf(hole.mowing) },
    uGreenMow: { value: hole.greenMowing === 'checker' ? 1 : 0 },
    uGreen: { value: new THREE.Vector4(hole.green.x, hole.green.z, hole.green.ax, hole.green.az) },
    uTee: { value: new THREE.Vector4(hole.tees[0].x, hole.tees[0].z, hole.tees[0].tx, hole.tees[0].tz) },
    uPlayDir: { value: playDir },
    uSunDirW: { value: lighting.sunDir }, uSunCol: { value: lighting.sunRadiance },
    uDew: { value: 0 }, uSnowLine: { value: 1e6 }, uCanopy: { value: new THREE.Color(0.03, 0.07, 0.02) },
    uCup: { value: new THREE.Vector3(terrain.pin.x, terrain.pin.z, 0.054) },
  };

  const defines = {};
  if (tier.id !== 'low') defines.TWO_SCALE = 1;
  if (tier.id !== 'low') defines.USE_DEW = 1;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
  material.defines = { ...(material.defines || {}), ...defines };
  lighting.setup(material, [(shader) => patchTerrainShader(shader, uniforms, false)], 'terrain:' + Object.keys(defines).join(','));
  const outerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.4 });
  outerMaterial.defines = { ...(outerMaterial.defines || {}), ...defines, OUTER_LAND: 1 };
  lighting.setup(outerMaterial, [(shader) => patchTerrainShader(shader, uniforms, true)], 'terrainOuter:' + Object.keys(defines).join(','));

  // --- chunked LOD mesh ---
  const chunks = [];
  const ncx = Math.ceil((nx - 1) / CHUNK), ncz = Math.ceil((nz - 1) / CHUNK);
  function buildChunkGeometry(c, step) {
    const xs = [], zs = [];
    for (let i = c.ix0; i < c.ix1; i += step) xs.push(i);
    xs.push(c.ix1);
    for (let i = c.iz0; i < c.iz1; i += step) zs.push(i);
    zs.push(c.iz1);
    const w = xs.length, h = zs.length;
    const skirt = step * 0.55 + 0.5;
    const border = 2 * (w + h);
    const pos = new Float32Array((w * h + border) * 3);
    let p = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      pos[p++] = x0 + xs[i] * CELL; pos[p++] = height[zs[j] * nx + xs[i]]; pos[p++] = z0 + zs[j] * CELL;
    }
    const idx = [];
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, d = a + w, e = d + 1;
      idx.push(a, d, b, b, d, e); // same diagonal as terrain.heightAt
    }
    // Skirts: a lowered copy of each border vertex hides the cracks between LOD levels.
    const addSkirt = (ids, flip) => {
      const start = p / 3;
      for (const v of ids) { pos[p++] = pos[v * 3]; pos[p++] = pos[v * 3 + 1] - skirt; pos[p++] = pos[v * 3 + 2]; }
      for (let i = 0; i < ids.length - 1; i++) {
        const a = ids[i], b = ids[i + 1], c2 = start + i, d = start + i + 1;
        if (flip) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
      }
    };
    const top = [], bottom = [], left = [], right = [];
    for (let i = 0; i < w; i++) { top.push(i); bottom.push((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { left.push(j * w); right.push(j * w + w - 1); }
    addSkirt(top, false); addSkirt(bottom, true); addSkirt(left, true); addSkirt(right, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
    g.boundingBox = c.box.clone();
    g.boundingSphere = c.sphere.clone();
    return g;
  }
  for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
    const c = { ix0: cx * CHUNK, iz0: cz * CHUNK, ix1: Math.min((cx + 1) * CHUNK, nx - 1), iz1: Math.min((cz + 1) * CHUNK, nz - 1), geos: new Map(), step: -1 };
    let lo = 1e9, hi = -1e9;
    for (let iz = c.iz0; iz <= c.iz1; iz += 2) for (let ix = c.ix0; ix <= c.ix1; ix += 2) { const v = height[iz * nx + ix]; if (v < lo) lo = v; if (v > hi) hi = v; }
    c.box = new THREE.Box3(new THREE.Vector3(x0 + c.ix0, lo - 10, z0 + c.iz0), new THREE.Vector3(x0 + c.ix1, hi + 1, z0 + c.iz1));
    c.sphere = c.box.getBoundingSphere(new THREE.Sphere());
    c.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    c.mesh.receiveShadow = true;
    c.mesh.castShadow = false;
    c.mesh.matrixAutoUpdate = false;
    c.mesh.userData.terrain = true;
    group.add(c.mesh);
    chunks.push(c);
  }
  const minStepIndex = STEPS.indexOf(tier.terrainStepNear);
  const _cp = new THREE.Vector3();
  let lastCam = new THREE.Vector3(1e9, 0, 0);
  function updateLod(camera, force) {
    _cp.setFromMatrixPosition(camera.matrixWorld);
    if (!force && _cp.distanceToSquared(lastCam) < 4) return;
    lastCam.copy(_cp);
    let tris = 0;
    for (const c of chunks) {
      const d = c.box.distanceToPoint(_cp) / tier.terrainLodScale;
      let si = 0;
      // Hysteresis: a chunk needs to move 12 percent past a threshold before it switches back.
      for (let i = 0; i < LOD_DIST.length; i++) if (d > LOD_DIST[i] * (c.stepIndex > i ? 0.88 : 1)) si = i + 1;
      si = Math.max(si, minStepIndex);
      if (si !== c.stepIndex) {
        c.stepIndex = si;
        const step = STEPS[si];
        if (!c.geos.has(step)) c.geos.set(step, buildChunkGeometry(c, step));
        c.mesh.geometry = c.geos.get(step);
      }
      tris += c.mesh.geometry.index.count / 3;
    }
    view.triangles = tris;
  }

  // --- outer landscape: the same macro function, sampled on a grid that coarsens outward ---
  function buildOuter() {
    const th = course.theme;
    // Cells grow outward but are capped, so distant mountains are not single long triangles
    // (300 to 500 m cells there drew each face as one streak). The cap depends on the tier.
    const maxCell = tier.id === 'low' ? 220 : tier.id === 'medium' ? 160 : 110;
    const growth = [];
    for (let g = 10, sum = 0; sum < 6600; g = Math.min(maxCell, g * 1.32)) { growth.push(Math.round(g)); sum += g; }
    const axis = (lo, hi) => {
      const pts = [];
      let acc = 0;
      const out = [];
      for (const g of growth) { acc += g; out.push(acc); }
      for (let i = out.length - 1; i >= 0; i--) pts.push(lo - out[i]);
      const inner = Math.max(2, Math.round((hi - lo) / 30));
      for (let i = 0; i <= inner; i++) pts.push(lo + ((hi - lo) * i) / inner);
      for (const o of out) pts.push(hi + o);
      return pts;
    };
    // The inner rectangle sits just inside the detailed grid and slightly below it.
    const inset = 4;
    const ix0 = x0 + inset, ix1 = terrain.maxX - inset, iz0 = z0 + inset, iz1 = terrain.maxZ - inset;
    const xs = axis(ix0, ix1), zs = axis(iz0, iz1);
    const w = xs.length, h = zs.length;
    const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), wts = new Float32Array(w * h * 4);
    const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
    const sea = hole.sea;
    const far = course.backdrop || {};
    const seed = hole.seed & 0xffff;
    // With the other holes drawn around this one (footprint), the ground under them is course
    // ground: the mesas and ridges of the macro and the distant relief fade out near their
    // corridors, so they lie on rolling land and the hills rise beyond the course. Near the
    // detailed grid (seam) nothing changes, so the two meshes still meet exactly.
    const seamAt = (x, z) => smoothstep(10, 110, Math.hypot(Math.max(ix0 - x, 0, x - ix1), Math.max(iz0 - z, 0, z - iz1)));
    const hAt = (x, z, dl = footAt ? footAt(x, z) : Infinity, seam = footAt ? seamAt(x, z) : 0) => {
      const flat = footAt ? (1 - smoothstep(30, 220, dl)) * seam : 0;
      let hh = terrain.macro(x, z, 1, 1 - flat * 0.95);
      // Distant relief grows with range: hills, mesas, or mountains depending on the course.
      const d = Math.hypot(x - cx, z - cz);
      const rise = smoothstep(380, 2400, d) * (footAt ? 1 - (1 - smoothstep(60, 700, dl)) * seam : 1);
      if (rise > 0 && far.amp) {
        const px = x / far.wave + seed, pz = z / far.wave - seed * 0.7;
        let r = 0, amp = 1, f = 1, norm = 0;
        for (let o = 0; o < 4; o++) {
          const nv = Math.sin(px * f * 1.7 + Math.cos(pz * f * 1.3) * 1.9) * Math.cos(pz * f * 1.9 - Math.sin(px * f * 1.1) * 1.4);
          r += (far.ridged ? 1 - Math.abs(nv) : nv * 0.5 + 0.5) * amp; norm += amp; amp *= 0.5; f *= 2.1;
        }
        r /= norm;
        hh += Math.pow(r, far.power || 1.5) * far.amp * rise;
      }
      if (sea) {
        // Same coastline function as the detailed grid, so the shore meets across the seam.
        const d2 = terrain.seaDistAt(x, z);
        const beach = d2 > 0 ? Math.max(sea.level + 1.1 - d2 * 0.075, sea.level - 30) : sea.level + 1.1 + (-d2) * 0.03;
        hh = hh + (beach - hh) * smoothstep(-34, 4, d2);
      }
      return hh;
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = xs[i], z = zs[j], k = j * w + i;
      const inside = x >= ix0 - 0.01 && x <= ix1 + 0.01 && z >= iz0 - 0.01 && z <= iz1 + 0.01;
      // The footprint distance is found once per vertex and reused for the normal's samples
      // (it changes over tens of meters, the samples are a few meters apart).
      const dl = footAt ? footAt(x, z) : Infinity, seam = footAt ? seamAt(x, z) : 0;
      const hh = hAt(x, z, dl, seam);
      pos[k * 3] = x; pos[k * 3 + 1] = hh - (inside ? 0.7 : 0); pos[k * 3 + 2] = z;
      // Normal over half a cell, so it describes the shape the cell can actually show.
      const cell = Math.min(xs[Math.min(w - 1, i + 1)] - xs[Math.max(0, i - 1)], zs[Math.min(h - 1, j + 1)] - zs[Math.max(0, j - 1)]) / 2;
      const e = Math.max(6, cell * 0.5);
      const gx = (hAt(x + e, z, dl, seam) - hAt(x - e, z, dl, seam)) / (2 * e), gz = (hAt(x, z + e, dl, seam) - hAt(x, z - e, dl, seam)) / (2 * e);
      const inv = 1 / Math.hypot(gx, gz, 1);
      nor[k * 3] = -gx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -gz * inv;
      const desert = th.base === 'waste';
      const nearSea = sea ? 1 - smoothstep(0.9, 3.0, hh - sea.level) : 0;
      wts[k * 4] = desert ? 0 : 1; // deep rough ground
      wts[k * 4 + 1] = desert ? 1 : Math.max(th.trees.forest > 0 ? 1 : 0, nearSea); // waste: desert floor, forest floor, beach
      // Canopy, cleared over the other holes' corridors (they are open ground).
      wts[k * 4 + 2] = clamp(th.trees.forest, 0, 1) * (1 - nearSea) * (footAt ? 1 - (1 - smoothstep(-10, 45, dl)) * seam : 1);
      wts[k * 4 + 3] = sea ? 1 - smoothstep(0.1, 0.6, hh - sea.level) : 0; // wet shore
    }
    const idx = [];
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      // Skip every cell inside the detailed grid. The two meshes then overlap only in the 4 m
      // inset band, where the terrain function and the outer function are identical. (An
      // earlier version kept a 30 m ring, and full-height mesas poked through the play area.)
      const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1];
      if (xa >= ix0 - 0.01 && xb <= ix1 + 0.01 && za >= iz0 - 0.01 && zb <= iz1 + 0.01) continue;
      const a = j * w + i, b = a + 1, d = a + w, e2 = d + 1;
      idx.push(a, d, b, b, d, e2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('oWeights', new THREE.BufferAttribute(wts, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, outerMaterial);
    mesh.receiveShadow = false; mesh.castShadow = false; mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    mesh.userData.terrain = true;
    view.outerHeightAt = hAt;
    // The outer mesh's own surface (its triangles, not the function it samples), for flat
    // things laid on it from far away: they then sit exactly on what is drawn.
    const cellOf = (arr, v) => {
      let lo = 0, hi = arr.length - 2;
      if (v <= arr[0]) return 0;
      if (v >= arr[hi]) return hi;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
      return lo;
    };
    view.outerSurfaceAt = (x, z) => {
      const i = cellOf(xs, x), j = cellOf(zs, z);
      const fx = clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1), fz = clamp((z - zs[j]) / (zs[j + 1] - zs[j]), 0, 1);
      const a = (j * w + i) * 3 + 1, b = a + 3, d = a + w * 3, e2 = d + 3;
      return fx + fz <= 1 ? pos[a] + fx * (pos[b] - pos[a]) + fz * (pos[d] - pos[a]) : pos[e2] + (1 - fx) * (pos[d] - pos[e2]) + (1 - fz) * (pos[b] - pos[e2]);
    };
    return mesh;
  }

  const view = { group, material, outerMaterial, uniforms, tex, chunks, triangles: 0, surfaces, sets, updateLod, ready: false, footprintAt: footAt };
  const tOuter = performance.now();
  const outer = buildOuter();
  view.outerMs = performance.now() - tOuter;
  group.add(outer);
  view.outer = outer;
  if (course.backdrop && course.backdrop.snowLine) uniforms.uSnowLine.value = course.theme.baseElevation + course.backdrop.snowLine;
  if (course.backdrop && course.backdrop.canopy) uniforms.uCanopy.value.setRGB(...course.backdrop.canopy);

  // --- lazy texture arrays: built layer by layer after first paint ---
  view.loadTextures = async () => {
    if (!assets || !assets.enabled) return false;
    const want = Math.min(tier.texSize, 1024);
    const loaded = await Promise.all(sets.map((id) => assets.textureSetBitmaps(id, want)));
    if (loaded.some((l) => !l)) return false;
    const size = Math.max(...loaded.map((l) => l.size));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const alb = new Uint8Array(size * size * 4 * sets.length), nr = new Uint8Array(size * size * 4 * sets.length);
    for (let i = 0; i < sets.length; i++) {
      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(loaded[i].albedo, 0, 0, size, size);
      alb.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
      ctx.drawImage(loaded[i].nr, 0, 0, size, size);
      nr.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
    }
    const mk = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, size, size, sets.length);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(tier.anisotropy, engine.renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      return t;
    };
    const oldA = albArr, oldN = nrArr;
    albArr = mk(alb, true); nrArr = mk(nr, false);
    uniforms.tAlb.value = albArr; uniforms.tNR.value = nrArr;
    oldA.dispose(); oldN.dispose();
    view.arrayBytes = size * size * 4 * sets.length * 2 * 1.33;
    const detail = await assets.texture('procedural', 'detail_noise', { repeat: true, anisotropy: 2 });
    if (detail) { uniforms.tDetail.value = detail; uniforms.uHasDetail.value = 1; }
    view.ready = true;
    view.fadeIn = 0;
    return true;
  };
  // Cross-fade from flat placeholder colors to the real textures once they arrive.
  view.update = (dt) => {
    if (view.ready && uniforms.uTexMix.value < 1) uniforms.uTexMix.value = Math.min(1, uniforms.uTexMix.value + dt * 1.6);
  };
  view.setTextureMix = (v) => { uniforms.uTexMix.value = v; };
  view.memoryBytes = () => tex.bytes + (view.arrayBytes || 0);
  view.dispose = () => {
    tex.dispose(); albArr.dispose(); nrArr.dispose();
    for (const c of chunks) for (const g of c.geos.values()) g.dispose();
    outer.geometry.dispose(); material.dispose(); outerMaterial.dispose();
  };
  return view;
}
