// Game controller. A small state machine over the round:
//   intro (flyover) -> aim -> flight -> settle -> (next turn | hole summary) -> next hole
// It owns no rendering and no DOM. It drives the world, the camera rig, the ball view, and
// the overlays, and tells the UI and audio what happened through events.
import { createRound, beginHole, applyShot, nextTurn, completeHole, holeFinished, standings, currentHoleIndex, parOf, playerDone } from './round.js';
import { predictShot, solvePower, solvePutt, simulatePutt, puttCeiling, dropPoint, aiPlan, chooseTarget, simulateFrom } from './planner.js';
import { computeLaunch, suggestClub, SHOT_TYPES, shotTypeById, BASE_PROFILE, dispersion, nominalCarry } from '../physics/shot.js';
import { simulateShot, samplePath, BALL_RADIUS } from '../physics/ball.js';
import { CLUBS, PUTTER } from '../physics/clubs.js';
import { SURFACES, SURFACE_NAMES } from '../physics/surfaces.js';
import { createWind, rollWind, windRelative } from '../physics/wind.js';
import { createRng } from '../core/rng.js';
import { clamp, headingTo, wrapAngle, DEG, YARD, MPH } from '../core/math.js';
import { clampAim } from '../physics/aim.js';
import { scoreName } from './scoring.js';
import { DECAL } from '../render/decals.js';
import { courseById } from '../course/courses.js';
import { fin } from '../core/guards.js';

