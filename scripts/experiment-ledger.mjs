// The experiment ledger at the top of the home page's Experiments section: every published experiment, its stage
// and the status sentence its own field-note row already states. Nothing here is authored per experiment. The bench
// recipes come from the recorded report, EXP 004 from the committed Laya record, and every pre-registered experiment
// from the pre-registration published under dist/data/<slug>/, so a new experiment or new results appear without an
// edit here. The status sentence is copied from the built home page's field-note row, after every qualify step has run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { day } from './blueprint-floor-results-site.mjs';

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

/** The home page's field-note rows: link, heading text and paragraph text, in page order. */
export function journalRows(html) {
  const rows = [];
  for (const part of html.split('<a class="journal-row" href="').slice(1)) {
    const href = part.slice(0, part.indexOf('"'));
    const body = part.slice(0, part.indexOf('</a>'));
    const h3 = body.split('<h3>')[1]?.split('</h3>')[0] ?? '';
    const p = body.split('<p>')[1]?.split('</p>')[0] ?? '';
    rows.push({ href, heading: textOf(h3), text: textOf(p) });
  }
  return rows;
}

/** The status sentence at the end of a row's paragraph: from its first "Pre-registered", "Draft" or "Measured" on. */
export function statusSentence(text) {
  const starts = ['Pre-registered', 'Draft', 'Measured'].map(word => text.indexOf(word)).filter(at => at >= 0);
  return starts.length ? text.slice(Math.min(...starts)) : '';
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
    // The build refuses a report in which any recipe failed to tell its two trees apart, so every run here passed.
    status: `Recorded ${day(report.completedAt)}: the same rule scored the conforming tree GREEN / ${run.cleanScore} and the drifted tree RED / ${run.driftScore}.`,
  }));
  const layaManifest = JSON.parse(readFileSync(`${dist}/data/laya-vs-jev/manifest.json`, 'utf8'));
  const layaRow = rows.find(row => row.href === 'journal/system-1-decisions-without-lock-in.html');
  if (!layaRow) throw new Error('Experiment ledger: the EXP 004 field-note row is missing from the home page');
  entries.push({ id: 'EXP 004', title: layaRow.heading, href: layaRow.href, stage: layaManifest.kind === 'measured' ? 'Measured' : 'Pre-registered', status: statusSentence(layaRow.text) });
  for (const slug of readdirSync(`${dist}/data`, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const prereg = `${dist}/data/${slug}/preregistration.json`;
    if (!existsSync(prereg)) continue;
    const { id, title } = JSON.parse(readFileSync(prereg, 'utf8')).experiment;
    if (!Number.isInteger(expNumber(id))) throw new Error(`Experiment ledger: ${prereg} names no experiment id of the form EXP 000`);
    const row = rows.find(r => r.heading.startsWith(`${id}:`) || r.heading.startsWith(`${title}:`));
    const amendments = readdirSync(`${dist}/data/${slug}`).filter(file => /^amendment-\d{2}\.json$/.test(file)).length;
    const results = existsSync(`${dist}/data/${slug}/results.json`);
    const status = row ? statusSentence(row.text) : '';
    if (results && /not yet run/.test(status)) throw new Error(`Experiment ledger: ${id} publishes results but its field-note row says it has not run`);
    entries.push({
      id, title,
      href: row ? row.href : `data/${slug}/preregistration.json`,
      stage: (results ? 'Results published' : 'Pre-registered') + (amendments ? ` · ${amendments} amendment${amendments > 1 ? 's' : ''}` : ''),
      status,
    });
  }
  const ids = entries.map(e => e.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated) throw new Error(`Experiment ledger: ${repeated} appears twice`);
  return entries.sort((a, b) => expNumber(a.id) - expNumber(b.id));
}

export function renderLedger(entries) {
  const items = entries.map(e => `<li><a href="${escape(e.href)}"><span class="technical">${escape(e.id)}</span><span class="ledger-title">${escape(e.title)}</span><span class="ledger-stage technical">${escape(e.stage)}</span>${e.status ? `<span class="ledger-status">${escape(e.status)}</span>` : ''}</a></li>`).join('');
  return `<div class="experiment-ledger" id="all-experiments"><h3 id="all-experiments-title">Every experiment, and where it stands.</h3><p>Each status is the one the experiment's own record and field note state. A refuted claim stays refuted.</p><ol aria-labelledby="all-experiments-title">${items}</ol></div>`;
}

/** Replaces the page's ledger marker with the ledger built from `dist`. */
export function addLedger(html, report, dist = 'dist') {
  if (!html.includes('<!--EXPERIMENT_LEDGER-->')) throw new Error('Experiment ledger: the home page has no ledger marker');
  return html.replace('<!--EXPERIMENT_LEDGER-->', renderLedger(ledgerEntries(html, report, dist)));
}
