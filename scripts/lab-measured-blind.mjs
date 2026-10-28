// Lab 13, "Does an agent company get better, measured blind?" (lane vp-bundle4). scripts/labs.mjs calls
// renderMeasuredBlind() and writes, into dist/ only (nothing rendered is committed):
//   labs/measured-blind/index.html   the lab page, from site/labs/measured-blind/index.html (<!--BLIND_*--> markers)
// The record is site/data/labs/measured-blind/record.json (odin-lab-measured-blind v1,
// scripts/schemas/odin-lab-measured-blind.schema.json), which scripts/vendor-measured-blind.mjs builds from the agent
// space's private repository at its main head; its sha256 is pinned in site/data/labs/measured-blind/record.sha256,
// which the Labs tile (scripts/lab-tiles.mjs) also checks.
//
// What the page may say is fixed here, not in the record: every verdict is an AI reviewer's (a separate Claude session,
// not a human), and the blinding is partial; each side of a set is 18 verdicts (nine items, each answered twice), never
// nine; the page recounts the committed, already-unblinded labels and unblinds nothing (the key stayed local by
// design); the live run after the measurement is the write-up's summary only. The build refuses the record, every
// reason listed, when:
//   - its bytes are not the pinned ones, it misses the schema (every object is closed), or the kit's record contract
//     (main-checked cites, files by sha256, real dates, none after the build);
//   - the sets are not the three, in order, of nine anonymously labelled items each;
//   - an item has not one label per run, or a set's labels do not recount to its counts (the summary's);
//   - the setup no longer says the blinding is partial, or the live run's labels do not add up to its answers;
//   - any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks), with only the record's own hashes masked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const BLIND_RECORD = 'data/labs/measured-blind/record.json';
export const BLIND_PIN = 'data/labs/measured-blind/record.sha256';
export const BLIND_TEMPLATE = 'labs/measured-blind/index.html';
export const BLIND_SCHEMA = join(here, 'schemas/odin-lab-measured-blind.schema.json');
export const LABELS = ['useful', 'partly', 'wrong', 'stuck'];
const SET_IDS = ['tuning', 'heldout1', 'heldout2'];
const PREFIX = { tuning: 'T', heldout1: 'A', heldout2: 'B' };
const ITEMS = 9;
export const KIND_WORDS = { ci_run: 'a failed CI run to diagnose', workflow: 'a failed workflow run to diagnose', pr: 'a pull request to review', issue: 'an issue to triage', proposal: 'a finance proposal to draft' };

/** The four labels counted over a list of labels. */
export const countOf = labels => Object.fromEntries(LABELS.map(l => [l, labels.filter(x => x === l).length]));
/** One arm of a set, recounted from its items' labels. */
export const recount = (set, arm) => countOf(set.items.flatMap(item => item[arm]));
const total = c => LABELS.reduce((t, l) => t + c[l], 0);

/** Every reason the record may not be published (empty when it may). */
export function blindProblems(record, { now = new Date(), where = BLIND_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(BLIND_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-measured-blind v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where));
  problems.push(...vendoredProblems(record.vendored, { where, now }));
  const runs = record.setup.runs;
  if (record.sets.map(s => s.id).join() !== SET_IDS.join()) problems.push(`${where}#/sets: not the tuning set, held-out set one and held-out set two, in that order`);
  record.sets.forEach((set, i) => {
    const at = `${where}#/sets/${i}`;
    if (set.items.length !== ITEMS) problems.push(`${at}/items: not nine items`);
    const labels = set.items.map(item => item.label);
    const want = Array.from({ length: set.items.length }, (_, k) => `${PREFIX[set.id] ?? '?'}${k + 1}`);
    if (labels.join() !== want.join()) problems.push(`${at}/items: the items are not labelled ${want[0]} to ${want.at(-1)}, in order`);
    set.items.forEach((item, j) => { for (const arm of ['before', 'after']) if (item[arm].length !== runs) problems.push(`${at}/items/${j}/${arm}: not one label per run (${runs})`); });
    for (const arm of ['before', 'after']) {
      const got = recount(set, arm), said = set.counts[arm];
      if (LABELS.some(l => got[l] !== said[l])) problems.push(`${at}/counts/${arm}: the labels recount to ${LABELS.map(l => `${l} ${got[l]}`).join(', ')}, the record says ${LABELS.map(l => `${l} ${said[l]}`).join(', ')}`);
      if (total(said) !== set.items.length * runs) problems.push(`${at}/counts/${arm}: not ${set.items.length * runs} verdicts (items times runs)`);
    }
  });
  // The page says, in its own words, that the blinding is partial: the record must say exactly that, and nothing that
  // takes it back (a negation, "impartial", "fully blind").
  if (!/(^|; )the blinding is partial\b/.test(record.setup.blinding) || /\bnot partial\b|\bimpartial\b|\bfully blind\b|\bnot blind\b/i.test(record.setup.blinding)) problems.push(`${where}#/setup/blinding: the page says the blinding is partial; the record must say "the blinding is partial", and nothing that takes it back`);
  for (const s of record.sets) if (!/no fix had seen them|the fixes were made on them/i.test(s.about)) problems.push(`${where}#/sets/${s.id}/about: it must say whether the fixes had seen the set`);
  const l = record.live;
  if (l.useful + l.partly + l.wrong !== l.answers) problems.push(`${where}#/live: its labels do not add up to its ${l.answers} answers`);
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readMeasuredBlind(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: BLIND_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: BLIND_PIN, file: BLIND_RECORD, vendor: 'scripts/vendor-measured-blind.mjs' }), check: record => blindProblems(record, { now }), refused: 'Lab 13 record refused' });
}

