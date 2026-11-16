// Quality tiers. Every renderer subsystem reads its budget from the active tier.
// Budgets (draw calls, triangles) are the targets the perf report checks against.
export const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];

export const TIERS = Object.freeze({
  low: {
    id: 'low', label: 'Low',
    pixelRatioCap: 1.0, msaa: 0,
    shadows: { enabled: true, cascades: 1, size: 1024, far: 70, radius: 2 },
    ao: false, aoSamples: 0, bloom: false, shafts: false, dof: false, shimmer: false,
    texSize: 512, anisotropy: 4,
    treeDensity: 0.45, propDensity: 0.5, treeLod: { near: 0, mid: 55, maxLod0: 0, maxLod1: 22, outerRing: 140 },
    grassRadius: 7, grassBlades: 9000,
    terrainStepNear: 2, terrainLodScale: 0.6,
    drawDistance: 1100, waterQuality: 0, cloudSteps: 0, crowd: 60,
    budget: { drawCalls: 140, triangles: 220000 },
  },
  medium: {
    id: 'medium', label: 'Medium',
    pixelRatioCap: 1.5, msaa: 2,
    shadows: { enabled: true, cascades: 2, size: 1536, far: 130, radius: 2.5 },
    ao: false, aoSamples: 0, bloom: true, shafts: false, dof: false, shimmer: true,
    texSize: 512, anisotropy: 8,
    treeDensity: 0.7, propDensity: 0.8, treeLod: { near: 0, mid: 85, maxLod0: 0, maxLod1: 40, outerRing: 240 },
    grassRadius: 10, grassBlades: 22000,
    terrainStepNear: 1, terrainLodScale: 0.8,
    drawDistance: 1600, waterQuality: 1, cloudSteps: 1, crowd: 140,
    budget: { drawCalls: 220, triangles: 500000 },
  },
  high: {
    id: 'high', label: 'High',
    pixelRatioCap: 2.0, msaa: 4,
    shadows: { enabled: true, cascades: 3, size: 2048, far: 220, radius: 3 },
    ao: true, aoSamples: 8, bloom: true, shafts: true, dof: true, shimmer: true,
    texSize: 1024, anisotropy: 16,
    treeDensity: 1.0, propDensity: 1.0, treeLod: { near: 38, mid: 130, maxLod0: 8, maxLod1: 70, outerRing: 340 },
    grassRadius: 14, grassBlades: 48000,
    terrainStepNear: 1, terrainLodScale: 1.0,
    drawDistance: 2400, waterQuality: 2, cloudSteps: 2, crowd: 260,
    budget: { drawCalls: 320, triangles: 1100000 },
  },
  ultra: {
    id: 'ultra', label: 'Ultra',
    pixelRatioCap: 2.5, msaa: 4,
    shadows: { enabled: true, cascades: 4, size: 2048, far: 320, radius: 3.5 },
    ao: true, aoSamples: 16, bloom: true, shafts: true, dof: true, shimmer: true,
    texSize: 2048, anisotropy: 16,
    treeDensity: 1.3, propDensity: 1.0, treeLod: { near: 55, mid: 190, maxLod0: 16, maxLod1: 110, outerRing: 480 },
    grassRadius: 18, grassBlades: 90000,
    terrainStepNear: 1, terrainLodScale: 1.3,
    drawDistance: 3200, waterQuality: 2, cloudSteps: 2, crowd: 400,
    budget: { drawCalls: 420, triangles: 2000000 },
  },
});

export const tierById = (id) => TIERS[id] || TIERS.medium;

/**
 * Pick a tier from device capabilities. Pure, so it is unit tested.
 * caps: { gpu (unmasked renderer string), mobile, memoryGb, cores, maxTextureSize, webgl2, pixels }
 */
export function detectTier(caps = {}) {
  const gpu = String(caps.gpu || '').toLowerCase();
  if (caps.webgl2 === false) return 'low';
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(gpu)) return 'low';
  const mem = Number.isFinite(caps.memoryGb) ? caps.memoryGb : 4;
  const cores = Number.isFinite(caps.cores) ? caps.cores : 4;
  if ((caps.maxTextureSize || 4096) < 4096) return 'low';
  if (caps.mobile) {
    // Recent flagship phone GPUs handle medium. Everything else starts on low.
    const strong = /apple a1[5-9]|apple a[2-9]\d|apple m\d|adreno \(tm\) (7[3-9]\d|8\d\d)|adreno (7[3-9]\d|8\d\d)|mali-g7[1-9]\d|mali-g[89]\d\d|immortalis|xclipse 9/.test(gpu);
    const appleGeneric = /apple gpu/.test(gpu);
    if ((strong || appleGeneric) && mem >= 4 && cores >= 6) return 'medium';
    return 'low';
  }
  if (/rtx|radeon rx (6[6-9]|7|8|9)\d\d|rx (6[6-9]|7|8|9)\d\d\d|arc a[57]|apple m[2-9] (pro|max|ultra)|apple m[3-9]/.test(gpu)) {
    return mem >= 8 ? 'ultra' : 'high';
  }
  if (/gtx (9[6-9]|10[5-9]|16)\d|geforce|radeon rx|radeon pro|apple m1|apple m2|arc|quadro|iris xe|iris\(r\) xe/.test(gpu)) return 'high';
  if (/intel|uhd|hd graphics|iris|radeon|mali|adreno|powervr/.test(gpu)) return mem >= 8 && cores >= 8 ? 'medium' : 'low';
  // Unknown GPU string (many browsers mask it): judge by the machine.
  if (mem >= 8 && cores >= 8) return 'high';
  if (mem >= 4 && cores >= 4) return 'medium';
  return 'low';
}

export function readCaps(gl) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  let gpu = '';
  let maxTextureSize = 4096;
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    }
  } catch (e) { /* masked or unavailable */ }
  const ua = String(nav.userAgent || '');
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /macintosh/i.test(ua));
  return {
    gpu: String(gpu || ''),
    mobile,
    memoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    maxTextureSize,
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
  };
}
