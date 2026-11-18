// Campaign screens: choosing an archetype, the hub (golfer card and chapters), a chapter's
// events, the event briefing (course, field, objectives, the boss, rewards), the result with
// its XP breakdown and stars, the character sheet, the skill tree with respec, and the
// level-up card (with the evolutions at 10 and 25). No people are drawn: rivals and bosses
// appear as initials on a colored badge.
import { h } from './dom.js';
import { fmtToPar, ordinal } from './format.js';
import { courseById } from '../course/courses.js';
import { hashString } from '../core/rng.js';
import {
  ARCHETYPES, ARCHETYPE_IDS, STATS, STAT_INFO, STAT_MAX, PERK_INFO, BRANCH_NAMES, SHOTS, CHAPTERS, BOSSES, eventById, holesOf,
  createCampaign, chapterUnlocked, eventUnlocked, eventCleared, chapterStars, nextCampaignEvent, fieldFor, completeCampaignEvent,
  roundFacts, newGolfer, golferLevel, xpProgress, evolutionStage, pointsFree, pointsTotal, treeFor, canBuy, buyNode, respec,
  golferStats, golferPerks, golferProfile, shotUnlocked, MAX_LEVEL,
} from '../game/campaign.js';
import { addTokens } from '../game/rewards.js';
import { grantClub, TIER_INFO, clubName } from '../game/gear.js';
import { simulateRivalRound } from '../game/career.js';
import { eventBoard } from '../game/tournament.js';

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const badge = (name, color) => h('span', { class: 'badge', style: { background: color || '#3a4a40' }, 'aria-hidden': 'true', text: initials(name) });
const TOD = { dawn: 'Dawn', morning: 'Morning', midday: 'Midday', golden: 'Golden hour', dusk: 'Dusk', night: 'Night' };

