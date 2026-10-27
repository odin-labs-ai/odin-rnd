// Lab 01's Dispatch #2, "The agents caught a real outage" (lane dispatch2-film). scripts/labs.mjs fills the lab page's
// <!--LAB_OUTAGE--> marker with renderOutage() from site/data/labs/agent-space/outage.json (odin-lab-outage v1,
// scripts/schemas/odin-lab-outage.schema.json): one film of agents as QA, filmed on a throwaway copy of the space where
// one agent's server was stopped for real, the verdicts Odin gave with their evidence ids, and the private commit it
// was filmed from.
//
// The citation is fixed here, not in the record: a commit the record marks onMain: false is cited as "not yet part of
// the private main", with the main it was built on; only a record with onMain: true AND a mainCheck may say it was
// checked as part of the private main (the same words as scripts/lab-engine-history.mjs cite()). When the commit
// lands on main, a re-cite flips onMain and adds the mainCheck.
//
// The build refuses the record, every reason listed, when it misses the schema; when any text fails the publisher's
// screen or claims main while onMain is false; when the film or poster is missing, over MAX_FILM_BYTES, a different
// size than recorded or does not hash to its recorded sha256; when the screening record does not cover the film (the
// films gate's rule, scripts/lab-films.mjs). The rendered section is screened again as a whole: no machine path, no
// local host, address or port, no credential shape (lab-rogue.mjs pageLeaks), and no host name, memory or processor
// count of the machine that filmed it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';
import { pinnedAssetProblems, screenHits } from './lab-dispatch-publish.mjs';
import { MAX_FILM_BYTES, screeningProblems } from './lab-films.mjs';
import { pageLeaks, recordHashes } from './lab-rogue.mjs';
import { cite } from './lab-engine-history.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const OUTAGE_RECORD = 'data/labs/agent-space/outage.json';
export const OUTAGE_SCHEMA = join(here, 'schemas/odin-lab-outage.schema.json');
const ASSET_DIR = 'assets/labs/agent-space/outage/';
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// A claim that the commit is part of the private main; "not yet part of the private main" is not one.
export const MAIN_CLAIM = /(?<!not yet )part of the private main/i;

// What the machine that filmed it must never show, beyond pageLeaks: its host name, its memory and its processors.
export const MACHINE_LEAKS = [
  [/\b[\w-]+\.local\b|\bmacbook\b|\bmbp\b|\bdesktop-[a-z0-9]+\b/i, 'a host name'],
  [/\b\d+(?:\.\d+)?\s*[GM]i?B\b|memory is free|\bfree memory\b/i, 'a memory count'],
  [/\blogical processors?\b|\b\d+\s*(?:cpus?|cores?|processors?)\b/i, 'a processor count'],
];

/** Every reason the record may not be published (empty when it may); with `root`, its files must be there, pinned. */
export function outageProblems(record, { where = OUTAGE_RECORD, root = null } = {}) {
  const problems = validate(JSON.parse(readFileSync(OUTAGE_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-outage v1)`);
  if (problems.length) return problems;
  const { film, source } = record;
  // Hashes and commits are checked by the schema; asset paths as pinned assets below; every other string is page text.
  const text = (value, at) => {
    if (typeof value === 'string') {
      if (/^[0-9a-f]{16,64}$/.test(value) || at === '/film/src' || at === '/film/poster') return [];
      return [...screenHits(value).map(hit => `${where}#${at}: ${hit.reason}`),
        ...pageLeaks(escape(value)).map(p => `${where}#${at}: ${p}`),
        ...MACHINE_LEAKS.filter(([re]) => re.test(value)).map(([, reason]) => `${where}#${at}: ${reason}`),
        ...(!source.onMain && MAIN_CLAIM.test(value) ? [`${where}#${at}: claims the private main, but the commit is not on it (onMain: false)`] : [])];
    }
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => text(v, `${at}/${k}`));
    return [];
  };
  problems.push(...text(record, ''));
  if (source.onMain && !source.mainCheck) problems.push(`${where}#/source: onMain is true, but there is no mainCheck naming the main it was checked against`);
  if (!source.onMain && source.mainCheck) problems.push(`${where}#/source/mainCheck: a main check for a commit marked not on main`);
  if (source.onMain && source.mainCheck && source.mainCheck.checked < source.filmedOn) problems.push(`${where}#/source/mainCheck/checked: before the film was made`);
  problems.push(...screeningProblems({ ...film, screening: record.screening }, `${where}#/screening`));
  problems.push(...pinnedAssetProblems(film.src, `${where}#/film/src`, { under: ASSET_DIR, root, sha: film.sha256.src }));
  problems.push(...pinnedAssetProblems(film.poster, `${where}#/film/poster`, { under: ASSET_DIR, root, sha: film.sha256.poster }));
  if (root && existsSync(join(root, film.src))) {
    const bytes = statSync(join(root, film.src)).size;
    if (bytes !== film.bytes) problems.push(`${where}#/film/bytes: ${film.src} is ${bytes} bytes on disk, the record says ${film.bytes}`);
    if (bytes > MAX_FILM_BYTES) problems.push(`${where}#/film/bytes: ${film.src} is ${bytes} bytes, over the ${MAX_FILM_BYTES}-byte limit`);
  }
  if (record.screening.result !== 'pass' || record.screening.textRead.hits !== 0) problems.push(`${where}#/screening: the film did not pass its screen`);
  const asks = record.steps.filter(s => s.ask);
  if (!asks.some(s => s.verdict === 'fail') || asks.at(-1).verdict !== 'pass') problems.push(`${where}#/steps: an outage film shows a failing check and ends on a passing one`);
  if (new Set(asks.map(s => s.evidence)).size !== asks.length) problems.push(`${where}#/steps: each check has its own evidence id`);
  asks.forEach((s, i) => { if (!s.said.includes(s.verdict === 'fail' ? 'I found a problem' : 'Good news')) problems.push(`${where}#/steps/${i}/said: not what a ${s.verdict} verdict says`); });
  return problems;
}

