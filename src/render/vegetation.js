// Vegetation: GPU-instanced trees, understory, ground cover, and rocks.
//   placement   deterministic per hole, driven by the terrain's tree density and surface masks
//   LOD         near trees use the LOD0 mesh, mid trees the LOD1 mesh, far trees a billboard
//               impostor baked at load from the same model (four views), re-bucketed as the
//               camera moves, with per-instance frustum culling on the CPU
//   per instance scale, rotation, and tint; wind sway in the vertex shader from the game wind
//   foliage     softened normals, back-lit translucency, and reduced specular so leaves never
//               go black on the shaded side
import * as THREE from 'three';
import { createRng, fbm2 } from '../core/rng.js';
import { clamp, smoothstep } from '../core/math.js';
import { fin } from '../core/guards.js';
import { SURFACES } from '../physics/surfaces.js';
import { PROCEDURAL_BUILDERS } from './proceduralPlants.js';

// What grows where. Weights are relative within a list.
export const MIX = {
  parkland: {
    trees: [['oak', 3], ['maple', 3], ['elm', 2.5], ['birch', 1.5], ['fir', 0.7], ['pine', 0.5], ['jacaranda', 0.3]],
    under: [['bushtree', 1.2], ['shrub2', 1], ['fern', 2.2], ['shrub4', 1], ['shrub3', 0.8]],
    logs: [['log', 1], ['stump', 0.7]], logChance: 0.06,
    ground: [['tallgrass', 4], ['tallgrass2', 2], ['celandine', 1], ['dandelion', 1]],
    rocks: [['mossrocks', 1], ['rock1', 0.5], ['stump', 0.6], ['log', 0.5]],
    water: [['reeds', 1]], rockChance: 0.012, groundChance: 0.3, treeScale: [0.8, 1.3],
  },
  links: {
    trees: [['thorn', 1.4], ['bushtree', 1], ['pine', 0.35]],
    under: [['thorn', 1], ['rooibos', 1.2], ['shrub3', 0.6]],
    ground: [['tallgrass2', 6], ['tallgrass', 2], ['dandelion', 0.4]],
    rocks: [['rock1', 1], ['rock2', 1], ['stone', 1.5]],
    water: [['reeds', 1]], rockChance: 0.008, groundChance: 0.42, treeScale: [0.7, 1.15],
  },
  desert: {
    trees: [['quiver', 2], ['quiver2', 1.4], ['thorn', 2], ['saguaro', 1.2], ['saguaro2', 0.8], ['saguaro3', 0.9]],
    under: [['rooibos', 3], ['thorn', 1]],
    ground: [['succulent', 2], ['gazania', 0.8], ['tallgrass2', 1.4]],
    rocks: [['boulder2', 1.5], ['boulder3', 1.5], ['rock1', 1], ['rock2', 1], ['stone', 2]],
    water: [['reeds', 1]], rockChance: 0.05, groundChance: 0.16, treeScale: [0.8, 1.4],
  },
  alpine: {
    trees: [['fir', 4], ['pine', 3], ['birch', 1], ['elm', 0.3]],
    under: [['fern', 2], ['shrub2', 1], ['bushtree', 0.6], ['shrub3', 0.6]],
    logs: [['log', 1], ['stump', 1]], logChance: 0.08,
    ground: [['tallgrass', 3], ['celandine', 1], ['dandelion', 0.6]],
    rocks: [['mossrocks', 2], ['rock2', 1], ['boulder3', 0.8], ['log', 0.7], ['stump', 0.6]],
    water: [['reeds', 1]], rockChance: 0.03, groundChance: 0.26, treeScale: [0.85, 1.45],
  },
  // Tall pines over azaleas in bloom.
  augusta: {
    trees: [['pine', 6], ['fir', 1.4], ['oak', 0.7], ['maple', 0.4], ['jacaranda', 0.25]],
    under: [['azalea', 3.2], ['azalea2', 2.2], ['shrub2', 0.8], ['fern', 0.5]],
    ground: [['tallgrass', 1.2], ['celandine', 0.4]],
    rocks: [['rock1', 0.5], ['stump', 0.5]],
    water: [['reeds', 0.4]], rockChance: 0.004, groundChance: 0.12, treeScale: [0.95, 1.4],
  },
  // No trees: gorse in clumps on the links, fescue around it.
  standrews: {
    trees: [['gorse', 5], ['thorn', 0.4]],
    under: [['gorse', 2], ['rooibos', 0.6]],
    ground: [['tallgrass2', 6], ['tallgrass', 2], ['celandine', 0.5]],
    rocks: [['stone', 1]],
    water: [['reeds', 0.6]], rockChance: 0.002, groundChance: 0.45, treeScale: [0.8, 1.5],
  },
  tropical: {
    trees: [['palm', 3], ['palm2', 2.4], ['jacaranda', 1.4], ['bushtree', 1], ['oak', 0.4]],
    under: [['fern', 3], ['shrub4', 1], ['bushtree', 1], ['shrub3', 0.8]],
    logs: [['log', 1]], logChance: 0.03,
    ground: [['tallgrass', 2], ['celandine', 1], ['tallgrass2', 1]],
    rocks: [['rock1', 1], ['boulder2', 0.5]],
    water: [['reeds', 1]], rockChance: 0.008, groundChance: 0.26, treeScale: [0.85, 1.25],
  },
};

