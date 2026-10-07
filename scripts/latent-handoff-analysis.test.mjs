// EXP 008 amendment 01: the confirmatory analysis (experiments/latent-handoff/analyse.mjs) on SYNTHETIC rows only.
// No counted data existed when this was written: every row below is invented on the real item ids and labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { STAGE1_ARMS } from '../experiments/latent-handoff/arms.mjs';
import { analyse, analysedIds, boundFiles, bootstrapRatio, loadInputs, mulberry32, rerunIds, runIds, wilson, STRATA } from '../experiments/latent-handoff/analyse.mjs';
import { loadTruth } from '../experiments/latent-handoff/score.mjs';
import { at, checkAmendment, CLAUSES } from './latent-handoff-amendment.mjs';
import { checkRecord } from './latent-handoff-prereg.mjs';
import { renderNote, SHORT_A2B_FILES, UNPRICED_NOTE } from './latent-handoff-site.mjs';

const { record } = checkRecord();
const lock = JSON.parse(readFileSync('experiments/latent-handoff/pair-lock.json', 'utf8'));
const truth = loadTruth();
const ALL = [...truth.keys()].sort();
const MERGED = '2026-10-03T10:00:00Z';
const AFTER = '2026-10-04T10:00:01.000Z';
const flip = d => (d === 'REJECT' ? 'ACCEPT' : 'REJECT');
const right = id => (truth.get(id) === 'RED' ? 'REJECT' : 'ACCEPT');

/** One synthetic row; `f(id, arm, stratum)` may override any field. */
function rows(runIdOf, items, f = () => ({})) {
  return STRATA.flatMap(s => items.flatMap(id => STAGE1_ARMS.map(arm => {
    const decision = ['C2', 'C3'].includes(arm) ? 'ACCEPT' : right(id);
    const base = {
      runId: runIdOf[s], pair: lock.decision, stratum: s, itemId: id, arm, attempt: 0, abstain: false, decision,
      pYes: decision === 'REJECT' ? 0.8 : 0.2, pYesBin: decision === 'REJECT' ? 0.81 : 0.19,
      ttftMs: arm === 'A0' ? 1000 : 300, senderMs: ['A1', 'A2a', 'A2b'].includes(arm) ? 900 : null,
      forwardCalls: [24], suffixLen: 24, gate: { ts: AFTER }, ...(arm === 'C1' ? { klVsA0: 0 } : {}),
    };
    return { ...base, ...f(id, arm, s) };
  })));
}
const ids = runIds(lock.decision);
const analysed = analysedIds(record, truth);
const reIds = rerunIds(record, analysed);
const run = (fc = () => ({}), fr = fc, extra = {}) => analyse({ record, lock, truth, counted: rows(ids.counted, ALL, fc), rerun: rows(ids.rerun, reIds, fr), mergedAt: MERGED, ...extra });
const gate = (r, id) => r.globalGates.find(g => g.id === id);

test('the analysed set and the re-run set are the record\'s', () => {
  assert.equal(analysed.length, 175);
  for (const id of record.corpus.exposedItems) assert.ok(!analysed.includes(id));
  assert.equal(reIds.length, 18);
});

test('Wilson interval and the seeded paired bootstrap', () => {
  const w0 = wilson(0, 10), w10 = wilson(10, 10);
  assert.equal(w0.lower, 0);
  assert.ok(Math.abs(w0.upper - 0.277532) < 1e-6, w0.upper);
  assert.ok(Math.abs(w10.lower - 0.722468) < 1e-6, w10.lower);
  const w = wilson(81, 100);
  assert.ok(Math.abs(w.lower - 0.722212) < 1e-5 && Math.abs(w.upper - 0.874852) < 1e-5, JSON.stringify(w));
  const constant = Array.from({ length: 50 }, () => ({ arm: 3, base: 10 }));
  assert.deepEqual(bootstrapRatio(constant), { point: 0.3, lower: 0.3, upper: 0.3 });
  const r = mulberry32(8008);
  const noisy = Array.from({ length: 60 }, () => ({ arm: 200 + 200 * r(), base: 1000 }));
  const a = bootstrapRatio(noisy), b = bootstrapRatio(noisy);
  assert.deepEqual(a, b, 'the bootstrap is reproducible');
  assert.ok(a.lower <= a.point && a.point <= a.upper);
});

test('a clean synthetic run: every gate passes and P1 holds', () => {
  const r = run();
  assert.deepEqual(r.globalGates.map(g => [g.id, g.pass]), [['complete', true], ['not-before', true], ['a0-accuracy', true], ['c1-matches-a0', true], ['zero-prefill', true], ['rerun-identical', true]]);
  assert.equal(r.P1.agreement.k, 175);
  assert.ok(r.P1.agreement.wilson95.lower > 0.97);
  assert.equal(r.P1.ttft.ratio, 0.3);
  assert.equal(r.P1.verdict, 'holds');
  assert.equal(r.seenItems.n, 25);
  assert.equal(r.secondary.S2.estimable, false);
  assert.equal(r.secondary.S3.estimable, false);
  assert.equal(r.secondary.S1.holds, false, 'a 3.3x synthetic speed-up on S does not hold S1');
});