export { pageLeaks, recordHashes };

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const pct = (k, of) => `${Math.round((k / of) * 100)}%`;
const set = (record, id) => record.sets.find(s => s.id === id);
const gain = s => s.counts.after.useful - s.counts.before.useful;
const per = s => s.items.length * s.items[0].before.length;
const useful = (s, arm) => `${s.counts[arm].useful} of ${per(s)}`;
// How two gains compare, in words the record cannot bend: computed here.
const compare = (a, b) => (a > b ? 'more than' : a < b ? 'less than' : 'as much as');

export function renderIntro(record) {
  const [t, a, b] = SET_IDS.map(id => set(record, id));
  return `<span class="technical">LAB 13 · DOES AN AGENT COMPANY GET BETTER, MEASURED BLIND?</span><h1 id="lab-title">Does an agent company get better, measured blind?</h1><p class="company-lead">The agents of our company on duty answered the same work items before and after we fixed their recipes and tools, and a separate AI reviewer judged every answer without being told which was which. On the nine items the fixes were made on, useful answers went from ${useful(t, 'before')} to ${useful(t, 'after')}. On nine items held out from the fixing, from ${useful(a, 'before')} to ${useful(a, 'after')}; on nine fresh ones, judged on the next version, from ${useful(b, 'before')} to ${useful(b, 'after')}.</p><p>Each side of a set is ${per(t)} verdicts, not ${t.items.length}: nine items, each answered twice. The set the fixes were made on gained ${compare(gain(t), gain(a))} the first held-out set: ${gain(t)} useful answers against ${gain(a)}.</p>`;
}

export function renderJudge(record) {
  const s = record.setup;
  return box('judge', { cls: 'blind-judge', id: 'judge', body: `<p>Every verdict on this page was given by ${escape(s.judge)}. It is not a human's verdict. It gave each answer one of four labels: useful, partly, wrong or stuck; ${escape(s.stuck)}.</p><p>The review sheet showed ${escape(s.blinding)}.</p>` });
}

export function renderHow(record) {
  const s = record.setup;
  const sets = record.sets.map(x => `<li><strong>${escape(x.name)}</strong>: items ${escape(x.items[0].label)} to ${escape(x.items.at(-1).label)}, judged on ${escape(x.afterVersion)} after the fixes.</li>`).join('');
  return `<ul class="blind-list"><li><strong>The agents.</strong> ${escape(s.sessions[0].toUpperCase() + s.sessions.slice(1))}; the model is <code>${escape(s.model)}</code>.</li><li><strong>Before.</strong> ${escape(s.before[0].toUpperCase() + s.before.slice(1))}.</li><li><strong>After.</strong> ${escape(s.after[0].toUpperCase() + s.after.slice(1))}.</li><li><strong>Runs.</strong> Each item was answered ${s.runs === 2 ? 'twice' : `${s.runs} times`} in each arm.</li></ul><h3 class="lab-subhead">The three sets</h3><ul class="blind-list">${sets}</ul>`;
}

