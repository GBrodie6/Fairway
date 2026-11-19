// Gear screens: the 14-club bag, each club's versions with stat bars and a side-by-side
// compare, balls, gloves, and gear drops with the odds printed next to the button.
// Everything here is earned by playing; there is nothing to buy.
import { h } from './dom.js';
import { createRng } from '../core/rng.js';
import { CLUB_SPECS } from '../physics/clubs.js';
import {
  TIERS, TIER_INFO, BALLS, GLOVES, clubStats, clubName, equipClub, equipItem, openDrop, DROP_ODDS, PITY_ODDS, PITY_AT, ITEM_ODDS,
  SHARDS_FOR_DUPLICATE, UPGRADE_COST, upgradeClub, dropsUntilPity, STARTER_IDS,
} from '../game/gear.js';
import { RARITY } from '../game/strike.js';
import { benefitLines, WIND_CAP, LIE_CAP } from '../data/tierBenefits.js';

// Coins come from tournament purses (earned, never bought).
const COINS_PER_TOKEN = 300;
// Three benefits, then the two costs. Wind and Bad lies show the real percentage; their bars
// fill to the cap (data/tierBenefits.js).
const STAT_NAMES = { wind: 'Wind', lie: 'Bad lies', control: 'Spin range', forgiveness: 'Forgiveness', difficulty: 'Mishit cost' };
const STAT_HELP = {
  wind: `How much less a crosswind moves the ball, up to ${Math.round(WIND_CAP * 100)} percent. Head and tail winds act in full. No extra carry.`,
  lie: `How much smaller the distance and accuracy penalties from rough, sand and bad lies are, up to ${Math.round(LIE_CAP * 100)} percent. Never past a clean strike.`,
  control: 'How far the ball-contact dot reaches: more draw, fade, backspin and topspin. No extra carry.',
  forgiveness: 'Size of the sweet spot.',
  difficulty: 'How much a mishit costs.',
};
const STAT_BAR = { wind: (v) => (v / (WIND_CAP * 100)) * 100, lie: (v) => (v / (LIE_CAP * 100)) * 100 };
const STAT_TEXT = { wind: (v) => (v ? `${v}% less` : 'none'), lie: (v) => (v ? `${v}% less` : 'none') };

export const tierChip = (rarity, extra = '') => h('span', { class: `tier t-${rarity}${extra ? ` ${extra}` : ''}`, text: TIER_INFO[rarity].name });