const IMPOSTOR_PX = 256;

function pickWeighted(list, r) {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r * total;
  for (const [id, w] of list) { x -= w; if (x <= 0) return id; }
  return list[list.length - 1][0];
}

export function createVegetation(world, engine) {
  const tier = engine.tier;
  const { lighting, assets } = world;
  const group = new THREE.Group();
  group.name = 'vegetation';
  const shared = {
    uVegTime: { value: 0 },
    uVegWind: { value: new THREE.Vector2(1, 0) },
    uVegSunDir: { value: lighting.sunDir },
    uVegSun: { value: lighting.sunRadiance },
  };

  // --- shader hooks ---
  // World-space wind sway applied after the instance transform. amp scales with height squared
  // so the trunk base stays planted. flutter adds a fast shimmer to leaves.
  function swayHook(height, amp, flutter) {
    return (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uVegTime;\nuniform vec2 uVegWind;\nvarying vec3 vVegWorld;')
        .replace('#include <project_vertex>', /* glsl */ `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            vec3 vegBase = instanceMatrix[3].xyz;
            float vegScale = length(instanceMatrix[1].xyz);
          #else
            vec3 vegBase = vec3(0.0);
            float vegScale = 1.0;
          #endif
          float vegH = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.2);
          float vegPhase = dot(vegBase.xz, vec2(0.37, 0.23));
          float vegW = length(uVegWind);
          float vegGust = sin(uVegTime * (0.9 + vegW * 0.06) + vegPhase) * 0.6 + sin(uVegTime * 2.3 + vegPhase * 1.9) * 0.4;
          float vegBend = (0.35 + 0.65 * vegGust) * vegH * vegH * ${amp.toFixed(3)} * vegScale * ${height.toFixed(2)} * (0.25 + vegW * 0.11);
          mvPosition.xz += normalize(uVegWind + vec2(1e-4)) * vegBend;
          ${flutter > 0 ? `mvPosition.xyz += vec3(sin(uVegTime * 5.3 + transformed.x * 9.0 + transformed.y * 7.0), sin(uVegTime * 4.1 + transformed.z * 8.0), cos(uVegTime * 4.7 + transformed.x * 6.0)) * ${flutter.toFixed(3)} * vegH * (0.4 + vegW * 0.12) * vegScale;` : ''}
          vVegWorld = mvPosition.xyz;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
  }
  // Foliage shading: leaves are thin and scatter light, so soften the normals toward up, add
  // light coming through from behind, and drop most of the mirror-like highlight.
  function foliageHook(shader) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uVegSunDir;\nuniform vec3 uVegSun;\nvarying vec3 vVegWorld;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.45));')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.directSpecular *= 0.2;\n  reflectedLight.indirectSpecular *= 0.2;')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 vegV = normalize(cameraPosition - vVegWorld);
          float vegBack = pow(max(dot(-vegV, uVegSunDir), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uVegSun * vec3(0.9, 1.0, 0.45) * vegBack * 0.16;
        }`);
    shader.vertexShader = shader.vertexShader;
  }
  function woodHook(shader) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.directSpecular *= 0.35;\n  reflectedLight.indirectSpecular *= 0.35;');
  }

  // --- species ---
  const species = new Map();
  const whiteTint = new THREE.Color(1, 1, 1);

  function prepareMaterial(part, info, heightM) {
    const src = part.material;
    const foliage = !!(info.materials || []).find((m) => m.name === part.name && m.foliage) || src.alphaTest > 0 || src.transparent;
    const mat = new THREE.MeshStandardMaterial({
      map: src.map || null, normalMap: foliage ? null : src.normalMap || null, color: src.color ? src.color.clone() : 0xffffff,
      roughness: foliage ? 0.7 : 0.9, metalness: 0, side: foliage ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: foliage ? 0.33 : 0, envMapIntensity: foliage ? 0.6 : 0.5,
    });
    mat.name = part.name;
    if (mat.map) mat.map.anisotropy = Math.min(4, tier.anisotropy);
    const amp = info.kind === 'tree' ? 0.012 : info.kind === 'plant' ? 0.05 : 0;
    const flutter = foliage ? (info.kind === 'tree' ? 0.018 : 0.006) : 0;
    const hooks = [swayHook(heightM, amp, flutter)];
    hooks.push(foliage ? foliageHook : woodHook);
    lighting.setup(mat, hooks, `veg:${foliage ? 'f' : 'w'}:${heightM.toFixed(1)}:${amp}:${flutter}`);
    // Shadow pass: same sway, and alpha-tested for leaves.
    const depth = new THREE.MeshDepthMaterial({ map: foliage ? mat.map : null, alphaTest: foliage ? 0.33 : 0, side: foliage ? THREE.DoubleSide : THREE.FrontSide });
    const dh = swayHook(heightM, amp, flutter);
    depth.onBeforeCompile = (shader) => { dh(shader); shader.vertexShader = shader.vertexShader.replace('varying vec3 vVegWorld;', 'vec3 vVegWorld;'); };
    depth.customProgramCacheKey = () => `vegdepth:${foliage ? 'f' : 'w'}:${heightM.toFixed(1)}:${amp}:${flutter}`;
    return { mat, depth, foliage };
  }

  // Impostor: four side views baked into one texture, lit at runtime with a rounded normal.
  function bakeImpostor(sp) {
    const parts = sp.lod0 || sp.lod1;
    const h = sp.height, r = sp.radius;
    const rt = new THREE.WebGLRenderTarget(IMPOSTOR_PX * 2, IMPOSTOR_PX * 2, { type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const scene = new THREE.Scene();
    const mats = [];
    for (const p of parts) {
      const m = new THREE.MeshBasicMaterial({ map: p.source.map || null, color: p.source.color ? p.source.color.clone() : 0xffffff, alphaTest: p.foliage ? 0.33 : 0, side: THREE.DoubleSide });
      mats.push(m);
      scene.add(new THREE.Mesh(p.geometry, m));
    }
    const cam = new THREE.OrthographicCamera(-r, r, h, 0, 0.1, r * 6 + 10);
    const renderer = engine.renderer;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    // Clear to the average leaf color with zero alpha, so texture filtering at the silhouette
    // blends toward leaf color instead of toward black.
    const avg = sp.leafAvg || [0.1, 0.2, 0.05];
    renderer.setRenderTarget(rt);
    renderer.setClearColor(new THREE.Color(avg[0], avg[1], avg[2]), 0);
    renderer.clear();
    rt.scissorTest = true;
    for (let v = 0; v < 4; v++) {
      const a = (v * Math.PI) / 2;
      cam.position.set(Math.sin(a) * (r * 3 + 5), 0, Math.cos(a) * (r * 3 + 5));
      cam.lookAt(0, 0, 0);
      cam.position.y = 0;
      cam.updateMatrixWorld(true);
      const vx = (v % 2) * IMPOSTOR_PX, vy = Math.floor(v / 2) * IMPOSTOR_PX;
      rt.viewport.set(vx, vy, IMPOSTOR_PX, IMPOSTOR_PX);
      rt.scissor.set(vx, vy, IMPOSTOR_PX, IMPOSTOR_PX);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
    rt.scissorTest = false;
    rt.viewport.set(0, 0, IMPOSTOR_PX * 2, IMPOSTOR_PX * 2);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    for (const m of mats) m.dispose();

    const geo = new THREE.PlaneGeometry(2 * r, h);
    geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.3, roughness: 1, metalness: 0, envMapIntensity: 0.6, side: THREE.DoubleSide });
    lighting.setup(mat, [(shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uVegTime;\nuniform vec2 uVegWind;\nvarying vec3 vImpN;\nvarying vec3 vVegWorld;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vec2 impUv = uv;')
        .replace('#include <project_vertex>', /* glsl */ `
          vec3 ipos = instanceMatrix[3].xyz;
          float isc = length(instanceMatrix[1].xyz);
          vec3 toCam = cameraPosition - ipos; toCam.y = 0.0;
          toCam = normalize(toCam + vec3(1e-5, 0.0, 0.0));
          vec3 rightV = vec3(toCam.z, 0.0, -toCam.x);
          float sway = (sin(uVegTime * 1.1 + dot(ipos.xz, vec2(0.37, 0.23))) * 0.6 + 0.3) * position.y * position.y * 0.0009 * (0.25 + length(uVegWind) * 0.11);
          vec3 wpos = ipos + rightV * position.x * isc + vec3(0.0, position.y * isc, 0.0);
          wpos.xz += normalize(uVegWind + vec2(1e-4)) * sway * isc;
          // Pick the baked view that matches where the camera stands around this tree.
          float rot = atan(instanceMatrix[0].z, instanceMatrix[0].x);
          float camAng = atan(toCam.x, toCam.z);
          float idx = floor(mod((camAng - rot) / 1.5707963 + 0.5, 4.0));
          vMapUv = impUv * 0.5 + vec2(mod(idx, 2.0), floor(idx / 2.0)) * 0.5;
          // A rounded normal: faces the camera in the middle, turns away toward the edges and top.
          vImpN = normalize(toCam * 0.75 + rightV * (impUv.x - 0.5) * 1.5 + vec3(0.0, 0.45 + impUv.y * 0.5, 0.0));
          vVegWorld = wpos;
          vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
          gl_Position = projectionMatrix * mvPosition;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vImpN;\nvarying vec3 vVegWorld;\nuniform vec3 uVegSunDir;\nuniform vec3 uVegSun;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(normalize(vImpN), 0.0)).xyz);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.directSpecular *= 0.1;\n  reflectedLight.indirectSpecular *= 0.1;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { vec3 vegV = normalize(cameraPosition - vVegWorld); totalEmissiveRadiance += diffuseColor.rgb * uVegSun * vec3(0.9, 1.0, 0.45) * pow(max(dot(-vegV, uVegSunDir), 0.0), 3.0) * 0.14; }');
    }], 'impostor');
    // Shadow proxy: two crossed cards carrying two of the baked views. Drawing every tree mesh
    // into every shadow cascade would triple the triangle count, so trees cast their shadows
    // from these instead (4 triangles each). They write nothing in the color pass.
    const a = new THREE.PlaneGeometry(2 * r, h), b = new THREE.PlaneGeometry(2 * r, h);
    a.translate(0, h / 2, 0); b.translate(0, h / 2, 0); b.rotateY(Math.PI / 2);
    const pg = new THREE.BufferGeometry();
    const pa = a.attributes.position.array, pb = b.attributes.position.array, ua = a.attributes.uv.array, ub = b.attributes.uv.array;
    const pos = new Float32Array(24), uv = new Float32Array(16);
    pos.set(pa, 0); pos.set(pb, 12);
    for (let i = 0; i < 4; i++) { uv[i * 2] = ua[i * 2] * 0.5; uv[i * 2 + 1] = ua[i * 2 + 1] * 0.5; uv[8 + i * 2] = ub[i * 2] * 0.5 + 0.5; uv[8 + i * 2 + 1] = ub[i * 2 + 1] * 0.5; }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    pg.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    a.dispose(); b.dispose();
    const proxyMat = new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.4, colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const proxyDepth = new THREE.MeshDepthMaterial({ map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide });
    return { rt, geo, mat, proxyGeo: pg, proxyMat, proxyDepth };
  }

  async function loadSpecies(id) {
    if (species.has(id)) return species.get(id);
    let model = null;
    const wantLod0 = tier.id === 'high' || tier.id === 'ultra';
    if (PROCEDURAL_BUILDERS[id]) model = PROCEDURAL_BUILDERS[id]();
    else if (assets) model = await assets.model(id, { lod0: wantLod0 });
    if (!model) { species.set(id, null); return null; }
    const info = model.info;
    const sp = { id, info, height: info.height, radius: Math.max(info.radius, 0.2), kind: info.kind, lod0: null, lod1: null, impostor: null };
    const leaf = (info.materials || []).find((m) => m.foliage);
    sp.leafAvg = leaf ? leaf.avg : (info.materials && info.materials[0] ? info.materials[0].avg : [0.2, 0.2, 0.2]);
    const prep = (parts) => parts.map((p) => {
      const m = prepareMaterial(p, info, info.height);
      return { geometry: p.geometry, material: m.mat, depth: m.depth, foliage: m.foliage, source: p.material };
    });
    sp.lod1 = prep(model.lod1);
    if (model.lod0) {
      // LOD0 shares the materials built for LOD1 (matched by name).
      const byName = new Map(sp.lod1.map((p) => [p.material.name, p]));
      sp.lod0 = model.lod0.map((p) => { const b = byName.get(p.name); return b ? { ...b, geometry: p.geometry } : null; }).filter(Boolean);
    }
    sp.tris = { lod0: sp.lod0 ? sp.lod0.reduce((a, p) => a + p.geometry.index.count / 3, 0) : 0, lod1: sp.lod1.reduce((a, p) => a + p.geometry.index.count / 3, 0) };
    if (sp.kind === 'tree') sp.impostor = bakeImpostor(sp);
    species.set(id, sp);
    return sp;
  }

  // --- placement ---
  // Instances are stored as structure-of-arrays per species for a cheap per-frame pass.
  function placeAll(w) {
    const t = w.terrain, mix = MIX[w.courseId] || MIX.parkland;
    const rng = createRng((t.hole.seed ^ 0x9e3779b9) >>> 0);
    const seed = t.hole.seed & 0xffff;
    const out = new Map();
    // Instance data, 9 floats: x, y, z, scale, rotation, tint r, g, b, and a height factor
    // (taller or squatter than the model) so no two trees in a line share a silhouette.
    const add = (id, x, z, scale, rot, tint, vert = 1) => {
      if (!species.get(id)) return;
      let a = out.get(id);
      if (!a) { a = []; out.set(id, a); }
      a.push(x, t.heightAt(x, z) - 0.04, z, scale, rot, tint[0], tint[1], tint[2], vert);
    };
    const n = { x: 0, y: 1, z: 0 };
    // Trees and understory on a jittered grid, thinned by the terrain's tree density.
    // With the other holes drawn (render/scenery.js), this hole's woods stop at their corridors
    // (that ground is their rough) and thin toward them across the gap between the holes, so the
    // next hole shows through. Visual only: trees take no part in the ball's flight.
    const foot = w.terrainView.footprintAt;
    const thin = (x, z) => { if (!foot) return 1; const dl = foot(x, z); return dl < 0 ? 0 : 0.4 + 0.6 * smoothstep(10, 45, dl); };
    const G = 6.5;
    for (let gz = t.z0 + 8; gz < t.maxZ - 8; gz += G) for (let gx = t.x0 + 8; gx < t.maxX - 8; gx += G) {
      const x = gx + (rng.next() - 0.5) * G * 0.9, z = gz + (rng.next() - 0.5) * G * 0.9;
      const dens = t.treeDensityAt(x, z) * thin(x, z);
      const roll = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
      if (dens <= 0.01) {
        // A specimen tree now and then just outside a wood, in the rough beyond play.
        const o = t.outsideAt(x, z);
        if (o > 8 && o < 26 && roll < 0.035 * tier.treeDensity && mix.trees.length) {
          const s = t.surfaceAt(x, z);
          if (s === SURFACES.ROUGH || s === SURFACES.DEEP_ROUGH || s === SURFACES.WASTE) {
            add(pickWeighted(mix.trees, r2), x, z, mix.treeScale[1] * (0.85 + r3 * 0.3), r4 * 6.28, [0.92, 0.95, 0.9], 0.95 + rng.next() * 0.25);
            continue;
          }
        }
        // Open ground: an occasional rock outside the maintained area.
        if (t.outsideAt(x, z) > 6 && roll < mix.rockChance) {
          const s = t.surfaceAt(x, z);
          if (s !== SURFACES.WATER && s !== SURFACES.PATH && s !== SURFACES.BUNKER) add(pickWeighted(mix.rocks, r2), x, z, 0.5 + r3 * 1.0, r4 * 6.28, [0.9, 0.9, 0.9]);
        }
        continue;
      }
      const surf = t.surfaceAt(x, z);
      if (surf === SURFACES.WATER || surf === SURFACES.PATH) continue;
      t.normalAt(x, z, n);
      const steep = n.y < 0.8;
      // Woods are not even: a clustering field makes clumps and clearings, and the edge
      // of a wood breaks up into single specimen trees standing out in the rough.
      const clump = fbm2(x / 38, z / 38, seed + 211, 2);
      const clumpK = clamp(0.08 + 1.4 * smoothstep(-0.3, 0.3, clump), 0, 1.4);
      const edge = dens < 0.35;
      if (roll < dens * 0.92 * tier.treeDensity * clumpK && !steep) {
        // Species come in stands, but stands are mixed: the slow field only biases the pick.
        const stand = fbm2(x / 120, z / 120, seed + 77, 2) * 0.5 + 0.5;
        const id = pickWeighted(mix.trees, clamp(stand * 0.4 + r2 * 0.6, 0, 0.999));
        // Age and vigor: size, height, and color all vary; trees deeper in the wood are taller.
        const age = rng.next();
        const sc = mix.treeScale[0] + (mix.treeScale[1] - mix.treeScale[0]) * (0.25 + 0.75 * age) * (0.65 + 0.35 * smoothstep(0, 25, t.outsideAt(x, z)));
        const vert = clamp(0.82 + r3 * 0.42 + (edge ? -0.06 : 0.05), 0.75, 1.3);
        const shade = 0.78 + r4 * 0.36;
        add(id, x, z, sc, rng.next() * 6.28, [shade * (0.92 + rng.next() * 0.16), shade, shade * (0.88 + rng.next() * 0.18)], vert);
        // Understory beneath the canopy, and now and then a fallen log.
        if (rng.next() < 0.45 * tier.propDensity && mix.under.length) {
          const a = rng.next() * 6.28, rr = 1.5 + rng.next() * 2.5;
          add(pickWeighted(mix.under, rng.next()), x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.7 + rng.next() * 0.6, rng.next() * 6.28, [0.88 + rng.next() * 0.2, 0.94, 0.88], 0.85 + rng.next() * 0.3);
        }
        if (mix.logs && rng.next() < mix.logChance * tier.propDensity) {
          const a = rng.next() * 6.28;
          add(pickWeighted(mix.logs, rng.next()), x + Math.cos(a) * 3, z + Math.sin(a) * 3, 0.8 + rng.next() * 0.5, rng.next() * 6.28, [0.85, 0.85, 0.85]);
        }
      } else if (roll > 0.55 && r2 < dens * 0.5 * tier.propDensity) {
        add(pickWeighted(mix.under, r3), x, z, 0.8 + r4 * 0.7, rng.next() * 6.28, [0.9 + rng.next() * 0.2, 0.95, 0.9], 0.85 + rng.next() * 0.3);
      } else if (r2 < mix.rockChance * 0.3) {
        // Rocks under trees sit in shade and half in the leaf litter: smaller and darker than
        // rocks in the open, so they do not read as pale blobs along the tree line.
        add(pickWeighted(mix.rocks, r3), x, z, 0.4 + r4 * 0.45, rng.next() * 6.28, [0.58, 0.6, 0.56]);
      }
    }
    // Beyond the mapped ground the woodland carries on over the outer landscape, as impostors
    // only, so the forest does not stop at the edge of the detailed grid.
    const ringW = tier.treeLod.outerRing, forest = w.course.theme.trees.forest, outerH = w.terrainView.outerHeightAt;
    // With the other holes drawn, the woods stay off their corridors (foot, above).
    if (forest > 0 && ringW > 0 && outerH) {
      const O = 12;
      for (let gz = t.z0 - ringW; gz < t.maxZ + ringW; gz += O) for (let gx = t.x0 - ringW; gx < t.maxX + ringW; gx += O) {
        if (gx > t.x0 + 4 && gx < t.maxX - 4 && gz > t.z0 + 4 && gz < t.maxZ - 4) { rng.next(); continue; }
        // The second layer: denser than the first and a little taller, so the woods have depth.
        if (rng.next() > 0.95 * clamp(forest, 0, 1)) continue;
        const x = gx + (rng.next() - 0.5) * O, z = gz + (rng.next() - 0.5) * O;
        if (foot && foot(x, z) < 4) continue;
        const y = outerH(x, z);
        if (w.course.theme.seaLevel !== null && y < w.course.theme.seaLevel + 1.5) continue;
        const stand = fbm2(x / 120, z / 120, seed + 77, 2) * 0.5 + 0.5;
        const id = pickWeighted(mix.trees, clamp(stand * 0.6 + rng.next() * 0.4, 0, 0.999));
        if (!species.get(id)) continue;
        let a = out.get(id);
        if (!a) { a = []; out.set(id, a); }
        const shade = 0.8 + rng.next() * 0.3;
        // Slightly larger, since each one stands in for a patch of forest.
        a.push(x, y - 0.05, z, (mix.treeScale[0] + mix.treeScale[1]) * 0.5 * (1.05 + rng.next() * 0.45), rng.next() * 6.28, shade, shade, shade * 0.95, 1.0 + rng.next() * 0.3);
      }
    }
    // Ground cover in the rough and on wild ground near play: tall grass clumps and flowers.
    const C = 1.9;
    for (let gz = t.z0 + 4; gz < t.maxZ - 4; gz += C) for (let gx = t.x0 + 4; gx < t.maxX - 4; gx += C) {
      const k = (Math.round(gz - t.z0) * t.nx + Math.round(gx - t.x0));
      const o = t.outside[k];
      if (!(o > -t.hole.roughBand - 4 && o < 30)) continue;
      const r1 = rng.next();
      const patch = fbm2(gx / 17, gz / 17, seed + 91, 2);
      if (r1 > mix.groundChance * (0.35 + 0.9 * smoothstep(-0.25, 0.35, patch)) * tier.propDensity) continue;
      const x = gx + (rng.next() - 0.5) * C, z = gz + (rng.next() - 0.5) * C;
      const surf = t.surfaceAt(x, z);
      const near = t.waterLevelAt ? t.nearLevel[k] > -1e8 && t.height[k] - t.nearLevel[k] < 0.6 : false;
      if (near && surf !== SURFACES.WATER && rng.next() < 0.8) { add(pickWeighted(mix.water, rng.next()), x, z, 0.7 + rng.next() * 0.6, rng.next() * 6.28, [1, 1, 1]); continue; }
      if (surf !== SURFACES.DEEP_ROUGH && surf !== SURFACES.WASTE && !(surf === SURFACES.ROUGH && o > -3)) continue;
      // Flowers gather in drifts.
      const flowers = fbm2(gx / 9, gz / 9, seed + 131, 2) > 0.3;
      const list = flowers ? mix.ground : mix.ground.slice(0, 2);
      add(pickWeighted(list, rng.next()), x, z, 0.75 + rng.next() * 0.7, rng.next() * 6.28, [0.9 + rng.next() * 0.2, 0.92 + rng.next() * 0.16, 0.85 + rng.next() * 0.2]);
    }
    return out;
  }

  // --- instanced buckets ---
  const buckets = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
  const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sph = new THREE.Sphere();
  function makeMeshes(parts, cap, castShadow) {
    return parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, cap);
      m.count = 0; m.frustumCulled = false; m.castShadow = castShadow; m.receiveShadow = true;
      m.customDepthMaterial = p.depth || undefined;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, whiteTint);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.matrixAutoUpdate = false;
      group.add(m);
      return m;
    });
  }
  function clearBuckets() {
    for (const b of buckets) for (const list of [b.m0, b.m1, b.mi, b.ms]) for (const m of list || []) { group.remove(m); m.dispose(); }
    buckets.length = 0;
  }

  const veg = { group, species, counts: { trees: 0, plants: 0, rocks: 0 }, drawn: { lod0: 0, lod1: 0, impostor: 0, small: 0 }, triangles: 0, ready: false };

  veg.unloadHole = () => { clearBuckets(); veg.ready = false; };
  veg.loadHole = async (w) => {
    clearBuckets();
    veg.ready = false;
    const mix = MIX[w.courseId] || MIX.parkland;
    const ids = new Set();
    for (const key of ['trees', 'under', 'ground', 'rocks', 'water', 'logs']) for (const [id] of mix[key] || []) ids.add(id);
    // Models load after first paint. The hole is playable (and physically identical) without them.
    veg.loading = (async () => {
      await Promise.all([...ids].map((id) => loadSpecies(id)));
      if (w.terrain !== world.terrain) return;
      const placed = placeAll(w);
      veg.counts = { trees: 0, plants: 0, rocks: 0 };
      for (const [id, arr] of placed) {
        const sp = species.get(id);
        const count = arr.length / 9;
        const data = new Float32Array(arr);
        const isTree = sp.kind === 'tree';
        if (isTree) veg.counts.trees += count; else if (sp.kind === 'plant') veg.counts.plants += count; else veg.counts.rocks += count;
        const cap0 = sp.lod0 ? Math.min(count, isTree ? tier.treeLod.maxLod0 : 40) : 0;
        const cap1 = Math.min(count, isTree ? tier.treeLod.maxLod1 : sp.kind === 'plant' ? Math.round(420 * tier.propDensity) : 90);
        const capS = isTree && sp.impostor ? Math.min(count, 170) : 0;
        const b = {
          sp, data, count, isTree, cap0, cap1, capS,
          m0: cap0 ? makeMeshes(sp.lod0, cap0, false) : null,
          m1: makeMeshes(sp.lod1, cap1, sp.kind === 'rock'),
          mi: sp.impostor ? makeMeshes([{ geometry: sp.impostor.geo, material: sp.impostor.mat }], count, false) : null,
          ms: capS ? makeMeshes([{ geometry: sp.impostor.proxyGeo, material: sp.impostor.proxyMat, depth: sp.impostor.proxyDepth }], capS, true) : null,
        };
        if (b.ms) for (const m of b.ms) m.receiveShadow = false;
        buckets.push(b);
      }
      veg.ready = true;
      lastCam.set(1e9, 0, 0);
    })();
  };
  // QA: the instance of a species nearest to a point, for close-up shots.
  veg.nearest = (id, px, pz) => {
    let best = null;
    for (const b of buckets) {
      if (b.sp.id !== id) continue;
      for (let i = 0; i < b.count; i++) {
        const o = i * 9, d = Math.hypot(b.data[o] - px, b.data[o + 2] - pz);
        if (!best || d < best.d) best = { d, x: b.data[o], y: b.data[o + 1], z: b.data[o + 2], height: b.sp.height * b.data[o + 3] * b.data[o + 8] };
      }
    }
    return best;
  };
  veg.whenSettled = async () => { if (veg.loading) await veg.loading; rebucket(world.camera, true); };

  const lastCam = new THREE.Vector3(1e9, 0, 0), lastDir = new THREE.Vector3(), _dir = new THREE.Vector3(), _cp = new THREE.Vector3();
  const cand = [];
  function setInst(meshes, i, x, y, z, sc, rot, r, g, b, vt = 1) {
    _p.set(x, y, z); _q.setFromAxisAngle(_up, rot); _s.set(sc, sc * vt, sc);
    _m.compose(_p, _q, _s);
    _c.setRGB(r, g, b);
    for (const m of meshes) { m.setMatrixAt(i, _m); m.setColorAt(i, _c); }
  }
  function rebucket(camera, force) {
    if (!veg.ready) return;
    camera.updateMatrixWorld();
    _cp.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(_dir);
    if (!force && _cp.distanceToSquared(lastCam) < 9 && _dir.dot(lastDir) > 0.9975) return;
    lastCam.copy(_cp); lastDir.copy(_dir);
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const near = tier.treeLod.near, mid = tier.treeLod.mid, far = tier.drawDistance;
    const drawn = { lod0: 0, lod1: 0, impostor: 0, small: 0 };
    let tris = 0;
    // Mesh LODs are a global budget spent on the nearest trees, whatever their species.
    // Everything else is an impostor. cut0 and cut1 are the distances that budget reaches.
    cand.length = 0;
    for (const b of buckets) {
      if (!b.isTree) continue;
      const { data, count } = b;
      for (let i = 0; i < count; i++) {
        const dx = data[i * 9] - _cp.x, dz = data[i * 9 + 2] - _cp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < mid * mid) cand.push(d2);
      }
    }
    cand.sort((a, b) => a - b);
    const cut0 = tier.treeLod.maxLod0 > 0 ? Math.min(near * near, cand.length > tier.treeLod.maxLod0 ? cand[tier.treeLod.maxLod0] : Infinity) : -1;
    const nMesh = tier.treeLod.maxLod0 + tier.treeLod.maxLod1;
    const cut1 = Math.min(mid * mid, cand.length > nMesh ? cand[nMesh] : Infinity);
    for (const b of buckets) {
      const { data, count, sp } = b;
      let n0 = 0, n1 = 0, ni = 0, ns = 0;
      const shadowR2 = (tier.shadows.far + 35) * (tier.shadows.far + 35);
      const smallRange = sp.kind === 'plant' ? (sp.height > 1.5 ? 110 : 55 + 30 * tier.propDensity) : sp.kind === 'rock' ? 220 : 0;
      for (let i = 0; i < count; i++) {
        const o = i * 9;
        const x = data[o], y = data[o + 1], z = data[o + 2], sc = data[o + 3], vt = data[o + 8];
        const dx = x - _cp.x, dz = z - _cp.z;
        const d2 = dx * dx + dz * dz;
        if (b.isTree) {
          if (d2 > far * far) continue;
          const d = Math.sqrt(d2);
          if (b.ms && d2 < shadowR2 && ns < b.capS) setInst(b.ms, ns++, x, y, z, sc, data[o + 4], 1, 1, 1, vt);
          // Trees close enough to throw a shadow into view are kept even when off screen.
          if (d > 70) { _sph.center.set(x, y + sp.height * sc * vt * 0.5, z); _sph.radius = sp.height * sc * vt * 0.75; if (!_frustum.intersectsSphere(_sph)) continue; }
          if (d2 < cut0 && b.m0 && n0 < b.cap0) setInst(b.m0, n0++, x, y, z, sc, data[o + 4], data[o + 5], data[o + 6], data[o + 7], vt);
          else if (d2 < cut1 && n1 < b.cap1) setInst(b.m1, n1++, x, y, z, sc, data[o + 4], data[o + 5], data[o + 6], data[o + 7], vt);
          else if (b.mi) setInst(b.mi, ni++, x, y, z, sc, data[o + 4], data[o + 5], data[o + 6], data[o + 7], vt);
        } else {
          if (d2 > smallRange * smallRange) continue;
          if (d2 > 400) { _sph.center.set(x, y, z); _sph.radius = sp.height * sc + 1; if (!_frustum.intersectsSphere(_sph)) continue; }
          if (b.m0 && d2 < 144 && n0 < b.cap0) setInst(b.m0, n0++, x, y, z, sc, data[o + 4], data[o + 5], data[o + 6], data[o + 7], vt);
          else if (n1 < b.cap1) setInst(b.m1, n1++, x, y, z, sc, data[o + 4], data[o + 5], data[o + 6], data[o + 7], vt);
        }
      }
      const commit = (meshes, n) => { for (const m of meshes || []) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } };
      commit(b.m0, n0); commit(b.m1, n1); commit(b.mi, ni); commit(b.ms, ns);
      if (b.isTree) { drawn.lod0 += n0; drawn.lod1 += n1; drawn.impostor += ni; } else drawn.small += n0 + n1;
      tris += n0 * sp.tris.lod0 + n1 * sp.tris.lod1 + ni * 2;
    }
    veg.drawn = drawn; veg.triangles = tris;
  }

  veg.update = (dt, t, w) => {
    shared.uVegTime.value = fin(t, 0) % 3600;
    const wind = w.wind || { x: 1, z: 0 };
    shared.uVegWind.value.set(fin(wind.x, 1), fin(wind.z, 0));
    rebucket(w.camera, false);
  };
  veg.forceUpdate = () => rebucket(world.camera, true);
  veg.dispose = () => {
    clearBuckets();
    for (const sp of species.values()) {
      if (!sp) continue;
      for (const p of sp.lod1) { p.material.dispose(); p.depth.dispose(); }
      if (sp.impostor) { sp.impostor.rt.dispose(); sp.impostor.geo.dispose(); sp.impostor.mat.dispose(); sp.impostor.proxyGeo.dispose(); sp.impostor.proxyMat.dispose(); sp.impostor.proxyDepth.dispose(); }
    }
    species.clear();
  };
  return veg;
}
