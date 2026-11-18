// Accounts, cloud save, leaderboards, and privacy screens.
//
// The cloud is optional: everyone plays as a guest by default and nothing is ever required.
// Builds made without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY keep cloud sync off and say
// so. "?cloud=demo" runs the same screens against an in-memory stand-in on this device (for
// trying the flows and for QA screenshots); nothing leaves the device in that mode.
import { h } from './dom.js';
import { fmtToPar } from './format.js';
import { createSupabase, cloudConfig, messageFor } from '../net/supabase.js';
import { createFakeSupabase } from '../net/fakeSupabase.js';
import { createSync } from '../net/sync.js';
import { BOARDS, BOARD_NOTE, fetchBoard, submitScore } from '../net/leaderboard.js';
import { validateDisplayName } from '../game/names.js';
import { defaultSave, migrateSave } from '../game/save.js';

const storage = () => {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* blocked */ }
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

export const PRIVACY_TEXT = [
  'Fairway Next keeps as little about you as it can.',
  'On this device: your settings and your game progress, in the browser\'s local storage.',
  'If you make an account: your email address, a display name you choose, and your game data (progress, gear, scores), stored with our database host so you can play on other devices.',
  'Leaderboards show your display name and your scores to other players.',
  'There are no ads, no tracking, no analytics, and nothing is sold or shared.',
  'Delete my data removes your account, your cloud data, and everything on this device. It cannot be undone.',
];