test('A2b disagreeing with A0 refutes P1 (abstentions count as disagreement)', () => {
  const r = run((id, arm) => (arm === 'A2b' && Number(id.slice(1)) % 4 === 0 ? { decision: flip(right(id)) } : arm === 'A2b' && id === 'c021' ? { abstain: true, decision: undefined, ttftMs: undefined, reason: 'oom' } : {}));
  assert.ok(r.P1.agreement.k < 175 - 40);
  assert.ok(r.P1.agreement.wilson95.lower < 0.9);
  assert.equal(r.P1.verdict, 'refuted');
});

test('a slow A2b refutes P1 on TTFT', () => {
  const r = run((id, arm) => (arm === 'A2b' ? { ttftMs: 700 } : {}));
  assert.equal(r.P1.ttft.holds, false);
  assert.equal(r.P1.verdict, 'refuted');
});

test('A0 below 0.75 on L makes the result uninformative, never a pass', () => {
  const r = run((id, arm, s) => (s === 'L' && ['A0', 'C1', 'A2b', 'A2a', 'A1'].includes(arm) && Number(id.slice(1)) % 3 === 0 ? { decision: flip(right(id)) } : {}));
  assert.equal(gate(r, 'a0-accuracy').pass, false);
  assert.equal(r.P1.verdict, 'uninformative');
  assert.match(r.P1.why, /small receivers cannot do this gate/);
});

test('a C1 mismatch, a prefill violation, a re-run difference or an early item each fail their global gate', () => {
  const c1 = run((id, arm) => (arm === 'C1' && id === 'c050' ? { klVsA0: 0.002 } : {}));
  assert.equal(gate(c1, 'c1-matches-a0').pass, false);
  assert.equal(c1.P1.verdict, 'uninformative');
  const pre = run((id, arm) => (arm === 'A2a' && id === 'c060' ? { forwardCalls: [24, 2048] } : {}));
  assert.deepEqual(gate(pre, 'zero-prefill').detail.violations, ['S/c060/A2a', 'M/c060/A2a', 'L/c060/A2a']);
  assert.equal(pre.P1.verdict, 'uninformative');
  const tiny = run(() => ({}), (id, arm) => (id === reIds[0] && arm === 'A2b' ? { pYes: (right(id) === 'REJECT' ? 0.8 : 0.2) + 4e-7 } : {}));
  assert.equal(gate(tiny, 'rerun-identical').pass, true, 'a difference past the 6th decimal is not a difference');
  const re = run(() => ({}), (id, arm) => (id === reIds[0] && arm === 'A2b' ? { pYes: (right(id) === 'REJECT' ? 0.8 : 0.2) + 2e-6 } : {}));
  assert.equal(gate(re, 'rerun-identical').pass, false);
  assert.equal(re.P1.verdict, 'uninformative');
  const at = run((id, arm) => (id === 'c200' && arm === 'C3' ? { gate: { ts: '2026-10-04T10:00:00.000Z' } } : {}));
  assert.equal(gate(at, 'not-before').pass, false, 'an item must start after the not-before, not at it');
  const early = run((id, arm) => (id === 'c200' && arm === 'C3' ? { gate: { ts: '2026-10-04T09:59:59.000Z' } } : {}));
  assert.equal(gate(early, 'not-before').pass, false);
  assert.equal(gate(early, 'not-before').detail.notBefore, '2026-10-04T10:00:00.000Z');
});

test('a failed manipulation check on A2b makes P1 uninformative', () => {
  const r = run((id, arm) => (arm === 'C2' ? { decision: right(id) } : {}));
  assert.equal(r.perArmGates.find(g => g.arm === 'A2b' && g.stratum === 'L').manipulation.pass, false);
  assert.equal(r.P1.verdict, 'uninformative');
});

test('more than 10% timing-unstable items make the TTFT criterion uninformative', () => {
  const counted = rows(ids.counted, ALL);
  counted.push({ runId: ids.counted.L, kind: 'timing-unstable', attempt: 2, items: analysed.slice(0, 18) });
  const r = analyse({ record, lock, truth, counted, rerun: rows(ids.rerun, reIds), mergedAt: MERGED });
  assert.equal(r.P1.ttft.excluded, 18);
  assert.equal(r.P1.ttft.informative, false);
  assert.equal(r.P1.verdict, 'uninformative');
  counted.at(-1).items = analysed.slice(0, 17);
  assert.equal(analyse({ record, lock, truth, counted, rerun: rows(ids.rerun, reIds), mergedAt: MERGED }).P1.verdict, 'holds');
});

