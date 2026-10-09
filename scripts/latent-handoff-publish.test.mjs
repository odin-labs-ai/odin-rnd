import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTE, preRecordItemIds, REQUIRED, STATUS, TO_FREEZE, checkRecord, toFreezePaths, validateRecord, EXP005, REBOUND } from './latent-handoff-prereg.mjs';
import { build as buildPairLock } from '../experiments/latent-handoff/pair_lock.mjs';
import { assertSiteCurrent, checkHorizon, measurementState, renderHorizon, renderNote, resultWords, validateHorizon } from './latent-handoff-site.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = path => execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 1 << 28 });
const clone = x => JSON.parse(JSON.stringify(x));

test('the pre-registration is exactly the build of the files, and pinned', () => {
  const { record } = checkRecord();
  for (const key of REQUIRED) assert.ok(record[key] !== undefined, key);
});

test('every hash the pre-registration references resolves to a committed file', () => {
  const { record } = checkRecord();
  const refs = {
    ...record.files,
    ...Object.fromEntries(Object.values(EXP005).map(v => [v.file, v.sha256])),
    [record.strata.manifest.file]: record.strata.manifest.sha256,
    [record.pins.file]: record.pins.sha256,
    [record.readout.file]: record.readout.sha256,
    [record.corpus.exp008x.sumsFile]: record.corpus.exp008x.sumsSha256,
    [`experiments/latent-handoff/${record.strata.distractor.file}`]: record.strata.distractor.sha256,
    ...Object.fromEntries(Object.entries(record.mappers.code).filter(([, d]) => d !== TO_FREEZE)),
  };
  for (const [path, digest] of Object.entries(refs)) assert.equal(sha(committed(path)), digest, `${path} is not committed with sha256 ${digest}`);
});

test('a draft lists its TO-FREEZE fields; a frozen record may carry none', () => {
  const { record } = checkRecord();
  assert.deepEqual(record.freeze.toFreeze, toFreezePaths(record));
  if (record.freeze.status === 'draft') assert.ok(record.freeze.toFreeze.length > 0, 'a draft with nothing to freeze should be frozen');
  const frozen = clone(record);
  Object.assign(frozen.freeze, { status: 'frozen' });
  Object.assign(frozen.experiment, { statusText: STATUS.frozen, note: NOTE.frozen });
  if (frozen.freeze.toFreeze.length) assert.throws(() => validateRecord(frozen), /TO-FREEZE/);
  const mislabelled = clone(record);
  mislabelled.experiment.statusText = STATUS.frozen;
  if (record.freeze.status === 'draft') assert.throws(() => validateRecord(mislabelled), /status text follows/);
  for (const text of ['Not before 3 Oct 2026.', 'Not before 2026-10-03 19:00.', 'After 19:00 on the day it merges.']) {
    assert.throws(() => validateRecord({ ...clone(record), notBefore: text }), /not-before/, text);
  }
  assert.deepEqual(record.corpus.exposedItems, [...Array.from({ length: 20 }, (_, i) => `c${String(i + 1).padStart(3, '0')}`), 'c029', 'c081', 'c097', 'c112', 'c144']);
  assert.match(record.corpus.analysed, /on the 175 items/);
  const hidden = clone(record);
  hidden.mappers.calibrationRecordSha256 = TO_FREEZE;
  hidden.mappers.extra = TO_FREEZE;
  assert.throws(() => validateRecord(hidden), /lists exactly the TO-FREEZE fields/);
  const dated = clone(record);
  dated.notBefore = 'Not before 2026-10-03T19:00:00Z.';
  assert.throws(() => validateRecord(dated), /not-before/);
});

test('A3 stays a generic reserved slot; P1 is the only primary claim', () => {
  const { record } = checkRecord();
  const withHash = clone(record);
  withHash.arms.find(a => a.id === 'A3').what = `Reserved: committed by sha256 ${'a'.repeat(64)}`;
  assert.throws(() => validateRecord(withHash), /A3 carries no hash/);
  const withPromise = clone(record);
  withPromise.limits.push('A later stage 2 adds a method.');
  assert.throws(() => validateRecord(withPromise), /stage-2/);
  const withP2 = clone(record);
  withP2.primary.P2 = { on: 'A3' };
  assert.throws(() => validateRecord(withP2), /exactly one primary claim/);
});

