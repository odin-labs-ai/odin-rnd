// The <source> elements of every film player the generators write: the MP4 copy when listed, then its WebM (see "WHO WRITES A PLAYER" in scripts/film-pairs.mjs, whose dist pass counts them). This module reads the record
// as data and imports nothing from the site's scripts, so every generator can use it; the record and each copy are
// checked by readFallbacks() in scripts/film-fallbacks.mjs, which the dist pass calls before it counts anything (an
// MP4 path that is not the WebM's own beside it is never counted).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FALLBACKS_FILE = 'data/labs/agent-space/film-fallbacks.json';
/** A WebM path inside the site: letters, digits, ".", "_", "-" and "/" between named segments, ending in .webm. */
const PLAIN_WEBM = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.webm$/;
export const WEBM_TYPE = /^video\/webm(?:;[a-z0-9=,. -]*)?$/;
let ledger = null;
const copies = new Map();
function copyFor(webm, root) {
  if (!copies.has(root)) {
    const file = join(root, FALLBACKS_FILE);
    copies.set(root, new Map(existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).fallbacks ?? []).map(entry => [entry.webm, entry]) : []));
  }
  return copies.get(root).get(webm) ?? null;
}

/**
 * The <source> elements of one player: the recorded MP4 copy first, followed by the original WebM. Refuses anything but a plain relative path and a WebM type, so nothing it writes needs
 * escaping. While a ledger is open, every pair it writes is counted.
 */
export function filmSources(up, webm, type = 'video/webm', root = 'site') {
  if (!/^(?:\.\.\/)*$/.test(up) || !PLAIN_WEBM.test(webm) || !WEBM_TYPE.test(type)) throw new Error(`filmSources: ${JSON.stringify({ up, webm, type })} is not a plain relative path to a WebM with a WebM type`);
  const entry = copyFor(webm, root);
  if (entry && ledger) ledger.set(webm, (ledger.get(webm) ?? 0) + 1);
  return `${entry ? `<source src="${up}${entry.mp4}" type="video/mp4">` : ''}<source src="${up}${webm}" type="${type}">`;
}

/** Opens the ledger of pairs filmSources() writes; the returned function closes it and returns film -> pairs written. */
export function startFilmLedger() {
  if (ledger) throw new Error('Film fallbacks: a film ledger is already open');
  ledger = new Map();
  return () => { const written = ledger; ledger = null; return written; };
}
