// The pros in the menus: a sideways row of emblem chips to choose one ("You" first), a card
// with the archetype, signature shot, stats, club preferences and bio, and a screen that lists
// them all. Emblems are images from data URLs (game/pros.js), never markup.
import { h } from './dom.js';
import { PROS, proById, emblemSrc } from '../game/pros.js';
import { ARCHETYPES, STATS, STAT_INFO } from '../game/campaign.js';
import { shotData } from '../data/shotTypes.js';
import { clubName } from '../game/gear.js';

export const emblemImg = (p, size = 36) => h('img', { class: 'emblem', src: emblemSrc(p), alt: '', width: String(size), height: String(size) });

/** A radio row: "You" (or noneLabel) and the twelve pros. onPick(id | null). */
export function proChooser({ selected = null, onPick, noneLabel = 'You', exclude = null, label = 'Play as' }) {
  const row = h('div', { class: 'prorow', role: 'radiogroup', 'aria-label': label });
  const chip = (id, name, img, sub) => {
    const on = (selected || null) === id;
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `prochip${on ? ' on' : ''}`, onclick: () => onPick(id) }, img, h('b', { text: name }), sub ? h('span', { text: sub }) : null);
    row.appendChild(b);
  };
  if (noneLabel) chip(null, noneLabel, h('span', { class: 'emblem you', 'aria-hidden': 'true' }), '');
  for (const p of PROS) if (p.id !== exclude) chip(p.id, p.name.split(' ')[1] || p.name, emblemImg(p, 32), ARCHETYPES[p.archetype].name.split(' ')[0]);
  return row;
}

export function proCard(p) {
  return h('div', { class: 'procard', style: { borderColor: p.color } },
    h('div', { class: 'prohead' }, emblemImg(p, 48), h('div', { class: 'stack tight' }, h('b', { text: p.name }), h('span', { class: 'small muted', text: `${ARCHETYPES[p.archetype].name}. Signature shot: ${shotData(p.signature).name}.` }))),
    h('div', { class: 'prostats' }, ...STATS.map((k) => h('span', { class: 'small', text: `${STAT_INFO[k].short || STAT_INFO[k].name} ${p.stats[k]}` }))),
    h('p', { class: 'small muted', text: `Clubs: ${p.clubs.tee === 'W3' ? 'a 3 wood off most tees' : 'the driver off the tee'}, the ${clubName(p.clubs.wedge).toLowerCase()} around the greens, and a favorite ${clubName(p.clubs.favorite).toLowerCase()}.` }),
    h('p', { class: 'small', text: p.bio }));
}

export function installPros(app, ui) {
  const { screens } = ui;
  screens.register('pros', () => screens.show('pros', () => h('div', { class: 'sheet glass wide' },
    h('h2', { class: 'h', text: 'The pros' }),
    h('p', { class: 'muted', text: 'Twelve tour pros, two of each kind of golfer, all at the same level. Play as one in Quick Play, the Daily challenge or a Tournament; they also turn up as rivals. In the Campaign one can be your mentor and teach you their signature shot.' }),
    h('div', { class: 'procards' }, ...PROS.map(proCard)),
    h('div', { class: 'stack', style: { marginTop: '12px' } }, h('button', { class: 'btn', type: 'button', onclick: () => screens.back() }, 'Back')))));
  app.proById = proById;
}
