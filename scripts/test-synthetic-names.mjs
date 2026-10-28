// Made-up restricted names for the lab tests: random consonants, new on every test run, added to the lab screen
// (addScreenNames, test-scoped) so a test plants one where a real restricted name would stand. A real one is never
// spelled in this public repository: the site's leak gate screens the tracked source too.
import { randomBytes } from 'node:crypto';
import { addScreenNames } from './lab-dispatch-publish.mjs';

const word = length => [...randomBytes(length)].map(byte => 'bcdfghjklmnpqrstvwxz'[byte % 20]).join('');
/** Stands in for a private repository's short name. */
export const SYN_REPO = `zq${word(8)}`;
/** Stands in for the client theme (a word of the client's domain). */
export const SYN_THEME = `zq${word(10)}`;
addScreenNames(SYN_REPO, SYN_THEME);
