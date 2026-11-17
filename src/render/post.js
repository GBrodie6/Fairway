// Post pipeline. The scene renders in linear light into a half-float HDR target with a depth
// texture. Everything after that is screen space:
//   GTAO (half res)  ->  bloom (thresholded HDR highlights)  ->  light shafts (quarter res)
//   -> composite: heat shimmer, AO, aerial perspective + height fog, shafts, bloom, exposure,
//      tone map (ACES or AgX), sRGB encode, then the grade and vignette IN DISPLAY SPACE.
// Grading after the sRGB encode is deliberate: the old project graded in linear space and
// crushed the image.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { fin } from '../core/guards.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
float luma709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

const BLOOM_PREFILTER = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
uniform float uKnee;
void main() {
  // 4-tap box downsample with a soft-knee threshold so only real highlights bloom.
  vec3 c = vec3(0.0);
  c += texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c = max(c * 0.25 * uExposure, vec3(0.0));
  c = min(c, vec3(64.0));
  float l = luma709(c);
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * max(w, 0.0), 1.0);
}`;

const BLOOM_DOWN = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const BLOOM_UP = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uBlend;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv).rgb * 2.0;
  c /= 6.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c * uBlend, 1.0);
}`;

const SHAFT_MASK = COMMON + /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tScene;
uniform float uExposure;
void main() {
  float d = texture2D(tDepth, vUv).x;
  // Only sky pixels emit. Anything in front of the sky occludes.
  float sky = step(0.9999995, d);
  float l = luma709(texture2D(tScene, vUv).rgb) * uExposure;
  gl_FragColor = vec4(vec3(sky * clamp(l * 0.5, 0.0, 1.5)), 1.0);
}`;

const SHAFT_BLUR = COMMON + /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uSunUv;
uniform float uDensity;
void main() {
  const int N = 28;
  vec2 delta = (uSunUv - vUv) * (uDensity / float(N));
  vec2 uv = vUv + delta * hash12(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++) {
    acc += texture2D(tMask, clamp(uv, 0.0, 1.0)).r * w;
    wsum += w;
    w *= 0.955;
    uv += delta;
  }
  gl_FragColor = vec4(vec3(acc / wsum), 1.0);
}`;

const COMPOSITE = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform float uExposure;
uniform float uAOStrength;
uniform float uBloomStrength;
uniform float uShaftStrength;
uniform vec3 uShaftColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uFogHaze;
uniform float uFogHeight;
uniform float uFogBase;
uniform float uFogMax;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uLift;
uniform float uVignette;
uniform float uTime;
uniform float uShimmer;
uniform float uFade;
uniform vec2 uResolution;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 tonemapACES(vec3 color) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inM * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(outM * color, 0.0, 1.0);
}
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tonemapAgX(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutsetMatrix = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = vUv;
  float depth0 = texture2D(tDepth, uv).x;
#ifdef USE_SHIMMER
  if (uShimmer > 0.0) {
    vec4 v0 = uProjInv * vec4(uv * 2.0 - 1.0, depth0 * 2.0 - 1.0, 1.0);
    float dist0 = length(v0.xyz / v0.w);
    float m = smoothstep(40.0, 220.0, dist0) * (1.0 - step(0.9999995, depth0) * 0.7);
    float band = smoothstep(0.75, 0.45, uv.y) * smoothstep(0.1, 0.4, uv.y);
    float n = sin(uv.y * 240.0 + uTime * 5.0) * sin(uv.x * 37.0 + uTime * 1.7) + sin(uv.y * 97.0 - uTime * 3.1) * 0.5;
    uv.x += n * 0.0011 * uShimmer * m * band;
  }
#endif
  vec3 color = max(texture2D(tScene, uv).rgb, vec3(0.0));
  float depth = texture2D(tDepth, uv).x;
  bool isSky = depth >= 0.9999995;
#ifdef USE_AO
  if (!isSky) {
    float ao = texture2D(tAO, uv).r;
    // Bright, directly lit pixels keep more of their energy than shaded ones.
    float keep = clamp(luma709(color) * uExposure * 0.35, 0.0, 0.6);
    color *= mix(1.0, ao, uAOStrength * (1.0 - keep));
  }
#endif
  // Reconstruct the world position for aerial perspective and height fog.
  vec4 vpos = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vpos.xyz /= vpos.w;
  float dist = length(vpos.xyz);
  vec3 wpos = (uViewInv * vec4(vpos.xyz, 1.0)).xyz;
  vec3 ray = normalize(wpos - uCamPos);
  if (!isSky) {
    float dy = wpos.y - uCamPos.y;
    float k = dy / uFogHeight;
    float integral = abs(k) < 1e-3 ? 1.0 : (1.0 - exp(-k)) / k;
    float tau = dist * (uFogHaze + uFogDensity * exp(-(uCamPos.y - uFogBase) / uFogHeight) * integral);
    float f = min(1.0 - exp(-max(tau, 0.0)), uFogMax);
    // The bright sun-side tint needs a long path through haze to build up. Applied at close
    // range it reads as a wet sheen on the ground below the sun.
    float sunAmt = pow(max(dot(ray, uSunDir), 0.0), 4.0) * smoothstep(60.0, 700.0, dist);
    vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt * 0.7);
    color = mix(color, fogCol, f);
  }