export function createGame(app) {
  const listeners = new Set();
  const emit = (type, data) => { for (const fn of listeners) { try { fn(type, data); } catch (e) { console.error('[fairway] listener for', type, e); } } };
  const W = () => app.world;
  const state = {
    phase: 'menu', round: null, turn: 0, ball: { x: 0, z: 0 }, lie: SURFACES.TEE, club: CLUBS[0], shotType: SHOT_TYPES.FULL,
    aim: 0, aimRef: 0, target: null, prediction: null, putt: null, distToPin: 0, message: '', hazard: null,
    wind: null, windInfo: { speedMph: 0, dir: 0 }, clock: 0, shot: null, lastShot: null, profile: BASE_PROFILE, replaying: false,
    busy: false, holeSummary: null, fast: false,
  };
  const game = { state, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const tmp = { x: 0, y: 0, z: 0 }, wv = { x: 0, z: 0 };
  let rng = createRng(1), holdTimer = 0, afterHold = null, apexShown = false, landShown = false, eventIdx = 0;
  const windAt = (t, h, out) => (state.wind ? state.wind.sample(t, h, out) : out);
  const isHuman = () => state.round && state.round.players[state.turn].kind === 'human';
  const motionReduced = () => (app.motionReduced ? app.motionReduced() : !!app.settings.reducedMotion);
  const pinDist = (x, z) => Math.hypot(W().terrain.pin.x - x, W().terrain.pin.z - z);

  function setPhase(p) { state.phase = p; emit('phase', p); }

  // --- starting and loading ---
  game.startRound = async (opts = {}) => {
    state.round = createRound(opts);
    state.profile = opts.profile || BASE_PROFILE;
    state.fast = !!opts.fast;
    rng = createRng(state.round.seed ^ 0xa53c9);
    state.decals = {};
    emit('roundStart', state.round);
    await loadHole();
    return state.round;
  };
  game.resumeRound = async (round, opts = {}) => {
    state.round = round; state.profile = opts.profile || BASE_PROFILE; state.fast = !!opts.fast;
    rng = createRng((round.seed ^ 0xa53c9) + round.hole * 7919);
    state.decals = {};
    emit('roundStart', state.round);
    await loadHole();
    return round;
  };

  async function loadHole() {
    const r = state.round;
    state.busy = true;
    setPhase('loading');
    const holeIdx = currentHoleIndex(r);
    const w = W();
    if (w.todId !== r.tod) w.setTimeOfDay(r.tod);
    await w.loadHole(r.courseId, holeIdx + 1);
    const t = w.terrain;
    // Wind for this hole: seeded by the round and the hole, so a shared round sees the same wind.
    const wr = createRng((r.seed * 31 + holeIdx * 977) >>> 0);
    const spec = rollWind(wr, courseById(r.courseId).wind);
    state.wind = createWind(spec);
    state.windInfo = { speedMph: spec.speedMph, dir: spec.dir };
    state.wind.vector(wv);
    w.wind = { x: wv.x, z: wv.z };
    beginHole(r, t.tee);
    w.decals.set(state.decals[holeIdx] || []);
    w.overlays.loadHole();
    w.greenProps.setFlagVisible(true);
    w.ball.clearTrace();
    w.ball.place(t.tee.x, t.heightAt(t.tee.x, t.tee.z) + BALL_RADIUS, t.tee.z);
    state.busy = false;
    emit('hole', { index: holeIdx, number: holeIdx + 1, par: parOf(r), yards: t.hole.yards });
    if (!state.fast && !motionReduced() && r.mode !== 'range') {
      setPhase('intro');
      w.rig.set('flyover', { duration: 6 });
    } else beginTurn();
  }
  game.skipIntro = () => { if (state.phase === 'intro') beginTurn(); };

  // --- a turn ---
  function beginTurn() {
    const r = state.round, w = W(), t = w.terrain;
    const who = nextTurn(r);
    if (who < 0) return finishHole();
    state.turn = who;
    const st = r.state[who];
    state.ball = { x: st.x, z: st.z }; state.lie = st.lie;
    const p = r.players[who];
    w.ball.setColor(p.ball);
    w.ball.clearTrace();
    w.ball.place(st.x, t.heightAt(st.x, st.z) + BALL_RADIUS, st.z);
    w.ball.spin.rate = 0;
    state.distToPin = pinDist(st.x, st.z);
    const onGreen = st.lie === SURFACES.GREEN;
    // Default choices: aim at a sensible target with the club that reaches it.
    state.target = onGreen ? { x: t.pin.x, z: t.pin.z } : chooseTarget(t, state.ball, st.lie, state.profile);
    const dTarget = Math.hypot(state.target.x - st.x, state.target.z - st.z);
    if (onGreen) { state.club = PUTTER; state.shotType = SHOT_TYPES.PUTT; }
    else {
      const chip = !state.target.layup && dTarget < 30 && st.lie !== SURFACES.BUNKER;
      state.shotType = chip ? SHOT_TYPES.CHIP : SHOT_TYPES.FULL;
      state.club = chip ? CLUBS.find((c) => c.id === (dTarget < 14 ? 'SW' : 'PW')) : suggestClub(dTarget + (t.heightAt(state.target.x, state.target.z) - t.heightAt(st.x, st.z)) * 0.9, { lie: st.lie, profile: state.profile }).club;
    }
    state.aimRef = headingTo(st.x, st.z, state.target.x, state.target.z);
    state.aim = state.aimRef;
    state.putt = null;
    computeIdeal();
    // Default to a club that reaches with some margin: step up while the shot needs more
    // than about 92 percent of a full swing.
    if (!onGreen && state.shotType.id === 'full' && !state.target.layup) {
      const allowed = CLUBS.filter((c) => !c.putter && !(c.id === 'DR' && st.lie !== SURFACES.TEE) && !(c.kind === 'wood' && (st.lie === SURFACES.DEEP_ROUGH || st.lie === SURFACES.BUNKER || st.lie === SURFACES.WETLAND)));
      for (let guard = 0; guard < 3 && state.idealPower > 0.92; guard++) {
        const i = allowed.indexOf(state.club);
        if (i <= 0) break;
        state.club = allowed[i - 1];
        computeIdeal();
      }
    }
    // The flag comes out for short putts.
    w.greenProps.setFlagVisible(!(onGreen && state.distToPin < 7));
    w.grassCenter = null;
    refresh();
    w.rig.resetLook();
    w.rig.set('address', addressCtx());
    if (state.fast) w.rig.cut = true;
    emit('turn', { player: who, human: isHuman() });
    if (isHuman()) setPhase('aim');
    else { setPhase('ai'); holdTimer = state.fast ? 0.05 : 1.1; afterHold = playAi; }
  }
  const addressCtx = () => ({ x: state.ball.x, z: state.ball.z, aim: state.aim, putt: state.club.putter, distance: state.distToPin });

  // Recompute the prediction and overlays for the current aim, club, and shot type.
  function refresh() {
    const w = W(), t = w.terrain;
    if (state.club.putter) {
      // The read is solved once per ball position; aim changes only re-roll the preview.
      const key = `${state.ball.x.toFixed(3)},${state.ball.z.toFixed(3)},${t.pin.x},${t.pin.z}`;
      if (!state.puttSolve || state.puttSolve.key !== key) state.puttSolve = { key, sol: solvePutt(t, state.ball, t.pin) };
      const sol = state.puttSolve.sol;
      const ceil = puttCeiling(sol.distance, sol.speed);
      // The line drawn is for the aim the player has now, at the pace that would reach the hole.
      const r = simulatePutt(t, state.ball, state.aim, sol.speed);
      state.putt = { ...sol, ceiling: ceil, idealPower: clamp(sol.speed / ceil, 0, 1), aimOffsetDeg: wrapAngle(state.aim - sol.heading) / DEG };
      state.prediction = r;
      state.hazard = null;
      w.overlays.showPutt({ path: r.points });
    } else {
      const power = game.suggestedPower();
      const r = predictShot(t, { x: state.ball.x, z: state.ball.z, lie: state.lie, club: state.club, shotType: state.shotType, aim: state.aim, power, profile: state.profile }, windAt, state.clock);
      state.prediction = r; state.putt = null;
      const wRel = windRelative(state.wind, state.aim, state.clock);
      const disp = dispersion(state.club, state.lie, { windMps: Math.hypot(wRel.along, wRel.cross), profile: state.profile, shotType: state.shotType });
      w.overlays.showAim({ from: state.ball, aim: state.aim, prediction: r, disp });
      state.hazard = w.overlays.hazard;
    }
    emit('aim', null);
  }
  // Power that sends the ball to the target with the current club, shot type, lie, and wind.
  // Solved once per club or shot-type change (not on every aim drag) and cached.
  function computeIdeal() {
    if (state.club.putter || !state.target) { state.idealPower = 0.5; return; }
    // Solve for where the ball stops, not where it lands: with only part of the roll allowed
    // for, approaches to firm or downhill greens ran 20 yards past the pin in play tests.
    state.idealPower = solvePower(W().terrain, { x: state.ball.x, z: state.ball.z, lie: state.lie, club: state.club, shotType: state.shotType, aim: state.aimRef, profile: state.profile }, windAt, state.clock, state.target, 'end');
  }
  game.suggestedPower = () => {
    if (state.club.putter) return state.putt ? state.putt.idealPower : 0.5;
    return state.idealPower ?? 0.8;
  };

  // --- player input (all guarded: ignored outside the aim phase) ---
  game.setAim = (heading) => {
    if (state.phase !== 'aim' || !Number.isFinite(heading)) return;
    state.aim = clampAim(heading, state.aimRef, state.club.putter ? 35 : 100);
    W().rig.ctx = addressCtx();
    refresh();
  };
  game.nudgeAim = (deltaRad) => game.setAim(state.aim + fin(deltaRad));
  // The clubs the current lie allows, longest first (the club list in the HUD shows these).
  game.clubChoices = () => {
    if (state.club.putter && state.lie === SURFACES.GREEN) return [PUTTER];
    const list = CLUBS.filter((c) => !c.putter && !(c.id === 'DR' && state.lie !== SURFACES.TEE));
    return state.lie === SURFACES.FRINGE || state.lie === SURFACES.GREEN ? [...list, PUTTER] : list;
  };
  game.selectClub = (delta) => {
    if (state.phase !== 'aim' || state.club.putter && state.lie === SURFACES.GREEN) return;
    const allow = game.clubChoices();
    let i = allow.indexOf(state.club);
    if (i < 0) i = 0;
    pickClub(allow[clamp(i + Math.sign(delta), 0, allow.length - 1)]);
  };
  game.setClub = (id) => {
    if (state.phase !== 'aim' || state.club.putter && state.lie === SURFACES.GREEN) return;
    const c = game.clubChoices().find((x) => x.id === id);
    if (c && c !== state.club) pickClub(c);
  };
  function pickClub(club) {
    state.club = club;
    if (state.club.putter) state.shotType = SHOT_TYPES.PUTT; else if (state.shotType.id === 'putt') state.shotType = SHOT_TYPES.FULL;
    if (state.shotType.wedgeOnly && state.club.kind !== 'wedge') state.shotType = SHOT_TYPES.FULL;
    W().rig.ctx = addressCtx();
    computeIdeal();
    refresh();
    emit('club', state.club);
  }
  game.setShotType = (id) => {
    if (state.phase !== 'aim' || state.club.putter) return;
    const st = shotTypeById(id);
    if (st.id === 'putt' || (st.wedgeOnly && state.club.kind !== 'wedge')) return;
    state.shotType = st;
    computeIdeal();
    refresh();
    emit('club', state.club);
  };
  game.shotTypes = () => (state.club.putter ? [] : Object.values(SHOT_TYPES).filter((s) => s.id !== 'putt' && (!s.wedgeOnly || state.club.kind === 'wedge')));

  // --- the shot ---
  game.swing = (swing) => {
    if (state.phase !== 'aim' || !swing || !Number.isFinite(swing.power)) return false;
    launchShot(swing, state.aim, state.club, state.shotType, 1);
    return true;
  };

  function playAi() {
    const r = state.round, p = r.players[state.turn], t = W().terrain;
    const plan = aiPlan(t, state.ball, state.lie, { skill: p.skill, rng, windAt, t0: state.clock });
    state.club = plan.club; state.shotType = plan.shotType; state.aim = plan.aim;
    if (plan.club.putter) state.putt = { ceiling: plan.puttCeiling };
    emit('club', state.club);
    launchShot(plan.swing, plan.aim, plan.club, plan.shotType, state.fast ? 1 : 2.4);
  }

  function launchShot(swing, aim, club, shotType, speedUp) {
    const w = W(), t = w.terrain;
    const from = { x: state.ball.x, z: state.ball.z, lie: state.lie };
    let launch, result;
    if (club.putter) {
      const ceil = (state.putt && state.putt.ceiling) || puttCeiling(state.distToPin);
      const tq = clamp(swing.tempoQuality ?? 1, 0, 1);
      launch = { x: from.x, z: from.z, putt: true, speed: clamp(swing.power, 0, 1) * ceil * (0.97 + 0.03 * tq), heading: aim + (swing.face || 0) * 0.45 * DEG * state.profile.putting, vAngle: 0, spin: 0, axisTilt: 0 };
      result = simulateShot(launch, t.env({ windAt, t0: state.clock }));
    } else {
      launch = computeLaunch(swing, { club, shotType, lie: from.lie, aim, x: from.x, z: from.z, profile: state.profile, lieRoll: rng.range(-1, 1) });
      result = simulateShot(launch, t.env({ windAt, t0: state.clock }));
    }
    // hold: the first frame after launch shows the ball still at rest with the club at impact.
    state.shot = { from, swing, club, shotType, launch, result, t: 0, speedUp, player: state.turn, landingCam: false, hold: 1 };
    apexShown = false; landShown = false; eventIdx = 0;
    w.overlays.hide();
    w.ball.clearTrace();
    // Impact: debris from the lie, a divot from turf, tracks in sand, and a little camera kick.
    const gy = t.heightAt(from.x, from.z);
    const fx = Math.sin(launch.heading), fz = -Math.cos(launch.heading);
    if (!club.putter) {
      w.ball.burstFor(from.lie, from.x, gy, from.z, { count: 10 + Math.round(swing.power * 16), speed: 2 + swing.power * 3, dirX: fx, dirZ: fz });
      const turf = from.lie === SURFACES.FAIRWAY || from.lie === SURFACES.FIRST_CUT || from.lie === SURFACES.ROUGH || from.lie === SURFACES.DEEP_ROUGH;
      if (turf && club.kind !== 'wood' && swing.power > 0.35) addDecal(DECAL.DIVOT, from.x + fx * 0.12, from.z + fz * 0.12, -launch.heading, 0.8 + swing.power * 0.5);
      if (from.lie === SURFACES.BUNKER) { w.decals.addBunkerVisit(from.x, from.z, launch.heading); saveDecals(); }
      w.rig.shake(0.02 + swing.power * 0.04);
    }
    // Spin visualization: backspin axis with the launch tilt.
    w.ball.spin.axis.set(-fz * Math.cos(launch.axisTilt || 0), -Math.sin(launch.axisTilt || 0), fx * Math.cos(launch.axisTilt || 0)).normalize();
    w.ball.spin.rate = club.putter ? 0 : -Math.min(launch.spin, 260);
    const landing = result.carryPoint || result.end;
    // A human full shot holds the address view for half a second, so the club's follow-through
    // is seen with the ball leaving; then the camera chases the ball.
    if (club.putter) w.rig.set('green', {});
    else if (isHuman() && !state.fast && !motionReduced()) state.shot.camAt = 0.5;
    else w.rig.set('follow', { dirX: fx, dirZ: fz });
    w.ball.hideMarkers();
    // The launch line: from the ball, rising along the launch direction.
    w.overlays.showLaunch({ x: from.x, y: gy + 0.021, z: from.z, putt: !!club.putter }, launch.heading, launch.vAngle || 0, club.putter ? 6 : 34);
    if (!club.putter && result.carry > 25) w.ball.showLanding(landing.x, t.inBounds(landing.x, landing.z, 1) ? t.heightAt(landing.x, landing.z) : landing.y, landing.z, 1.2 + result.carry * 0.008);
    emit('swing', { swing, club, putt: !!club.putter, lie: from.lie, player: state.turn, human: isHuman() });
    setPhase('flight');
  }

  function addDecal(type, x, z, rot, scale) { W().decals.add(type, x, z, rot, scale); saveDecals(); }
  function saveDecals() { state.decals[currentHoleIndex(state.round)] = W().decals.snapshot(); }

  // --- per-frame ---
  game.update = (dt) => {
    const w = W();
    if (!state.round || !w.terrain) return;
    state.clock += dt;
    if (state.phase === 'intro') { if (w.rig.flyoverDone()) beginTurn(); return; }
    if (holdTimer > 0) { holdTimer -= dt; if (holdTimer <= 0 && afterHold) { const f = afterHold; afterHold = null; f(); } }
    if (state.phase !== 'flight' || !state.shot) return;
    const sh = state.shot, r = sh.result, t = w.terrain;
    if (sh.hold > 0) { sh.hold--; return; }
    if (sh.camAt != null && sh.t >= sh.camAt) { sh.camAt = null; w.rig.set('follow', { dirX: Math.sin(sh.launch.heading), dirZ: -Math.cos(sh.launch.heading) }); }
    const prevT = sh.t;
    sh.t += dt * sh.speedUp;
    samplePath(r.points, sh.t, tmp);
    w.rig.ballVel.set((tmp.x - w.ball.position.x) / Math.max(dt, 1e-4), (tmp.y - w.ball.position.y) / Math.max(dt, 1e-4), (tmp.z - w.ball.position.z) / Math.max(dt, 1e-4));
    w.ball.place(tmp.x, tmp.y, tmp.z);
    w.rig.ballPos.copy(w.ball.position);
    w.grassCenter = w.ball.position;
    const airborne = !sh.club.putter && sh.t < r.hang;
    if (airborne) w.ball.addTrace(tmp.x, tmp.y, tmp.z);
    // Apex marker once the ball starts down.
    if (!apexShown && !sh.club.putter && w.rig.ballVel.y < 0 && sh.t > 0.3 && r.apex > 4) { apexShown = true; w.ball.showApex(tmp.x, tmp.y, tmp.z); emit('apex', { height: r.apex }); }
    // Long shots cut to a camera waiting near the landing point.
    if (!sh.landingCam && !sh.club.putter && r.carry > 120 && sh.t > r.hang * 0.6 && !motionReduced() && !state.fast) {
      sh.landingCam = true;
      const l = r.carryPoint || r.end;
      w.rig.set('landing', { landing: { x: l.x, y: t.inBounds(l.x, l.z, 1) ? t.heightAt(l.x, l.z) : l.y, z: l.z }, dirX: Math.sin(sh.launch.heading), dirZ: -Math.cos(sh.launch.heading) });
    }
    // Physics events that fell inside this frame.
    while (eventIdx < r.events.length && r.events[eventIdx].t <= sh.t) {
      const e = r.events[eventIdx++];
      if (e.type === 'land' || e.type === 'bounce') {
        const surf = e.surface;
        w.ball.burstFor(surf, e.x, e.y, e.z, { count: e.type === 'land' ? 16 : 7, speed: clamp(e.speed * 0.12, 0.6, 4), up: clamp(e.speed * 0.14, 0.8, 5) });
        if (e.type === 'land') {
          landShown = true; w.ball.hideMarkers(); w.ball.spin.rate *= 0.3;
          if (surf === SURFACES.GREEN) addDecal(DECAL.BALL_MARK, e.x, e.z, rng.range(0, 6.28), 0.8 + clamp(e.speed / 30, 0, 1));
          if (surf === SURFACES.BUNKER) addDecal(DECAL.CRATER, e.x, e.z, 0, 1);
        }
        emit('land', { surface: surf, speed: e.speed, first: e.type === 'land' });
      } else if (e.type === 'water') { w.ball.burst('water', e.x, e.y + 0.1, e.z, { count: 34, speed: 2.5, up: 6, size: 0.05 }); w.ball.hide(); emit('splash', null); }
      else if (e.type === 'holed') { emit('holed', null); }
      else if (e.type === 'lip') emit('lip', null);
    }
    if (sh.t >= r.duration && prevT < r.duration + 5) {
      // Let the result sit for a moment before moving on.
      setPhase('settle');
      w.ball.spin.rate = 0;
      holdTimer = state.fast ? 0.02 : (r.holed ? 1.8 : 1.15) / Math.sqrt(sh.speedUp);
      afterHold = resolve;
    }
  };

  function resolve() {
    const w = W(), t = w.terrain, r = state.round, sh = state.shot, res = sh.result;
    const st = r.state[sh.player];
    const end = res.end;
    const dist = res.holed ? 0 : pinDist(end.x, end.z);
    const outcome = {
      from: sh.from, end: { x: end.x, z: end.z }, lie: res.lie, holed: res.holed, water: res.water, oob: res.oob,
      carry: res.carry, total: res.total, putt: !!sh.club.putter, distToPin: dist,
      drop: res.water ? dropPoint(t, res, sh.from) : null,
    };
    const applied = applyShot(r, sh.player, outcome);
    const par = parOf(r);
    let msg;
    if (res.holed) msg = scoreName(st.strokes, par);
    else if (applied.pickedUp) msg = applied.message;
    else if (res.oob) msg = 'Out of bounds. One stroke penalty';
    else if (res.water) msg = 'In the water. One stroke penalty';
    else msg = SURFACE_NAMES[res.lie] || 'In play';
    state.lastShot = { ...sh, outcome, applied, message: msg, strokes: st.strokes, par, distToPin: dist };
    state.message = msg;
    emit('shotEnd', state.lastShot);
    if (res.holed && w.props) { const d = st.strokes - par; if (d <= 0 && t.hole.tournament) w.props.cheer(d < 0 ? 1 : 0.6); }
    else if (!sh.club.putter && res.lie === SURFACES.GREEN && dist < 5 && t.hole.tournament && w.props) w.props.cheer(0.7);
    state.shot = null;
    if (holeFinished(r)) return finishHole();
    // After a penalty the same player may not be furthest away, the order is recomputed.
    beginTurn();
  }

  function finishHole() {
    const r = state.round;
    const holeIdx = currentHoleIndex(r), par = parOf(r);
    const strokes = r.state.map((s) => s.strokes);
    const slot = r.hole;
    const over = completeHole(r);
    state.holeSummary = { holeIdx, slot, par, strokes, standings: standings(r), over };
    W().overlays.hide();
    setPhase('summary');
    emit('holeEnd', state.holeSummary);
    if (over) emit('roundEnd', r);
    if (state.fast) game.continue();
  }
  // Called by the UI from the hole summary.
  game.continue = async () => {
    if (state.phase !== 'summary' || state.busy) return;
    if (state.round.complete) { setPhase('done'); return; }
    await loadHole();
  };

  // --- replay ---
  game.replay = (angle = 'follow') => {
    const last = state.lastShot;
    if (!last || (state.phase !== 'aim' && state.phase !== 'replay') || last.club.putter) return false;
    const w = W(), t = w.terrain, res = last.result;
    state.shot = { ...last, t: 0, speedUp: 0.5, landingCam: true, replay: true };
    apexShown = true; landShown = true; eventIdx = res.events.length;
    w.overlays.hide();
    w.ball.clearTrace();
    const l = res.carryPoint || res.end;
    const ctx = { replay: true, from: { x: last.from.x, y: t.heightAt(last.from.x, last.from.z), z: last.from.z }, landing: { x: l.x, y: t.inBounds(l.x, l.z, 1) ? t.heightAt(l.x, l.z) : 0, z: l.z }, apex: res.apex, dirX: Math.sin(last.launch.heading), dirZ: -Math.cos(last.launch.heading) };
    w.rig.set(angle, ctx);
    w.rig.cut = true;
    state.replaying = true;
    state.replayAngle = angle;
    setPhase('replay');
    return true;
  };
  const baseUpdate = game.update;
  game.update = (dt) => {
    if (state.phase !== 'replay') return baseUpdate(dt);
    const w = W(), sh = state.shot;
    state.clock += 0; // the game clock does not advance during a replay
    sh.t += dt * sh.speedUp;
    samplePath(sh.result.points, sh.t, tmp);
    w.rig.ballVel.set((tmp.x - w.ball.position.x) / Math.max(dt, 1e-4), 0, (tmp.z - w.ball.position.z) / Math.max(dt, 1e-4));
    w.ball.place(tmp.x, tmp.y, tmp.z);
    w.rig.ballPos.copy(w.ball.position);
    if (sh.t < sh.result.hang) w.ball.addTrace(tmp.x, tmp.y, tmp.z);
    if (sh.t >= sh.result.duration + 0.6) game.endReplay();
  };
  game.endReplay = () => {
    if (state.phase !== 'replay') return;
    const w = W(), t = w.terrain;
    state.shot = null; state.replaying = false;
    w.ball.clearTrace();
    w.ball.place(state.ball.x, t.heightAt(state.ball.x, state.ball.z) + BALL_RADIUS, state.ball.z);
    w.rig.set('address', addressCtx());
    w.rig.cut = true;
    refresh();
    setPhase('aim');
  };

  // Back to the address view after looking around.
  game.returnToAddress = () => { if (state.round && W().rig) W().rig.set('address', addressCtx()); };
  game.quit = () => { state.round = null; state.shot = null; W().overlays.hide(); setPhase('menu'); emit('quit', null); };
  // After the world is rebuilt (quality tier change) the current view state is restored.
  game.onWorldChanged = () => { if (state.round && state.phase !== 'menu' && W().terrain) { W().overlays.loadHole(); if (state.phase === 'aim') { W().rig.set('address', addressCtx()); refresh(); } } };

  // --- read model for the HUD ---
  game.view = () => {
    const r = state.round, w = W();
    if (!r || !w.terrain) return null;
    const t = w.terrain, st = r.state ? r.state[state.turn] : null;
    const rel = state.wind ? windRelative(state.wind, state.aim, state.clock) : { along: 0, cross: 0 };
    const elev = t.heightAt(t.pin.x, t.pin.z) - t.heightAt(state.ball.x, state.ball.z);
    const s = standings(r);
    return {
      phase: state.phase, mode: r.mode, hole: currentHoleIndex(r) + 1, holeOf: r.hole + 1, holes: r.holes.length, par: parOf(r), yards: t.hole.yards,
      player: r.players[state.turn], human: isHuman(), playerCount: r.players.length,
      strokes: st ? st.strokes : 0, toPar: s.totals[state.turn] ? s.totals[state.turn].toPar : 0, standingsText: s.text,
      totals: s.totals, turn: state.turn, thru: s.totals[state.turn] ? s.totals[state.turn].played : 0,
      distToPin: state.distToPin, elevation: elev,
      wind: { speedMph: state.windInfo.speedMph, relAngle: wrapAngle(state.windInfo.dir - state.aim), along: rel.along / MPH, cross: rel.cross / MPH },
      club: state.club, shotType: state.shotType, lie: state.lie, lieName: SURFACE_NAMES[state.lie],
      carry: state.club.putter ? 0 : nominalCarry(state.club, state.profile, state.shotType),
      predicted: state.prediction ? { carry: state.prediction.carry, total: state.prediction.total, lie: state.prediction.lie } : null,
      suggestedPower: state.phase === 'aim' ? game.suggestedPower() : 0,
      hazard: state.hazard, putt: state.putt, message: state.message, aim: state.aim,
      canReplay: !!(state.lastShot && !state.lastShot.club.putter && state.phase === 'aim'), replayAngle: state.replayAngle || 'follow',
    };
  };
  return game;
}

export { YARD };