export function installGear(app, ui) {
  const { screens } = ui;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const back = () => btn('Back', () => screens.back());
  const gear = () => app.save().gear;
  const wallet = () => app.save().wallet;
  let tab = 'bag';
  let lastDrop = null;

  const walletLine = () => h('p', { class: 'wallet' },
    h('span', { class: 'chip' }, 'Gear tokens ', h('b', { text: String(wallet().tokens || 0) })),
    h('span', { class: 'chip' }, 'Shards ', h('b', { text: String(wallet().shards || 0) })),
    h('span', { class: 'chip' }, 'Coins ', h('b', { text: String(wallet().coins || 0) })));

  // One stat bar, with an optional second value drawn as a thin marker for compare.
  function bar(stat, value, other) {
    const delta = other == null ? null : value - other;
    const w = (v) => Math.round((STAT_BAR[stat] ? STAT_BAR[stat](v) : v) * 10) / 10;
    const shown = STAT_TEXT[stat] ? STAT_TEXT[stat](value) : String(value);
    return h('div', { class: 'statrow' },
      h('span', { class: 'statname', text: STAT_NAMES[stat], title: STAT_HELP[stat] }),
      h('span', { class: 'statbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(w(value)), 'aria-label': `${STAT_NAMES[stat]} ${shown}` },
        h('i', { style: { width: `${w(value)}%` } }),
        other == null ? null : h('em', { style: { left: `${w(other)}%` } })),
      h('b', { class: delta == null || delta === 0 ? '' : (stat === 'difficulty' ? delta < 0 : delta > 0) ? 'up' : 'down', text: delta == null || delta === 0 ? shown : `${shown} (${delta > 0 ? '+' : ''}${delta})` }));
  }
  // The table carry: the same for every tier, Good or Pured.
  const carries = (clubId) => {
    const spec = CLUB_SPECS.find((c) => c.id === clubId);
    return spec && spec.carry ? { base: spec.carry } : null;
  };
  const statBlock = (clubId, rarity, vs) => {
    const s = clubStats(rarity), o = vs ? clubStats(vs) : null;
    const carry = carries(clubId);
    const lines = benefitLines(rarity);
    return h('div', { class: 'stats' },
      ...Object.keys(STAT_NAMES).map((k) => bar(k, s[k], o ? o[k] : null)),
      rarity === 'common' ? null : h('ul', { class: 'benefits small' }, h('li', { text: lines.wind }), h('li', { text: lines.lie }), h('li', { text: `${lines.range}: the spin dot reaches ${s.control} percent of the way to the edge (Common 50)` })),
      carry ? h('p', { class: 'muted small', text: rarity === 'common' ? `Carry about ${carry.base} yd, Good or Pured. The most forgiving sweet spot.` : `Carry about ${carry.base} yd, Good or Pured, the same as Common. The cost: a sweet spot ${Math.round(RARITY[rarity].sweet * 100)} percent of Common's and harsher mishits.` }) : null);
  };

  // ---------- the bag ----------
  function bagTab() {
    const g = gear();
    return h('div', { class: 'list bag' }, ...g.bag.map((uid) => {
      const c = g.clubs.find((x) => x.uid === uid);
      const count = g.clubs.filter((x) => x.clubId === c.clubId).length;
      return h('button', { class: `item clubrow t-${c.rarity}`, type: 'button', onclick: () => clubScreen(c.clubId), 'aria-label': `${clubName(c.clubId)}, ${TIER_INFO[c.rarity].name} ${TIER_INFO[c.rarity].model}. ${count} owned. Open` },
        h('span', { class: 'row' }, h('b', { class: 'short', text: (CLUB_SPECS.find((s) => s.id === c.clubId) || {}).short || c.clubId }), h('span', { text: `${TIER_INFO[c.rarity].model} ${clubName(c.clubId)}` })),
        h('span', { class: 'row' }, count > 1 ? h('span', { class: 'muted small', text: `${count} owned` }) : null, tierChip(c.rarity)));
    }));
  }

  // ---------- one club: its versions, compare, equip, upgrade ----------
  let compareUid = null;
  function clubScreen(clubId) {
    screens.show('gear-club', () => {
      const g = gear();
      const owned = g.clubs.filter((c) => c.clubId === clubId).sort((a, b) => TIERS.indexOf(a.rarity) - TIERS.indexOf(b.rarity));
      const inBag = owned.find((c) => g.bag.includes(c.uid));
      const cmp = owned.find((c) => c.uid === compareUid && c.uid !== inBag.uid) || null;
      const shards = wallet().shards || 0;
      const rows = owned.map((c) => {
        const equipped = c.uid === inBag.uid;
        const cost = UPGRADE_COST[c.rarity];
        return h('div', { class: `item version t-${c.rarity}` },
          h('div', { class: 'stack tight' },
            h('span', { class: 'row' }, tierChip(c.rarity), h('b', { text: `${TIER_INFO[c.rarity].model} ${clubName(clubId)}` })),
            h('span', { class: 'muted small', text: TIER_INFO[c.rarity].text })),
          h('div', { class: 'row actions' },
            equipped ? h('span', { class: 'chip', text: 'In the bag' }) : btn('Equip', () => { app.updateSave((s) => ({ ...s, gear: equipClub(s.gear, c.uid) }), 'gear'); compareUid = null; clubScreen(clubId); }, 'btn small primary'),
            equipped ? null : btn(cmp && cmp.uid === c.uid ? 'Hide compare' : 'Compare', () => { compareUid = cmp && cmp.uid === c.uid ? null : c.uid; clubScreen(clubId); }, 'btn small'),
            cost ? btn(`Upgrade (${cost})`, () => {
              const r = upgradeClub(app.save().gear, c.uid, app.save().wallet.shards || 0);
              if (r.error) { ui.hud.toast('Upgrade', r.error, 2000); return; }
              app.updateSave((s) => ({ ...s, gear: r.gear, wallet: { ...s.wallet, shards: (s.wallet.shards || 0) - r.cost } }), 'purchase');
              if (app.recordPlay) app.recordPlay({ upgrades: 1 });
              ui.hud.toast('Upgraded', `${clubName(clubId)} is now ${TIER_INFO[TIERS[TIERS.indexOf(c.rarity) + 1]].name}`, 2000);
              clubScreen(clubId);
            }, 'btn small', { disabled: shards < cost, 'aria-label': `Upgrade to ${TIER_INFO[TIERS[TIERS.indexOf(c.rarity) + 1]].name} for ${cost} shards` }) : null));
      });
      return sheet('wide gear',
        h('h2', { class: 'h', text: clubName(clubId) }),
        walletLine(),
        cmp
          ? h('div', { class: 'compare' },
            h('div', {}, h('h3', { class: 'h small' }, tierChip(inBag.rarity), ' In the bag'), statBlock(clubId, inBag.rarity)),
            h('div', {}, h('h3', { class: 'h small' }, tierChip(cmp.rarity), ' Compared'), statBlock(clubId, cmp.rarity, inBag.rarity)))
          : h('div', {}, h('h3', { class: 'h small' }, tierChip(inBag.rarity), ` ${TIER_INFO[inBag.rarity].model}, in the bag`), statBlock(clubId, inBag.rarity)),
        h('p', { class: 'muted small', text: 'Every tier carries the same distance: a Pured strike lands on the power guide with any club. Higher tiers have a smaller sweet spot and mishits cost more. In return a crosswind moves the ball less, rough, sand and bad lies cost less, and the spin dot reaches further. Common is the most forgiving.' }),
        h('div', { class: 'list' }, ...rows),
        h('p', { class: 'muted small', text: `Upgrades use shards. Duplicates from drops become shards (${TIERS.map((t) => `${TIER_INFO[t].name} ${SHARDS_FOR_DUPLICATE[t]}`).join(', ')}).` }),
        h('div', { class: 'grid2' }, back(), btn('Bag', () => { tab = 'bag'; screens.registry.gear(); })));
    });
  }

  // ---------- balls and gloves ----------
  function itemTab(kind) {
    const g = gear();
    const list = kind === 'ball' ? g.balls : g.gloves;
    const cur = kind === 'ball' ? g.ball : g.glove;
    const sorted = [...list].sort((a, b) => TIERS.indexOf(a.rarity) - TIERS.indexOf(b.rarity));
    const desc = (r) => (kind === 'ball'
      ? (r === 'common' ? BALLS[r].text : `${BALLS[r].text} Spin +${Math.round((BALLS[r].spin - 1) * 100)} percent, ball speed ${((BALLS[r].speed - 1) * 100).toFixed(1)} percent.`)
      : (GLOVES[r] ? `Sweet spot +${Math.round(GLOVES[r] * 100)} percent.` : 'Standard grip. No change.'));
    return h('div', { class: 'list' },
      ...sorted.map((it) => h('div', { class: `item version t-${it.rarity}` },
        h('div', { class: 'stack tight' }, h('span', { class: 'row' }, tierChip(it.rarity), h('b', { text: `${TIER_INFO[it.rarity].model} ${kind === 'ball' ? 'ball' : 'glove'}` })), h('span', { class: 'muted small', text: desc(it.rarity) })),
        it.uid === cur ? h('span', { class: 'chip', text: 'In use' }) : btn('Use', () => { app.updateSave((s) => ({ ...s, gear: equipItem(s.gear, kind, it.uid) }), 'gear'); screens.registry.gear(); }, 'btn small primary'))),
      h('p', { class: 'muted small', text: kind === 'ball' ? 'More spin stops the ball faster on the green but flies a touch shorter.' : 'A glove widens the sweet spot a little. The effect is small by design.' }));
  }

  // ---------- drops ----------
  function dropsTab() {
    const g = gear();
    const tokens = wallet().tokens || 0;
    const oddsRows = TIERS.map((t) => h('div', { class: 'item' }, tierChip(t), h('b', { text: `${DROP_ODDS[t]} percent` })));
    const result = lastDrop ? h('div', { class: `dropresult t-${lastDrop.rarity}`, role: 'status', 'aria-live': 'polite' },
      tierChip(lastDrop.rarity, 'big'),
      h('b', { text: lastDrop.kind === 'club' ? `${TIER_INFO[lastDrop.rarity].model} ${clubName(lastDrop.clubId)}` : `${TIER_INFO[lastDrop.rarity].model} ${lastDrop.kind}` }),
      h('span', { class: 'muted', text: lastDrop.duplicate ? `Duplicate: +${lastDrop.shards} shards.` : lastDrop.pityGuaranteed ? 'New, from the guarantee.' : 'New. It is in your gear.' })) : null;
    return h('div', { class: 'stack' },
      result,
      btn(tokens > 0 ? 'Open a gear drop (1 token)' : 'No gear tokens yet', () => {
        const s = app.save();
        if ((s.wallet.tokens || 0) <= 0) return;
        const rng = createRng((Date.now() ^ (s.gear.opened * 2654435761)) >>> 0);
        const r = openDrop(s.gear, rng);
        app.updateSave((x) => ({ ...x, gear: r.gear, wallet: { ...x.wallet, tokens: (x.wallet.tokens || 0) - 1, shards: (x.wallet.shards || 0) + r.drop.shards } }), 'purchase');
        lastDrop = r.drop;
        if (ui.haptic) ui.haptic(r.drop.rarity === 'legendary' ? [20, 40, 20, 40, 60] : r.drop.rarity === 'epic' ? [20, 40, 40] : 14);
        screens.registry.gear();
      }, 'btn primary', { disabled: tokens <= 0 }),
      btn(`Trade ${COINS_PER_TOKEN} coins for a token`, () => { app.updateSave((s) => ((s.wallet.coins || 0) < COINS_PER_TOKEN ? s : { ...s, wallet: { ...s.wallet, coins: s.wallet.coins - COINS_PER_TOKEN, tokens: (s.wallet.tokens || 0) + 1 } }), 'purchase'); screens.registry.gear(); }, 'btn small', { disabled: (wallet().coins || 0) < COINS_PER_TOKEN }),
      h('p', { class: 'muted small', text: `Epic or better is guaranteed within ${dropsUntilPity(g)} more drop${dropsUntilPity(g) === 1 ? '' : 's'} (at most ${PITY_AT} in a row without one; the guaranteed drop is Epic ${PITY_ODDS.epic} percent, Legendary ${PITY_ODDS.legendary} percent).` }),
      h('h3', { class: 'h small', text: 'Drop odds' }),
      h('div', { class: 'list odds' }, ...oddsRows),
      h('p', { class: 'muted small', text: `Each drop is a club (${ITEM_ODDS.club} percent, any of the 14), a ball (${ITEM_ODDS.ball} percent) or a glove (${ITEM_ODDS.glove} percent). Duplicates become shards for upgrades.` }),
      h('p', { class: 'muted small', text: 'Tokens are earned by playing: finishing rounds, daily challenges, range drills, level milestones and campaign chapters. They cannot be bought.' }));
  }

  screens.register('gear', () => screens.show('gear', () => {
    const tabs = h('div', { class: 'seg', role: 'tablist' }, ...[['bag', 'Bag'], ['ball', 'Balls'], ['glove', 'Gloves'], ['drops', 'Drops']].map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': tab === id ? 'true' : 'false', onclick: () => { tab = id; screens.registry.gear(); } }, label)));
    const body = tab === 'bag' ? bagTab() : tab === 'drops' ? dropsTab() : itemTab(tab);
    return sheet('wide gear',
      h('h2', { class: 'h', text: 'Gear' }),
      walletLine(),
      tabs,
      tab === 'bag' ? h('p', { class: 'muted small', text: `Your bag: ${STARTER_IDS.length} clubs, one of each. Tap a club to compare versions or equip another.` }) : null,
      body,
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, back(), btn('Main menu', () => screens.menu())));
  }));
  app.openGear = (t) => { if (t) tab = t; screens.registry.gear(); };
  app.openClub = clubScreen;
}