export function installCampaign(app, ui) {
  const { screens } = ui;
  const game = app.game;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const back = (fn) => btn('Back', fn || (() => screens.back()));
  const golfer = () => app.save().profile || newGolfer();
  const campaign = () => app.save().campaign;
  const setGolfer = (g, reason = 'golfer') => app.updateSave((s) => ({ ...s, profile: g }), reason);
  const title = (g) => (g.archetype ? ARCHETYPES[g.archetype].titles[evolutionStage(golferLevel(g))] : 'No archetype yet');
  let lastResult = null;

  const xpBar = (g) => {
    const p = xpProgress(g.xp);
    return h('div', { class: 'xpbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p.frac * 100)), 'aria-label': `Level ${p.level}, ${Math.round(p.frac * 100)} percent to the next level` },
      h('i', { style: { width: `${Math.round(p.frac * 100)}%` } }),
      h('span', { text: p.level >= MAX_LEVEL ? `Level ${MAX_LEVEL}, the top` : `Level ${p.level}  ${p.into} / ${p.need} XP` }));
  };
  const golferCard = (g) => h('div', { class: 'golfer', style: { borderColor: g.archetype ? ARCHETYPES[g.archetype].color : 'var(--line)' } },
    badge(app.save().player.name || 'You', g.archetype ? ARCHETYPES[g.archetype].color : null),
    h('div', { class: 'stack tight' }, h('b', { text: `${app.save().player.name || 'You'}, ${title(g)}` }), xpBar(g),
      pointsFree(g) > 0 ? h('span', { class: 'chip warn small', text: `${pointsFree(g)} skill point${pointsFree(g) === 1 ? '' : 's'} to spend` }) : null));

  // ---------- choosing an archetype ----------
  function pickArchetype() {
    screens.show('campaign-pick', () => sheet('wide campaign',
      h('h2', { class: 'h', text: 'Choose your golfer' }),
      h('p', { class: 'muted', text: 'Your archetype shapes your skill tree, your strengths, and a weakness. You can respec your skills any time, but the archetype stays.' }),
      h('div', { class: 'arch' }, ...ARCHETYPE_IDS.map((id) => {
        const a = ARCHETYPES[id];
        return h('button', { class: 'card archcard', type: 'button', style: { borderColor: a.color }, onclick: () => confirmArchetype(id) },
          h('b', { text: a.name }), h('span', { class: 'small', text: a.text }),
          h('span', { class: 'small good', text: `Perk: ${a.innateText}` }), h('span', { class: 'small bad', text: `Weakness: ${a.weakness}` }),
          h('span', { class: 'muted small', text: `Grows into ${a.titles[1]} at level 10 and ${a.titles[2]} at 25.` }));
      })),
      h('div', { class: 'stack' }, back(() => screens.menu()))));
  }
  function confirmArchetype(id) {
    const g = golfer();
    setGolfer({ ...newGolfer(id, g.xp), respecs: g.respecs || 0 }, 'golfer');
    if (!campaign()) app.updateSave((s) => ({ ...s, campaign: createCampaign((hashString(s.player.name || 'You') ^ Date.now()) >>> 0) }), 'campaign');
    hub();
  }

  // ---------- the hub ----------
  function hub() {
    const g = golfer();
    if (!g.archetype) return pickArchetype();
    if (!campaign()) app.updateSave((s) => ({ ...s, campaign: createCampaign((hashString(s.player.name || 'You') ^ Date.now()) >>> 0) }), 'campaign');
    screens.show('campaign', () => {
      const c = campaign();
      const next = nextCampaignEvent(c);
      return sheet('wide campaign',
        h('h2', { class: 'h', text: 'Campaign' }),
        golferCard(g),
        h('div', { class: 'grid2' }, btn('Character', () => characterSheet()), btn(pointsFree(g) ? `Skill tree (${pointsFree(g)})` : 'Skill tree', () => skillTree(), pointsFree(g) ? 'btn primary' : 'btn')),
        next ? btn(`Next: ${next.name}`, () => briefing(next.id), 'btn primary wide') : h('p', { class: 'center good', text: 'Every event cleared. Replay any event for stars and XP.' }),
        h('div', { class: 'list chapters' }, ...CHAPTERS.map((ch, ci) => {
          const open = chapterUnlocked(c, ci), st = chapterStars(c, ci), boss = BOSSES[ch.boss];
          return h('button', { class: `item chapter${open ? '' : ' locked'}`, type: 'button', disabled: !open, onclick: () => chapter(ci), 'aria-label': `Chapter ${ci + 1}, ${ch.name}. ${open ? `${st.got} of ${st.total} stars` : 'Locked'}` },
            h('span', { class: 'row' }, badge(boss.name, open ? boss.color : '#333'), h('span', { class: 'stack tight' }, h('b', { text: `${ci + 1}. ${ch.name}` }), h('span', { class: 'muted small', text: open ? ch.text : `Clear ${CHAPTERS[ci - 1].name} to unlock` }))),
            h('span', { class: 'stars', text: open ? `${st.got}/${st.total}` : '' }));
        })),
        h('div', { class: 'stack' }, back(() => screens.menu())));
    });
  }

  function chapter(ci) {
    const ch = CHAPTERS[ci];
    screens.show('campaign-chapter', () => {
      const c = campaign(), boss = BOSSES[ch.boss];
      return sheet('wide campaign',
        h('h2', { class: 'h', text: `${ci + 1}. ${ch.name}` }),
        h('p', { class: 'muted', text: ch.text }),
        h('div', { class: 'boss' }, badge(boss.name, boss.color), h('div', { class: 'stack tight' }, h('b', { text: `${boss.name}, ${boss.title}` }), h('span', { class: 'small', text: boss.trait }))),
        h('div', { class: 'list' }, ...ch.events.map((ev) => {
          const open = eventUnlocked(c, ev.id), p = c.progress[ev.id];
          return h('button', { class: `item event${open ? '' : ' locked'}${ev.bossEvent ? ' bossev' : ''}`, type: 'button', disabled: !open, onclick: () => briefing(ev.id), 'aria-label': `${ev.name}. ${open ? `${(p && p.stars) || 0} of 3 stars` : 'Locked'}` },
            h('span', { class: 'stack tight' }, h('b', { text: ev.name }), h('span', { class: 'muted small', text: `${courseById(ev.courseId).name}, ${ev.holes} holes, ${ev.mode === 'match' ? 'match play' : `field of ${ev.field}`}` })),
            h('span', { class: 'stars', text: open ? `${'★'.repeat((p && p.stars) || 0)}${'☆'.repeat(3 - ((p && p.stars) || 0))}` : 'Locked' }));
        })),
        h('p', { class: 'muted small', text: `Chapter reward: ${/^[AEIOU]/.test(TIER_INFO[ch.reward.rarity].name) ? 'an' : 'a'} ${TIER_INFO[ch.reward.rarity].name} ${clubName(ch.reward.clubId)} (${TIER_INFO[ch.reward.rarity].model}) for clearing the final event.` }),
        h('div', { class: 'stack' }, back(() => hub())));
    });
  }

  // ---------- briefing ----------
  function briefing(id) {
    const ev = eventById(id);
    screens.show('campaign-brief', () => {
      const c = campaign(), p = c.progress[ev.id];
      const field = fieldFor(c, ev);
      const boss = ev.boss ? BOSSES[ev.boss] : null;
      const met = new Set((p && p.met) || []);
      const g = golfer();
      return sheet('campaign',
        h('h2', { class: 'h', text: ev.name }),
        h('p', { class: 'muted', text: `${courseById(ev.courseId).name}. Holes ${ev.startHole} to ${ev.startHole + ev.holes - 1}. ${TOD[ev.tod] || ''}. ${ev.mode === 'match' ? 'Match play: win holes, not strokes.' : `${ev.field} players; the rest of the field plays alongside you.`}` }),
        boss ? h('div', { class: 'boss' }, badge(boss.name, boss.color), h('div', { class: 'stack tight' }, h('b', { text: `${boss.name}, ${boss.title}` }), h('span', { class: 'small', text: boss.trait }))) : null,
        h('h3', { class: 'h small', text: 'Objectives' }),
        h('div', { class: 'list objectives' }, ...ev.objectives.map((o) => h('div', { class: `item${met.has(o.id) ? ' done' : ''}` }, h('span', { text: `${o.main ? 'Main: ' : ''}${o.text}` }), h('span', { text: met.has(o.id) ? 'Done' : o.main ? 'Clears the event' : 'Star' })))),
        h('p', { class: 'muted small', text: `Rewards: XP for holes, scoring, birdies, objectives and your finish; a gear token on the first clear${ev.bossEvent ? ' (two for a boss event) and the chapter club' : ''}. Each objective met is a star.` }),
        ev.mode !== 'match' ? h('p', { class: 'muted small', text: `In the field: ${field.slice(0, 4).map((r) => r.name).join(', ')}${field.length > 4 ? ` and ${field.length - 4} more` : ''}.` }) : null,
        h('p', { class: 'muted small', text: `Your shots: Full, Chip${['punch', 'high', 'flop', 'bump'].filter((s) => shotUnlocked(g, s)).map((s) => `, ${SHOTS[s]}`).join('')}. Unlock more in the skill tree.` }),
        h('div', { class: 'grid2', style: { marginTop: '10px' } }, back(() => chapter(ev.chapter)), btn(p && p.plays ? 'Play again' : 'Tee off', () => start(ev), 'btn primary')));
    });
  }

  // The field's rounds for the live leaderboard, seeded exactly as the result will be.
  let liveField = null;
  app.boardProviders = app.boardProviders || [];
  app.boardProviders.push((r, mine, thru) => {
    const ev = eventById(r.eventId);
    if (!ev || ev.mode !== 'stroke' || !liveField || liveField.id !== ev.id) return null;
    const course = courseById(ev.courseId);
    return eventBoard(app.save().player.name || 'You', mine, liveField.field, holesOf(ev).map((x) => course.pars[x]), thru);
  });
  async function start(ev) {
    const c = campaign(), g = golfer(), s = app.save();
    {
      const plays0 = (c.progress[ev.id] && c.progress[ev.id].plays) || 0;
      const seed = (c.seed + hashString(ev.id) + plays0 * 7919) >>> 0;
      liveField = { id: ev.id, field: ev.mode === 'stroke' ? fieldFor(c, ev).map((f) => ({ id: f.id, name: f.name, boss: !!f.boss, scores: simulateRivalRound(f, { courseId: ev.courseId, holes: holesOf(ev), seed }) })) : [] };
    }
    screens.hide();
    const players = [{ id: 'p1', name: s.player.name || 'You', kind: 'human', handed: s.player.handed, ball: s.player.ball }];
    if (ev.mode === 'match') { const b = fieldFor(c, ev)[0]; players.push({ id: b.id, name: b.name, kind: 'ai', skill: b.skill, ball: '#ffd23f' }); }
    const plays = (c.progress[ev.id] && c.progress[ev.id].plays) || 0;
    await game.startRound({ courseId: ev.courseId, mode: ev.mode, holes: holesOf(ev), tod: ev.tod, seed: (c.seed ^ hashString(ev.id) ^ (plays * 2654435761)) >>> 0, eventId: ev.id, profile: golferProfile(g), players });
  }
  app.startCampaignEvent = (id) => { const ev = eventById(id); if (ev) start(ev); };
  app.isCampaignEvent = (id) => !!eventById(id);

  // ---------- a finished event ----------
  // Called by the round-end glue (menus.js) for rounds whose eventId is a campaign event.
  app.campaignRoundEnd = (r) => {
    const ev = eventById(r.eventId);
    if (!ev) return null;
    const s = app.save();
    const facts = roundFacts(r, 0);
    let match = null;
    if (ev.mode === 'match') {
      // Holes won by each side: the match is decided on holes, ties are halved.
      let me = 0, them = 0;
      r.scores[0].forEach((sc, i) => { const o = r.scores[1][i]; if (Number.isFinite(sc) && Number.isFinite(o)) { if (sc < o) me++; else if (o < sc) them++; } });
      match = me > them ? 'win' : me < them ? 'loss' : 'halved';
    }
    const rivalScores = {};
    r.players.forEach((p, i) => { if (p.kind === 'ai') rivalScores[p.id] = r.scores[i]; });
    const out = completeCampaignEvent(s.campaign, ev.id, { facts, rivalScores, match, rangeMedals: (s.range && s.range.medals) || {}, name: s.player.name, date: Date.now() });
    if (!out.result) return null;
    lastResult = { ...out.result, match, facts };
    app.updateSave((x) => {
      let n = { ...x, campaign: out.campaign };
      if (out.result.tokens) n = addTokens(n, out.result.tokens);
      if (out.result.chapterReward) {
        const gr = grantClub(n.gear, out.result.chapterReward.clubId, out.result.chapterReward.rarity);
        n = { ...n, gear: gr.gear, wallet: { ...n.wallet, shards: (n.wallet.shards || 0) + gr.shards } };
      }
      return n;
    }, 'campaign');
    if (app.addXp) app.addXp(out.result.xp.total, ev.name);
    return lastResult;
  };

  // The extra block on the round-end screen for a campaign event.
  app.campaignRoundEndExtra = () => {
    const r = lastResult;
    if (!r) return null;
    const rows = r.event.mode === 'match'
      ? [h('p', { class: 'center big2', text: r.match === 'win' ? `You beat ${r.board.find((b) => b.boss).name}` : r.match === 'halved' ? 'The match is halved' : `${r.board.find((b) => b.boss).name} wins the match` })]
      : [h('h3', { class: 'h', text: `${r.event.name}: ${ordinal(r.position)} of ${r.board.length}` }), h('div', { class: 'list' }, ...r.board.slice(0, 5).map((b) => h('div', { class: `item${b.id === 'me' ? ' me' : ''}` }, h('span', { text: `${b.position}. ${b.name}${b.boss ? ' (boss)' : ''}` }), h('span', { text: `${b.total} (${fmtToPar(b.toPar)})` }))))];
    return h('div', { class: 'campaign-result' }, ...rows,
      h('div', { class: 'list objectives' }, ...r.objectives.map((o) => h('div', { class: `item${o.met ? ' done' : ''}` }, h('span', { text: o.text }), h('span', { text: o.met ? 'Met' : 'Missed' })))),
      h('p', { class: 'center stars big2', 'aria-label': `${r.stars} of 3 stars`, text: `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}` }),
      h('p', { class: 'center', text: r.cleared ? (r.firstClear ? 'Event cleared!' : 'Cleared again.') : 'Not cleared yet. Meet the main objective to move on.' }),
      h('table', { class: 'avg xp' }, h('tbody', {}, ...r.xp.lines.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: `+${v}` }))), h('tr', { class: 'tot' }, h('td', { text: 'Total XP' }), h('td', { text: `+${r.xp.total}` })))),
      r.tokens ? h('p', { class: 'center good', text: `+${r.tokens} gear token${r.tokens === 1 ? '' : 's'}` }) : null,
      r.chapterReward ? h('p', { class: 'center good', text: `Chapter reward: ${TIER_INFO[r.chapterReward.rarity].model} ${clubName(r.chapterReward.clubId)} (${TIER_INFO[r.chapterReward.rarity].name})` }) : null,
      h('div', { class: 'center' }, btn('Campaign', () => { screens.hide(); game.quit(); hub(); }, 'btn')));
  };

  // ---------- level up ----------
  app.showLevelUp = (from, to) => {
    const g = golfer();
    const evolved = [10, 25].filter((l) => from < l && to >= l);
    const a = g.archetype ? ARCHETYPES[g.archetype] : null;
    screens.show('levelup', () => sheet('campaign levelup',
      h('p', { class: 'kicker', text: 'Level up' }),
      h('h2', { class: 'h big', text: `Level ${to}` }),
      h('p', { text: `+${pointsTotal(to, g.archetype) - pointsTotal(from, g.archetype)} skill point${pointsTotal(to, g.archetype) - pointsTotal(from, g.archetype) === 1 ? '' : 's'}. You have ${pointsFree(g)} to spend.` }),
      evolved.length && a ? h('div', { class: 'evolve', style: { borderColor: a.color } }, h('b', { text: `You are now a ${a.titles[evolutionStage(to)]}` }), h('span', { class: 'small', text: `${a.innateText} The effect grows${a.signature ? `, and ${STAT_INFO[a.signature].name.toLowerCase()} rises by 4` : ''}.` })) : null,
      h('div', { class: 'grid2' }, btn('Later', () => screens.back()), btn('Skill tree', () => skillTree(), 'btn primary'))), { modal: true });
  };

  // ---------- character sheet ----------
  function characterSheet() {
    screens.show('character', () => {
      const g = golfer(), st = golferStats(g), pk = golferPerks(g), a = ARCHETYPES[g.archetype];
      return sheet('campaign',
        h('h2', { class: 'h', text: 'Character' }),
        golferCard(g),
        h('p', { class: 'small', text: `${a.name}: ${a.text}` }),
        h('div', { class: 'stats' }, ...STATS.map((k) => {
          const cap = Math.min(STAT_MAX, a.caps[k] ?? STAT_MAX);
          return h('div', { class: 'statrow' }, h('span', { class: 'statname', text: STAT_INFO[k].name, title: STAT_INFO[k].text }),
            h('span', { class: 'statbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(st[k]), 'aria-label': `${STAT_INFO[k].name} ${st[k]} of ${cap}` }, h('i', { style: { width: `${st[k]}%` } }), cap < STAT_MAX ? h('em', { class: 'cap', style: { left: `${cap}%` } }) : null),
            h('b', { text: String(st[k]) }));
        })),
        h('p', { class: 'muted small', text: `Weakness: ${a.weakness} The thin mark on a bar is its cap.` }),
        h('h3', { class: 'h small', text: 'Perks' }),
        h('div', { class: 'list' }, ...Object.entries(pk).filter(([, v]) => v > 0).map(([k, v]) => h('div', { class: 'item' }, h('span', { text: PERK_INFO[k].name }), h('span', { class: 'small', text: `${PERK_INFO[k].fmt(v)} ${PERK_INFO[k].unit}` }))),
          Object.values(pk).every((v) => !v) ? h('p', { class: 'muted small', text: 'No perks yet.' }) : null),
        h('p', { class: 'muted small', text: `Shots: Full, Chip${['punch', 'high', 'flop', 'bump'].filter((s) => shotUnlocked(g, s)).map((s) => `, ${SHOTS[s]}`).join('')}.` }),
        h('div', { class: 'grid2' }, back(), btn('Skill tree', () => skillTree(), 'btn primary')));
    });
  }

  // ---------- skill tree ----------
  let picked = null;
  function skillTree() {
    screens.show('skilltree', () => {
      const g = golfer(), tree = treeFor(g.archetype);
      const node = picked ? tree.find((n) => n.id === picked) : null;
      const can = node ? canBuy(g, node.id) : null;
      return sheet('wide campaign',
        h('h2', { class: 'h', text: `Skill tree: ${ARCHETYPES[g.archetype].name}` }),
        h('p', { class: 'row' }, h('span', { class: 'chip', text: `${pointsFree(g)} point${pointsFree(g) === 1 ? '' : 's'} free` }), h('span', { class: 'muted small', text: `Level ${golferLevel(g)}. One point per level.` })),
        h('div', { class: 'tree' }, ...BRANCH_NAMES.map((bn, b) => h('div', { class: 'branch' }, h('span', { class: 'bname', text: bn }),
          ...tree.filter((n) => n.branch === b).map((n) => {
            const own = g.nodes.includes(n.id), avail = !own && canBuy(g, n.id).ok;
            return h('button', { class: `node k-${n.kind}${own ? ' own' : avail ? ' avail' : ''}${picked === n.id ? ' sel' : ''}`, type: 'button', 'aria-pressed': picked === n.id ? 'true' : 'false', onclick: () => { picked = n.id; skillTree(); }, 'aria-label': `${n.name}, ${own ? 'learned' : `${n.cost} point${n.cost === 1 ? '' : 's'}`}` },
              h('b', { text: n.name }), h('small', { text: own ? 'Learned' : `${n.cost} pt` }));
          })))),
        node ? h('div', { class: 'nodeinfo' }, h('b', { text: node.name }), h('span', { text: node.text }),
          g.nodes.includes(node.id) ? h('span', { class: 'good small', text: 'Learned.' }) : btn(`Learn (${node.cost} point${node.cost === 1 ? '' : 's'})`, () => { setGolfer(buyNode(golfer(), node.id)); skillTree(); }, 'btn primary', { disabled: !can.ok }),
          !can || can.ok || g.nodes.includes(node.id) ? null : h('span', { class: 'muted small', text: can.reason })) : h('p', { class: 'muted small', text: 'Tap a skill to see what it does.' }),
        h('div', { class: 'grid2', style: { marginTop: '10px' } }, back(), btn('Respec (free)', () => respecFlow(), 'btn', { disabled: !g.nodes.length })));
    });
  }
  function respecFlow() {
    screens.show('respec', () => sheet('campaign',
      h('h2', { class: 'h', text: 'Respec' }),
      h('p', { text: `Unlearn every skill and get all ${pointsTotal(golferLevel(golfer()), golfer().archetype)} points back to spend again. It is free.` }),
      h('div', { class: 'grid2' }, back(), btn('Respec', () => { setGolfer(respec(golfer())); picked = null; skillTree(); }, 'btn primary'))));
  }

  screens.register('campaign', hub);
  screens.register('character', () => (golfer().archetype ? characterSheet() : pickArchetype()));
  screens.register('skilltree', () => (golfer().archetype ? skillTree() : pickArchetype()));
  app.openCampaign = hub;
  app.pointsFree = () => pointsFree(golfer());
}
