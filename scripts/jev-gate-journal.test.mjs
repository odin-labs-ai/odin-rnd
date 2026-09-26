import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRecord, validateRecord } from './jev-gate-prereg.mjs';
import { articlePath, assertNoteCurrent, noteNumber, renderNote, renderTriageExhibit, slug } from './jev-gate-journal.mjs';
import { stations } from './station-contract.mjs';

const { record, sha256 } = checkRecord();
const note = readFileSync(articlePath, 'utf8');
const page = readFileSync('site/index.html', 'utf8');
const html = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

test('the committed note is exactly the render of the committed pre-registration', () => {
  assert.doesNotThrow(() => assertNoteCurrent());
  assert.equal(note, renderNote(record, sha256));
  // A threshold cannot move without its statement: the validator refuses that record before any render.
  const moved = structuredClone(record); moved.criteria[0].threshold = moved.criteria[1].threshold;
  assert.throws(() => validateRecord(moved), /statement disagrees/);
  for (const mutate of [r => { r.criteria[0].statement = r.criteria[1].statement; }, r => { r.corpus.items += 1; }, r => { r.cascade.confidenceThreshold = r.decisionRules.decisionThreshold; }, r => { r.gates.reviewer.prompt += ' Be thorough.'; }]) {
    const changed = structuredClone(record); mutate(changed);
    assert.notEqual(renderNote(changed, sha256), note, 'A changed record must change the page');
  }
  assert.throws(() => renderNote(record, 'abc'), /sha256/);
});

test('the note states it is pre-registered with no results, and carries the whole plan', () => {
  assert.match(note, /Pre-registered, no results yet\./);
  assert.match(note, new RegExp(`EXPERIMENT NOTE / ${noteNumber} · EXP 005 · PRE-REGISTERED 26 SEP 2026 · NO RESULTS YET`));
  assert.doesNotMatch(note, /Recorded experiment|MEASURED ON|FIXTURE/);
  for (const text of [record.question, record.rulesText, record.gates.reviewer.prompt, record.claimRule, record.baselineValidity.statement, ...record.criteria.map(c => c.statement), ...record.limits, ...record.framing]) assert(note.includes(html(text)), `Note is missing: ${text.slice(0, 60)}`);
  for (const value of [record.corpus.corpusSha256, record.corpus.inputsSha256, sha256, record.gates.laya.revision, record.gates.reviewer.commit, record.statistics.pairedDifference.method]) assert(note.includes(html(value)), `Note is missing ${value}`);
  for (const source of record.sources) assert(note.includes(`href="${html(source.url)}"`), `Note is missing source ${source.id}`);
  assert(note.includes('href="../data/jev-gate/preregistration.json"'));
  assert(note.includes('diff-only triage is not a replacement for bce'));
});

test('the baseline rows Jev has to beat are named on the note and the station', () => {
  assert(note.includes('Baselines Jev has to beat') && note.includes(html(record.baselineRule)));
  const withRows = structuredClone(record);
  withRows.baselines = [{ id: 'keyword-grep', script: 'scripts/jev-gate-heuristic-grep.mjs', sha256: 'a'.repeat(64), results: { correct: 55, total: 60 } }, { id: 'regex-lint', script: 'scripts/jev-gate-heuristic-lint.mjs', sha256: 'b'.repeat(64), results: { correct: 60, total: 60 } }];
  const rendered = renderNote(withRows, sha256);
  for (const b of withRows.baselines) assert(rendered.includes(`<strong>${b.id}</strong>`) && rendered.includes(b.script) && rendered.includes(`${b.results.correct} / ${b.results.total} agree with bce`));
  const exhibit = renderTriageExhibit(withRows, stations.find(s => s.id === 'triage'));
  for (const b of withRows.baselines) assert(exhibit.includes(`Baseline to beat · ${b.id}`));
});

test('the nina attribution is the founder wording, with its link, wherever nina is named', () => {
  const linked = record.attribution.nina.replace('github.com/xhulz/nina', '<a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a>');
  assert.equal(record.attribution.nina, 'nina (github.com/xhulz/nina) — used with the permission of its author, as confirmed by Odin Labs');
  assert(note.includes(linked), 'Note attribution');
  assert(page.includes('The LLM reviewer is nina (<a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a>) — used with the permission of its author, as confirmed by Odin Labs.'), 'Project row attribution');
});

test('the journal row, featured row 004 and sitemap list the note, and agree with the record', () => {
  const journal = page.split(`href="journal/${slug}.html"><div class="journal-date">`)[1]?.split('</a>')[0] ?? '';
  assert(journal.includes(`EXPERIMENT NOTE / ${noteNumber}`) && journal.includes('Pre-registered, no results yet.'), 'Journal row');
  assert(journal.includes('<time datetime="2026-09-26">') && record.experiment.authoredOn === '2026-09-26');
  const notes = [...page.matchAll(/EXPERIMENT NOTE \/ (\d{3})/g)].map(m => m[1]);
  assert.equal(new Set(notes).size, notes.length, 'Experiment note numbers are unique');
  const featured = page.split('<div class="project-number">004')[1]?.split('</article>')[0] ?? '';
  assert(featured.includes(`${record.corpus.items} authored changes`) && featured.includes(`${record.groundTruth.engine} ${record.groundTruth.version}`) && featured.includes(record.experiment.id), 'Featured row numbers come from the record');
  for (const href of [`journal/${slug}.html`, 'data/jev-gate/preregistration.json', '#station-triage']) assert(featured.includes(`href="${href}"`), `Featured row is missing ${href}`);
  assert.doesNotMatch(featured, /Recorded|Measured/);
  assert(readFileSync('site/sitemap.xml', 'utf8').includes(`journal/${slug}.html`), 'Sitemap entry');
});