#ifdef USE_SHAFTS
  // Shafts are light scattered in the air along the view ray, so nearby ground gets almost
  // none of it. Without this the rays read as a wet sheen on the grass under the sun.
  color += uShaftColor * texture2D(tShafts, vUv).r * uShaftStrength * (isSky ? 1.0 : smoothstep(25.0, 420.0, dist));
#endif
#ifdef USE_BLOOM
  color += texture2D(tBloom, vUv).rgb * (uBloomStrength / max(uExposure, 1e-4));
#endif
  color *= uExposure;
#ifdef TONEMAP_AGX
  color = tonemapAgX(color);
#else
  color = tonemapACES(color);
#endif
  // Display space from here on.
  color = toSRGB(color);
  color = (color - 0.5) * uContrast + 0.5 + uLift;
  float l = luma709(color);
  color = mix(vec3(l), color, uSaturation) * uTint;
  vec2 q = vUv - 0.5;
  q.x *= min(uResolution.x / uResolution.y, 1.6);
  float vig = smoothstep(0.35, 1.05, length(q) * 1.25);
  color *= 1.0 - uVignette * vig;
  color *= uFade;
  // Triangular dither removes banding in sky gradients.
  float dn = hash12(gl_FragCoord.xy + fract(uTime) * 61.0) + hash12(gl_FragCoord.xy * 1.37 + 17.0) - 1.0;
  color += dn / 255.0;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

const DOF = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform float uFocus;
uniform float uRange;
uniform float uMaxBlur;
uniform vec2 uTexel;
float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
void main() {
  float cd = viewDist(vUv);
  float coc = clamp(abs(cd - uFocus) / max(uRange, 0.01) - 0.15, 0.0, 1.0) * uMaxBlur;
  vec3 acc = texture2D(tScene, vUv).rgb;
  float wsum = 1.0;
  const float GOLDEN = 2.39996323;
  for (int i = 1; i <= 14; i++) {
    float r = sqrt(float(i) / 14.0) * coc;
    float a = float(i) * GOLDEN;
    vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
    float sd = viewDist(vUv + o);
    // Do not let sharp foreground pixels bleed over a blurred background.
    float w = sd >= cd - 0.5 ? 1.0 : clamp(abs(sd - uFocus) / max(uRange, 0.01), 0.0, 1.0);
    acc += min(texture2D(tScene, vUv + o).rgb, vec3(32.0)) * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;

function makeMat(frag, uniforms, defines) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines || {},
    depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
  });
}