/** The committed record, checked; null when there is none. Throws with every reason. */
export function readOutage(root = 'site') {
  const file = join(root, OUTAGE_RECORD);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const problems = outageProblems(record, { root });
  if (problems.length) throw new Error(`Lab 01 Dispatch #2 refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayMonth = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five'];
const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

/** Where the film came from, in words that never claim main for a commit that is not on it. */
export function citeSource(source) {
  if (source.onMain) return `Filmed on <time datetime="${escape(source.filmedOn)}">${escape(longDate(source.filmedOn))}</time> on ${escape(source.machine)}. ${cite(source, source.mainCheck)}`;
  const n = source.changes.length;
  return `Filmed on <time datetime="${escape(source.filmedOn)}">${escape(longDate(source.filmedOn))}</time> on ${escape(source.machine)} from private commit <code>${escape(source.commit.slice(0, 8))}</code>, on a pushed branch that is not yet part of the private main. It is the main of ${escape(dayMonth(source.filmedOn))} (<code>${escape(source.baseMain.slice(0, 8))}</code>) plus ${escape(COUNT[n] ?? String(n))} change${n === 1 ? '' : 's'}: ${escape(list(source.changes))}. Cited by hash; this page cannot check it, anyone with access can.`;
}

/** The section: the film, what was staged and what was real, each verdict with its evidence id, and its source. */
export function renderOutage(record, up = '../../') {
  if (!record) return '';
  const { film } = record;
  const steps = record.steps.map(s => s.event
    ? `<li class="outage-event">${escape(s.event)}</li>`
    : `<li><strong>"${escape(s.ask)}"</strong> <span class="outage-verdict outage-${escape(s.verdict)}">${escape(s.verdict.toUpperCase())}</span><br>${escape(s.said)} <span class="lab-source">Evidence <code>${escape(s.evidence)}</code>.</span></li>`).join('');
  const html = `<figure class="lab-film" id="dispatch-${escape(record.number)}"><video controls preload="none" playsinline poster="${up}${escape(film.poster)}" aria-label="Dispatch #${escape(record.number)}: ${escape(record.title)}"><source src="${up}${escape(film.src)}" type="${escape(film.mime)}"></video><figcaption><h3>Dispatch #${escape(record.number)}: ${escape(record.title)}</h3><p>${escape(record.line)}</p><p class="lab-film-meta"><span>0:${String(film.seconds).padStart(2, '0')}</span> · <span>no sound</span> · <code title="sha256 of the file">${escape(film.sha256.src.slice(0, 12))}</code></p><p class="lab-film-real"><strong>Staged, and real:</strong> ${escape(record.staged)}</p></figcaption></figure><ol class="lab-steps outage-steps">${steps}</ol><p class="lab-film-source">${citeSource(record.source)}</p><p class="lab-film-screened">${escape(film.original.note)} Screened: a frame every 5 s (${record.screening.frames.length} frames, each listed with its hash in the record), viewed by an AI agent, and ${escape(record.screening.textRead.images)} frames read by text recognition, with ${escape(record.screening.textRead.hits)} hits for a path, an address, a port, a host name or a machine count.</p>`;
  const leaks = [...pageLeaks(html, recordHashes(record)),
    ...MACHINE_LEAKS.filter(([re]) => re.test(html.replace(/<[^>]+>/g, ' '))).map(([, reason]) => reason),
    ...(!record.source.onMain && MAIN_CLAIM.test(html) ? ['claims the private main for a commit that is not on it'] : [])];
  if (leaks.length) throw new Error(`Lab 01 Dispatch #2: the rendered section fails the screen:\n  ${leaks.join('\n  ')}`);
  return html;
}