test('the latest timing attempt counts; a gap, a duplicate, another run id or another pair is refused', () => {
  const counted = rows(ids.counted, ALL);
  counted.push({ ...counted.find(x => x.arm === 'A2b' && x.stratum === 'L' && x.itemId === 'c100'), attempt: 1, decision: flip(right('c100')) });
  assert.equal(analyse({ record, lock, truth, counted, rerun: rows(ids.rerun, reIds), mergedAt: MERGED }).P1.agreement.k, 174);
  const rerun = rows(ids.rerun, reIds);
  const gap = analyse({ record, lock, truth, counted: rows(ids.counted, ALL).slice(1), rerun, mergedAt: MERGED });
  assert.deepEqual([gap.globalGates.map(g => [g.id, g.pass]), gap.P1.verdict], [[['complete', false]], 'uninformative']);
  assert.equal(gap.P1.agreement, undefined, 'nothing else is computed on a run with gaps');
  const stopped = analyse({ record, lock, truth, counted: rows(ids.counted, ALL).filter(r => r.stratum !== 'S'), rerun: [], mergedAt: MERGED });
  assert.equal(stopped.globalGates[0].detail.gaps.length, 4, 'a stratum never run and an absent re-run are gaps');
  const dup = rows(ids.counted, ALL); dup.push(dup[0]);
  assert.throws(() => analyse({ record, lock, truth, counted: dup, rerun, mergedAt: MERGED }), /two rows/);
  const other = rows(ids.counted, ALL); other.push({ ...other[0], runId: 'practice-d1p-L-02' });
  assert.throws(() => analyse({ record, lock, truth, counted: other, rerun, mergedAt: MERGED }), /not one of/);
  assert.throws(() => analyse({ record, lock, truth, counted: rows(ids.counted, ALL, () => ({ pair: 'D1' })), rerun, mergedAt: MERGED }), /not the locked/);
});

test('a superseded timing attempt that started before the not-before fails the gate', () => {
  const counted = rows(ids.counted, ALL, (id, arm, s) => (id === 'c100' && arm === 'A2b' && s === 'L' ? { gate: { ts: '2026-10-04T09:00:00.000Z' } } : {}));
  counted.push({ ...counted.find(x => x.itemId === 'c100' && x.arm === 'A2b' && x.stratum === 'L'), attempt: 1, gate: { ts: AFTER } });
  const r = analyse({ record, lock, truth, counted, rerun: rows(ids.rerun, reIds), mergedAt: MERGED });
  assert.deepEqual(gate(r, 'not-before').detail.early, 1);
  assert.equal(r.P1.verdict, 'uninformative');
});

test('the other arm of the manipulation check, a parity failure, and abstentions in the TTFT exclusions', () => {
  const c3 = run((id, arm) => (arm === 'C3' ? { decision: right(id) } : {}));
  const m = c3.perArmGates.find(g => g.arm === 'A2b' && g.stratum === 'L').manipulation;
  assert.ok(m.armMinusC2 >= 0.15 && Math.abs(m.c2MinusC3) > 0.1 && m.pass === false);
  assert.equal(c3.P1.verdict, 'uninformative');
  const broken = JSON.parse(JSON.stringify(record));
  broken.mappers.pairs[lock.decision].parityBinding.A2b.pass = false;
  const par = analyse({ record: broken, lock, truth, counted: rows(ids.counted, ALL), rerun: rows(ids.rerun, reIds), mergedAt: MERGED });
  assert.equal(par.perArmGates.find(g => g.arm === 'A2b' && g.stratum === 'L').parity.pass, false);
  assert.equal(par.P1.verdict, 'uninformative');
  const gone = new Set(analysed.slice(0, 18));
  const ab = run((id, arm, s) => (s === 'L' && arm === 'A2b' && gone.has(id) ? { abstain: true, decision: undefined, ttftMs: undefined, reason: 'oom' } : {}));
  assert.deepEqual([ab.P1.ttft.excluded, ab.P1.ttft.informative, ab.P1.agreement.k], [18, false, 157]);
  assert.equal(ab.P1.verdict, 'refuted', 'a failed agreement criterion refutes even when TTFT is uninformative');
});