const cell = c => LABELS.map(l => `<td>${c[l]}</td>`).join('');
export function renderNumbers(record) {
  const rows = record.sets.map(s => `<tr><th scope="rowgroup" rowspan="2">${escape(s.name)}</th><td>before</td>${cell(s.counts.before)}<td>${pct(s.counts.before.useful, per(s))}</td></tr><tr><td>after (${escape(s.afterVersion)})</td>${cell(s.counts.after)}<td>${pct(s.counts.after.useful, per(s))}</td></tr>`).join('');
  const items = record.sets.map(s => s.items.map(item => `<tr><th scope="row">${escape(item.label)}</th><td>${escape(KIND_WORDS[item.kind])}</td><td>${item.before.map(escape).join(', ')}</td><td>${item.after.map(escape).join(', ')}</td></tr>`).join('')).join('');
  return `<p>Each row is ${per(record.sets[0])} verdicts: nine items, each answered twice. Useful is the share of those ${per(record.sets[0])}.</p><div class="lab-table-wrap"><table class="blind-table"><thead><tr><th scope="col">Set</th><th scope="col">Arm</th>${LABELS.map(l => `<th scope="col">${l}</th>`).join('')}<th scope="col">useful share</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-source">Recounted at build from the per-item labels below; the build refuses the record if they do not give these counts, which are the committed summary's.</p><details class="lab-panel-table"><summary>Every item, every run</summary><p>Items by anonymous label: their keys name private repositories and CI runs, so only their kind is shown.</p><table><thead><tr><th scope="col">Item</th><th scope="col">Kind</th><th scope="col">Before, runs one and two</th><th scope="col">After, runs one and two</th></tr></thead><tbody>${items}</tbody></table></details>`;
}

export function renderReading(record) {
  const [t, a, b] = SET_IDS.map(id => set(record, id));
  const runUseful = (s, arm, k) => s.items.filter(item => item[arm][k] === 'useful').length;
  // What each set is (its about, from the record, bound to the write-up by the vendor), beside its own numbers.
  const sets = record.sets.map(s => `<li><strong>${escape(s.name)}</strong>: useful from ${pct(s.counts.before.useful, per(s))} to ${pct(s.counts.after.useful, per(s))}, a gain of ${gain(s)}. ${escape(s.about)}</li>`).join('');
  return `<ul class="blind-list">${sets}<li><strong>Tuning against held-out set one.</strong> The set the fixes were made on gained ${compare(gain(t), gain(a))} the first held-out set: ${gain(t)} against ${gain(a)}.</li><li><strong>A restart.</strong> ${escape(record.setup.restart[0].toUpperCase() + record.setup.restart.slice(1))}. Run by run, useful of ${b.items.length}: before, ${runUseful(b, 'before', 0)} and then ${runUseful(b, 'before', 1)}; after, ${runUseful(b, 'after', 0)} and then ${runUseful(b, 'after', 1)}, the run on the updated runtime.</li></ul>`;
}

export function renderLive(record) {
  const l = record.live;
  return box('summary', { cls: 'blind-live', id: 'live', body: `<h3>Then, on live work</h3><p>After this measurement the agents went on duty on live work, a different set of items. The same reviewer judged ${l.answers} of their answers: <strong>${l.useful} useful</strong>, ${l.partly} partly, ${l.wrong} wrong. That is much worse than the second held-out set, and the write-up says so. Those answers were not committed, so this page cannot recount them: the figures are the write-up's.</p>` });
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(c.what[0].toUpperCase() + c.what.slice(1))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(f.what[0].toUpperCase() + f.what.slice(1))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${BLIND_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}.</p><p>Nothing here was unblinded for this page. The evaluation's own runner keeps the blind key and the raw answers local, by design: the reviewer's reasons quote private repositories. What was committed is the verdict labels, already unblinded, and this page recounts them.</p><h3 class="lab-subhead">The commits it stands on</h3><ul class="blind-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="blind-list blind-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary(record) {
  return `<ul class="blind-list"><li>The judge is an AI, not a person, and the blinding is partial: the shape of a tool's reply can show which arm wrote it.</li><li>The sets are small: nine items each, ${per(record.sets[0])} verdicts a side. A few answers either way move a share by ten points or more.</li><li>It shows that our own fixes (recipes, tool output, the facts handed over, routing) made these answers better. It does not show the model got better: the model was the same in both arms.</li><li>On live work afterwards the results were much worse; the write-up does not separate the two causes it names, other items and the updated runtime.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderMeasuredBlind(root = 'site', { now = new Date() } = {}) {
  const record = readMeasuredBlind(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, BLIND_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--BLIND_INTRO-->': renderIntro(record), '<!--BLIND_JUDGE-->': renderJudge(record), '<!--BLIND_HOW-->': renderHow(record), '<!--BLIND_NUMBERS-->': renderNumbers(record), '<!--BLIND_READING-->': renderReading(record), '<!--BLIND_LIVE-->': renderLive(record), '<!--BLIND_CHECK-->': renderCheck(record), '<!--BLIND_BOUNDARY-->': renderBoundary(record) })) {
    if (!html.includes(marker)) throw new Error(`${BLIND_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${BLIND_TEMPLATE}: unresolved content marker`);
  const v = record.vendored;
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [v.mainCheck.main, ...v.mainCheck.commits] });
  if (leaks.length) throw new Error(`${BLIND_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [BLIND_TEMPLATE]: html } };
}
