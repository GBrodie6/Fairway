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
import { createSync, cloudPayload } from '../net/sync.js';
import { RPCS } from '../net/tables.js';
import {
  credentials, cleanAnswer, signUpPayload, pictureSrc, isGameAccount, authError, AUTH_TEXT,
  NO_RESET_LINE, PICTURE_ALT, PICTURE_PROMPT, CHALLENGE_MIN_MS, NEW_PICTURE_MS, USERNAME_MAX, PASSWORD_MAX,
} from '../net/account.js';
import { BOARDS, BOARD_NOTE, fetchBoard, submitScore } from '../net/leaderboard.js';
import { defaultSave, migrateSave } from '../game/save.js';

const storage = () => {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* blocked */ }
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

export const PRIVACY_TEXT = [
  'Fairway Next keeps as little about you as it can.',
  'On this device: your settings and your game progress, in the browser\'s local storage.',
  'If you make an account: a username you choose, your password (kept by our database host as a one-way hash, never readable), and your game data (progress, gear, scores), so you can play on other devices. There is no email address on an account.',
  'Sign-up shows a picture of 5 digits to keep robots out. Your answer is checked once and not kept.',
  'Leaderboards show your username and your scores to other players.',
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

  // ---------- the robot check ----------
  // The picture comes from the server as svg text and is shown only as an img data URL.
  const pic = { id: null, at: 0, askedAt: 0, loading: false };
  const picture = h('img', { class: 'robotpic', alt: PICTURE_ALT, width: '220', height: '80' });
  const newPicBtn = h('button', { class: 'btn small', type: 'button' }, 'New picture');
  async function loadPicture(force = false) {
    const t = Date.now();
    if (pic.loading || (!force && t - pic.askedAt < NEW_PICTURE_MS)) return false;
    pic.loading = true; pic.askedAt = t;
    newPicBtn.disabled = true;
    setTimeout(() => { newPicBtn.disabled = false; }, NEW_PICTURE_MS);
    const r = await client.rpc(RPCS.newChallenge);
    pic.loading = false;
    const d = r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
    if (r.error || !d || !d.id || typeof d.svg !== 'string') { pic.id = null; say(authError(r).text); return false; }
    pic.id = d.id; pic.at = Date.now();
    picture.src = pictureSrc(d.svg);
    const code = document.getElementById('a-code'); if (code) code.value = '';
    return true;
  }
  newPicBtn.onclick = () => loadPicture();

  // After sign-up or sign-in: only accounts that passed the robot check get cloud save. The
  // flag can arrive a moment after the session; one user fetch and token refresh pick it up.
  async function checkFlag() {
    if (isGameAccount(client.user)) return true;
    await client.fetchUser();
    if (isGameAccount(client.user)) { await client.refresh(); return true; }
    return false;
  }
  async function notForCloud() {
    await client.signOut();
    say(AUTH_TEXT.noCloud);
  }

  let busy = false;
  async function doAuth(kind) {
    if (busy) return;
    const c = credentials(val('a-user'), document.getElementById('a-pass') ? document.getElementById('a-pass').value : '');
    if (!c.ok) { say(c.reason); return; }
    busy = true;
    try {
      if (kind === 'create') {
        const answer = cleanAnswer(val('a-code'));
        if (!answer) { say(PICTURE_PROMPT + '.'); return; }
        if (!pic.id) { await loadPicture(true); say('Here is a picture. ' + PICTURE_PROMPT + '.'); return; }
        // The server refuses an answer within 2 seconds of the picture.
        const wait = CHALLENGE_MIN_MS + 250 - (Date.now() - pic.at);
        say('Creating your account...');
        if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        const r = await client.signUp(signUpPayload({ username: c.username, password: c.password, challengeId: pic.id, answer }));
        pic.id = null; // a picture works once
        if (r.error) { const e = authError(r); say(e.text); if (e.newPicture) await loadPicture(true); return; }
        // Email confirmation is off, so a session normally comes back at once; if not, sign in.
        if (!r.data.session) {
          const s = await client.signIn(c.email, c.password);
          if (s.error) { say(authError(s).text); return; }
        }
        if (!(await checkFlag())) { await notForCloud(); return; }
        const m = await sync.afterSignIn({ displayName: c.display, created: true });
        if (m.error) { say(messageFor(m.error)); return; }
      } else {
        say('Signing in...');
        const r = await client.signIn(c.email, c.password);
        if (r.error) { say(authError(r).text); return; }
        if (!(await checkFlag())) { await notForCloud(); return; }
        const m = await sync.afterSignIn({});
        if (m.error) { say(messageFor(m.error)); return; }
      }
      ui.hud.toast('Signed in', 'Your progress is saved to your account', 2200);
      screens.registry.account();
    } finally { busy = false; }
  }

  // ---------- backup files ----------
  function downloadBackup() {
    const s = app.save();
    const text = JSON.stringify({ app: 'fairway-next', kind: 'save-backup', exportedAt: new Date().toISOString(), save: cloudPayload(s) });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: `fairway-save-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    say('Backup downloaded. Keep the file somewhere safe.');
  }
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { say('That file is too big to be a Fairway Next backup.'); return; }
    let data;
    try { const j = JSON.parse(await f.text()); data = j && j.kind === 'save-backup' ? j.save : j; } catch { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.player) { say('That file is not a Fairway Next backup.'); return; }
    if (sync.restoreFromData(migrateSave(data))) { ui.hud.toast('Backup restored', 'The save it replaced is kept under Backups', 2200); screens.registry.account(); }
  };
  const backupButtons = () => h('div', { class: 'grid2' }, btn('Download backup', downloadBackup), btn('Restore from file', () => fileInput.click()), fileInput);

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
        h('h3', { class: 'h', text: 'Backups' }), backupButtons(), status, backupsList(),
        h('div', { class: 'stack', style: { marginTop: '12px' } }, btn('Privacy', () => screens.registry.privacy()), btn('Delete my data', deleteFlow), back()),
      );
    }
    if (!client.user) {
      const tabs = h('div', { class: 'seg', role: 'tablist' },
        h('button', { type: 'button', 'aria-pressed': mode === 'create' ? 'true' : 'false', onclick: () => { mode = 'create'; screens.registry.account(); } }, "I'm new"),
        h('button', { type: 'button', 'aria-pressed': mode === 'signin' ? 'true' : 'false', onclick: () => { mode = 'signin'; screens.registry.account(); } }, 'I have an account'));
      const create = mode === 'create';
      if (create && !pic.id && !pic.loading) loadPicture(true);
      return sheet('',
        h('h2', { class: 'h', text: create ? 'Keep your progress on any device' : 'Sign in' }),
        banner(),
        h('p', { class: 'muted', text: create ? 'Optional. You can keep playing as a guest; your progress on this device moves into the account when you sign up.' : 'Sign in with your username and password.' }),
        tabs,
        input('a-user', 'text', 'Username', '', { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: USERNAME_MAX, placeholder: create ? `3 to ${USERNAME_MAX}: a-z 0-9 _` : '' }),
        input('a-pass', 'password', 'Password', '', { autocomplete: create ? 'new-password' : 'current-password', maxlength: PASSWORD_MAX, placeholder: create ? `8 to ${PASSWORD_MAX} characters` : '' }),
        create ? h('div', { class: 'robot' },
          h('p', { class: 'small', text: PICTURE_PROMPT }),
          h('div', { class: 'robotrow' }, picture, newPicBtn),
          input('a-code', 'text', 'The 5 digits', '', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: '5', autocomplete: 'one-time-code' })) : null,
        create ? h('p', { class: 'muted small', text: NO_RESET_LINE }) : null,
        status,
        h('div', { class: 'stack' },
          btn(create ? 'Create account' : 'Sign in', () => doAuth(mode), 'btn primary'),
          h('h3', { class: 'h', text: 'Backups' }), backupButtons(),
          h('div', { class: 'grid2' }, btn('Privacy', () => screens.registry.privacy()), back())),
      );
    }
    const acct = save.account || {};
    return sheet('',
      h('h2', { class: 'h', text: 'Your account' }),
      banner(),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('span', { text: 'Username' }), h('b', { text: acct.displayName || client.user.username || acct.username || '' })),
        h('div', { class: 'item' }, h('span', { text: 'Cloud save' }), h('b', { text: sync.status === 'error' ? 'waiting' : sync.pending() ? 'queued' : `synced ${ago(sync.lastSync)}` }))),
      h('p', { class: 'muted small', text: NO_RESET_LINE + ' A downloaded backup keeps your progress safe too.' }),
      status,
      h('div', { class: 'grid2' },
        btn('Sync now', async () => { say('Syncing...'); const r = await sync.flush(); say(r.error ? messageFor(r.error) : 'Synced.'); }),
        btn('Sign out', async () => { await sync.signOut(); ui.hud.toast('Signed out', 'You are playing as a guest', 2000); screens.registry.account(); })),
      h('h3', { class: 'h', text: 'Backups' }), backupButtons(), backupsList(),
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        btn('Privacy', () => screens.registry.privacy()),
        btn('Delete my data', deleteFlow), back()),
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
