// Display names: 3 to 18 characters of letters, digits, spaces, and a few marks, no links, and
// a small profanity filter that also catches common letter swaps (0 for o, 1 for i, and so on).
// The word list is short on purpose and lives here only to block names; it is never shown.

const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'porn', 'sex', 'twat', 'wank', 'piss', 'arse', 'asshole', 'kike', 'spic', 'chink', 'tranny'];
// Whole-word checks only for short words that are parts of ordinary names (Dickens, Cockburn,
// Scunthorpe): those count only as separate words.
const WHOLE_WORD = new Set(['dick', 'cock', 'fag', 'arse', 'sex', 'piss', 'spic']);
const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

export function normalizeForFilter(s) {
  return String(s).toLowerCase().split('').map((c) => SWAPS[c] || c).join('');
}
export function isProfane(name) {
  const n = normalizeForFilter(name);
  const squashed = n.replace(/[^a-z]/g, '');
  const words = n.split(/[^a-z]+/).filter(Boolean);
  // Repeated letters squeezed out too ("fuuuck").
  const squeezed = squashed.replace(/(.)\1+/g, '$1');
  for (const w of BLOCKED) {
    if (WHOLE_WORD.has(w)) { if (words.includes(w)) return true; continue; }
    if (squashed.includes(w) || squeezed.includes(w)) return true;
  }
  return false;
}

export function validateDisplayName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return { ok: false, name, reason: 'Use at least 3 characters.' };
  if (name.length > 18) return { ok: false, name, reason: 'Use at most 18 characters.' };
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name)) return { ok: false, name, reason: 'Use letters, numbers, spaces, and . _ \' - only.' };
  if (/(https?|www\.|\.com|\.net)/i.test(name)) return { ok: false, name, reason: 'Links are not allowed in names.' };
  if (isProfane(name)) return { ok: false, name, reason: 'Please choose a different name.' };
  return { ok: true, name };
}
