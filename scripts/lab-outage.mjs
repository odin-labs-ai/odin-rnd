// Lab 01's Dispatch #2, "The agents caught a real outage" (lane dispatch2-film). scripts/labs.mjs fills the lab page's
// <!--LAB_OUTAGE--> marker with renderOutage() from site/data/labs/agent-space/outage.json (odin-lab-outage v1,
// scripts/schemas/odin-lab-outage.schema.json): one film of agents as QA, filmed on a throwaway copy of the space where
// one agent's server was stopped for real, the verdicts Odin gave with their evidence ids, and the private commit it
// was filmed from. It builds on the lab kit (scripts/lab-kit.mjs): its screen, leak list, cite sentence and hashes.
//
// The citation is fixed here, not in the record. A commit the record marks onMain: false is cited by citeSource() as
// "not yet part of the private main", with the main it was built on, and no other text of the record or the section
// may mention main at all: the record's free text is refused on the word, and the rendered section, with that one
// sentence taken out, is refused on it too. Only a record with onMain: true AND a mainCheck is cited with the kit's
// cite() sentence ("checked as part of the private main"). When the commit lands on main, a re-cite flips onMain and
// adds the mainCheck.
//
// The build refuses the record, every reason listed, when it misses the schema; when any text fails the kit's record
// screen (the publisher's screen and LEAKS) or MACHINE_LEAKS, or mentions main while onMain is false; when the film or
// poster is missing, a different size than recorded, or does not hash to its recorded sha256, or the film is over
// MAX_FILM_BYTES; when the film is not a WebM whose own header gives the recorded length, or the poster not a PNG of
// the film's frame size; when the screening record does not cover the film (the films gate's rule, lab-films.mjs).
// What the gate cannot do is read pixels: the pictures rest on the screening record (frames hashed, viewed, read by
// text recognition before commit), as Lab 01's films do. The rendered section is screened again as a whole.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cite, escape, pageLeaks, recordHashes, screenRecord, sha256, validate } from './lab-kit.mjs';
import { MAX_FILM_BYTES, screeningProblems } from './lab-films.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const OUTAGE_RECORD = 'data/labs/agent-space/outage.json';
export const OUTAGE_SCHEMA = join(here, 'schemas/odin-lab-outage.schema.json');
const ASSET_DIR = 'assets/labs/agent-space/outage/';
export const FRAME = { width: 1280, height: 720 };

// Any mention of main: while the commit is not on it, only citeSource()'s own sentence may say the word.
export const MAIN_WORD = /\bmain\b/i;

// What the machine that filmed it must never show, beyond the kit's LEAKS: its host name, its memory and processors.
export const MACHINE_LEAKS = [
  [/\b[\w-]+\.local\b|\bmacbook\b|\bmbp\b|\bdesktop-[a-z0-9]+\b/i, 'a host name'],
  [/\b\d+(?:\.\d+)?\s*[GM]i?B\b|memory is free|\bfree memory\b/i, 'a memory count'],
  [/\blogical processors?\b|\b\d+\s*(?:cpus?|cores?|processors?)\b/i, 'a processor count'],
];

/** The length a WebM's own header states, in whole seconds (Segment Info: TimecodeScale 0x2AD7B1, Duration 0x4489). */
export function webmSeconds(bytes) {
  if (bytes.length < 4 || bytes.readUInt32BE(0) !== 0x1a45dfa3) return { problem: 'not an EBML file' };
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (!head.includes(Buffer.from('webm'))) return { problem: 'its DocType is not webm' };
  let scale = 1e6;
  const s = head.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (s >= 0 && (head[s + 3] & 0xf0) === 0x80) { const n = head[s + 3] & 0x0f; scale = Number(head.readUIntBE(s + 4, n)); }
  const d = head.indexOf(Buffer.from([0x44, 0x89]));
  if (d < 0) return { problem: 'its header states no duration' };
  const size = head[d + 2];
  const ticks = size === 0x88 ? head.readDoubleBE(d + 3) : size === 0x84 ? head.readFloatBE(d + 3) : NaN;
  if (!Number.isFinite(ticks)) return { problem: 'its duration cannot be read' };
  return { seconds: ticks * scale / 1e9 };
}

/** A PNG's own width and height (IHDR), or a problem. */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('latin1', 12, 16) !== 'IHDR') return { problem: 'not a PNG' };
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function fileProblems(record, root, where) {
  const { film } = record, problems = [];
  for (const [at, path, sha, bytes] of [['/film/src', film.src, film.sha256.src, film.bytes], ['/film/poster', film.poster, film.sha256.poster, film.posterBytes]]) {
    if (!path.startsWith(ASSET_DIR)) { problems.push(`${where}#${at}: not under ${ASSET_DIR}`); continue; }
    if (!root) continue;
    if (!existsSync(join(root, path))) { problems.push(`${where}#${at}: ${path} is missing`); continue; }
    const data = readFileSync(join(root, path));
    if (sha256(data) !== sha) problems.push(`${where}#${at}: ${path} does not match its recorded sha256`);
    if (data.length !== bytes) problems.push(`${where}#${at}: ${path} is ${data.length} bytes on disk, the record says ${bytes}`);
    if (at === '/film/src') {
      if (data.length > MAX_FILM_BYTES) problems.push(`${where}#${at}: ${path} is ${data.length} bytes, over the ${MAX_FILM_BYTES}-byte limit`);
      const w = webmSeconds(data);
      if (w.problem) problems.push(`${where}#${at}: ${path}: ${w.problem}`);
      else if (Math.round(w.seconds) !== film.seconds) problems.push(`${where}#/film/seconds: ${film.seconds} s, but the film's own header says ${w.seconds.toFixed(1)} s`);
    } else {
      const p = pngSize(data);
      if (p.problem) problems.push(`${where}#${at}: ${path}: ${p.problem}`);
      else if (p.width !== FRAME.width || p.height !== FRAME.height) problems.push(`${where}#${at}: ${p.width}x${p.height}, not the film's ${FRAME.width}x${FRAME.height} frame`);
    }
  }
  return problems;
}

