// Course registry. Names are invented for this game. Each theme drives the layout generator,
// the terrain shaper, the vegetation mix, the backdrop, and the wind profile.
// par sequences each total 72 over 18 holes.
export const COURSES = Object.freeze([
  {
    id: 'parkland', name: 'Alderwick Park', flagship: true, seed: 0x51a7,
    blurb: 'Tree-lined fairways, quiet ponds, and big rolling greens.',
    pars: [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4],
    wind: { min: 2, max: 11, gustiness: 0.25 },
  },
  {
    id: 'links', name: 'Saltmarrow Links', flagship: true, seed: 0x7c31,
    blurb: 'Dunes, pot bunkers, firm turf, and the sea wind.',
    pars: [4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4],
    wind: { min: 8, max: 24, gustiness: 0.55 },
  },
  {
    id: 'desert', name: 'Cinder Mesa', flagship: true, seed: 0x2e95,
    blurb: 'Green ribbons through red rock and open desert.',
    pars: [4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4, 4],
    wind: { min: 3, max: 15, gustiness: 0.35 },
  },
  {
    id: 'alpine', name: 'Larchfall Summit', flagship: false, seed: 0x9b44,
    blurb: 'Big elevation changes among conifers and snow peaks.',
    pars: [4, 4, 5, 3, 4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4],
    wind: { min: 3, max: 16, gustiness: 0.45 },
  },
  {
    id: 'tropical', name: 'Coralline Bay', flagship: false, seed: 0x3d18,
    blurb: 'Palms, white sand, and lagoons beside a warm sea.',
    pars: [5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4],
    wind: { min: 4, max: 17, gustiness: 0.4 },
  },
]);

export const COURSE_IDS = COURSES.map((c) => c.id);
export const courseById = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
export const coursePar = (c) => c.pars.reduce((a, b) => a + b, 0);
