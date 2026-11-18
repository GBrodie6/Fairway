// Quests, the season track, the achievement gallery, the cosmetics locker, and this week's
// rotating mini-game and long drive. Everything is earned by playing; the season track is free
// and its rewards are fixed (no randomness to disclose).
import { h } from './dom.js';
import { fmtDist } from './format.js';
import { questDef, claimQuest, unclaimed } from '../game/quests.js';
import { SEASON_TIERS, XP_PER_TIER, tierFor, tierReward, claimTier, seasonName, seasonEnds } from '../game/season.js';
import { COSMETICS, cosmeticById, equipCosmetic, grantCosmetic } from '../game/cosmetics.js';
import { ACHIEVEMENTS } from '../game/save.js';
import { FEATS } from '../game/feats.js';
import { miniGameForWeek, rollWeekly } from '../game/weekly.js';
import { addTokens } from '../game/rewards.js';
import { YARD } from '../core/math.js';

export function installFun(app, ui) {
  const { screens } = ui;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const back = () => btn('Back', () => screens.back());
  const bar = (frac, label) => h('div', { class: 'xpbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(frac * 100)), 'aria-label': label },
    h('i', { style: { width: `${Math.round(Math.min(1, frac) * 100)}%` } }), h('span', { text: label }));

  // Apply a reward from a quest or a season tier to the save.
  function grant(reward) {
    if (!reward) return;
    app.updateSave((s) => {
      let n = s;
      if (reward.tokens) n = addTokens(n, reward.tokens);
      if (reward.kind === 'tokens') n = addTokens(n, reward.n);
      if (reward.kind === 'shards') n = { ...n, wallet: { ...n.wallet, shards: (n.wallet.shards || 0) + reward.n } };
      if (reward.kind === 'mulligan') n = { ...n, wallet: { ...n.wallet, mulligans: (n.wallet.mulligans || 0) + reward.n } };
      if (reward.kind === 'cosmetic') n = { ...n, cosmetics: grantCosmetic(n.cosmetics, reward.id) };
      return n;
    }, 'purchase');
    if (reward.xp && app.addXp) app.addXp(reward.xp, 'Quest');
  }
  const rewardText = (r) => (r.kind === 'tokens' ? `${r.n} gear token${r.n === 1 ? '' : 's'}` : r.kind === 'shards' ? `${r.n} shards` : r.kind === 'mulligan' ? 'a Mulligan' : r.kind === 'cosmetic' ? (cosmeticById(r.id) || {}).name : '');

  // ---------- quests ----------
  function questRow(q) {
    const d = questDef(q.id);
    const done = q.progress >= d.goal;
    return h('div', { class: `item quest${q.claimed ? ' claimed' : done ? ' ready' : ''}` },
      h('div', { class: 'stack tight' }, h('b', { text: d.text }), bar(q.progress / d.goal, `${q.progress} / ${d.goal}`),
        h('span', { class: 'muted small', text: `${d.xp} XP${d.tokens ? ` and ${d.tokens} gear token` : ''}` })),
      q.claimed ? h('span', { class: 'chip', text: 'Claimed' }) : btn('Claim', () => { const r = claimQuest(app.save().quests, q.id); if (!r.reward) return; app.updateSave((s) => ({ ...s, quests: r.state }), 'quest'); grant(r.reward); ui.hud.toast('Quest complete', `${r.reward.xp} XP${r.reward.tokens ? ' and a gear token' : ''}`, 2000); questsScreen(); }, 'btn small primary', { disabled: !done }));
  }
  function questsScreen() {
    if (app.refreshPeriods) app.refreshPeriods();
    screens.show('quests', () => {
      const q = app.save().quests;
      return sheet('fun',
        h('h2', { class: 'h', text: 'Quests' }),
        h('h3', { class: 'h small', text: 'Today' }),
        h('div', { class: 'list' }, ...q.daily.list.map(questRow)),
        h('h3', { class: 'h small', text: 'This week' }),
        h('div', { class: 'list' }, ...q.weekly.list.map(questRow)),
        h('p', { class: 'muted small', text: 'New daily quests every day, new weekly quests every Monday. Everyone gets the same ones.' }),
        h('div', { class: 'stack' }, back()));
    });
  }

  // ---------- season track ----------
  function seasonScreen() {
    if (app.refreshPeriods) app.refreshPeriods();
    screens.show('season', () => {
      const s = app.save().season, reached = tierFor(s.xp);
      const days = Math.max(0, Math.ceil((seasonEnds(Date.now()) - Date.now()) / 86400000));
      return sheet('fun',
        h('h2', { class: 'h', text: `Season: ${seasonName(s.id)}` }),
        h('p', { class: 'muted small', text: `A free track. Every XP you earn fills it. ${days} day${days === 1 ? '' : 's'} left.` }),
        bar(reached >= SEASON_TIERS ? 1 : (s.xp % XP_PER_TIER) / XP_PER_TIER, reached >= SEASON_TIERS ? 'Track complete' : `Tier ${reached}: ${s.xp % XP_PER_TIER} / ${XP_PER_TIER} XP to the next`),
        h('div', { class: 'list tiers' }, ...Array.from({ length: SEASON_TIERS }, (_, i) => i + 1).map((t) => {
          const r = tierReward(t), got = s.claimed.includes(t), open = t <= reached;
          return h('div', { class: `item tier-row${got ? ' claimed' : open ? ' ready' : ''}` },
            h('span', { class: 'row' }, h('b', { class: 'tn', text: String(t) }), h('span', { text: rewardText(r) })),
            got ? h('span', { class: 'muted small', text: 'Claimed' }) : open ? btn('Claim', () => { const c = claimTier(app.save().season, t); if (!c.reward) return; app.updateSave((x) => ({ ...x, season: c.state }), 'season'); grant(c.reward); seasonScreen(); }, 'btn small primary') : h('span', { class: 'muted small', text: `${t * XP_PER_TIER} XP` }));
        })),
        h('div', { class: 'stack', style: { marginTop: '10px' } }, back()));
    });
  }

  // ---------- achievements ----------
  function achievementsScreen() {
    screens.show('feats', () => {
      const have = app.save().achievements || {};
      const n = ACHIEVEMENTS.filter((a) => have[a.id]).length;
      return sheet('wide fun',
        h('h2', { class: 'h', text: 'Achievements' }),
        h('p', { class: 'muted', text: `${n} of ${ACHIEVEMENTS.length} unlocked.` }),
        h('div', { class: 'feats' }, ...ACHIEVEMENTS.map((a) => {
          const f = FEATS.find((x) => x.id === a.id);
          return h('div', { class: `feat${have[a.id] ? ' got' : ''}` }, h('b', { text: a.name }), h('span', { class: 'small', text: a.text }),
            f && f.cosmetic ? h('span', { class: 'small reward', text: `Unlocks ${cosmeticById(f.cosmetic).name} ${cosmeticById(f.cosmetic).kind === 'ball' ? 'ball' : 'tracer'}` }) : null);
        })),
        h('div', { class: 'stack' }, back()));
    });
  }

  // ---------- the locker ----------
  function lockerScreen() {
    screens.show('locker', () => {
      const c = app.save().cosmetics;
      const section = (kind, title) => h('div', {}, h('h3', { class: 'h small', text: title }),
        h('div', { class: 'swatches' }, ...COSMETICS.filter((x) => x.kind === kind).map((x) => {
          const own = c.owned.includes(x.id), on = c[kind] === x.id;
          const how = x.source === 'season' ? `Season tier ${x.tier}` : x.source === 'feat' ? `Achievement: ${(ACHIEVEMENTS.find((a) => a.id === x.feat) || {}).name}` : '';
          return h('button', { class: `swatch${on ? ' on' : ''}${own ? '' : ' locked'}`, type: 'button', disabled: !own, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${x.name}${own ? '' : `, locked. ${how}`}`, onclick: () => { app.updateSave((s) => { const nc = equipCosmetic(s.cosmetics, x.id); return { ...s, cosmetics: nc, player: kind === 'ball' ? { ...s.player, ball: x.color } : s.player }; }, 'cosmetic'); if (app.applyCosmetics) app.applyCosmetics(); lockerScreen(); } },
            h('i', { class: kind, style: { background: x.color } }), h('span', { class: 'small', text: x.name }), own ? null : h('span', { class: 'muted tiny', text: how }));
        })));
      return sheet('fun',
        h('h2', { class: 'h', text: 'Locker' }),
        h('p', { class: 'muted small', text: 'Ball colors and shot tracers. Earned from achievements and the season track; they never change how the ball flies.' }),
        section('ball', 'Ball'), section('trail', 'Shot tracer'),
        h('div', { class: 'stack', style: { marginTop: '10px' } }, back()));
    });
  }

  // ---------- this week ----------
  app.thisWeekCard = () => {
    const now = Date.now();
    const mg = miniGameForWeek(now);
    const wk = rollWeekly(app.save().weekly, now);
    return h('div', { class: 'thisweek' },
      h('h3', { class: 'h small', text: 'This week' }),
      h('div', { class: 'item' }, h('div', { class: 'stack tight' }, h('b', { text: `Mini-game: ${mg.name}` }), h('span', { class: 'small', text: mg.text }), wk.mini ? h('span', { class: 'muted small', text: `Your best this week: ${wk.mini}` }) : null),
        btn('Play', () => app.playMiniGame && app.playMiniGame(mg), 'btn small primary')),
      h('div', { class: 'item' }, h('div', { class: 'stack tight' }, h('b', { text: 'Weekly long drive' }), h('span', { class: 'small', text: wk.longdrive ? `Your longest this week: ${fmtDist(wk.longdrive * YARD, app.settings.units)}` : 'Six drives on the range. Your best this week goes on the board.' })),
        btn('Play', () => app.openRangeMode && app.openRangeMode('longdrive'), 'btn small primary')));
  };

  screens.register('quests', questsScreen);
  screens.register('season', seasonScreen);
  screens.register('feats', achievementsScreen);
  screens.register('locker', lockerScreen);
  app.questBadge = () => unclaimed(app.save().quests);
  app.weeklyMiniGame = () => miniGameForWeek(Date.now());
  // The mini-game of the week: a range drill or closest to the pin on the par 3s.
  app.playMiniGame = (mg) => {
    if (mg.kind === 'range' && app.openRangeMode) app.openRangeMode(mg.drill);
    else if (mg.mode === 'ctp' && screens.startQuick) screens.startQuick({ mode: 'ctp', holes: 18, players: 1, rival: false });
  };
}