test('the horizon record: every measured number has its fraction, window and source; statuses are computed', () => {
  const { record } = checkHorizon();
  const byId = Object.fromEntries(record.measurements.map(m => [m.id, m]));
  assert.deepEqual([byId['outcome-join-coverage'].numerator, byId['outcome-join-coverage'].denominator, byId['outcome-join-coverage'].value], [1194, 1304, 0.9156]);
  assert.deepEqual(measurementState(byId['outcome-join-coverage']), { milestone: 'met', kill: 'not triggered' });
  // The cost milestone is the plan's: routing rows. The five-source share is context only, with no threshold.
  assert.deepEqual([byId['routing-cost-share'].numerator, byId['routing-cost-share'].denominator, byId['routing-cost-share'].value], [3, 341, 0.0088]);
  assert.deepEqual(measurementState(byId['routing-cost-share']), { milestone: 'not yet met', kill: null });
  assert.equal(record.rungs[0].milestones.find(x => x.id === 'cost').measure, 'routing-cost-share');
  assert.deepEqual([byId['dispatch-cost-share'].role, byId['dispatch-cost-share'].numerator, byId['dispatch-cost-share'].denominator], ['context', 358, 753]);
  const promoted = clone(record);
  promoted.rungs[0].milestones.find(x => x.id === 'cost').measure = 'dispatch-cost-share';
  assert.throws(() => validateHorizon(promoted), /not a milestone measurement/);
  const thresholded = clone(record);
  thresholded.measurements.find(x => x.id === 'dispatch-cost-share').milestone = { op: '>=', value: 0.5 };
  assert.throws(() => validateHorizon(thresholded), /context figure carries no threshold/);
  const wrong = clone(record);
  wrong.measurements[1].value = 0.5; // routing: 3/341
  assert.throws(() => validateHorizon(wrong), /numerator \/ denominator/);
  const unsourced = clone(record);
  delete unsourced.measurements[0].source.recordSha256;
  assert.throws(() => validateHorizon(unsourced), /source.recordSha256/);
  const noKill = clone(record);
  noKill.rungs[2].kill = [];
  assert.throws(() => validateHorizon(noKill), /kill criterion/);
});

