// Fairway Next entry point.
import { createEngine } from './render/engine.js';
import { createWorld } from './render/world.js';
import { createAssets } from './render/assets.js';
import { createLoop } from './core/loop.js';
import { loadSettings, readUrlParams } from './core/settings.js';
import { detectTier, readCaps } from './core/quality.js';
import { COURSE_IDS } from './course/courses.js';
import { TOD_ORDER } from './render/timeOfDay.js';
import { createDebugOverlay } from './ui/debug.js';
import { installHooks } from './tools/hooks.js';
import { createGame } from './game/controller.js';
import { createUI } from './ui/ui.js';

async function boot() {
  const params = readUrlParams();
  const settings = loadSettings();
  const view = document.getElementById('view');
  const ui = document.getElementById('ui');
  const bootEl = document.getElementById('boot');

  const engine = createEngine({ container: view, tierId: 'low', renderScale: params.scale || 1 });
  const caps = readCaps(engine.renderer.getContext());
  const tierId = params.tier || (settings.tier !== 'auto' ? settings.tier : detectTier(caps));
  engine.setTier(tierId);

  const loop = createLoop({ timescale: params.timescale || 1 });
  const assets = createAssets(params.noassets ? { enabled: false } : {});
  const app = { engine, loop, params, settings, caps, assets, world: null, debug: null };

  const courseId = COURSE_IDS.includes(params.course) ? params.course : COURSE_IDS[0];
  const todId = TOD_ORDER.includes(params.tod) ? params.tod : 'morning';
  app.world = createWorld(engine, { courseId, todId, hole: params.hole || 1, assets });
  engine.listeners.resize.add(() => app.world && app.world.resize());

  app.setTimeOfDay = async (id) => { app.world.setTimeOfDay(id); };
  app.setCourse = async (id, hole = 1) => { await app.world.loadHole(id, hole); };
  // A tier change rebuilds the world: shadow cascades, material variants, and instance
  // counts are all baked into it.
  app.setTier = async (id) => {
    if (id === engine.tier.id) return;
    const prev = app.world;
    engine.setTier(id);
    const next = createWorld(engine, { courseId: prev.courseId, todId: prev.todId, hole: prev.hole, assets });
    if (prev.wind) next.wind = { ...prev.wind };
    await next.loadHole(prev.courseId, prev.hole);
    app.world = next;
    prev.dispose();
    for (const fn of app.onWorld || []) fn(next);
  };

  await app.world.loadHole(courseId, params.hole || 1);

  app.game = createGame(app);
  app.onWorld = [() => { app.game.onWorldChanged(); if (app.ui) app.ui.applySettings(); }];
  app.ui = createUI(app);
  app.ui.applySettings();

  // Order matters: the game advances the ball, the rig follows it, the world animates, then
  // the HUD reads the settled state and the frame renders.
  loop.add('game', (dt) => app.game.update(dt));
  loop.add('camera', (dt) => { if (app.world.rig.enabled) app.world.rig.update(dt); });
  loop.add('world', (dt, t) => app.world.update(dt, t));
  loop.add('ui', (dt) => app.ui.update(dt), { profile: false });
  loop.add('render', (dt, t, realDt) => engine.render(app.world.scene, app.world.camera, t, realDt));
  if (params.debug) {
    app.debug = createDebugOverlay(ui, { engine, loop, getExtra: () => `terrain build ${app.world.buildMs.toFixed(0)} ms  terrain tris ${(app.world.terrainView.triangles / 1000).toFixed(0)}k\ntrees ${app.world.vegetation.counts.trees} (lod0 ${app.world.vegetation.drawn.lod0} lod1 ${app.world.vegetation.drawn.lod1} impostor ${app.world.vegetation.drawn.impostor})  plants ${app.world.vegetation.drawn.small}/${app.world.vegetation.counts.plants}  veg tris ${(app.world.vegetation.triangles / 1000).toFixed(0)}k\n  assets ${(assets.stats.bytes / 1048576).toFixed(1)} MB in ${assets.stats.requests} req` });
    loop.add('debug', (dt, t, realDt) => app.debug.update(realDt), { profile: false });
  }

  const fw = installHooks(app);
  loop.start();
  // Two frames so the first real image is on screen before the boot veil lifts.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  bootEl.classList.add('hide');
  fw.ready = true;
  // A round can start straight from the URL (used by the QA bot and for shared links),
  // otherwise the main menu shows over the course.
  if (params.mode) await app.ui.screens.startQuick({ courseId, mode: params.mode, holes: params.holes || 9, startHole: params.hole || 1, tod: todId, seed: params.seed });
  else app.ui.screens.menu();
  // The heavy assets arrive after first paint.
  app.world.whenSettled().then(() => { fw.settled = true; });
}

boot().catch((err) => {
  console.error('[fairway] boot failed:', err);
  const msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = 'Something went wrong while starting. Please reload.';
});
