// Time-of-day presets. Angles are degrees. sunAz is a world compass bearing (0 = north = -Z,
// 90 = east = +X); each hole rotates it by its own routing so the light differs hole to hole.
// targetLuma is the mean display luma the auto exposure aims for (0..255).
export const TOD_ORDER = ['dawn', 'morning', 'midday', 'golden', 'dusk', 'night'];

export const TOD = Object.freeze({
  dawn: {
    id: 'dawn', label: 'Dawn', night: false,
    sunElev: 6, sunAz: 78, sunColor: [1.0, 0.66, 0.44], sunIntensity: 2.6,
    skyTint: [1.0, 0.86, 0.9], turbidity: 3.4, rayleigh: 1.5, mie: 0.012,
    ambient: 0.9, envIntensity: 0.95,
    fog: { density: 0.0034, haze: 0.00016, height: 26, color: [0.86, 0.8, 0.82], max: 0.9 },
    cloudCover: 0.42, cloudColor: [1.0, 0.82, 0.78], dew: 1.0, shafts: 0.55, stars: 0,
    grade: { contrast: 1.03, saturation: 1.02, tint: [1.02, 1.0, 0.99] },
    targetLuma: 150, exposure: [0.3, 12], hdri: 'dawn',
  },
  morning: {
    id: 'morning', label: 'Morning', night: false,
    sunElev: 24, sunAz: 104, sunColor: [1.0, 0.9, 0.78], sunIntensity: 3.6,
    skyTint: [1, 1, 1], turbidity: 2.4, rayleigh: 1.1, mie: 0.006,
    ambient: 1.0, envIntensity: 1.0,
    fog: { density: 0.0014, haze: 0.00009, height: 40, color: [0.78, 0.85, 0.93], max: 0.8 },
    cloudCover: 0.36, cloudColor: [1.0, 0.97, 0.94], dew: 0.6, shafts: 0.2, stars: 0,
    grade: { contrast: 1.04, saturation: 1.05, tint: [1.01, 1.0, 0.99] },
    targetLuma: 150, exposure: [0.2, 8], hdri: 'morning',
  },
  midday: {
    id: 'midday', label: 'Midday', night: false,
    sunElev: 61, sunAz: 172, sunColor: [1.0, 0.97, 0.92], sunIntensity: 4.2,
    skyTint: [1, 1, 1], turbidity: 2.0, rayleigh: 1.0, mie: 0.004,
    ambient: 1.0, envIntensity: 1.0,
    fog: { density: 0.0008, haze: 0.00007, height: 60, color: [0.74, 0.84, 0.95], max: 0.72 },
    cloudCover: 0.4, cloudColor: [1, 1, 1], dew: 0, shafts: 0, stars: 0,
    grade: { contrast: 1.05, saturation: 1.06, tint: [1, 1, 1] },
    targetLuma: 150, exposure: [0.15, 6], hdri: 'midday',
  },
  golden: {
    id: 'golden', label: 'Golden hour', night: false,
    sunElev: 12, sunAz: 262, sunColor: [1.0, 0.72, 0.42], sunIntensity: 3.2,
    skyTint: [1.0, 0.93, 0.86], turbidity: 3.0, rayleigh: 1.4, mie: 0.01,
    ambient: 0.9, envIntensity: 0.95,
    fog: { density: 0.0018, haze: 0.00013, height: 45, color: [0.93, 0.8, 0.68], max: 0.82 },
    cloudCover: 0.34, cloudColor: [1.0, 0.84, 0.66], dew: 0, shafts: 0.6, stars: 0,
    grade: { contrast: 1.05, saturation: 1.06, tint: [1.02, 1.0, 0.97] },
    targetLuma: 150, exposure: [0.25, 10], hdri: 'golden',
  },
  dusk: {
    id: 'dusk', label: 'Dusk', night: false,
    sunElev: 2.5, sunAz: 284, sunColor: [1.0, 0.5, 0.3], sunIntensity: 1.9,
    skyTint: [0.95, 0.82, 0.95], turbidity: 3.6, rayleigh: 1.8, mie: 0.014,
    ambient: 0.85, envIntensity: 0.9,
    fog: { density: 0.0024, haze: 0.00015, height: 36, color: [0.76, 0.66, 0.72], max: 0.86 },
    cloudCover: 0.38, cloudColor: [1.0, 0.68, 0.6], dew: 0, shafts: 0.5, stars: 0.15,
    grade: { contrast: 1.04, saturation: 1.04, tint: [1.01, 0.99, 1.01] },
    targetLuma: 150, exposure: [0.4, 20], hdri: 'dusk',
  },
  night: {
    id: 'night', label: 'Night', night: true,
    // The "sun" is the moon here: cool, dim, high.
    sunElev: 48, sunAz: 150, sunColor: [0.62, 0.74, 1.0], sunIntensity: 0.22,
    skyTint: [0.5, 0.62, 1.0], turbidity: 2.0, rayleigh: 1.0, mie: 0.004,
    ambient: 0.5, envIntensity: 0.5,
    fog: { density: 0.0012, haze: 0.0001, height: 40, color: [0.1, 0.14, 0.24], max: 0.7 },
    cloudCover: 0.25, cloudColor: [0.5, 0.58, 0.8], dew: 0.3, shafts: 0, stars: 1,
    grade: { contrast: 1.06, saturation: 0.82, tint: [0.92, 0.98, 1.1] },
    // Moonlight should read as night: a clearly darker frame with the ball and flag still legible.
    targetLuma: 62, exposure: [0.5, 60], hdri: 'night',
  },
});

export const todById = (id) => TOD[id] || TOD.midday;

// Luma acceptance bands used by the smoke gate.
export const LUMA_BANDS = Object.freeze({
  day: { min: 140, max: 160, maxClippedPct: 2 },
  night: { min: 50, max: 76, maxClippedPct: 2 },
});
export const bandFor = (todId) => (todById(todId).night ? LUMA_BANDS.night : LUMA_BANDS.day);
