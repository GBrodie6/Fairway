// Time-of-day presets. Angles are degrees. sunAz is a world compass bearing (0 = north = -Z,
// 90 = east = +X); each hole rotates it by its own routing so the light differs hole to hole.
// targetLuma is the mean display luma the auto exposure aims for (0..255).
export const TOD_ORDER = ['dawn', 'morning', 'midday', 'golden', 'dusk', 'night'];

export const TOD = Object.freeze({
  dawn: {
    id: 'dawn', label: 'Dawn', night: false,
    sunElev: 7, sunAz: 78, sunColor: [1.0, 0.68, 0.46], sunIntensity: 3.6,
    skyTint: [1.0, 0.88, 0.92], turbidity: 2.6, rayleigh: 1.5, mie: 0.005, skyGain: 0.24, cloudGain: 0.5,
    ambient: 0.9, envIntensity: 1.3,
    fog: { density: 0.0011, haze: 0.00006, height: 22, color: [0.86, 0.8, 0.82], max: 0.9 },
    cloudCover: 0.42, cloudColor: [1.0, 0.72, 0.6], dew: 1.0, shafts: 0.55, stars: 0,
    grade: { contrast: 1.03, saturation: 1.02, tint: [1.02, 1.0, 0.99] },
    targetLuma: 150, exposure: [0.3, 12], hdri: 'dawn',
  },
  morning: {
    id: 'morning', label: 'Morning', night: false,
    sunElev: 24, sunAz: 104, sunColor: [1.0, 0.9, 0.78], sunIntensity: 3.6,
    skyTint: [1, 1, 1], turbidity: 2.4, rayleigh: 1.1, mie: 0.006,
    ambient: 1.0, envIntensity: 1.0,
    fog: { density: 0.00034, haze: 0.000035, height: 40, color: [0.78, 0.85, 0.93], max: 0.8 },
    cloudCover: 0.36, cloudColor: [1.0, 0.97, 0.94], dew: 0.6, shafts: 0.2, stars: 0,
    grade: { contrast: 1.04, saturation: 1.05, tint: [1.01, 1.0, 0.99] },
    targetLuma: 150, exposure: [0.2, 8], hdri: 'morning',
  },
  midday: {
    id: 'midday', label: 'Midday', night: false,
    sunElev: 61, sunAz: 172, sunColor: [1.0, 0.97, 0.92], sunIntensity: 4.2,
    skyTint: [1, 1, 1], turbidity: 2.0, rayleigh: 1.0, mie: 0.004,
    ambient: 1.0, envIntensity: 1.0,
    fog: { density: 0.0002, haze: 0.000028, height: 60, color: [0.74, 0.84, 0.95], max: 0.72 },
    cloudCover: 0.4, cloudColor: [1, 1, 1], dew: 0, shafts: 0, stars: 0,
    grade: { contrast: 1.05, saturation: 1.06, tint: [1, 1, 1] },
    targetLuma: 150, exposure: [0.15, 6], hdri: 'midday',
  },
  golden: {
    id: 'golden', label: 'Golden hour', night: false,
    sunElev: 12, sunAz: 262, sunColor: [1.0, 0.72, 0.42], sunIntensity: 4.8,
    skyTint: [1.0, 0.93, 0.86], turbidity: 2.6, rayleigh: 1.4, mie: 0.006, skyGain: 0.24, cloudGain: 0.55,
    ambient: 0.9, envIntensity: 0.9,
    fog: { density: 0.00026, haze: 0.00004, height: 45, color: [0.93, 0.8, 0.68], max: 0.7 },
    cloudCover: 0.34, cloudColor: [1.0, 0.76, 0.5], dew: 0, shafts: 0.6, stars: 0,
    grade: { contrast: 1.05, saturation: 1.08, tint: [1.04, 1.0, 0.95] },
    targetLuma: 150, exposure: [0.25, 10], hdri: 'golden',
  },
  dusk: {
    id: 'dusk', label: 'Dusk', night: false,
    sunElev: 3.5, sunAz: 284, sunColor: [1.0, 0.52, 0.32], sunIntensity: 3.0,
    skyTint: [0.95, 0.82, 0.95], turbidity: 2.8, rayleigh: 1.8, mie: 0.004, skyGain: 0.3, cloudGain: 0.42,
    ambient: 0.85, envIntensity: 1.7,
    fog: { density: 0.0004, haze: 0.00005, height: 34, color: [0.76, 0.66, 0.72], max: 0.72 },
    cloudCover: 0.38, cloudColor: [1.0, 0.5, 0.42], dew: 0, shafts: 0.5, stars: 0.15,
    grade: { contrast: 1.05, saturation: 1.1, tint: [1.03, 0.98, 1.02] },
    targetLuma: 150, exposure: [0.4, 20], hdri: 'dusk',
  },
  night: {
    id: 'night', label: 'Night', night: true,
    // The "sun" is the moon here: cool, dim, high.
    sunElev: 48, sunAz: 150, sunColor: [0.62, 0.74, 1.0], sunIntensity: 0.22,
    skyTint: [0.62, 0.7, 0.95], turbidity: 2.0, rayleigh: 1.0, mie: 0.004,
    ambient: 0.5, envIntensity: 0.5,
    fog: { density: 0.0004, haze: 0.00004, height: 40, color: [0.1, 0.14, 0.24], max: 0.7 },
    cloudCover: 0.25, cloudColor: [0.5, 0.58, 0.8], dew: 0.3, shafts: 0, stars: 1,
    // Under moonlight the eye loses color (rod vision): strongly desaturated and shifted blue.
    grade: { contrast: 1.08, saturation: 0.48, tint: [0.88, 0.97, 1.14] },
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
