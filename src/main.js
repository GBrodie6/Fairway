// Fairway Next entry point.
import { createEngine } from './render/engine.js';
import { createWorld } from './render/world.js';
import { createLoop } from './core/loop.js';
import { loadSettings, readUrlParams } from './core/settings.js';
import { detectTier, readCaps } from './core/quality.js';
import { COURSE_IDS } from './course/courses.js';
import { TOD_ORDER } from './render/timeOfDay.js';
import { createDebugOverlay } from './ui/debug.js';
import { installHooks } from './tools/hooks.js';

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
  const app = { engine, loop, params, settings, caps, world: null, debug: null };

  const courseId = COURSE_IDS.includes(params.course) ? params.course : COURSE_IDS[0];
  const todId = TOD_ORDER.includes(params.tod) ? params.tod : 'morning';
  app.world = createWorld(engine, { courseId, todId, hole: params.hole || 1 });
  engine.listeners.resize.add(() => app.world && app.world.resize());

  app.setTimeOfDay = async (id) => { app.world.setTimeOfDay(id); };
  app.setCourse = async (id) => { app.world.setCourse(id); };
  app.setTier = (id) => engine.setTier(id);

  loop.add('world', (dt, t) => app.world.update(dt, t));
  loop.add('render', (dt, t, realDt) => engine.render(app.world.scene, app.world.camera, t, realDt));
  if (params.debug) {
    app.debug = createDebugOverlay(ui, { engine, loop });
    loop.add('debug', (dt, t, realDt) => app.debug.update(realDt), { profile: false });
  }

  const fw = installHooks(app);
  loop.start();
  // Two frames so the first real image is on screen before the boot veil lifts.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  bootEl.classList.add('hide');
  fw.ready = true;
}

boot().catch((err) => {
  console.error('[fairway] boot failed:', err);
  const msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = 'Something went wrong while starting. Please reload.';
});