export function installAccount(app, ui) {
  const { screens } = ui;
  const st = storage();
  const cfg = cloudConfig();
  const demo = app.params && app.params.cloud === 'demo';
  let client;
  if (demo) {
    const fake = createFakeSupabase();
    client = createSupabase({ url: 'https://demo.invalid', anonKey: 'demo', fetchImpl: fake.fetch, storage: st });
  } else client = createSupabase({ url: cfg.url, anonKey: cfg.anonKey, storage: st });
  const sync = createSync({
    client, storage: st,
    getSave: () => app.save(),
    applySave: (s) => app.setSave(migrateSave(s)),
  });
  app.cloud = { client, sync, enabled: client.configured, demo };
  // A magic link or a password reset link lands with tokens in the URL fragment.
  if (client.configured && /access_token=/.test(location.hash || '')) {
    const s = client.acceptRedirect(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (s) sync.afterSignIn({}).then(() => ui.hud.toast('Signed in', 'Your progress is synced', 2200));
  }
  // Push anything queued from an earlier visit once the page is up.
  if (client.configured && client.user && sync.pending()) setTimeout(() => sync.flush(), 3000);
  window.addEventListener('online', () => { if (client.user && sync.pending()) sync.flush(); });

  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);
  const back = () => btn('Back', () => screens.back());
  const input = (id, type, label, value = '', extra = {}) => h('div', { class: 'field' }, h('label', { for: id, text: label }), h('input', { id, type, value, autocomplete: extra.autocomplete || 'off', ...extra }));
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const say = (text) => { status.textContent = text || ''; };
  const banner = () => (demo ? h('p', { class: 'chip warn', text: 'Demo mode: accounts live in memory on this device. Nothing is sent anywhere.' }) : null);
  let mode = 'create';

  const ago = (t) => { if (!t) return 'not yet'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

  async function doAuth(kind) {
    const email = val('a-email'), password = val('a-pass');
    say('Working...');
    let r;
    if (kind === 'create') {
      const n = validateDisplayName(val('a-name'));
      if (!n.ok) { say(n.reason); return; }
      r = await client.signUp(email, password, n.name);
      if (r.error) { say(messageFor(r.error)); return; }
      if (r.data.needsConfirmation) { say('Check your email to confirm your account, then sign in.'); return; }
      const m = await sync.afterSignIn({ displayName: n.name });
      if (m.error) { say(messageFor(m.error)); return; }
    } else if (kind === 'signin') {
      r = await client.signIn(email, password);
      if (r.error) { say(messageFor(r.error)); return; }
      const m = await sync.afterSignIn({});
      if (m.error) { say(messageFor(m.error)); return; }
    } else if (kind === 'magic') {
      r = await client.magicLink(email, location.origin + location.pathname);
      say(r.error ? messageFor(r.error) : 'We sent a sign-in link to that address.');
      return;
    } else if (kind === 'reset') {
      r = await client.resetPassword(email, location.origin + location.pathname);
      say(r.error ? messageFor(r.error) : 'If that address has an account, a reset link is on its way.');
      return;
    }
    ui.hud.toast('Signed in', 'Your progress is saved to your account', 2200);
    screens.registry.account();
  }

  function backupsList() {
    const list = sync.backups();
    if (!list.length) return h('p', { class: 'muted', text: 'No backups. When a newer save replaces this one, the older one is kept here for 30 days.' });
    return h('div', { class: 'list' }, ...list.map((b) => h('div', { class: 'item' },
      h('span', { text: `${new Date(b.savedAt).toLocaleString()}: ${b.reason}` }),
      btn('Restore', () => { if (sync.restoreBackup(b.id)) { ui.hud.toast('Backup restored', '', 1800); screens.registry.account(); } }, 'btn small'))));
  }

  function deleteFlow() {
    screens.show('delete', () => sheet('',
      h('h2', { class: 'h', text: 'Delete my data' }),
      h('p', { text: client.user ? 'This deletes your account, your cloud save, your leaderboard scores, and all progress on this device.' : 'This deletes all game progress on this device.' }),
      h('p', { class: 'muted', text: 'It cannot be undone. Your settings (sound, quality, and so on) stay.' }),
      status,
      h('div', { class: 'grid2' }, back(), btn('Delete everything', async () => {
        say('Deleting...');
        const r = await sync.deleteEverything(defaultSave());
        if (r.error) { say(r.message); return; }
        say('');
        ui.hud.toast('Your data was deleted', '', 2400);
        screens.menu();
      }, 'btn primary')),
    ));
  }
  app.deleteMyData = deleteFlow;

  screens.register('account', () => screens.show('account', () => {
    say(sync.message || '');
    const save = app.save();
    if (!client.configured) {
      return sheet('',
        h('h2', { class: 'h', text: 'Account and cloud save' }),
        h('p', { text: messageFor('off') }),
        h('p', { class: 'muted', text: 'You play as a guest. Leaderboards and playing on other devices need cloud sync, which is not set up in this build.' }),
        h('h3', { class: 'h', text: 'Backups on this device' }), backupsList(),
        h('div', { class: 'stack', style: { marginTop: '12px' } }, btn('Privacy', () => screens.registry.privacy()), btn('Delete my data', deleteFlow), back()),
      );
    }
    if (!client.user) {
      const tabs = h('div', { class: 'seg', role: 'tablist' },
        h('button', { type: 'button', 'aria-pressed': mode === 'create' ? 'true' : 'false', onclick: () => { mode = 'create'; screens.registry.account(); } }, "I'm new"),
        h('button', { type: 'button', 'aria-pressed': mode === 'signin' ? 'true' : 'false', onclick: () => { mode = 'signin'; screens.registry.account(); } }, 'I have an account'));
      return sheet('',
        h('h2', { class: 'h', text: 'Keep your progress on any device' }),
        banner(),
        h('p', { class: 'muted', text: 'Optional. You can keep playing as a guest; your progress on this device moves into the account when you sign up.' }),
        tabs,
        mode === 'create' ? input('a-name', 'text', 'Display name', save.player.name || '', { maxlength: 18 }) : null,
        input('a-email', 'email', 'Email', '', { autocomplete: 'email', inputmode: 'email' }),
        input('a-pass', 'password', 'Password (8 or more characters)', '', { autocomplete: mode === 'create' ? 'new-password' : 'current-password' }),
        status,
        h('div', { class: 'stack' },
          btn(mode === 'create' ? 'Create account' : 'Sign in', () => doAuth(mode), 'btn primary'),
          h('div', { class: 'grid2' }, btn('Email me a sign-in link', () => doAuth('magic')), btn('Forgot password', () => doAuth('reset'))),
          h('div', { class: 'grid2' }, btn('Privacy', () => screens.registry.privacy()), back())),
      );
    }
    const acct = save.account || {};
    return sheet('',
      h('h2', { class: 'h', text: 'Your account' }),
      banner(),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('span', { text: 'Email' }), h('b', { text: client.user.email || acct.email || '' })),
        h('div', { class: 'item' }, h('span', { text: 'Cloud save' }), h('b', { text: sync.status === 'error' ? 'waiting' : sync.pending() ? 'queued' : `synced ${ago(sync.lastSync)}` }))),
      input('a-name', 'text', 'Display name', acct.displayName || save.player.name || '', { maxlength: 18 }),
      status,
      h('div', { class: 'grid2' },
        btn('Save name', () => {
          const n = validateDisplayName(val('a-name'));
          if (!n.ok) { say(n.reason); return; }
          app.setSave({ ...app.save(), account: { ...(app.save().account || {}), displayName: n.name }, player: { ...app.save().player, name: n.name }, updatedAt: Date.now() });
          sync.schedule('name');
          say('Saved.');
        }),
        btn('Sync now', async () => { say('Syncing...'); const r = await sync.flush(); say(r.error ? messageFor(r.error) : 'Synced.'); })),
      h('h3', { class: 'h', text: 'Backups on this device' }), backupsList(),
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        h('div', { class: 'grid2' }, btn('Sign out', async () => { await sync.signOut(); ui.hud.toast('Signed out', 'You are playing as a guest', 2000); screens.registry.account(); }), btn('Privacy', () => screens.registry.privacy())),
        btn('Delete account and data', deleteFlow), back()),
    );
  }));

  // ---------- leaderboards ----------
  let board = 'daily';
  screens.register('leaderboards', () => screens.show('leaderboards', () => {
    const tabs = h('div', { class: 'seg', role: 'tablist' }, ...Object.values(BOARDS).map((b) => h('button', { type: 'button', 'aria-pressed': board === b.id ? 'true' : 'false', onclick: () => { board = b.id; screens.registry.leaderboards(); } }, b.name)));
    const body = h('div', { class: 'list' }, h('p', { class: 'muted', text: client.configured ? 'Loading...' : 'Leaderboards need cloud sync, which is off in this build. Your own bests are kept on this device.' }));
    if (client.configured) {
      fetchBoard(client, board).then((r) => {
        body.textContent = '';
        if (r.error) { body.appendChild(h('p', { class: 'muted', text: messageFor(r.error) })); return; }
        if (!r.data.rows.length) { body.appendChild(h('p', { class: 'muted', text: 'No scores yet for this period. Be the first.' })); return; }
        const b = r.data.board;
        for (const row of r.data.rows) body.appendChild(h('div', { class: `item${row.me ? ' me' : ''}` }, h('span', { text: `${row.rank}. ${row.name}` }), h('b', { text: b.id === 'daily' ? fmtToPar(row.value) : `${row.value} ${b.unit}` })));
      });
    }
    return sheet('wide',
      h('h2', { class: 'h', text: 'Leaderboards' }),
      banner(),
      tabs,
      h('p', { class: 'muted', text: BOARD_NOTE }),
      body,
      !client.user && client.configured ? h('p', { class: 'muted', text: 'Sign in to post your scores. Anyone can read the boards.' }) : null,
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, client.configured && !client.user ? btn('Sign in', () => screens.registry.account()) : null, back()),
    );
  }));

  // ---------- privacy ----------
  screens.register('privacy', () => screens.show('privacy', () => sheet('',
    h('h2', { class: 'h', text: 'Privacy' }),
    ...PRIVACY_TEXT.map((t) => h('p', { text: t })),
    h('p', { class: 'muted' }, 'The same text is at ', h('a', { href: './privacy.html', target: '_blank', rel: 'noopener', text: 'privacy.html' }), '.'),
    h('div', { class: 'grid2' }, btn('Delete my data', deleteFlow), back()),
  )));

  // Scores go up only when signed in; failures are silent (the board is casual).
  app.postScore = (boardId, value) => {
    if (!client.configured || !client.user) return Promise.resolve({ error: 'guest' });
    const s = app.save();
    return submitScore(client, boardId, value, (s.account && s.account.displayName) || s.player.name).catch(() => ({ error: 'offline' }));
  };
  // The prompt after the first finished round (only when cloud sync exists in this build).
  app.accountPrompt = () => {
    const s = app.save();
    if (!client.configured || client.user || (app.settings.accountPromptSeen && s.history.length > 1)) return null;
    return h('div', { class: 'card' }, h('b', { text: 'Keep your progress on any device' }), h('span', { text: 'Optional: make a free account. You can keep playing as a guest.' }),
      h('div', { class: 'grid2', style: { marginTop: '8px' } }, btn('Create account', () => { app.settings.accountPromptSeen = true; app.saveSettings(); screens.registry.account(); }, 'btn small primary'), btn('Not now', (e) => { app.settings.accountPromptSeen = true; app.saveSettings(); e.target.closest('.card').remove(); }, 'btn small')));
  };
  return app.cloud;
}
