// Username and password accounts, as pure functions (tests/account.test.js).
//
// There is no email on an account. The username maps to a private auth address that is never
// shown (username@fairway.invalid, a reserved domain that cannot receive mail), so there is no
// magic link and no password reset. Sign-up passes a robot check: a picture of 5 digits from
// the server (fairway_new_challenge), shown through an img data URL, never as HTML.
import { isProfane } from '../game/names.js';

export const AUTH_DOMAIN = 'fairway.invalid';
export const APP_ID = 'fairway';
export const USERNAME_MIN = 3, USERNAME_MAX = 16;
export const PASSWORD_MIN = 8, PASSWORD_MAX = 72;
export const DISPLAY_MAX = 20;
export const CHALLENGE_DIGITS = 5;
export const CHALLENGE_MIN_MS = 2000; // the server refuses an answer sooner than this
export const NEW_PICTURE_MS = 3000; // the New picture button, at most once per this
export const NO_RESET_LINE = 'There is no email on this account, so a forgotten password cannot be reset.';
export const PICTURE_ALT = 'Security picture with 5 digits';
export const PICTURE_PROMPT = 'Type the 5 digits you see';

const utf8Length = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length);

// Usernames: 3 to 16 of a-z, 0-9 and _. Whatever the player types is lowercased first.
export function validateUsername(raw) {
  const typed = String(raw ?? '').trim();
  const username = typed.toLowerCase();
  if (username.length < USERNAME_MIN) return { ok: false, username, typed, reason: `Use at least ${USERNAME_MIN} characters.` };
  if (username.length > USERNAME_MAX) return { ok: false, username, typed, reason: `Use at most ${USERNAME_MAX} characters.` };
  if (!/^[a-z0-9_]+$/.test(username)) return { ok: false, username, typed, reason: 'Use lowercase letters, numbers and _ only.' };
  if (isProfane(username)) return { ok: false, username, typed, reason: 'Please choose a different username.' };
  return { ok: true, username, typed };
}

// Passwords: 8 to 72 characters (and at most 72 bytes, the limit of the server's hash).
export function validatePassword(raw) {
  const password = String(raw ?? '');
  if (password.length < PASSWORD_MIN) return { ok: false, reason: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX) return { ok: false, reason: `Use at most ${PASSWORD_MAX} characters.` };
  if (utf8Length(password) > PASSWORD_MAX) return { ok: false, reason: 'That password is too long: some symbols count as more than one character.' };
  return { ok: true };
}

// The private auth address for a username. Never shown.
export const authEmail = (username) => `${String(username).toLowerCase()}@${AUTH_DOMAIN}`;

// Validate and map in one step: { ok, username, display, email, password } or { ok: false, field, reason }.
export function credentials(rawUser, rawPassword) {
  const u = validateUsername(rawUser);
  if (!u.ok) return { ok: false, field: 'username', reason: u.reason };
  const p = validatePassword(rawPassword);
  if (!p.ok) return { ok: false, field: 'password', reason: p.reason };
  return { ok: true, username: u.username, display: u.typed.slice(0, DISPLAY_MAX), email: authEmail(u.username), password: String(rawPassword) };
}

// The answer to the picture: exactly 5 digits (spaces and other characters dropped).
export function cleanAnswer(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length === CHALLENGE_DIGITS ? d : null;
}

// The sign-up call, in the shape of supabase.auth.signUp. data.app = 'fairway' tells the
// shared project's trigger that this is a game account; the server then checks the picture
// and sets app_metadata.fairway = true.
export function signUpPayload({ username, password, challengeId, answer }) {
  return { email: authEmail(username), password, options: { data: { app: APP_ID, username, challenge_id: challengeId, challenge_answer: answer } } };
}

// The picture from the server as an img src. The svg text is only ever a data URL; it is
// never inserted into the page as markup.
export const pictureSrc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg ?? ''))}`;

// The game flag the server sets on accounts that passed the robot check.
export const isGameAccount = (user) => !!(user && user.app_metadata && user.app_metadata.fairway === true);

// Errors as plain text. Raw server text is never shown. newPicture: load a new picture.
export const AUTH_TEXT = {
  badCode: 'That code was wrong or expired. Here is a new picture.',
  taken: 'That username is taken.',
  badLogin: 'That username and password do not match.',
  rate: 'Too many tries. Please wait a minute and try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  server: 'The server had a problem. Please try again in a moment.',
  noCloud: 'Cloud save is not available for this account.',
  unknown: 'Something went wrong. Please try again.',
};
export function authError(err) {
  const raw = typeof err === 'string' ? err : err && typeof err === 'object' ? [err.error, err.code, err.error_code, err.msg, err.message, err.error_description, err.detail && (err.detail.msg || err.detail.message || err.detail.error_description || err.detail.error_code || err.detail.code)].filter(Boolean).join(' ') : '';
  const t = raw.toLowerCase();
  const status = err && typeof err === 'object' ? Number(err.status) || 0 : 0;
  if (t.includes('robot check failed') || t.includes('database error saving new user')) return { text: AUTH_TEXT.badCode, newPicture: true };
  if (t.includes('user already registered') || t.includes('user_already_exists') || t.includes('taken')) return { text: AUTH_TEXT.taken, field: 'username' };
  if (status === 429 || t.includes('rate limit') || t.includes('rate_limit') || t.includes('rate-limited') || t.includes('too many')) return { text: AUTH_TEXT.rate };
  if (t.includes('offline') || t.includes('failed to fetch') || t.includes('network')) return { text: AUTH_TEXT.network };
  if (t.includes('invalid login') || t.includes('invalid_credentials') || t.includes('invalid_grant') || t.includes('bad-credentials')) return { text: AUTH_TEXT.badLogin };
  if (status >= 500 || t === 'server' || t.startsWith('server ')) return { text: AUTH_TEXT.server };
  return { text: AUTH_TEXT.unknown };
}
