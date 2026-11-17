// Sky: analytic atmospheric scattering (Preetham model: Rayleigh and Mie), a sun disc with
// limb darkening, a moon and stars at night, and a procedural cloud layer that drifts with the
// game wind and is lit from the sun's side. Writes linear HDR radiance.
// Also owns the image-based lighting: a prefiltered environment from a 1k HDRI rotated so its
// sun matches the game sun, with a fallback prefiltered from this same procedural sky.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { fin } from '../core/guards.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTurbidity;
uniform float uRayleigh;
uniform float uMie;
uniform float uMieG;
uniform float uGain;
uniform float uNight;
uniform vec3 uTint;
uniform vec3 uHorizon;
uniform float uHaze;
uniform float uSunDisc;
uniform float uStars;
uniform sampler2D tCloud;
uniform float uHasCloud;
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform vec3 uCloudColor;
uniform vec3 uCloudShade;
uniform float uTime;
uniform vec3 uCamPos;

const float PI = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularCos = 0.99996;

float sunIntensity(float zc) {
  zc = clamp(zc, -1.0, 1.0);
  return EE * max(0.0, 1.0 - exp(-((cutoffAngle - acos(zc)) / steepness)));
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Cloud density at a point on the cloud plane (meters).
float cloudDensity(vec2 p) {
  float d;
  if (uHasCloud > 0.5) {
    vec4 a = texture2D(tCloud, p / 11000.0);
    vec4 b = texture2D(tCloud, p / 2900.0 + 0.37);
    d = a.r * 0.62 + a.a * 0.2 + b.g * 0.18;
  } else {
    d = vnoise(p / 2600.0) * 0.55 + vnoise(p / 900.0) * 0.3 + vnoise(p / 330.0) * 0.15;
  }
  float lo = 1.0 - uCloudCover;
  return smoothstep(lo - 0.06, lo + 0.26, d);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 up = vec3(0.0, 1.0, 0.0);
  float sunE = sunIntensity(uSunDir.y);
  vec3 betaR = totalRayleigh * uRayleigh;
  vec3 betaM = 0.434 * (0.2 * uTurbidity) * 10E-18 * MieConst * uMie;

  // Below the horizon the dome continues the haze, so no hard line shows past the land.
  float elev = dir.y;
  vec3 d2 = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z));
  float zenithAngle = acos(max(0.0, d2.y));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / PI), -1.253));
  float sR = rayleighZenithLength * inv;
  float sM = mieZenithLength * inv;
  vec3 Fex = exp(-(betaR * sR + betaM * sM));
  float cosTheta = dot(d2, uSunDir);
  float rPhase = (3.0 / (16.0 * PI)) * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
  float g2 = uMieG * uMieG;
  float mPhase = (1.0 / (4.0 * PI)) * ((1.0 - g2) / pow(1.0 - 2.0 * uMieG * cosTheta + g2, 1.5));
  vec3 betaRT = betaR * rPhase, betaMT = betaM * mPhase;
  vec3 Lin = pow(sunE * ((betaRT + betaMT) / (betaR + betaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ((betaRT + betaMT) / (betaR + betaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, uSunDir), 5.0), 0.0, 1.0));
  vec3 sky = (Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  sky = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.15)) * uTint * uGain;
  // By moonlight the same scattering applies at a tiny fraction of the energy.
  sky = mix(sky, sky * vec3(0.009, 0.013, 0.024), uNight);

  // Haze band: the sky meets the fogged land at the horizon in the same color.
  float hz = pow(1.0 - clamp(elev, 0.0, 1.0), 9.0) * uHaze;
  vec3 hazeCol = uHorizon * (1.0 + pow(max(cosTheta, 0.0), 6.0) * 0.5);
  sky = mix(sky, hazeCol, clamp(hz, 0.0, 1.0));
  if (elev < 0.0) sky = mix(sky, uHorizon * 0.82, smoothstep(0.0, -0.12, elev));

  // Stars, faded by haze near the horizon.
  if (uStars > 0.001 && elev > 0.0) {
    vec3 sd = dir * 190.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    float pt = smoothstep(0.42, 0.0, length(fract(sd) - 0.5));
    float tw = 0.75 + 0.25 * sin(uTime * 2.3 + h * 90.0);
    sky += vec3(0.9, 0.95, 1.0) * step(0.9972, h) * pt * tw * uStars * 0.9 * smoothstep(0.02, 0.3, elev) * (0.4 + 0.6 * fract(h * 37.0));
  }

  // Clouds on a plane above the camera.
  float cover = 0.0;
  if (uCloudCover > 0.01 && elev > 0.012) {
    float t = 1700.0 / elev;
    vec2 p = uCamPos.xz + dir.xz * t + uCloudOffset;
    float d = cloudDensity(p);
    if (d > 0.002) {
      float lit = 1.0;
#ifdef CLOUD_LIGHT
      // Density toward the sun: thick cloud on the sun side puts this point in shade.
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * (0.35 + 0.65 * (1.0 - uSunDir.y));
      float ds = cloudDensity(p + toSun * 260.0);
#if CLOUD_LIGHT > 1
      ds = ds * 0.6 + cloudDensity(p + toSun * 620.0) * 0.4;
#endif
      lit = exp(-ds * 1.5) * 0.9 + 0.1;
      lit = mix(lit, 1.0, (1.0 - d) * 0.5);
#else
      lit = 1.0 - d * 0.45;
#endif
      // Thin edges glow when looking toward the sun (forward scattering).
      float silver = pow(max(cosTheta, 0.0), 10.0) * (1.0 - d) * 1.6;
      vec3 cl = mix(uCloudShade, uCloudColor, lit) + uSunColor * silver * (1.0 - uNight) * 0.6;
      float fade = smoothstep(0.012, 0.2, elev);
      cover = d * fade * 0.96;
      sky = mix(sky, cl, cover);
    }
  }

  // Sun or moon disc, dimmed by cloud.
  float disc = smoothstep(sunAngularCos, sunAngularCos + 0.000022, dot(dir, uSunDir));
  float limb = 0.55 + 0.45 * smoothstep(sunAngularCos, 1.0, dot(dir, uSunDir));
  // Near the horizon the disc is seen through far more air, so it dims and stops glaring.
  sky += uSunColor * disc * limb * uSunDisc * (1.0 - cover) * mix(0.06, 1.0, smoothstep(0.03, 0.4, uSunDir.y));

  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
}`;

export function createSky(world, engine) {
  const { scene, assets } = world;
  const tier = engine.tier;
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uTurbidity: { value: 2 }, uRayleigh: { value: 1 }, uMie: { value: 0.005 }, uMieG: { value: 0.8 },
    uGain: { value: 1 }, uNight: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) }, uHaze: { value: 1 }, uSunDisc: { value: 40 }, uStars: { value: 0 },
    tCloud: { value: null }, uHasCloud: { value: 0 }, uCloudOffset: { value: new THREE.Vector2() },
    uCloudCover: { value: 0.4 }, uCloudColor: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.5, 0.55, 0.62) },
    uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() },
  };
  const defines = {};
  if (tier.cloudSteps > 0) defines.CLOUD_LIGHT = tier.cloudSteps;
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, defines, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  scene.add(mesh);

  // --- environment (IBL) ---
  const pmrem = new THREE.PMREMGenerator(engine.renderer);
  const envScene = new THREE.Scene();
  const envMesh = new THREE.Mesh(mesh.geometry, material);
  envMesh.scale.setScalar(50);
  envScene.add(envMesh);
  let envRT = null, envKey = '', hdriFor = '', pendingHdri = null;
  const sky = { mesh, material, uniforms, envSource: 'none', envIntensity: 1, tod: null };

  function applyEnv(rt, source) {
    const old = envRT;
    envRT = rt;
    scene.environment = rt.texture;
    sky.envSource = source;
    if (old && old !== rt) old.dispose();
  }

  // Fallback and first-paint environment: the procedural sky itself, prefiltered.
  function bakeProcedural() {
    const sun = uniforms.uSunDisc.value;
    uniforms.uSunDisc.value = Math.min(sun, 6); // keep the disc from producing fireflies in the blur
    const cam = uniforms.uCamPos.value.clone();
    uniforms.uCamPos.value.set(0, 0, 0);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
    uniforms.uSunDisc.value = sun;
    uniforms.uCamPos.value.copy(cam);
    scene.environmentRotation.set(0, 0, 0);
    applyEnv(rt, 'procedural');
  }

  function alignHdri(info) {
    // Rotating the environment by theta about +Y moves a compass bearing az to az - theta.
    const s = uniforms.uSunDir.value;
    const gameAz = Math.atan2(s.x, -s.z);
    const hdriAz = (info.sunAzDeg * Math.PI) / 180;
    scene.environmentRotation.set(0, hdriAz - gameAz, 0);
  }

  async function loadHdri(tod) {
    if (!assets || !assets.has('hdris', tod.hdri)) return false;
    const want = tod.hdri;
    pendingHdri = want;
    const h = await assets.hdri(want);
    if (!h || pendingHdri !== want) return false;
    const rt = pmrem.fromEquirectangular(h.texture);
    applyEnv(rt, 'hdri:' + want);
    hdriFor = want;
    sky.hdriInfo = h.info;
    alignHdri(h.info);
    updateIntensity();
    return true;
  }

  function updateIntensity() {
    const tod = sky.tod;
    if (!tod) return;
    // Sky light is set relative to the sun: about a fifth of the sun's irradiance at midday,
    // a larger share when the sun is low. HDRIs are normalized by their own mean luminance.
    const targetMean = 0.25 * tod.envIntensity * (tod.night ? 0.05 : 1);
    if (sky.envSource.startsWith('hdri') && sky.hdriInfo) scene.environmentIntensity = targetMean / Math.max(sky.hdriInfo.meanLuminance, 1e-4);
    else scene.environmentIntensity = tod.night ? 0.9 : 0.72 * tod.envIntensity;
    sky.envIntensity = scene.environmentIntensity;
  }

  sky.setTimeOfDay = (tod, w) => {
    sky.tod = tod;
    uniforms.uSunDir.value.copy(w.sunDir);
    uniforms.uSunColor.value.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    uniforms.uTurbidity.value = tod.turbidity; uniforms.uRayleigh.value = tod.rayleigh; uniforms.uMie.value = tod.mie;
    uniforms.uNight.value = tod.night ? 1 : 0;
    uniforms.uTint.value.setRGB(tod.skyTint[0], tod.skyTint[1], tod.skyTint[2]);
    // Sky radiance sits in the same units as the sunlit land: a clear zenith is about as
    // bright as sunlit grass, the horizon two to three times brighter.
    uniforms.uGain.value = tod.skyGain ?? 0.4;
    const f = tod.fog.color;
    uniforms.uHorizon.value.setRGB(f[0], f[1], f[2]).multiplyScalar(tod.night ? 0.02 : tod.horizonGain ?? 0.5);
    uniforms.uHaze.value = clamp(0.55 + tod.fog.density * 260, 0.4, 1);
    uniforms.uSunDisc.value = tod.night ? 1.6 : 26;
    uniforms.uStars.value = tod.stars;
    uniforms.uCloudCover.value = tod.cloudCover * (w.course && w.course.cloudBias ? w.course.cloudBias : 1);
    const cc = tod.cloudColor;
    // Sunlit cloud brightness follows the strength of the sun at this hour.
    const cg = tod.night ? 0.02 : tod.cloudGain ?? clamp(1.05 * (tod.sunIntensity / 4.2), 0.3, 1.1);
    uniforms.uCloudColor.value.setRGB(cc[0] * cg, cc[1] * cg, cc[2] * cg);
    // The shaded side of a cloud is lit by the sky: a cool grey around half the sunlit value.
    uniforms.uCloudShade.value.setRGB(cc[0], cc[1], cc[2]).lerp(new THREE.Color(0.6, 0.68, 0.82), 0.6).multiplyScalar(tod.night ? 0.012 : 0.5);
    // Fog must match what the sky shows at the horizon.
    engine.post.state.fogColor.copy(uniforms.uHorizon.value);
    // Haze toward the sun brightens and takes the sun's hue, relative to the horizon it joins.
    engine.post.state.fogSunColor.copy(uniforms.uHorizon.value).multiply(uniforms.uSunColor.value).multiplyScalar(tod.night ? 1.2 : 1.5);
    const key = tod.id + ':' + w.sunDir.x.toFixed(3) + w.sunDir.z.toFixed(3);
    if (key !== envKey) {
      envKey = key;
      if (hdriFor === tod.hdri && sky.hdriInfo) { alignHdri(sky.hdriInfo); updateIntensity(); }
      else { bakeProcedural(); updateIntensity(); sky.loading = loadHdri(tod); }
    }
  };

  sky.loadHole = async () => {
    if (assets && assets.enabled && !uniforms.tCloud.value) {
      sky.cloudLoading = assets.texture('procedural', 'cloud_noise', { repeat: true, anisotropy: 2 }).then((t) => {
        if (t) { uniforms.tCloud.value = t; uniforms.uHasCloud.value = 1; }
      });
    }
  };
  sky.whenSettled = async () => { if (sky.cloudLoading) await sky.cloudLoading; if (sky.loading) await sky.loading; };

  sky.update = (dt, t, w) => {
    mesh.position.copy(w.camera.position);
    mesh.scale.setScalar(w.camera.far * 0.92);
    uniforms.uCamPos.value.copy(w.camera.position);
    uniforms.uTime.value = fin(t, 0) % 10000;
    // Clouds ride the upper wind: faster than the wind at ground level.
    const wind = w.wind || { x: 0, z: 0 };
    uniforms.uCloudOffset.value.x -= fin(wind.x, 0) * dt * 9 + dt * 4;
    uniforms.uCloudOffset.value.y -= fin(wind.z, 0) * dt * 9 + dt * 2;
  };

  // After a context restore the prefiltered targets are gone: rebuild them.
  sky.restore = () => { envKey = ''; hdriFor = ''; if (sky.tod) sky.setTimeOfDay(sky.tod, world); };
  sky.dispose = () => { scene.remove(mesh); material.dispose(); pmrem.dispose(); if (envRT) envRT.dispose(); scene.environment = null; };
  return sky;
}
