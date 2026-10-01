import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRecords } from '../experiments/jev-gate/runner-guard.mjs';
import { classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { loadFingerprints } from '../experiments/nina-changes/fingerprints.mjs';
import { computeResults6 } from '../experiments/nina-changes/results6.mjs';
import { checkResults, renderSpotlightCard } from './jev-gate-results-site.mjs';
import { checkRecord } from './nina-changes-prereg.mjs';
import { addNinaEntry, attributionLine, entryId, loadEntryData, renderNinaEntry } from './nina-changes-spotlight.mjs';
import { entryShown, gateFromBytes, gateOpen } from '../experiments/nina-changes/spotlight-gate.mjs';
import { builtCopy } from './test-build.mjs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';
import { spotlightShown } from '../experiments/nina-changes/spotlight-gate.mjs';
import { corpusItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { outFile as FINGERPRINTS_FILE } from '../experiments/nina-changes/fingerprints.mjs';
import { amendedPins6, checkPinned6, checkRun6 } from '../experiments/nina-changes/guard6.mjs';
import { buildReviewerRun } from './nina-changes-built-reviewer.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

const GATE = 'experiments/nina-changes/spotlight-gate.mjs';

// EXP 006 REVISION 5: nina's entry in "Tools leaving the factory" — rendered only on a PASS with an explicit
// held:false (EXP 005's card gate, reused) and a PASSING manipulation check; figures from the EXP 006 results record.

const { prereg, amendment } = checkRecords({ mode: 'practice' });
const { record: prereg6 } = checkRecord();
const labels = JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8'));
const fingerprints = loadFingerprints();
const truth = Object.fromEntries(labels.items.map(i => [i.id, i.label]));

// Refute r5 B1: the reviewer run record is made by the REAL builder and loop (runReviewer6 in rehearsal mode, the
// stream-json fake answering each item with its labelled verdict), and the results by the REAL scorer from that record.
// Both are then made "counted" the way the freeze is injected: the rehearsal flag cleared and a synthetic frozen
// pre-registration sha set (freeze.mjs stays null in the repository; nothing is written outside a scratch dir).
const FROZEN = createHash('sha256').update('EXP 006 synthetic frozen pre-registration (test only)').digest('hex');
const BUILT = await (async () => {
  const dir = scratchDir('nc-spot-built');
  try {
    const items = corpusItems();
    const modes = items.flatMap(i => Array.from({ length: 3 }, () => `synthetic:${truth[i.id] === 'RED' ? 'REJECTED' : 'APPROVED'}`));
    return await buildReviewerRun({ dir, items, modes });
  } finally { removeScratch(dir); }
})();
const { stamp: STAMP } = checkRun6({ mode: 'rehearsal', rehearsalPins: BUILT.pins });

/** The builder's record with its first `blindRuns` calls replayed with no tool output (diff-blind). */
function blindRun(blindRuns) {
  const run = structuredClone(BUILT.run);
  for (const c of run.calls.slice(0, blindRuns)) {
    c.toolCalls = [];
    const d = classifyDiffSeen({ calls: [], fp: fingerprints.items[c.id], harnessFailure: c.harnessFailure });
    c.diffSeen = { seen: d.seen, rule: d.rule, evidence: d.evidence };
  }
  return run;
}
/** The real scorer over that record. */
function passingResults({ blindRuns = 0 } = {}) {
  const run = blindRun(blindRuns);
  return computeResults6({ exp005: { prereg, amendment }, bar6: prereg6.bar, labels, run, fingerprints, fingerprintsSha256: createHash('sha256').update(readFileSync(FINGERPRINTS_FILE)).digest('hex'), stamp: STAMP, preflight: BUILT.preflight });
}
// EXP 006 amendment 01 (A5): the synthetic freeze names an amendment too, the one the builder's rehearsal pins carry.
const FROZEN_A6 = BUILT.pins.amendment6Sha256;
const countedRecord = r => { const { banner: _b, rehearsal: _r, ...rest } = structuredClone(r); return { ...rest, fixture: false, prereg6Sha256: FROZEN, amendment6Sha256: FROZEN_A6 }; };
const counted = countedRecord;
const pass = counted(passingResults());
const open = { kind: 'spotlight-decision', held: false };
const REVIEWER = countedRecord(BUILT.run);
/** The gate from records: the decision binds these results bytes and this reviewer record unless told otherwise. */
function gate(results, decision, { bind = true, bindReviewer = true, rawDecision = null, reviewer = REVIEWER, freeze = { PREREG6_SHA256: FROZEN, AMENDMENT6_SHA256: FROZEN_A6 } } = {}) {
  const resultsBytes = Buffer.from(JSON.stringify(results));
  const reviewerBytes = reviewer ? Buffer.from(JSON.stringify(reviewer)) : null;
  const sha = b => createHash('sha256').update(b).digest('hex');
  const decisionBytes = rawDecision ?? (decision ? Buffer.from(JSON.stringify({ ...decision, resultsSha256: bind ? sha(resultsBytes) : 'f'.repeat(64), reviewerSha256: bindReviewer && reviewerBytes ? sha(reviewerBytes) : 'e'.repeat(64) })) : null);
  return gateFromBytes({ resultsBytes, decisionBytes, reviewerBytes, freeze });
}
const upstream = JSON.parse(readFileSync('experiments/nina-changes/upstream.json', 'utf8')).prs;
const data = (results, decision, opts) => gate(results, decision, opts);

test('PASS with an explicit held:false renders nina\'s entry, every figure from the results record', () => {
  assert.equal(pass.spotlight.verdict, 'PASS'); assert.equal(pass.manipulation.state, 'PASS');
  const entry = renderNinaEntry(data(pass, open), upstream);
  assert.match(entry, /^<article class="project-row project-featured" id="project-nina"><div class="project-number">005<span>HARNESS<\/span><\/div>/);
  for (const part of ['nina: harness orchestration for Claude Code', 'Marcos Schulz (xhulz)', 'github.com/xhulz/nina', `— ${attributionLine}.`, 'journal/nina-reviews-the-change.html#results', 'journal/jev-as-a-fast-gate.html#spotlight', 'xhulz/nina#39 (merged 2026-09-28)', 'xhulz/nina#41 (open)', 'no local patch to nina', '0 of 180 harness failures', '0 of 90 runs missed drift', '0 of 90 runs falsely rejected', 'the same verdict on 60 of 60 changes', 'in 180 of 180 runs a tool output showed it at least one line of the change', day(REVIEWER.endedAt), '<div class="project-links">', '<p class="project-note">', '<dl class="project-spec">']) assert(entry.includes(part), part);
  assert.equal(attributionLine, 'used with the permission of its author, as confirmed by Odin Labs');
  // A figure changed in the record changes the entry: nothing is typed in the renderer.
  const blind5 = counted(passingResults({ blindRuns: 5 }));
  assert(renderNinaEntry(data({ ...blind5, spotlight: { ...blind5.spotlight, verdict: 'PASS' }, manipulation: { ...blind5.manipulation, state: 'PASS' }, spotlightEligible: true }, open, { reviewer: countedRecord(blindRun(5)) }), upstream).includes('175 of 180 runs'));
  // Null-safe zero-patch wording (refute r3 N5): a record without the patch list renders, and says so.
  const noPatches = structuredClone(pass); noPatches.spotlight.criteria.find(x => x.id === 'zero-patches').patches = null;
  assert(renderNinaEntry(data(noPatches, open), upstream).includes('local patches not recorded'));
});

test('FAIL, held, a missing decision, a non-boolean held, or a failed manipulation check render nothing', () => {
  assert.equal(entryShown({ results: pass, decision: open }), true);
  assert.equal(data(pass, open).shown, true);
  assert.equal(renderNinaEntry(data(pass, open, { bind: false })), '', 'a decision bound to another results record hides it');
  assert.match(data(pass, open, { bind: false }).reason, /another results record/);
  assert.equal(renderNinaEntry(data(pass, null, { rawDecision: Buffer.from('not json {') })), '', 'an unparseable decision hides it');
  assert.equal(renderNinaEntry(data(pass, { ...open, held: true })), '', 'held');
  assert.equal(renderNinaEntry(data(pass, null)), '', 'no decision record');
  assert.equal(renderNinaEntry(data(pass, { ...open, held: 'false' })), '', 'only an explicit boolean false opens it');
  assert.equal(renderNinaEntry(data({ ...pass, spotlight: { ...pass.spotlight, verdict: 'FAIL' } }, open)), '', 'bar FAIL');
  assert.equal(renderNinaEntry(data({ ...pass, manipulation: { ...pass.manipulation, state: 'FAIL' }, spotlightEligible: false }, open)), '', 'manipulation FAIL');
  const tooBlind = counted(passingResults({ blindRuns: 19 }));
  assert.equal(tooBlind.manipulation.state, 'FAIL');
  assert.equal(renderNinaEntry(data(tooBlind, open, { reviewer: countedRecord(blindRun(19)) })), '', '19 of 180 diff-blind');
  assert.match(data(tooBlind, open, { reviewer: countedRecord(blindRun(19)) }).reason, /bar, manipulation check/, 'closed by the manipulation check, not by a record mismatch');
  assert.equal(renderNinaEntry(null), '');
});

test('the entry goes next after 002 Laya, and there is only ever one nina entry', () => {
  const home = readFileSync('site/index.html', 'utf8');
  const built = addNinaEntry(home, data(pass, open), upstream);
  const at = s => built.indexOf(s);
  assert(at('<div class="project-number">002') < at(`id="${entryId}"`) && at(`id="${entryId}"`) < at('<div class="project-number">003'));
  assert.throws(() => addNinaEntry(built, data(pass, open), upstream), /one nina entry only/);
  assert.equal(addNinaEntry(home, data(pass, { ...open, held: true }), upstream), home, 'closed gate: the page is unchanged');
  // EXP 005's gated card (the slot this supersedes) stays closed on its committed, held decision.
  assert.equal(renderSpotlightCard(checkResults()), '');
});

test('the live site renders nina\'s entry exactly when the committed records open the pinned gate (fresh build copy)', { timeout: 600_000 }, () => {
  // Three committed states: no results record (closed); results with a held decision (closed); results with the
  // pre-registered held:false decision (open: the entry renders, from the records).
  const R = 'experiments/nina-changes/results/';
  const decision = existsSync(`${R}spotlight-decision.json`) ? JSON.parse(readFileSync(`${R}spotlight-decision.json`, 'utf8')) : null;
  const page = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  const g = gateOpen();
  assert.equal(loadEntryData().shown, g.shown);
  if (!existsSync(`${R}results.json`)) assert.deepEqual([g.shown, g.reason], [false, 'no results record']);
  else if (decision?.held !== false) assert.deepEqual([g.shown, g.reason], [false, 'the gate is closed: bar, manipulation check, eligibility or held']);
  else {
    assert.equal(g.shown, true, g.reason);
    assert(page.includes(renderNinaEntry(g, upstream)), 'the built home page carries the entry the gate opens, as rendered from the records');
    const at = s => page.indexOf(s);
    assert(at('<div class="project-number">002') < at(`id="${entryId}"`) && at(`id="${entryId}"`) < at('<div class="project-number">003'), 'next after 002 Laya');
    assert.equal(page.split(`id="${entryId}"`).length, 2, 'one nina entry');
    return;
  }
  assert(!page.includes(`id="${entryId}"`) && !page.includes('HARNESS</span>'));
});

test('the gate is pinned (an edit makes the guard refuse), the markup renderer is not; the record states the split', () => {
  assert.match(prereg6.spotlightArtefact.pass, /Tools leaving the factory/);
  assert.match(prereg6.spotlightArtefact.fail, /no entry/);
  assert.match(prereg6.spotlightArtefact.renderer, /scripts\/nina-changes-spotlight\.mjs, the markup, not pinned/);
  assert.match(prereg6.spotlightArtefact.gate, /experiments\/nina-changes\/spotlight-gate\.mjs, pinned/);
  assert.ok(!('scripts/nina-changes-spotlight.mjs' in prereg6.files), 'the markup renderer is not pinned (N5)');
  // Refute r2 B1: the GATE is pinned (as EXP 006 amendment 01 re-pins it), and an edit to it makes the counted guard refuse.
  const pinned = amendedPins6(prereg6.files, JSON.parse(readFileSync('experiments/nina-changes/amendment-01.json', 'utf8')));
  assert.equal(pinned[GATE], createHash('sha256').update(readFileSync(GATE)).digest('hex'));
  const root = scratchDir('nc-gate');
  try {
    mkdirSync(join(root, 'experiments/nina-changes'), { recursive: true });
    writeFileSync(join(root, GATE), readFileSync(GATE, 'utf8').replace("data.results.manipulation?.state === 'PASS'", 'true'));
    assert.throws(() => checkPinned6({ [GATE]: pinned[GATE] }, root), /spotlight-gate\.mjs at [0-9a-f]{64}; it hashes to/);
    writeFileSync(join(root, GATE), readFileSync(GATE));
    assert.doesNotThrow(() => checkPinned6({ [GATE]: pinned[GATE] }, root));
  } finally { removeScratch(root); }
  // The renderer holds no gate logic: it imports the pinned gate.
  const renderer = readFileSync('scripts/nina-changes-spotlight.mjs', 'utf8');
  assert.match(renderer, /import \{ gateOpen \} from '\.\.\/experiments\/nina-changes\/spotlight-gate\.mjs';/);
  assert.doesNotMatch(renderer, /held\s*===|manipulation\?\.state\s*===|spotlightEligible\s*===|checkDecision|entryShown/, 'no gate logic in the renderer');
  assert.doesNotMatch(renderer, /results\/results\.json|spotlight-decision\.json|results\/reviewer\.json/, 'no record path in the renderer');
});

test('spotlight-gate.mjs carries EXP 005\'s spotlightShown byte-identical (scripts/jev-gate-results-site.mjs at b2dbb1fd)', () => {
  const fixture = readFileSync('experiments/nina-changes/fixtures/exp005-b2dbb1fd/jev-gate-results-site.mjs.txt', 'utf8');
  assert.equal(createHash('sha256').update(fixture).digest('hex'), 'a88a5e2b8649b21f487374f97158e4d84c82ff371971d70cced5705b019b347f');
  const line = src => src.split('\n').find(l => l.startsWith('export const spotlightShown = '));
  assert.equal(line(readFileSync(GATE, 'utf8')), line(fixture));
  assert.equal(line(readFileSync('scripts/jev-gate-results-site.mjs', 'utf8')), line(fixture), 'EXP 005\'s own copy is unchanged too');
  assert.equal(spotlightShown({ results: { spotlight: { verdict: 'PASS' } }, decision: { held: false } }), true);
});

test('a synthetic edit of the gate makes the build refuse (the pre-registration no longer matches its pinned files)', { timeout: 600_000 }, () => {
  const root = scratchDir('nc-gatebuild');
  try {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const rel of files) { if (!existsSync(rel)) continue; mkdirSync(dirname(join(root, rel)), { recursive: true }); cpSync(rel, join(root, rel)); }
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'));
    writeFileSync(join(root, GATE), readFileSync(GATE, 'utf8').replace("data.results.manipulation?.state === 'PASS'", 'true'));
    const r = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'the build must refuse');
    assert.match(r.stderr, /differs from its build|not amendment 01's pin/);
  } finally { removeScratch(root); }
});

test('refute r4 B1: the gate opens only for a real, complete, counted EXP 006 measurement under the frozen pre-registration', () => {
  assert.equal(gate(pass, open).shown, true, 'the synthetic counted record opens it');
  const hidden = (label, results, opts = {}, why) => { const g = gate(results, open, opts); assert.equal(g.shown, false, label); if (why) assert.match(g.reason, why, label); };
  hidden('a fixture results record', { ...pass, fixture: true }, {}, /fixture/);
  hidden('a rehearsal results record', { ...pass, rehearsal: true }, {}, /rehearsal/);
  hidden('a partial results record', { ...pass, partial: [{ reason: 'spend' }] }, {}, /partial/);
  hidden('another experiment', { ...pass, experiment: 'EXP 005' }, {}, /EXP 006/);
  hidden('not a results record', { ...pass, kind: 'gate-run' }, {}, /kind/);
  hidden('another pre-registration sha', { ...pass, prereg6Sha256: 'a'.repeat(64) }, {}, /another pre-registration/);
  hidden('no pre-registration sha', { ...pass, prereg6Sha256: null }, {}, /another pre-registration/);
  hidden('a null freeze (not frozen yet)', pass, { freeze: { PREREG6_SHA256: null } }, /not frozen/);
  hidden('amendment 01 not frozen yet', pass, { freeze: { PREREG6_SHA256: FROZEN, AMENDMENT6_SHA256: null } }, /amendment 01 is not frozen/);
  hidden('another amendment sha', { ...pass, amendment6Sha256: 'c'.repeat(64) }, {}, /another EXP 006 amendment 01/);
  hidden('no amendment sha', { ...pass, amendment6Sha256: null }, {}, /another EXP 006 amendment 01/);
  hidden('a reviewer record under another amendment', pass, { reviewer: { ...REVIEWER, amendment6Sha256: 'd'.repeat(64) } }, /another EXP 006 amendment 01/);
  hidden('the decision does not name the reviewer record', pass, { bindReviewer: false }, /reviewer run record/);
  hidden('a fixture reviewer record', pass, { reviewer: { ...REVIEWER, fixture: true } }, /reviewer run record is a fixture/);
  hidden('a rehearsal reviewer record', pass, { reviewer: { ...REVIEWER, rehearsal: true } }, /rehearsal/);
  hidden('a reviewer record under another pre-registration', pass, { reviewer: { ...REVIEWER, prereg6Sha256: 'b'.repeat(64) } }, /another pre-registration/);
  hidden('no reviewer record', pass, { reviewer: null }, /no reviewer run record/);
  hidden('EXP 005\'s publication check fails', { ...pass, note: 'FIXTURE' }, {}, /not publishable/);
  // The committed tree: the live gate opens only with results and the pre-registered held:false decision (the live-site
  // test covers each committed state).
  const committed = 'experiments/nina-changes/results/spotlight-decision.json';
  assert.equal(gateOpen().shown, existsSync(committed) && JSON.parse(readFileSync(committed, 'utf8')).held === false);
});

test('refute r5 B1: the bound reviewer record must be the complete counted EXP 006 reviewer run the results scored', () => {
  assert.equal(REVIEWER.calls.length, 180, 'the builder-made record is complete');
  assert.equal(gate(pass, open).shown, true);
  const hidden = (label, reviewer, why, results = pass) => { const g = gate(results, open, { reviewer }); assert.equal(g.shown, false, label); assert.match(g.reason, why, label); };
  // One per field.
  hidden('kind', { ...REVIEWER, kind: 'results' }, /not a gate-run/);
  hidden('experiment', { ...REVIEWER, experiment: 'EXP 005' }, /not EXP 006/);
  hidden('gate', { ...REVIEWER, gate: 'jev' }, /reviewer gate/);
  hidden('mode', { ...REVIEWER, mode: 'practice' }, /not a counted run/);
  hidden('partial', { ...REVIEWER, partial: { reason: 'hang-stop' } }, /partial/);
  hidden('endedAt unparseable', { ...REVIEWER, endedAt: 'not a date' }, /parseable measured date/);
  hidden('endedAt missing', { ...REVIEWER, endedAt: null }, /parseable measured date/);
  hidden('notBefore', { ...REVIEWER, notBefore: '2026-01-01T00:00:00Z' }, /another not-before/);
  const otherCode = structuredClone(REVIEWER.code); otherCode[Object.keys(otherCode)[0]] = 'c'.repeat(64);
  hidden('code', { ...REVIEWER, code: otherCode }, /other code/);
  hidden('a call missing', { ...REVIEWER, calls: REVIEWER.calls.slice(0, -1) }, /not the runs the results scored/);
  hidden('two calls swapped', { ...REVIEWER, calls: [REVIEWER.calls[1], REVIEWER.calls[0], ...REVIEWER.calls.slice(2)] }, /not the runs the results scored/);
  hidden('a call relabelled', { ...REVIEWER, calls: REVIEWER.calls.map((c, i) => (i === 7 ? { ...c, run: 9 } : c)) }, /not the runs the results scored/);
  hidden('the count is not the denominator', REVIEWER, /not the denominator 181/, { ...pass, manipulation: { ...pass.manipulation, denominator: 181 } });
  // Key order does not matter, a stage-error entry is not a counted call.
  const reordered = Object.fromEntries(Object.entries(REVIEWER.code).reverse());
  assert.equal(gate(pass, open, { reviewer: { ...REVIEWER, code: reordered } }).shown, true, 'the same code in another key order');
  // Refute r5's five attack records, reproduced.
  hidden('r5 #1: a prerun-matrix probe record', { ...REVIEWER, mode: 'prerun-matrix', items: [], calls: [{ id: 'isolation-matrix', run: 1, gate: 'reviewer' }] }, /not a counted run/);
  hidden('r5 #2: a partial counted run', { ...REVIEWER, partial: { reason: 'hang-stop', completed: 90 }, calls: REVIEWER.calls.slice(0, 90) }, /partial/);
  hidden('r5 #3: a bare object', { fixture: false, prereg6Sha256: FROZEN, endedAt: 'not a date' }, /not a gate-run/);
  const exp005 = { ...JSON.parse(readFileSync('experiments/jev-gate/results/reviewer.json', 'utf8')), prereg6Sha256: FROZEN };
  hidden('r5 #4: an EXP 005-shaped record (EXP 005\'s own reviewer run)', exp005, /not EXP 006/);
  hidden('r5 #5: another not-before and code', { ...REVIEWER, notBefore: '2026-09-28T18:36:49Z', code: otherCode }, /another not-before/);
  hidden('r5 #5b: the same not-before, other code', { ...REVIEWER, code: otherCode }, /other code/);
});

test('refute r6 N2: each call must match the scored run in decision, harness failure and diff-visibility class', () => {
  const at = (i, over) => ({ ...REVIEWER, calls: REVIEWER.calls.map((c, j) => (j === i ? { ...c, ...over } : c)) });
  const why = /not the runs the results scored/;
  const hidden = (label, reviewer) => { const g = gate(pass, open, { reviewer }); assert.equal(g.shown, false, label); assert.match(g.reason, why, label); };
  const c = REVIEWER.calls[3];
  hidden('a decision flipped', at(3, { decision: c.decision === 'REJECT' ? 'ACCEPT' : 'REJECT' }));
  hidden('a decision dropped', at(3, { decision: null }));
  hidden('a harness failure added', at(3, { harnessFailure: 'timeout' }));
  hidden('the diff-visibility rule changed', at(3, { diffSeen: { ...c.diffSeen, rule: c.diffSeen.rule === 'a' ? 'b' : 'a' } }));
  hidden('seen claimed false on a SEEN run', at(3, { diffSeen: { ...c.diffSeen, seen: false } }));
  // A diff-blind run's record and the results scored from it agree; claiming it seen does not.
  const blind1 = counted(passingResults({ blindRuns: 1 }));
  const rec1 = countedRecord(blindRun(1));
  assert.equal(rec1.calls[0].diffSeen.seen, false);
  assert.doesNotMatch(gate(blind1, open, { reviewer: rec1 }).reason ?? '', why, 'the matching record passes the call check');
  const lie = structuredClone(rec1); lie.calls[0].diffSeen = { ...lie.calls[0].diffSeen, seen: true };
  assert.match(gate(blind1, open, { reviewer: lie }).reason, why);
});

test('refute r6 N1: no page renders the text undefined, NaN or a bare null (the new note, home, the EXP 005 note, every built page)', { timeout: 600_000 }, () => {
  // Prose that names null on purpose, verbatim: each is a sentence about a value, not a value rendered as text.
  const PROSE_NULL = ['it is null only while no baseline is recorded', 'stay null, as init writes them', 'costPer1kUsd is null for Laya'];
  const text = html => stripTags(stripBlocks(html, ['script', 'style'], ''), '\n').replace(/&[a-z#0-9]+;/gi, ' ');
  const pages = ['site/journal/nina-reviews-the-change.html', 'site/index.html', 'site/journal/jev-as-a-fast-gate.html'].map(f => [f, readFileSync(f, 'utf8')]);
  const dist = join(builtCopy(), 'dist');
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.html') ? [join(d, e.name)] : []));
  for (const f of walk(dist)) pages.push([`dist${f.slice(dist.length)}`, readFileSync(f, 'utf8')]);
  assert.ok(pages.length >= 6);
  for (const [f, html] of pages) {
    let t = text(html).replace(/\s+/g, ' ');
    for (const p of PROSE_NULL) t = t.split(p).join(' ');
    t = t.replace(/\/dev\/null/g, ' ');
    const bad = [...t.matchAll(/\b(undefined|NaN|null)\b/g)].map(m => t.slice(Math.max(0, m.index - 40), m.index + 20));
    assert.deepEqual(bad, [], `${f} renders a missing value as text`);
  }
});

test('results refute B1: the entry carries each item-level label beside its rate, "passes, not established at this N" verbatim', () => {
  const NOT_ESTABLISHED = prereg6.bar.states.notEstablished;
  assert.equal(NOT_ESTABLISHED, 'passes, not established at this N');
  assert.match(prereg6.bar.labelPhrase, /carry that phrase verbatim/);
  const md = pass.spotlight.criteria.find(x => x.id === 'missed-drift'), fr = pass.spotlight.criteria.find(x => x.id === 'false-reject');
  assert.deepEqual([md.itemLevel.state, fr.itemLevel.state], [NOT_ESTABLISHED, prereg6.bar.states.passes], '0 of 30 items: not established at the 10% bar, passes at 25%');
  const entry = renderNinaEntry(data(pass, open), upstream);
  assert(entry.includes(`runs missed drift (${NOT_ESTABLISHED} on the items)`));
  assert(entry.includes(`runs falsely rejected (${prereg6.bar.states.passes} on the items)`));
  // When no criterion's label is "not established", the phrase is absent: the label comes from the record, not the markup.
  const established = structuredClone(pass); established.spotlight.criteria.find(x => x.id === 'missed-drift').itemLevel.state = prereg6.bar.states.passes;
  const plain = renderNinaEntry(data(established, open), upstream);
  assert(!plain.includes(NOT_ESTABLISHED), 'no not-established phrase when no label says so');
  assert(plain.includes(`runs missed drift (${prereg6.bar.states.passes} on the items)`));
});
