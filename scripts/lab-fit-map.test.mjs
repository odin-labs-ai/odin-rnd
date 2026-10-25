import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fitMapProblems, labsDigest, readFitMap, renderFitMap, VERDICT_WORDS } from './lab-fit-map.mjs';
import { vendor } from './vendor-fit-map.mjs';
import { renderLabs } from './labs.mjs';

// "Where each store fits" (mission rnd-labs-human-first-1024). The lab's own fit map is private, so every source here
// is written by the test at run time, shaped like the real one; only the committed public file is read from site/.
const temp = mkdtempSync(join(tmpdir(), 'lab-fit-map-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const committed = JSON.parse(readFileSync('site/data/labs/fit-map.json', 'utf8'));
const hex = (n, d) => d.repeat(n);

const source = () => ({
  format: 'odin-fit-map', version: 1, built_at_commit: hex(40, 'a'),
  question: 'where does each store fit Odin? (per scenario; no overall winner)',
  rule: 'a verdict fills only from the experiment\'s committed RESULT.json; predictions are the frozen ones',
  verdict_words: [...VERDICT_WORDS],
  labs: [
    { lab: 'EXP 020', dir: '.ai/experiments/x-home', published: { odin_rnd: hex(40, 'b'), how: 'odin-rnd PR #76 (a note)' },
      prereg: { file: '.ai/experiments/x-home/PREREG.md', commit: hex(40, 'c'), status: 'main', sha256: hex(64, 'd') }, stage: 'pre-registered',
      cells: [{ scenario: 'S1', what: 'order-preserving records', verdict: null, predictions: { this_pc: 'both-fit', mongodb_advocate: 'both-fit', postgres_advocate: 'both-fit, leaning postgres-fits' } }] },
    { lab: 'Lab 02 (v1.1)', dir: '.ai/experiments/lab02-x', published: null,
      prereg: { file: '.ai/experiments/lab02-x/PREREG.md', commit: hex(40, 'e'), status: 'main', sha256: hex(64, 'f') }, stage: 'frozen, not yet published',
      cells: [{ scenario: 'F1', what: 'node death', verdict: null, predictions: { this_pc: 'mongodb-fits' } }] },
    { lab: 'Lab 03', dir: '.ai/experiments/lab02-y', published: null, stage: 'design',
      design: { file: '.ai/experiments/lab02-y/DESIGN.md', commit: hex(40, '1'), status: 'main' },
      cells: [{ scenario: 'company-store', what: 'the records (design; not yet frozen)', verdict: null, predictions: {} }] },
  ],
});
const mapping = { as: { 'EXP 020': 'EXP 020', 'Lab 02 (v1.1)': 'Lab 03', 'Lab 03': 'Lab 04' },
  title: { 'EXP 020': 'Home ground', 'Lab 02 (v1.1)': 'Failover', 'Lab 03': 'The company store' },
  page: { 'EXP 020': 'journal/mongodb-home-ground-pre-registration.html' } };
const bytes = obj => Buffer.from(JSON.stringify(obj, null, 1));
const COMMIT = hex(40, '9');

test('the committed fit map passes the build gate and shows every cell pending, its predictions labelled as predictions', () => {
  assert.deepEqual(fitMapProblems(committed), []);
  assert.equal(committed.vendored.sourceSha256, '89870a85f42f025a79b01129a0ccae8c4292a4ab42920323ac109466199df1e5');
  assert.equal(committed.vendored.commit, '14a29c9dedc4b1d0c7edd6d3da78a55f5dadde61');
  assert.deepEqual(committed.labs.map(lab => lab.lab), ['EXP 020', 'Lab 03', 'Lab 04'], 'the site\'s numbering: Lab 03 failover, Lab 04 company store');
  assert.deepEqual(committed.vendored.transform.map(t => [t.lab, t.as]), [['EXP 020', 'EXP 020'], ['Lab 02 (v1.1)', 'Lab 03'], ['Lab 03', 'Lab 04']]);
  const cells = committed.labs.flatMap(lab => lab.cells);
  assert.equal(cells.length, 10);
  assert.ok(cells.every(cell => cell.verdict === null && cell.result === null));
  const html = renderFitMap(committed);
  assert.equal((html.match(/class="fit-pending">Pending</g) ?? []).length, 10);
  assert.match(html, /0 of 10 cells have a verdict\./);
  assert.match(html, /<th scope="col">Predictions, frozen before the run<\/th>/);
  assert.match(html, /<li><span>PostgreSQL’s advocate:<\/span> both-fit, leaning postgres-fits<\/li>/);
  assert.match(html, /<a href="\.\.\/journal\/mongodb-home-ground-pre-registration\.html">EXP 020: /);
  assert.match(html, /<h3 id="fit-1">Lab 03: [^<]+<\/h3>/, 'a lab without a public page is a plain label');
  const raw = readFileSync('site/data/labs/fit-map.json', 'utf8');
  for (const leak of ['.ai/', 'PREREG', 'DESIGN.md', 'RESULT.json', 'lab02-', '"dir"', 'odin_rnd', 'this_pc', 'Mac']) assert.ok(!raw.includes(leak) && !html.includes(leak), leak);
});

test('the Labs page carries the matrix, and the build reads it through renderLabs', () => {
  const page = renderLabs()['labs/index.html'];
  assert.match(page, /<section class="company-section company-width" id="fit-map" aria-labelledby="fit-map-title">/);
  assert.doesNotMatch(page, /<!--LABS_FIT_MAP-->/);
});

test('vendoring is reproducible byte for byte and records every change it makes', () => {
  const src = bytes(source());
  const once = `${JSON.stringify(vendor({ commit: COMMIT, fileBytes: src, ...mapping }), null, 1)}\n`;
  const file = join(temp, 'fit-map.json');
  writeFileSync(file, src);
  const cli = execFileSync(process.execPath, ['scripts/vendor-fit-map.mjs', '--commit', COMMIT, '--file', file,
    '--as', 'EXP 020=EXP 020', '--title', 'EXP 020=Home ground', '--page', 'EXP 020=journal/mongodb-home-ground-pre-registration.html',
    '--as', 'Lab 02 (v1.1)=Lab 03', '--title', 'Lab 02 (v1.1)=Failover', '--as', 'Lab 03=Lab 04', '--title', 'Lab 03=The company store'], { encoding: 'utf8' });
  assert.equal(cli, once);
  const record = JSON.parse(once);
  assert.deepEqual(fitMapProblems(record), []);
  assert.equal(record.vendored.labsSha256, labsDigest(record.labs));
  assert.deepEqual(record.vendored.reworded, [{ field: 'rule', fromSha256: createHash('sha256').update('RESULT.json').digest('hex'), to: 'result record' }]);
  assert.deepEqual(record.labs[0].published, { commit: hex(40, 'b'), pr: 76 });
  assert.deepEqual(record.labs[2].record, { kind: 'design', commit: hex(40, '1'), status: 'main', sha256: null });
  assert.deepEqual(record.labs[0].cells[0].predictions, { lab: 'both-fit', mongodbAdvocate: 'both-fit', postgresAdvocate: 'both-fit, leaning postgres-fits' });
  for (const leak of ['.ai/', 'PREREG', 'DESIGN', 'a note', 'lab02-']) assert.ok(!once.includes(leak), leak);
});

test('the vendor refuses what it does not know: a field, a predictor, a status, a verdict, a lab without a name', () => {
  const refuse = (edit, expected, extra = {}) => {
    const s = source(); edit(s);
    assert.throws(() => vendor({ commit: COMMIT, fileBytes: bytes(s), ...mapping, ...extra }), expected, String(expected));
  };
  refuse(s => { s.labs[0].cells[0].result = 'x'; }, /cells\/0: unknown field result/);
  refuse(s => { s.labs[0].owner = 'x'; }, /\/labs\/0: unknown field owner/);
  refuse(s => { s.labs[1].cells[0].predictions.guest = 'x'; }, /unknown predictor guest/);
  refuse(s => { s.labs[1].prereg.status = 'draft'; }, /record status "draft"/);
  refuse(s => { s.labs[1].cells[0].verdict = 'mostly-mongodb'; }, /"mostly-mongodb" is not a verdict word/);
  refuse(s => { s.labs[1].cells[0].verdict = 'mongodb-fits'; }, /a verdict without --result for Lab 02 \(v1\.1\)\/F1/);
  refuse(s => { s.labs.push({ ...s.labs[2], lab: 'Lab 09' }); }, /no --as for Lab 09/);
  refuse(s => { s.verdict_words.push('maybe'); }, /verdict_words: not exactly/);
  refuse(() => {}, /--result Lab 03\/F9: the fit map has no such cell/, { result: { 'Lab 03/F9': 'labs/' } });
  const filled = source(); filled.labs[1].cells[0].verdict = 'mongodb-fits';
  const record = vendor({ commit: COMMIT, fileBytes: bytes(filled), ...mapping, result: { 'Lab 02 (v1.1)/F1': 'labs/agent-space/' } });
  assert.deepEqual(fitMapProblems(record), []);
  assert.match(renderFitMap(record), /<a class="fit-verdict" href="\.\.\/labs\/agent-space\/">MongoDB fits<\/a>/);
});

test('the build refuses a hand edit, an unknown verdict, a cell and its result out of step, and a link or text that may not be public', () => {
  const base = vendor({ commit: COMMIT, fileBytes: bytes(source()), ...mapping });
  const redigest = r => { r.vendored.labsSha256 = labsDigest(r.labs); return r; };
  const cases = [
    [r => { r.labs[0].cells[0].predictions.lab = 'postgres-fits'; }, /#\/labs: not the labs that were vendored/],
    [r => { r.labs[0].cells[0].verdict = 'mostly'; r.labs[0].cells[0].result = 'labs/'; redigest(r); }, /verdict: "mostly" is not a verdict word/],
    [r => { r.labs[0].cells[0].verdict = 'both-fit'; redigest(r); }, /cells\/0: a filled cell without a result link/],
    [r => { r.labs[0].cells[0].result = 'labs/'; redigest(r); }, /cells\/0: a pending cell with a result link/],
    [r => { r.labs[0].cells[0].verdict = 'both-fit'; r.labs[0].cells[0].result = 'labs/missing/'; redigest(r); }, /result: labs\/missing\/ is not a page of this site/],
    [r => { r.labs[0].cells[0].verdict = 'both-fit'; r.labs[0].cells[0].result = 'https://example.com/r'; redigest(r); }, /result: a link outside this lab/],
    [r => { r.labs[0].cells[0].verdict = 'both-fit'; r.labs[0].cells[0].result = '../secret/'; redigest(r); }, /result: not a page path of this site/],
    [r => { r.labs[1].cells[0].what = 'see .ai/experiments/x/PREREG.md'; redigest(r); }, /what: a file path or file name/],
    [r => { r.labs[1].title = `Failover in ${[...'nrooH'].reverse().join('')}`; r.vendored.transform[1].title = r.labs[1].title; redigest(r); }, /title: a place name/],
    [r => { r.verdictWords = ['yes', 'no']; }, /verdictWords: not exactly/],
    [r => { r.labs[1].lab = 'Lab 02 (v1.1)'; redigest(r); }, /lab: does not match/],
    [r => { r.rule = 'a verdict fills only from RESULT.json'; }, /rule: a file path[\s\S]*rule does not say result record/],
  ];
  for (const [edit, expected] of cases) {
    const r = structuredClone(base); edit(r);
    assert.match(fitMapProblems(r).join('\n'), expected, String(expected));
  }
  // The same gate runs in the build: a committed file that fails it throws.
  const root = join(temp, 'site');
  mkdirSync(join(root, 'data/labs'), { recursive: true });
  cpSync('site/journal', join(root, 'journal'), { recursive: true });
  const bad = structuredClone(base); bad.labs[0].cells[0].predictions.lab = 'neither';
  writeFileSync(join(root, 'data/labs/fit-map.json'), JSON.stringify(bad));
  assert.throws(() => readFitMap(root), /Fit map refused/);
  writeFileSync(join(root, 'data/labs/fit-map.json'), JSON.stringify(base));
  assert.equal(readFitMap(root).labs.length, 3);
});