/** Every reason the record may not be published (empty when it may); with `root`, its files must be there, pinned. */
export function outageProblems(record, { where = OUTAGE_RECORD, root = null } = {}) {
  const problems = validate(JSON.parse(readFileSync(OUTAGE_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-outage v1)`);
  if (problems.length) return problems;
  const { film, source } = record;
  // Hashes and commits are checked by the schema; the two asset paths below; every other string is page text.
  const { src, poster, ...filmText } = film;
  const text = { ...record, film: filmText };
  problems.push(...screenRecord(text, where));
  (function walk(v, at) {
    if (typeof v === 'string') {
      if (/^[0-9a-f]{16,64}$/.test(v)) return;
      for (const [re, reason] of MACHINE_LEAKS) if (re.test(v)) problems.push(`${where}#${at}: ${reason}`);
      if (!source.onMain && MAIN_WORD.test(v)) problems.push(`${where}#${at}: mentions main, but the commit is not on it (onMain: false); only the page's own citation may`);
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}/${k}`);
  })(text, '');
  if (source.onMain && !source.mainCheck) problems.push(`${where}#/source: onMain is true, but there is no mainCheck naming the main it was checked against`);
  if (!source.onMain && source.mainCheck) problems.push(`${where}#/source/mainCheck: a main check for a commit marked not on main`);
  if (source.onMain && source.mainCheck && source.mainCheck.checked < source.filmedOn) problems.push(`${where}#/source/mainCheck/checked: before the film was made`);
  problems.push(...screeningProblems({ ...film, screening: record.screening }, `${where}#/screening`));
  problems.push(...fileProblems(record, root, where));
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
  const filmed = `Filmed on <time datetime="${escape(source.filmedOn)}">${escape(longDate(source.filmedOn))}</time> on ${escape(source.machine)}`;
  if (source.onMain) return `${filmed}. ${cite(source, source.mainCheck)}`;
  const n = source.changes.length;
  return `${filmed} from private commit <code>${escape(source.commit.slice(0, 8))}</code>, on a pushed branch that is not yet part of the private main. It is the main of ${escape(dayMonth(source.filmedOn))} (<code>${escape(source.baseMain.slice(0, 8))}</code>) plus ${escape(COUNT[n] ?? String(n))} change${n === 1 ? '' : 's'}: ${escape(list(source.changes))}. Cited by hash; this page cannot check it, anyone with access can.`;
}

/** Why a rendered section may not be published: the kit's pageLeaks, MACHINE_LEAKS, and main outside the citation. */
export function sectionLeaks(html, record) {
  const cited = citeSource(record.source);
  const visible = html.split(cited).join(' ').replace(/<[^>]+>/g, ' ');
  return [...pageLeaks(html, recordHashes(record)),
    ...MACHINE_LEAKS.filter(([re]) => re.test(html.replace(/<[^>]+>/g, ' '))).map(([, reason]) => reason),
    ...(!record.source.onMain && MAIN_WORD.test(visible) ? ['mentions main outside the citation, for a commit that is not on it'] : [])];
}

/** The section: the film, what was staged and what was real, each verdict with its evidence id, and its source. */
export function renderOutage(record, up = '../../') {
  if (!record) return '';
  const { film } = record;
  const steps = record.steps.map(s => s.event
    ? `<li class="outage-event">${escape(s.event)}</li>`
    : `<li><strong>"${escape(s.ask)}"</strong> <span class="outage-verdict outage-${escape(s.verdict)}">${escape(s.verdict.toUpperCase())}</span><br>${escape(s.said)} <span class="lab-source">Evidence <code>${escape(s.evidence)}</code>.</span></li>`).join('');
  const html = `<figure class="lab-film" id="dispatch-${escape(record.number)}"><video controls preload="none" playsinline poster="${up}${escape(film.poster)}" aria-label="Dispatch #${escape(record.number)}: ${escape(record.title)}"><source src="${up}${escape(film.src)}" type="${escape(film.mime)}"></video><figcaption><h3>Dispatch #${escape(record.number)}: ${escape(record.title)}</h3><p>${escape(record.line)}</p><p class="lab-film-meta"><span>0:${String(film.seconds).padStart(2, '0')}</span> · <span>no sound</span> · <code title="sha256 of the file">${escape(film.sha256.src.slice(0, 12))}</code></p><p class="lab-film-real"><strong>Staged, and real:</strong> ${escape(record.staged)}</p></figcaption></figure><ol class="lab-steps outage-steps">${steps}</ol><p class="lab-film-source">${citeSource(record.source)}</p><p class="lab-film-screened">${escape(film.original.note)} Screened: a frame every 5 s (${record.screening.frames.length} frames, each listed with its hash in the record), viewed by an AI agent, and ${escape(record.screening.textRead.images)} frames read by text recognition, with ${escape(record.screening.textRead.hits)} hits for a path, an address, a port, a host name or a machine count.</p>`;
  const leaks = sectionLeaks(html, record);
  if (leaks.length) throw new Error(`Lab 01 Dispatch #2: the rendered section fails the screen:\n  ${leaks.join('\n  ')}`);
  return html;
}