export function createPost(renderer, tier) {
  const fsScene = new THREE.Scene();
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsGeo = new THREE.BufferGeometry();
  // One oversized triangle covers the screen with no diagonal seam.
  fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const fsMesh = new THREE.Mesh(fsGeo, null);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);

  const drawFs = (material, target) => {
    fsMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  };

  const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
  let w = 4, h = 4;
  let sceneRT = null, dofRT = null, shaftMaskRT = null, shaftRT = null;
  const bloomDown = [], bloomUp = [];
  const BLOOM_LEVELS = 5;
  const lumaRT = new THREE.WebGLRenderTarget(64, 36, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const lumaBuf = new Uint8Array(64 * 36 * 4);
  let gtao = null;

  const state = {
    exposure: 1,
    tonemap: 'aces',
    aoStrength: 0.85,
    bloomStrength: 0.12,
    bloomThreshold: 1.7,
    shaftStrength: 0,
    shaftColor: new THREE.Color(1, 0.9, 0.7),
    sunDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
    fogColor: new THREE.Color(0.7, 0.8, 0.9),
    fogSunColor: new THREE.Color(1, 0.9, 0.75),
    fogDensity: 0.0006, fogHaze: 0.00006, fogHeight: 60, fogBase: 0, fogMax: 0.85,
    contrast: 1.04, saturation: 1.04, tint: new THREE.Color(1, 1, 1), lift: 0, vignette: 0.16,
    shimmer: 0, fade: 1,
    dof: { enabled: false, focus: 30, range: 40, maxBlur: 7 },
    measured: { luma: 0, age: 1e9 },
  };

  const composite = makeMat(COMPOSITE, {
    tScene: { value: null }, tDepth: { value: null }, tAO: { value: null }, tBloom: { value: null }, tShafts: { value: null },
    uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uExposure: { value: 1 }, uAOStrength: { value: 0.85 }, uBloomStrength: { value: 0.12 },
    uShaftStrength: { value: 0 }, uShaftColor: { value: state.shaftColor },
    uFogColor: { value: state.fogColor }, uFogSunColor: { value: state.fogSunColor }, uSunDir: { value: state.sunDir },
    uFogDensity: { value: 0 }, uFogHaze: { value: 0 }, uFogHeight: { value: 60 }, uFogBase: { value: 0 }, uFogMax: { value: 0.85 },
    uContrast: { value: 1 }, uSaturation: { value: 1 }, uTint: { value: state.tint }, uLift: { value: 0 }, uVignette: { value: 0.15 },
    uTime: { value: 0 }, uShimmer: { value: 0 }, uFade: { value: 1 }, uResolution: { value: new THREE.Vector2(1, 1) },
  });
  const prefilter = makeMat(BLOOM_PREFILTER, { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uThreshold: { value: 1.7 }, uKnee: { value: 0.5 } });
  const down = makeMat(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = makeMat(BLOOM_UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uBlend: { value: 1 } });
  const shaftMask = makeMat(SHAFT_MASK, { tDepth: { value: null }, tScene: { value: null }, uExposure: { value: 1 } });
  const shaftBlur = makeMat(SHAFT_BLUR, { tMask: { value: null }, uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uDensity: { value: 0.9 } });
  const dofMat = makeMat(DOF, { tScene: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uFocus: { value: 30 }, uRange: { value: 40 }, uMaxBlur: { value: 7 }, uTexel: { value: new THREE.Vector2() } });

  let currentTier = tier;
  let lastDefines = '';

  function disposeTargets() {
    for (const rt of [sceneRT, dofRT, shaftMaskRT, shaftRT, ...bloomDown, ...bloomUp]) if (rt) rt.dispose();
    bloomDown.length = 0; bloomUp.length = 0;
    sceneRT = dofRT = shaftMaskRT = shaftRT = null;
  }

  function setSize(width, height) {
    w = Math.max(4, Math.floor(width)); h = Math.max(4, Math.floor(height));
    disposeTargets();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, depthTexture, samples: currentTier.msaa || 0, generateMipmaps: false,
    });
    sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    if (currentTier.bloom) {
      let bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        bloomDown.push(new THREE.WebGLRenderTarget(bw, bh, hdr));
        if (i < BLOOM_LEVELS - 1) bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, hdr));
        bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      }
    }
    if (currentTier.shafts) {
      const sw = Math.max(2, w >> 2), sh = Math.max(2, h >> 2);
      const o = { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      shaftMaskRT = new THREE.WebGLRenderTarget(sw, sh, o);
      shaftRT = new THREE.WebGLRenderTarget(sw, sh, o);
    }
    if (currentTier.dof) dofRT = new THREE.WebGLRenderTarget(w, h, hdr);
    if (gtao) gtao.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    composite.uniforms.uResolution.value.set(w, h);
  }

  function ensureGtao(scene, camera) {
    if (!currentTier.ao) return null;
    if (!gtao) {
      gtao = new GTAOPass(scene, camera, Math.max(2, w >> 1), Math.max(2, h >> 1), { depthTexture: sceneRT.depthTexture });
      gtao.output = GTAOPass.OUTPUT.Off;
      gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, distanceFallOff: 1, scale: 1.1, samples: currentTier.aoSamples || 8, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 8 });
    }
    gtao.scene = scene; gtao.camera = camera;
    if (gtao.depthTexture !== sceneRT.depthTexture) gtao.setGBuffer(sceneRT.depthTexture, undefined);
    return gtao;
  }

  const _sunNdc = new THREE.Vector3();

  function render(scene, camera, time, { toTarget = null } = {}) {
    if (!sceneRT) return;
    // Lesson from the old project: matrices must be current before any projection math.
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    renderer.setRenderTarget(sceneRT);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    let colorTex = sceneRT.texture;
    const u = composite.uniforms;
    const exposure = fin(state.exposure, 1);

    // GTAO
    let aoTex = null;
    if (currentTier.ao && state.aoStrength > 0) {
      const g = ensureGtao(scene, camera);
      if (g) { g.render(renderer, null, null); aoTex = g.pdRenderTarget.texture; }
    }

    // Depth of field (replay and flyover only)
    if (currentTier.dof && state.dof.enabled && dofRT) {
      const d = dofMat.uniforms;
      d.tScene.value = colorTex; d.tDepth.value = sceneRT.depthTexture;
      d.uProjInv.value.copy(camera.projectionMatrixInverse);
      d.uFocus.value = fin(state.dof.focus, 30); d.uRange.value = fin(state.dof.range, 40); d.uMaxBlur.value = fin(state.dof.maxBlur, 7);
      d.uTexel.value.set(1 / w, 1 / h);
      drawFs(dofMat, dofRT);
      colorTex = dofRT.texture;
    }

    // Bloom
    let bloomTex = null;
    if (currentTier.bloom && state.bloomStrength > 0 && bloomDown.length) {
      prefilter.uniforms.tScene.value = colorTex;
      prefilter.uniforms.uTexel.value.set(1 / w, 1 / h);
      prefilter.uniforms.uExposure.value = exposure;
      prefilter.uniforms.uThreshold.value = state.bloomThreshold;
      drawFs(prefilter, bloomDown[0]);
      for (let i = 1; i < bloomDown.length; i++) {
        down.uniforms.tSrc.value = bloomDown[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / bloomDown[i - 1].width, 1 / bloomDown[i - 1].height);
        drawFs(down, bloomDown[i]);
      }
      let src = bloomDown[bloomDown.length - 1];
      for (let i = bloomUp.length - 1; i >= 0; i--) {
        up.uniforms.tSrc.value = src.texture;
        up.uniforms.tBase.value = bloomDown[i].texture;
        up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        drawFs(up, bloomUp[i]);
        src = bloomUp[i];
      }
      bloomTex = src.texture;
    }

    // Light shafts: only when the sun is in front of the camera and low enough to matter.
    let shaftTex = null;
    if (currentTier.shafts && state.shaftStrength > 0.001 && shaftRT) {
      _sunNdc.copy(camera.position).addScaledVector(state.sunDir, 1000).project(camera);
      const inFront = _sunNdc.z < 1 && Number.isFinite(_sunNdc.x + _sunNdc.y);
      const off = Math.max(Math.abs(_sunNdc.x), Math.abs(_sunNdc.y));
      if (inFront && off < 1.6) {
        shaftMask.uniforms.tDepth.value = sceneRT.depthTexture;
        shaftMask.uniforms.tScene.value = sceneRT.texture;
        shaftMask.uniforms.uExposure.value = exposure;
        drawFs(shaftMask, shaftMaskRT);
        shaftBlur.uniforms.tMask.value = shaftMaskRT.texture;
        shaftBlur.uniforms.uSunUv.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
        drawFs(shaftBlur, shaftRT);
        shaftTex = shaftRT.texture;
        u.uShaftStrength.value = state.shaftStrength * Math.max(0, 1 - Math.max(0, off - 1) / 0.6);
      }
    }

    const defines = [aoTex ? 'AO' : '', bloomTex ? 'BLOOM' : '', shaftTex ? 'SHAFTS' : '', state.shimmer > 0 && currentTier.shimmer ? 'SHIMMER' : '', state.tonemap === 'agx' ? 'AGX' : ''].join('|');
    if (defines !== lastDefines) {
      lastDefines = defines;
      composite.defines = {};
      if (aoTex) composite.defines.USE_AO = 1;
      if (bloomTex) composite.defines.USE_BLOOM = 1;
      if (shaftTex) composite.defines.USE_SHAFTS = 1;
      if (state.shimmer > 0 && currentTier.shimmer) composite.defines.USE_SHIMMER = 1;
      if (state.tonemap === 'agx') composite.defines.TONEMAP_AGX = 1;
      composite.needsUpdate = true;
    }
    u.tScene.value = colorTex; u.tDepth.value = sceneRT.depthTexture;
    u.tAO.value = aoTex; u.tBloom.value = bloomTex; u.tShafts.value = shaftTex;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uViewInv.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uExposure.value = exposure;
    u.uAOStrength.value = fin(state.aoStrength, 0);
    u.uBloomStrength.value = fin(state.bloomStrength, 0);
    u.uFogDensity.value = fin(state.fogDensity, 0); u.uFogHaze.value = fin(state.fogHaze, 0);
    u.uFogHeight.value = Math.max(1, fin(state.fogHeight, 60)); u.uFogBase.value = fin(state.fogBase, 0); u.uFogMax.value = fin(state.fogMax, 0.85);
    u.uContrast.value = fin(state.contrast, 1); u.uSaturation.value = fin(state.saturation, 1);
    u.uLift.value = fin(state.lift, 0); u.uVignette.value = fin(state.vignette, 0);
    u.uTime.value = fin(time, 0) % 1000; u.uShimmer.value = fin(state.shimmer, 0); u.uFade.value = fin(state.fade, 1);
    drawFs(composite, toTarget);
    renderer.setRenderTarget(null);
  }

  // Mean display luma of the last composite, measured on a 64x36 copy. Drives auto exposure.
  function measureLumaSync() {
    if (!sceneRT) return 0;
    drawFs(composite, lumaRT);
    renderer.readRenderTargetPixels(lumaRT, 0, 0, 64, 36, lumaBuf);
    renderer.setRenderTarget(null);
    let sum = 0;
    for (let i = 0; i < lumaBuf.length; i += 4) sum += 0.2126 * lumaBuf[i] + 0.7152 * lumaBuf[i + 1] + 0.0722 * lumaBuf[i + 2];
    const l = sum / (lumaBuf.length / 4);
    state.measured.luma = l; state.measured.age = 0;
    return l;
  }

  let asyncBusy = false;
  function measureLumaAsync() {
    if (asyncBusy || !sceneRT) return;
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') { measureLumaSync(); return; }
    asyncBusy = true;
    drawFs(composite, lumaRT);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixelsAsync(lumaRT, 0, 0, 64, 36, lumaBuf).then(() => {
      let sum = 0;
      for (let i = 0; i < lumaBuf.length; i += 4) sum += 0.2126 * lumaBuf[i] + 0.7152 * lumaBuf[i + 1] + 0.0722 * lumaBuf[i + 2];
      state.measured.luma = sum / (lumaBuf.length / 4); state.measured.age = 0;
      asyncBusy = false;
    }).catch(() => { asyncBusy = false; });
  }

  function setTier(t) {
    currentTier = t;
    if (gtao) { gtao.dispose(); gtao = null; }
    lastDefines = '';
    setSize(w, h);
  }

  function dispose() {
    disposeTargets();
    lumaRT.dispose();
    if (gtao) gtao.dispose();
    for (const m of [composite, prefilter, down, up, shaftMask, shaftBlur, dofMat]) m.dispose();
    fsGeo.dispose();
  }

  // Bytes held by render targets, for the debug overlay memory readout.
  function memoryBytes() {
    let b = 0;
    const add = (rt, bpp) => { if (rt) b += rt.width * rt.height * bpp; };
    add(sceneRT, 8 * (1 + (currentTier.msaa || 0)) + 4);
    add(dofRT, 8);
    for (const rt of bloomDown) add(rt, 8);
    for (const rt of bloomUp) add(rt, 8);
    add(shaftMaskRT, 4); add(shaftRT, 4);
    if (gtao) { add(gtao.gtaoRenderTarget, 8); add(gtao.pdRenderTarget, 8); }
    return b;
  }

  return { state, render, setSize, setTier, measureLumaSync, measureLumaAsync, dispose, memoryBytes, get sceneRT() { return sceneRT; }, get size() { return { w, h }; } };
}
