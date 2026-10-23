// The experiment ledger at the top of the home page's Experiments section: every experiment this site publishes, its stage
// and the status sentence its own field-note row already states. Nothing here is authored per experiment. The bench
// recipes come from the recorded report, EXP 004 from the committed Laya record, and every pre-registered experiment
// from the pre-registration published under dist/data/<slug>/, so a new experiment or new results appear without an
// edit here. The status sentence is copied from the built home page's field-note row, after every qualify step has run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { day } from './blueprint-floor-results-site.mjs';
import { checkCopies, checkDist, checkLedgerEntry, repoBlob } from './ledger-publish.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Applies `re` (global) until the string stops changing, so no nested or overlapping tag survives one pass. */
const untilStable = (text, re, replacement) => {
  let out = String(text), prev;
  do { prev = out; out = out.replace(re, replacement); } while (out !== prev);
  return out;
};
const entities = { '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

/** The text a reader sees in a fragment of the built page. It is escaped again wherever it is rendered. */
export function textOf(fragment) {
  const plain = untilStable(untilStable(fragment, /<[^>]*>/g, ' '), /[<>]/g, ' ');
  // &amp; last, so an escaped entity such as &amp;lt; reads as "&lt;", never as "<".
  return plain.replace(/&#39;|&quot;|&lt;|&gt;|&nbsp;/g, match => entities[match]).replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim();
}

/** The content of the first `<tag>` or `<tag …>` element in `html`, or '' when there is none. */
function inner(html, tag) {
  let at = html.indexOf(`<${tag}`);
  while (at >= 0 && !['>', ' '].includes(html[at + tag.length + 1])) at = html.indexOf(`<${tag}`, at + 1);
  if (at < 0) return '';
  const open = html.indexOf('>', at);
  const close = html.indexOf(`</${tag}>`, open);
  return open < 0 || close < 0 ? '' : html.slice(open + 1, close);
}

/** The home page's field-note rows: link, heading text and paragraph text, in page order. */
export function journalRows(html) {
  const rows = [];
  for (const part of html.split('<a class="journal-row" href="').slice(1)) {
    const href = part.slice(0, part.indexOf('"'));
    const body = part.slice(0, part.indexOf('</a>'));
    rows.push({ href, heading: textOf(inner(body, 'h3')), text: textOf(inner(body, 'p')) });
  }
  return rows;
}

/** The status sentence at the end of a row's paragraph: from its first "Pre-registered", "Draft" or "Measured" on.
 *  A paragraph with none of those words is shown whole, unedited, rather than cut or left blank. */
export function statusSentence(text) {
  const starts = ['Pre-registered', 'Draft', 'Measured'].map(word => text.indexOf(word)).filter(at => at >= 0);
  return starts.length ? text.slice(Math.min(...starts)) : text;
}

const expNumber = id => Number(/^EXP (\d{3})$/.exec(id)?.[1] ?? NaN);

/** Every ledger entry, sorted by experiment number. `dist` is the built site; `html` the built home page. */
export function ledgerEntries(html, report, dist = 'dist') {
  const rows = journalRows(html);
  const entries = report.runs.map((run, index) => ({
    id: `EXP ${String(index + 1).padStart(3, '0')}`,
    title: run.title,
    href: '#bench',
    stage: 'Recorded',
    // No field note exists for the bench recipes, so their status is composed from the recorded report's own fields
    // (completedAt, cleanScore, driftScore) and the intro says so. The build refuses a report with any failed recipe.
    status: `Recorded ${day(report.completedAt)}: the same rule scored the conforming tree GREEN / ${run.cleanScore} and the drifted tree RED / ${run.driftScore}.`,
  }));
  const layaManifest = JSON.parse(readFileSync(`${dist}/data/laya-vs-jev/manifest.json`, 'utf8'));
  const layaRow = rows.find(row => row.href === 'journal/system-1-decisions-without-lock-in.html');
  if (!layaRow) throw new Error('Experiment ledger: the EXP 004 field-note row is missing from the home page');
  entries.push({ id: 'EXP 004', title: layaRow.heading, href: layaRow.href, stage: layaManifest.kind === 'measured' ? 'Measured' : 'Pre-registered', status: statusSentence(layaRow.text) });
  for (const slug of readdirSync(`${dist}/data`, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const prereg = `${dist}/data/${slug}/preregistration.json`;
    const entryFile = `${dist}/data/${slug}/ledger-entry.json`;
    if (existsSync(entryFile)) {
      // A ledger entry (scripts/ledger-publish.mjs) is either a pre-registration listed from the repository (EXP 010, whose
      // record the site check cannot publish) or a study published without a pre-registration, numbered so it can be
      // cited, whose stage says so and which links its own field note, matched by the note path the entry names.
      if (existsSync(prereg)) throw new Error(`Experiment ledger: data/${slug} has both a pre-registration and a not-pre-registered ledger entry`);
      const entry = checkLedgerEntry(JSON.parse(readFileSync(entryFile, 'utf8')), `data/${slug}/ledger-entry.json`);
      if (entry.preregistered) {
        entries.push({ id: entry.experiment.id, title: entry.experiment.title, href: repoBlob(entry.record), stage: 'Pre-registered · record in the repository', status: `Pre-registration published in the repository, sha256 ${entry.sha256.slice(0, 12)}…; no field note yet.` });
        continue;
      }
      const row = rows.find(r => r.href === entry.note);
      if (!row) throw new Error(`Experiment ledger: ${entry.experiment.id} names field note ${entry.note}, which is not a row on the home page`);
      entries.push({ id: entry.experiment.id, title: entry.experiment.title, href: row.href, stage: 'Results published · not pre-registered', status: statusSentence(row.text) });
      continue;
    }
    if (!existsSync(prereg)) continue;
    const { id, title } = JSON.parse(readFileSync(prereg, 'utf8')).experiment;
    if (!Number.isInteger(expNumber(id))) throw new Error(`Experiment ledger: ${prereg} names no experiment id of the form EXP 000`);
    const row = rows.find(r => r.heading.startsWith(`${id}:`) || r.heading.startsWith(`${title}:`));
    const amendments = readdirSync(`${dist}/data/${slug}`).filter(file => /^amendment-\d{2}\.json$/.test(file)).length;
    const results = existsSync(`${dist}/data/${slug}/results.json`);
    // A row is matched by its heading: "EXP 006: …" onwards, rendered by each note generator from the same record's
    // experiment.id and experiment.title, so a renumber or a retitle moves both together. EXP 005's row is written by
    // hand in site/index.html and has no id, so it matches by title. With no row, the entry says so in plain words and links the published record: never a
    // blank status. Results need their note.
    if (!row && results) throw new Error(`Experiment ledger: ${id} publishes results but has no field-note row on the home page`);
    const status = row ? statusSentence(row.text) : 'Pre-registration published; no field note yet.';
    if (results && /not yet run/.test(status)) throw new Error(`Experiment ledger: ${id} publishes results but its field-note row says it has not run`);
    entries.push({
      id, title,
      href: row ? row.href : `data/${slug}/preregistration.json`,
      stage: (results ? 'Results published' : 'Pre-registered') + (amendments ? ` · ${amendments} amendment${amendments > 1 ? 's' : ''}` : ''),
      status,
    });
  }
  // Every published result belongs to a listed experiment: results with no pre-registration beside them refuse the build.
  for (const slug of readdirSync(`${dist}/data`, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    if (existsSync(`${dist}/data/${slug}/results.json`) && !existsSync(`${dist}/data/${slug}/preregistration.json`)) throw new Error(`Experiment ledger: data/${slug}/results.json has no pre-registration, so no ledger entry`);
  }
  const ids = entries.map(e => e.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated) throw new Error(`Experiment ledger: ${repeated} appears twice`);
  return entries.sort((a, b) => expNumber(a.id) - expNumber(b.id));
}

export function renderLedger(entries) {
  const items = entries.map(e => `<li><a href="${escape(e.href)}"><span class="technical">${escape(e.id)}</span><span class="ledger-title">${escape(e.title)}</span><span class="ledger-stage technical">${escape(e.stage)}</span>${e.status ? `<span class="ledger-status">${escape(e.status)}</span>` : ''}</a></li>`).join('');
  return `<div class="experiment-ledger" id="all-experiments"><h3 id="all-experiments-title">Every experiment on this site, and where it stands.</h3><p>It lists each experiment whose pre-registration this site publishes, and the studies published without one, numbered so they can be cited and marked “not pre-registered”: for those, no question, metric or decision rule was frozen before they ran. A pre-registration the site cannot copy is listed with a link to its record in the repository and that record's sha256. EXP 001–003 show their recorded run: its date and the two scores, as published in the run's record. Every later experiment shows the status sentence from its own field note, unedited, or says it has no note yet. A refuted claim stays refuted.</p><ol aria-labelledby="all-experiments-title">${items}</ol></div>`;
}

/** Replaces the page's ledger marker with the ledger built from `dist`. */
export function addLedger(html, report, dist = 'dist') {
  if (!html.includes('<!--EXPERIMENT_LEDGER-->')) throw new Error('Experiment ledger: the home page has no ledger marker');
  // EXP 010 and EXP 012 join through byte-for-byte site copies of their frozen records (scripts/ledger-publish.mjs):
  // each record must still match its committed .sha256, and the copy built into dist must still be the record's bytes.
  if (dist === 'dist') checkDist(checkCopies(), dist);
  return html.replace('<!--EXPERIMENT_LEDGER-->', renderLedger(ledgerEntries(html, report, dist)));
}