test('the amendment is exactly its build, quotes the record verbatim, and binds this script and these tests', () => {
  const { record: a } = checkAmendment();
  for (const c of a.clauses) for (const q of c.record) assert.equal(q.text, at(record, q.path), `${c.id}: ${q.path}`);
  assert.deepEqual(a.clauses.map(c => c.id), CLAUSES.map(c => c.id));
  const inputs = loadInputs();
  assert.equal(inputs.amendment.sha256, checkAmendment().sha256);
  const bound = boundFiles(record, a).map(([f]) => f);
  for (const f of ['experiments/jev-gate/labels.json', 'experiments/latent-handoff/corpus-x/labels-x.json', record.pairLockResult.rows.file, ...record.corpus.exposureEvidence.map(x => x.file), 'experiments/latent-handoff/analyse.mjs', 'scripts/latent-handoff-analysis.test.mjs']) assert.ok(bound.includes(f), `${f} is checked before the analysis`);
  assert.equal(a.run.pair, lock.decision);
});

test('the note renders amendment 01 and refuses one that amends another record', () => {
  const { record: r, sha256 } = checkRecord();
  const amendment = checkAmendment();
  const note = renderNote(r, sha256, lock, amendment);
  assert.match(note, /PRE-REGISTERED 02 OCT 2026 · AMENDED 02 OCT 2026 · NOT YET RUN/);
  assert.match(note, /<h2 id="amendment-01">Amendment 01: the confirmatory analysis script<\/h2>/);
  assert.ok(note.includes(amendment.sha256) && note.includes('../data/latent-handoff/amendment-01.json'));
  const other = { ...amendment, record: { ...amendment.record, parent: { ...amendment.record.parent, sha256: 'a'.repeat(64) } } };
  assert.throws(() => renderNote(r, sha256, lock, other), /amends a different record/);
});

test('S1 and the descriptive figures follow the gates: informative only when their gates pass', () => {
  const slow = run((id, arm, s) => (s === 'S' && ['A2a', 'A2b'].includes(arm) ? { ttftMs: 900 } : {}));
  assert.deepEqual([slow.secondary.S1.holds, slow.secondary.S1.arms.map(x => x.speedup)], [true, [1.111111, 1.111111]]);
  assert.ok(slow.informative && slow.descriptive.R1.every(x => x.informative) && slow.accuracy.every(x => x.informative));
  const early = run((id, arm, s) => (s === 'S' && ['A2a', 'A2b'].includes(arm) ? { ttftMs: 900, ...(id === 'c200' && arm === 'A2a' ? { gate: { ts: '2026-10-04T09:00:00.000Z' } } : {}) } : {}));
  assert.equal(early.informative, false);
  assert.deepEqual([early.secondary.S1.holds, early.P1.agreement.holds, early.P1.ttft.holds], [null, null, null]);
  assert.ok(early.descriptive.R1.every(x => !x.informative) && early.accuracy.every(x => !x.informative) && early.timings.every(x => !x.informative));
  const manipS = run((id, arm, s) => (s === 'S' && ['A2a', 'A2b'].includes(arm) ? { ttftMs: 900 } : s === 'S' && arm === 'C2' ? { decision: right(id) } : {}));
  assert.equal(manipS.secondary.S1.holds, null, 'a failed per-arm gate on S makes S1 uninformative');
  assert.equal(manipS.P1.verdict, 'holds', 'P1 reads stratum L only');
  assert.equal(manipS.descriptive.R1.find(x => x.arm === 'A2b' && x.stratum === 'S').informative, false);
  assert.equal(manipS.descriptive.R1.find(x => x.arm === 'A2b' && x.stratum === 'L').informative, true);
});

test('the site wording fixes: edit summary, lock link and answers, short labels, one unpriced term, no internal paths', () => {
  const dir = 'experiments/latent-handoff';
  const walk = d => readdirSync(d).flatMap(f => (statSync(`${d}/${f}`).isDirectory() ? (['node_modules', 'datasets'].includes(f) ? [] : walk(`${d}/${f}`)) : [`${d}/${f}`]));
  const carriers = walk(dir).filter(f => /2609\.32259/.test(readFileSync(f, 'utf8'))).map(f => f.slice(dir.length + 1))
    .filter(f => !['README.md', 'preregistration.json'].includes(f)).sort();
  assert.deepEqual(carriers, [...SHORT_A2B_FILES].sort(), 'the short-label list is every file that carries one');
  const note = readFileSync('site/journal/latent-handoff-pre-registration.html', 'utf8');
  assert.match(note, /shrank the analysed set from 180 to 175 items/);
  assert.match(note, /answered ACCEPT on all 20 practice items/);
  assert.match(note, /<a href="#after-the-lock">the edits after the lock run started<\/a>/);
  const horizon = readFileSync('site/horizon/factory-intelligence.html', 'utf8');
  assert.ok(!/(^|[^\w.-])\.(ai|claude)\//.test(horizon), 'no internal monorepo path on the horizon page');
  assert.ok(horizon.includes(UNPRICED_NOTE.replaceAll("'", '&#39;')));
  assert.match(horizon, /will emit it for every arm row of its counted run/);
});