test('the pages, data copies, home-page row and sitemap are current with the records', () => {
  assertSiteCurrent();
  const { record, sha256 } = checkRecord();
  const lock = JSON.parse(readFileSync('experiments/latent-handoff/pair-lock.json', 'utf8'));
  const note = renderNote(record, sha256, lock);
  // The edits made after the lock run started are disclosed on the page itself, with the lock record linked and published.
  assert.match(note, /<h2 id="after-the-lock">Edits after the lock run started<\/h2>/);
  assert.match(note, /href="\.\.\/data\/latent-handoff\/pair-lock\.json"/);
  for (const n of lock.notes) assert.ok(note.includes(`<li>${n.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')}</li>`), 'every pair-lock note is on the page');
  assert.equal(readFileSync('site/data/latent-handoff/pair-lock.json').equals(readFileSync('experiments/latent-handoff/pair-lock.json')), true);
  assert.throws(() => renderNote(record, sha256), /needs pair-lock\.json/);
  assert.throws(() => renderNote(record, sha256, { ...lock, record: { ...lock.record, sha256: 'a'.repeat(64) } }), /different record/);
  // The note states rules ("passes" is a rule word there); only result phrasing is refused. The home-page row is held
  // to the stricter resultWords by withHome.
  assert(!/\b(results? show|proven|outperform\w*|we found)\b/i.test(note.replace(/<[^>]+>/g, ' ')), 'the pre-registration note states a result');
  assert.ok(resultWords instanceof RegExp);
  const horizon = checkHorizon();
  const page = renderHorizon(horizon.record, horizon.sha256);
  assert.match(page, /Routing rows that carry a recorded cost: 0\.88%<\/strong> \(3 of 341/);
  assert.match(page, /0\.88%<\/strong>[^\n]*Milestone \(≥ 50\.00%\): <strong>not yet met<\/strong>/);
  assert.match(page, /<em>Context, not the milestone value: [^<]*: 47\.54%<\/em> \(358 of 753/);
  assert.doesNotMatch(page, /47\.54%[^\n]*Milestone/, 'the five-source share is never shown as the milestone value');
  assert.match(page, /91\.56%<\/strong> \(1194 of 1304/);
  assert.equal(readFileSync('site/data/latent-handoff/horizon.json').equals(horizon.bytes), true);
});

test('a measurement breakdown must sum to its fraction', () => {
  const { record } = checkHorizon();
  const m = record.measurements.find(x => x.breakdown);
  assert.ok(m, 'the cost share is published with its per-source breakdown');
  const routing = m.breakdown.find(b => b.source === 'routing');
  assert.deepEqual([routing.numerator, routing.denominator], [3, 341]);
  const off = clone(record);
  off.measurements.find(x => x.breakdown).breakdown[0].numerator += 1;
  assert.throws(() => validateHorizon(off), /breakdown numerators/);
});

test('H1 criteria that cannot be judged yet are dated, give their reason and carry no number', () => {
  const { record, sha256 } = checkHorizon();
  const h1 = record.rungs.find(r => r.id === 'H1');
  const dates = [...h1.milestones, ...h1.kill].filter(x => x.notYetMature).map(x => x.notYetMature.evaluableFrom).sort();
  assert.deepEqual(dates, ['2026-10-08', '2026-10-27', '2026-11-26']);
  const page = renderHorizon(record, sha256);
  assert.match(page, /Not yet mature: evaluable from 26 NOV 2026/);
  const numbered = clone(record);
  numbered.rungs[1].kill[0].measure = 'outcome-join-coverage';
  assert.throws(() => validateHorizon(numbered), /carries no measurement/);
  const undated = clone(record);
  delete undated.rungs[1].milestones[0].notYetMature.evaluableFrom;
  assert.throws(() => validateHorizon(undated), /needs a date and a reason/);
});

test('the prize size: open-to-open is zero, the fresh share is an upper bound, every figure is sourced', () => {
  const { record, sha256 } = checkHorizon();
  const f = Object.fromEntries(record.prizeSize.figures.map(x => [x.id, x]));
  assert.deepEqual([f['open-to-open'].numerator, f['open-to-open'].denominator], [0, 2077]);
  assert.deepEqual([f['above-window'].numerator, f['above-window'].denominator], [1375, 2077]);
  assert.deepEqual([f['first-turn-p50'].value, f['prefill-16k'].value], [270485, 7673.4]);
  assert.match(f['fresh-share'].note, /upper bound/);
  const page = renderHorizon(record, sha256);
  for (const re of [/0\.00%<\/strong> \(0 of 2,077\)/, /66\.20%<\/strong> \(1,375 of 2,077\)/, /270,485 tokens<\/strong> \(n = 2077\)/, /7,673\.4 ms<\/strong> \(n = 5\)/, /89\.10%<\/strong>/]) assert.match(page, re);
  const both = clone(record);
  both.prizeSize.figures[0].value = 1; both.prizeSize.figures[0].unit = 'x'; both.prizeSize.figures[0].n = 1;
  assert.throws(() => validateHorizon(both), /either a fraction or a value/);
});

test('every committed row file from before the record holds only excluded (seen) items', () => {
  const { record } = checkRecord();
  assert.ok(record.corpus.exposureEvidence.length >= 4);
  for (const e of record.corpus.exposureEvidence) for (const id of [...e.items, ...e.donors]) assert.ok(record.corpus.exposedItems.includes(id), `${e.file}: ${id}`);
  assert.deepEqual([...new Set(record.corpus.exposureEvidence.flatMap(e => e.donors))].sort(), ['c029', 'c081', 'c097', 'c112', 'c144']);
  assert.match(record.corpus.exposures[0].reason, /mapper readouts/);
  assert.match(record.pairLockEarlierPractice, /answered ACCEPT on all 5 \(3 of 5 correct\)/);
  assert.doesNotMatch(record.pairLockEarlierPractice, /always/, 'the always-ACCEPT score was computed after the lock outcome; it lives in pair-lock.json');
});

test('pair-lock.json is the pairLock rule applied to its committed rows, under the frozen record', () => {
  const lock = JSON.parse(readFileSync('experiments/latent-handoff/pair-lock.json', 'utf8'));
  const again = buildPairLock(lock.run.rows.file, lock.notes, undefined, REBOUND);
  assert.throws(() => buildPairLock(lock.run.rows.file, lock.notes), /runner\.py differs from the hash the frozen record binds/);
  assert.deepEqual(again, lock);
  assert.equal(sha(committed(lock.run.rows.file)), lock.run.rows.sha256);
  assert.equal(lock.record.sha256, sha(committed('experiments/latent-handoff/preregistration.json')));
  assert.equal(lock.decision, lock.result.correct >= 15 ? 'D1' : 'D1p');
  const { record } = checkRecord();
  assert.equal(record.pairLockResult.decision, lock.decision, 'the record states the lock decision pair-lock.json holds');
  assert.equal(record.pairLockResult.rows.sha256, lock.run.rows.sha256);
  assert.match(record.pairLockResult.statement, /11 of 20 .*below the bar of 15, so D1′/);
});

test('the pre-record scan fails closed on any analysed item id, wherever it sits in a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lh-prerecord-'));
  try {
    writeFileSync(join(dir, 'ok.rows.jsonl'), `${JSON.stringify({ itemId: 'c001', arm: 'C2', donor: 'c081' })}\n`);
    assert.deepEqual(preRecordItemIds(dir, ['ok.rows.jsonl']), ['c001', 'c081']);
    writeFileSync(join(dir, 'donor.rows.jsonl'), `${JSON.stringify({ itemId: 'c001', arm: 'C2', donor: 'c100' })}\n`);
    assert.throws(() => preRecordItemIds(dir, ['donor.rows.jsonl']), /analysed items: c100/);
    writeFileSync(join(dir, 'nested.json'), JSON.stringify({ parity: { items: [{ note: 'readout on c175' }] } }));
    assert.throws(() => preRecordItemIds(dir, ['nested.json']), /c175/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every A2b description in the record carries the full simplified-reimplementation label', () => {
  const { record } = checkRecord();
  const short = clone(record);
  short.mappers.implementations.A2b = 'our reimplementation of HeteroFold (arXiv 2609.32259)';
  assert.throws(() => validateRecord(short), /without its full label/);
});
