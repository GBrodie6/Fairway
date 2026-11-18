// Username and password accounts with the robot check (src/net/account.js, src/ui/account.js):
// username rules and the private address mapping, password rules, the sign-up payload, error
// text, the table names, and that the server's picture only ever reaches the page as an img
// data URL.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  validateUsername, validatePassword, authEmail, credentials, cleanAnswer, signUpPayload, pictureSrc,
  isGameAccount, authError, AUTH_TEXT, NO_RESET_LINE, PICTURE_ALT, PICTURE_PROMPT, AUTH_DOMAIN,
} from '../src/net/account.js';
import { TABLES, RPCS } from '../src/net/tables.js';
import { createSupabase, userOf } from '../src/net/supabase.js';
import { createFakeSupabase } from '../src/net/fakeSupabase.js';

describe('table and procedure names', () => {
  it('every table carries the fairway_ prefix and the names live in one file', () => {
    expect(TABLES).toEqual({ profiles: 'fairway_profiles', saves: 'fairway_saves', scores: 'fairway_scores' });
    expect(RPCS).toEqual({ newChallenge: 'fairway_new_challenge', deleteMyAccount: 'fairway_delete_my_account' });
    expect(Object.isFrozen(TABLES)).toBe(true);
    // No other source file names a table or procedure as a string.
    const dir = path.resolve('src');
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
    for (const f of walk(dir)) {
      if (f.endsWith(path.join('net', 'tables.js'))) continue;
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/['"`]fairway_(profiles|saves|scores|new_challenge|delete_my_account)['"`]/);
      expect(src, f).not.toMatch(/(select|upsert|insert|remove|update)\(\s*['"`](profiles|saves|scores)['"`]/);
    }
  });
});

describe('usernames and passwords', () => {
  it('3 to 16 of a-z, 0-9 and _, lowercased from whatever is typed', () => {
    expect(validateUsername('Ana_99')).toEqual({ ok: true, username: 'ana_99', typed: 'Ana_99' });
    expect(validateUsername('  KIT  ').username).toBe('kit');
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('a'.repeat(16)).ok).toBe(true);
    expect(validateUsername('a'.repeat(17)).ok).toBe(false);
    for (const bad of ['has space', 'dash-name', 'dot.name', 'émile', 'at@sign', '<b>x</b>', '']) expect(validateUsername(bad).ok).toBe(false);
    expect(validateUsername('sh1tshot').ok).toBe(false); // the profanity filter
    expect(validateUsername(null).ok).toBe(false);
  });
  it('maps a username to a private address on a reserved domain', () => {
    expect(AUTH_DOMAIN).toBe('fairway.invalid');
    expect(authEmail('ana_99')).toBe('ana_99@fairway.invalid');
    expect(authEmail('ANA')).toBe('ana@fairway.invalid');
    const c = credentials('Ana_99', 'password1');
    expect(c).toEqual({ ok: true, username: 'ana_99', display: 'Ana_99', email: 'ana_99@fairway.invalid', password: 'password1' });
    expect(credentials('ok_name', 'short')).toMatchObject({ ok: false, field: 'password' });
    expect(credentials('x', 'password1')).toMatchObject({ ok: false, field: 'username' });
  });
  it('passwords are 8 to 72 characters and at most 72 bytes', () => {
    expect(validatePassword('1234567').ok).toBe(false);
    expect(validatePassword('12345678').ok).toBe(true);
    expect(validatePassword('x'.repeat(72)).ok).toBe(true);
    expect(validatePassword('x'.repeat(73)).ok).toBe(false);
    expect(validatePassword('é'.repeat(40)).ok).toBe(false); // 80 bytes
    expect(validatePassword(undefined).ok).toBe(false);
  });
});

describe('the robot check and the sign-up payload', () => {
  it('the payload declares the game app, the username and the answer', () => {
    const p = signUpPayload({ username: 'ana', password: 'password1', challengeId: 'c-1', answer: '04721' });
    expect(p).toEqual({ email: 'ana@fairway.invalid', password: 'password1', options: { data: { app: 'fairway', username: 'ana', challenge_id: 'c-1', challenge_answer: '04721' } } });
  });
  it('the client sends exactly that to the auth endpoint', async () => {
    const fake = createFakeSupabase();
    const client = createSupabase({ url: 'https://demo.local', anonKey: 'anon', fetchImpl: fake.fetch });
    await client.signUp(signUpPayload({ username: 'ana', password: 'password1', challengeId: 'c-1', answer: '12345' }));
    const call = fake.calls.find((c) => c.path === '/auth/v1/signup');
    expect(call.body).toEqual({ email: 'ana@fairway.invalid', password: 'password1', data: { app: 'fairway', username: 'ana', challenge_id: 'c-1', challenge_answer: '12345' } });
  });
  it('answers are exactly 5 digits', () => {
    expect(cleanAnswer('12345')).toBe('12345');
    expect(cleanAnswer(' 1 2 3 4 5 ')).toBe('12345');
    expect(cleanAnswer('1234')).toBe(null);
    expect(cleanAnswer('123456')).toBe(null);
    expect(cleanAnswer('abcde')).toBe(null);
  });
  it('the server rules: a wrong, reused, too quick or stale answer gets no account', async () => {
    let t = 1e12;
    const fake = createFakeSupabase({ now: () => t });
    const client = createSupabase({ url: 'https://demo.local', anonKey: 'anon', fetchImpl: fake.fetch, now: () => t });
    const ask = async () => (await client.rpc(RPCS.newChallenge)).data;
    const go = (u, ch, a) => client.signUp(signUpPayload({ username: u, password: 'password1', challengeId: ch.id, answer: a }));
    let ch = await ask(); t += 2500;
    expect(authError(await go('wrong', ch, '00000')).newPicture).toBe(true);
    ch = await ask(); t += 500; // too quick
    expect(authError(await go('quick', ch, fake.lastChallenge().answer)).newPicture).toBe(true);
    ch = await ask(); t += 11 * 60000; // expired
    expect(authError(await go('stale', ch, fake.lastChallenge().answer)).newPicture).toBe(true);
    ch = await ask(); const a = fake.lastChallenge().answer; t += 2500;
    const ok = await go('right', ch, a);
    expect(isGameAccount(ok.data.session.user)).toBe(true);
    await client.signOut();
    expect(authError(await go('reuse', ch, a)).newPicture).toBe(true); // a picture works once
  });
  it('the picture is an img data URL, never markup', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>12345</text><script>alert(1)</script></svg>';
    const src = pictureSrc(svg);
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(src).not.toMatch(/[<>"]/);
    expect(decodeURIComponent(src.slice(src.indexOf(',') + 1))).toBe(svg);
    // The screen code: the picture is an img with the alt text, its src set from pictureSrc,
    // and nothing in the account code writes HTML.
    const ui = readFileSync(path.resolve('src/ui/account.js'), 'utf8');
    const net = readFileSync(path.resolve('src/net/account.js'), 'utf8');
    expect(ui).toMatch(/h\('img', \{ class: 'robotpic', alt: PICTURE_ALT/);
    expect(ui).toMatch(/picture\.src = pictureSrc\(d\.svg\)/);
    for (const code of [ui, net]) expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|document\.write/);
    expect(PICTURE_ALT).toBe('Security picture with 5 digits');
    expect(PICTURE_PROMPT).toBe('Type the 5 digits you see');
    expect(NO_RESET_LINE).toBe('There is no email on this account, so a forgotten password cannot be reset.');
    // No email field, magic link or password reset anywhere in the account screen.
    expect(ui).not.toMatch(/type="email"|'email'|magic|resetPassword|Forgot password|VITE_EMAIL_FLOWS/);
  });
});

describe('error text', () => {
  it('maps server errors to plain words and never shows the raw text', () => {
    const badCode = { text: 'That code was wrong or expired. Here is a new picture.', newPicture: true };
    expect(authError({ error: 'unknown', detail: { message: 'Robot check failed' } })).toEqual(badCode);
    expect(authError({ error: 'server', status: 500, detail: { code: 'unexpected_failure', message: 'Database error saving new user' } })).toEqual(badCode);
    expect(authError({ error: 'taken', detail: { msg: 'User already registered' } }).text).toBe('That username is taken.');
    expect(authError({ error: 'rate-limited', status: 429, detail: { message: 'email rate limit exceeded' } }).text).toBe(AUTH_TEXT.rate);
    expect(authError({ error: 'offline' }).text).toBe(AUTH_TEXT.network);
    expect(authError({ error: 'bad-credentials', detail: { error_description: 'Invalid login credentials' } }).text).toBe(AUTH_TEXT.badLogin);
    expect(authError({ error: 'server', status: 503 }).text).toBe(AUTH_TEXT.server);
    const odd = authError({ error: 'unknown', detail: { message: 'relation "x" does not exist at character 42' } });
    expect(odd.text).toBe(AUTH_TEXT.unknown);
    for (const v of Object.values(AUTH_TEXT)) expect(v).not.toMatch(/—/);
  });
  it('the game flag is read from app_metadata only', () => {
    expect(isGameAccount({ app_metadata: { fairway: true } })).toBe(true);
    expect(isGameAccount({ app_metadata: { fairway: 'true' } })).toBe(false);
    expect(isGameAccount({ user_metadata: { fairway: true } })).toBe(false);
    expect(isGameAccount(null)).toBe(false);
    expect(userOf({ id: 'u1', email: 'ana@fairway.invalid', app_metadata: { fairway: true }, user_metadata: { username: 'ana' } })).toEqual({ id: 'u1', username: 'ana', app_metadata: { fairway: true } });
  });
});
