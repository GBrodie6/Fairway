// Profile: one place for everything about you. The golfer card (archetype, level, XP), then
// character, skill tree, gear, locker, achievements, stats, trophies, quests and season, and
// the account. The main menu's Profile button opens it.
import { h } from './dom.js';
import { fmtToPar } from './format.js';
import { ARCHETYPES, golferLevel, xpProgress, evolutionStage, pointsFree, MAX_LEVEL } from '../game/campaign.js';
import { ACHIEVEMENTS } from '../game/save.js';
import { badge } from './campaignUi.js';

export function installProfile(app, ui) {
  const { screens } = ui;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const open = (name) => () => (screens.registry[name] ? screens.registry[name]() : null);

  screens.register('profile', () => screens.show('profile', () => {
    const s = app.save(), g = s.profile, a = g.archetype ? ARCHETYPES[g.archetype] : null;
    const p = xpProgress(g.xp), lvl = golferLevel(g);
    const got = ACHIEVEMENTS.filter((x) => s.achievements[x.id]).length;
    const st = s.stats;
    const avg = st.holes ? (st.strokes - st.par) / st.holes * 9 : null;
    const free = pointsFree(g);
    return sheet('profile',
      h('h2', { class: 'h', text: 'Profile' }),
      h('div', { class: 'golfer', style: { borderColor: a ? a.color : 'var(--line)' } },
        badge(s.player.name || 'You', a ? a.color : null),
        h('div', { class: 'stack tight' },
          h('b', { text: `${s.player.name || 'You'}${a ? `, ${a.titles[evolutionStage(lvl)]}` : ''}` }),
          h('div', { class: 'xpbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p.frac * 100)), 'aria-label': `Level ${lvl}` }, h('i', { style: { width: `${Math.round(p.frac * 100)}%` } }), h('span', { text: lvl >= MAX_LEVEL ? `Level ${MAX_LEVEL}` : `Level ${lvl}  ${p.into} / ${p.need} XP` })),
          a ? null : h('span', { class: 'muted small', text: 'Choose an archetype in the campaign to start your skill tree.' }))),
      h('div', { class: 'pstats' },
        h('span', {}, h('b', { text: String(st.rounds) }), h('small', { text: 'rounds' })),
        h('span', {}, h('b', { text: avg == null ? '-' : fmtToPar(Math.round(avg)) }), h('small', { text: 'per 9 holes' })),
        h('span', {}, h('b', { text: `${got}/${ACHIEVEMENTS.length}` }), h('small', { text: 'achievements' })),
        h('span', {}, h('b', { text: String((s.trophies || []).length) }), h('small', { text: 'trophies' }))),
      h('div', { class: 'grid2' },
        btn('Character', open('character')), btn(free ? `Skill tree (${free})` : 'Skill tree', open('skilltree'), free ? 'btn primary' : 'btn'),
        btn('Gear', open('gear')), btn('Locker', open('locker')),
        btn('Achievements', open('feats')), btn('Stats and history', open('stats')),
        btn('Quests', open('quests')), btn('Season track', open('season')),
        btn('Tournaments and trophies', open('tournament')), btn('Leaderboards', open('leaderboards')),
        btn(app.cloud && app.cloud.client.user ? 'Account' : 'Account (optional)', open('account')), btn('Privacy', open('privacy'))),
      h('div', { class: 'stack', style: { marginTop: '12px' } }, btn('Back', () => screens.menu())));
  }));
}
