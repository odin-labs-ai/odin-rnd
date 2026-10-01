import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { corpusItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { checkRun6 } from '../experiments/nina-changes/guard6.mjs';
import { callDigests6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { computeResults6 } from '../experiments/nina-changes/results6.mjs';
import { gateFromBytes } from '../experiments/nina-changes/spotlight-gate.mjs';
import { conditions6, decide6 } from '../experiments/nina-changes/write-decision6.mjs';
import { check6, FILES, RESULTS_DIR, score6 } from '../experiments/nina-changes/write-results6.mjs';
import { check as checkRescrub, localNames, MANIFEST as RESCRUB_MANIFEST, scrubNames } from '../experiments/nina-changes/rescrub-records6.mjs';
import { hashInputs } from '../demos/lib.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';
import { buildReviewerRun } from './nina-changes-built-reviewer.mjs';
import { addJournalRow, articlePath } from './nina-changes-note.mjs';
import { checkRecord } from './nina-changes-prereg.mjs';
import { amendNote6, checkResults6, maskedDigests6, runLimits, measuredStatus6, publicReviewer6, publishResults6, qualifyExp005Note, qualifyHome6, renderResultsSection6, resultsData } from './nina-changes-results-site.mjs';
import { addNinaEntry, entryId, renderNinaEntry } from './nina-changes-spotlight.mjs';
import { builtCopy } from './test-build.mjs';
import { generatorInputs } from './witness-records.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';

// EXP 006 bundle 3 prep (WO-3-02/03, REVISION 5), built before the measured run and tested with no paid call: the
// results writer and --check, the automatic spotlight decision, the note's results section, the measured home row and
// the EXP 005 #exp006 line, and the build wiring. Every record here comes from the REAL builder and loop
// (runReviewer6, mode rehearsal: the committed stream-json fake stands in for the model) and the REAL scorer; a
// "counted" variant is made the way the spotlight tests make one (rehearsal flag cleared, a synthetic frozen
// pre-registration sha injected, never committed). freeze.mjs stays null; nothing is written outside scratch dirs.

const CLI = 'experiments/nina-changes/write-results6.mjs';
const DECIDE = 'experiments/nina-changes/write-decision6.mjs';
const labels = JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8'));
const truth = Object.fromEntries(labels.items.map(i => [i.id, i.label]));
const { record: prereg6 } = checkRecord();
const sha = b => createHash('sha256').update(b).digest('hex');
const FROZEN = sha('EXP 006 synthetic frozen pre-registration (results-site test only)');
const DAY = '2026-10-01';
const escapeHtml = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// One builder run, every item answered with its labelled verdict: 180 counted-shaped runs, all diff-seen.
const DIR = scratchDir('nc-results-site');
after(() => removeScratch(DIR));
const BUILT = await buildReviewerRun({ dir: DIR, items: corpusItems(), modes: corpusItems().flatMap(i => Array.from({ length: 3 }, () => `synthetic:${truth[i.id] === 'RED' ? 'REJECTED' : 'APPROVED'}`)) });
const { prereg, amendment, stamp: STAMP } = checkRun6({ mode: 'rehearsal', rehearsalPins: BUILT.pins });
const fpBytes = readFileSync('experiments/nina-changes/change-fingerprints.json');
const fingerprints = JSON.parse(fpBytes);

/** The builder's record, edited: `blind` first calls replayed with no tool output; `flip` RED calls answered APPROVED. */
function variant({ blind = 0, flip = 0 } = {}) {
  const run = structuredClone(BUILT.run);
  for (const c of run.calls.slice(0, blind)) {
    c.toolCalls = [];
    const d = classifyDiffSeen({ calls: [], fp: fingerprints.items[c.id], harnessFailure: c.harnessFailure });
    c.diffSeen = { seen: d.seen, rule: d.rule, evidence: d.evidence };
  }
  for (const c of run.calls.filter(c => truth[c.id] === 'RED').slice(0, flip)) { c.decision = 'ACCEPT'; c.verdictLine = 'VERDICT: APPROVED'; }
  return run;
}
const scoreRun = run => computeResults6({ exp005: { prereg, amendment }, bar6: prereg6.bar, labels, run, fingerprints, fingerprintsSha256: sha(fpBytes), stamp: STAMP, preflight: BUILT.preflight });
// The synthetic freeze names the pre-registration and EXP 006 amendment 01 (A5): the amendment sha is the one the
// builder's rehearsal pins carry, as the spotlight tests do.
const FREEZE = { PREREG6_SHA256: FROZEN, AMENDMENT6_SHA256: BUILT.pins.amendment6Sha256 };
const counted = r => { const { banner: _b, rehearsal: _r, ...rest } = structuredClone(r); return { ...rest, fixture: false, prereg6Sha256: FREEZE.PREREG6_SHA256, amendment6Sha256: FREEZE.AMENDMENT6_SHA256 }; };
const bytes = v => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
/** A counted-shaped {results, reviewer} pair from the real scorer, as bytes. */
function pair(opts) {
  const run = variant(opts);
  return { resultsBytes: bytes(counted(scoreRun(run))), reviewerBytes: bytes(counted(run)) };
}
/** The page data under the synthetic freeze, with a decision written by the pre-registered rule (or none). */
function page({ resultsBytes, reviewerBytes }, { refute = null, decision = true } = {}) {
  const decisionBytes = decision ? bytes(decide6({ resultsBytes, reviewerBytes, refuteShip: refute, decidedOn: DAY })) : null;
  return resultsData({ resultsBytes, reviewerBytes, decisionBytes, freeze: FREEZE });
}
const PASS = pair();
const FAIL_BAR = pair({ flip: 10 });           // 10 of 90 RED runs approved: missed drift 11.1% > 10%
const FAIL_MANIP = pair({ blind: 19 });        // 19 of 180 diff-blind: more than the 18 allowed
const note = () => readFileSync(articlePath, 'utf8');
const home = () => readFileSync('site/index.html', 'utf8');
const text = html => stripTags(stripBlocks(html, ['script', 'style'], ''), '\n').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
/** No missing value rendered as text: undefined, NaN, or a bare null (the prose /dev/null aside). */
const noMissing = (html, label) => {
  const t = text(html).replace(/\/dev\/null/g, ' ');
  const bad = [...t.matchAll(/\b(undefined|NaN|null)\b/g)].map(m => t.slice(Math.max(0, m.index - 40), m.index + 20));
  assert.deepEqual(bad, [], `${label} renders a missing value as text`);
};
/** The committed results.json bytes (null while none is committed), to prove a refused call wrote nothing there. */
const committedResults = () => (existsSync(join(RESULTS_DIR, FILES.results)) ? readFileSync(join(RESULTS_DIR, FILES.results), 'utf8') : null);
const COMMITTED_RESULTS = committedResults();
const node = (args, cwd = process.cwd()) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

test('write-results6 --rehearsal: the real builder\'s record → results.json + pre-flight copy, marked and unpublishable; --check; the note renders', { timeout: 600_000 }, () => {
  const dir = scratchDir('nc-w6');
  try {
    for (const f of [FILES.reviewer, FILES.preflight]) cpSync(join(DIR, f), join(dir, f));
    // Refusals first: a rehearsal needs --rehearsal, and never goes into the committed directory.
    assert.match(node([CLI, '--dir', dir]).stderr, /is a rehearsal: pass --rehearsal/);
    const committed = node([CLI, '--rehearsal']);
    assert.equal(committed.status, 1);
    assert.match(committed.stderr, /never written into experiments\/nina-changes\/results/);
    assert.equal(committedResults(), COMMITTED_RESULTS, 'nothing was written into the committed results directory');
    const w = node([CLI, '--dir', dir, '--rehearsal']);
    assert.equal(w.status, 0, w.stderr);
    assert.match(w.stdout, /REHEARSAL, unpublishable; bar PASS, manipulation PASS/);
    const written = readFileSync(join(dir, FILES.results));
    const r = JSON.parse(written);
    assert.deepEqual([r.rehearsal, r.fixture, r.partial, r.spotlight.verdict, r.manipulation.state, r.perRun.length], [true, false, null, 'PASS', 'PASS', 180]);
    assert(written.toString().endsWith('}\n') && !written.toString().endsWith('\n\n'), 'one trailing newline');
    assert.equal(written.toString(), `${JSON.stringify(r, null, 2)}\n`, 'two-space JSON in the scorer\'s key order');
    // --check recomputes byte for byte; a one-byte edit fails it; writing again with other bytes refuses.
    const c = node([CLI, '--check', '--dir', dir]);
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, new RegExp(`sha256 ${sha(written)}`));
    writeFileSync(join(dir, FILES.results), written.toString().replace('"blind": 0', '"blind": 1'));
    assert.match(node([CLI, '--check', '--dir', dir]).stderr, /differs from what the frozen results6\.mjs computes/);
    assert.match(node([CLI, '--dir', dir, '--rehearsal']).stderr, /exists with other bytes/);
    writeFileSync(join(dir, FILES.results), written);
    // The rehearsal decision: even with a refute named, the pinned gate stays closed on a rehearsal.
    const d = node([DECIDE, '--dir', dir, '--rehearsal', '--refute-ship', 'refute-r1-ship', '--decided-on', DAY]);
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /the pinned gate: closed — the results record is a rehearsal/);
    const data = resultsData({ resultsBytes: written, reviewerBytes: readFileSync(join(dir, FILES.reviewer)), decisionBytes: readFileSync(join(dir, FILES.decision)) });
    const out = amendNote6(note(), data);
    for (const part of ['<section id="results"', 'Rehearsal · ', 'A rehearsal, not a measurement.', 'Rehearsal, not a measurement — bar met, spotlight held', ' · REHEARSAL, NOT A MEASUREMENT ', 'No spotlight: the spotlight gate is closed: the results record is a rehearsal.', '180 SEEN-DECIDED']) assert(out.includes(part), part);
    noMissing(out, 'the rehearsal note');
  } finally { removeScratch(dir); }
});

test('write-results6 refuses a FIXTURE record, a partial counted run without --partial, and counts nothing before the freeze', () => {
  const dir = scratchDir('nc-w6-refuse');
  try {
    cpSync(join(DIR, FILES.preflight), join(dir, FILES.preflight));
    const put = run => writeFileSync(join(dir, FILES.reviewer), bytes(run));
    put({ ...BUILT.run, fixture: true, banner: 'FIXTURE' });
    assert.throws(() => score6({ dir }), /is a FIXTURE/);
    assert.throws(() => score6({ dir, rehearsal: true }), /is a FIXTURE/, '--rehearsal does not admit a fixture');
    const partial = counted(BUILT.run); partial.partial = { reason: 'spend-cap', completed: 90 }; partial.calls = partial.calls.slice(0, 90);
    put(partial);
    assert.throws(() => score6({ dir }), /the run is partial \(spend-cap\); a partial run decides nothing and is written only with --partial/);
    // A complete counted-shaped record: the guard refuses counted scoring while freeze.mjs is null.
    put(counted(BUILT.run));
    // Before the freeze the guard refuses; after it, the scorer refuses a record not made under the frozen records.
    const notCounted = /counted runs wait for the freeze|the run was made under another EXP 006 pre-registration/;
    assert.throws(() => score6({ dir }), notCounted);
    assert.throws(() => score6({ dir, allowPartial: true }), notCounted);
  } finally { removeScratch(dir); }
});

test('the spotlight decision is the pre-registered rule: held:false only for bar PASS + manipulation PASS + a named refute SHIP', () => {
  const d = (p, refute) => decide6({ ...p, refuteShip: refute, decidedOn: DAY });
  const open = d(PASS, 'a1b2c3d4e5f6');
  assert.deepEqual(Object.keys(open), ['schemaVersion', 'kind', 'resultsSha256', 'reviewerSha256', 'held', 'reason', 'decidedOn', 'refute']);
  assert.deepEqual([open.kind, open.held, open.decidedOn, open.refute, open.resultsSha256, open.reviewerSha256], ['spotlight-decision', false, DAY, { verdict: 'SHIP', ref: 'a1b2c3d4e5f6' }, sha(PASS.resultsBytes), sha(PASS.reviewerBytes)]);
  assert.match(open.reason, /^Not held, by the pre-registered rule: the bar PASSES, the manipulation check PASSES \(0 of 180 runs diff-blind, at most 18 allowed\), and the independent results refute SHIPped \(a1b2c3d4e5f6\)\.$/);
  // The pinned gate accepts exactly these fields (synthetic freeze): open.
  assert.equal(gateFromBytes({ ...PASS, decisionBytes: bytes(open), freeze: FREEZE }).shown, true);
  const held = (p, refute, why) => { const x = d(p, refute); assert.equal(x.held, true); assert.match(x.reason, why); return x; };
  held(PASS, null, /^Held by the pre-registered rule: no independent results refute SHIP is named yet\.$/);
  held(FAIL_BAR, 'refute-ship-1', /the bar was not met \(missed-drift does not hold\)/);
  const manip = held(FAIL_MANIP, 'refute-ship-1', /the manipulation check failed: 19 of 180 runs were diff-blind, more than the 18 of 180 allowed/);
  assert.doesNotMatch(manip.reason, /refute/, 'a named refute is not listed as failed');
  const partial = JSON.parse(PASS.resultsBytes); partial.partial = [{ reason: 'spend-cap' }]; partial.manipulation.state = null; partial.spotlightEligible = false;
  held({ resultsBytes: bytes(partial), reviewerBytes: PASS.reviewerBytes }, 'refute-ship-1', /the run is partial, and a partial run decides nothing/);
  assert.throws(() => d(PASS, 'a refute that is prose'), /is not a refute report sha or id/);
  assert.throws(() => decide6({ ...PASS, decidedOn: 'yesterday' }), /not a YYYY-MM-DD date/);
  assert.deepEqual(conditions6(JSON.parse(PASS.resultsBytes), 'x-ship').map(c => c.met), [true, true, true, true, true]);
});

test('PASS with held:false renders nina\'s entry and "Measured", the measured home row and the EXP 005 #exp006 line (fresh build copy)', { timeout: 600_000 }, () => {
  const data = page(PASS, { refute: 'refute-r1-ship' });
  assert.equal(data.gate.shown, true);
  assert.equal(measuredStatus6(data), 'Measured — bar met, nina in the spotlight');
  assert.equal(data.results.amendment6Sha256, FREEZE.AMENDMENT6_SHA256, 'the results carry the amendment sha (A5)');
  const out = amendNote6(note(), data);
  const measured = new Date(JSON.parse(PASS.reviewerBytes).endedAt);
  const dd = `${String(measured.getUTCDate()).padStart(2, '0')} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][measured.getUTCMonth()]} ${measured.getUTCFullYear()}`;
  for (const part of [` · MEASURED ${dd}</p>`, `<section id="results" class="article-amendment">\n<h2>Results · ${dd}</h2>`, '<strong>Measured — bar met, nina in the spotlight.</strong>', `<a href="../#${entryId}">nina's entry in the tools list</a>`,
    '0 of 180 counted runs were diff-blind, 0 of them harness failures, against the pre-registered maximum of 18 of 180', '<th>All runs (primary)</th><th>Diff-seen runs only</th>', 'node experiments/nina-changes/write-results6.mjs --check', 'href="../data/nina-changes/results.json"', 'href="../data/nina-changes/spotlight-decision.json"', `<a href="#amendment-01">amendment 01</a> (sha256 <code>${FREEZE.AMENDMENT6_SHA256}</code>`, `sha256 <code>${sha(PASS.resultsBytes)}</code>`]) assert(out.includes(part), part);
  assert.match(out, /<td>0 of 90 \(0\.0%\); on the 30 items, 0 of 30 \(0\.0%\), 95% interval 0\.0%–11\.[34]%: passes, not established at this N<\/td>/);
  assert.equal(out.split('<tr><td>c0').length - 1, 180, 'one table row per run');
  noMissing(out, 'the PASS note');
  // nina's entry (the renderer is the unpinned markup; the gate is the pinned one), and the entry's #results anchor exists.
  const entry = renderNinaEntry(data.gate);
  assert(entry.includes(`id="${entryId}"`) && entry.includes('journal/nina-reviews-the-change.html#results'));
  // The pages as they stand before any EXP 006 results: the source home with the (amended) EXP 006 row, and the built
  // EXP 005 note with its #exp006 line as pre-registered (restored if the committed results already qualified it).
  const dist = join(builtCopy(), 'dist');
  const withEntry = qualifyHome6(addNinaEntry(addJournalRow(home(), prereg6), data.gate), data);
  assert(withEntry.includes(`id="${entryId}"`));
  assert(withEntry.includes(`Pre-registered; measured ${dd}: bar met, nina in the spotlight. <span class="amendment-qualifier">`), 'the measured lead, then amendment 01\'s qualifier');
  assert(!withEntry.includes('Pre-registered, not yet run.'), 'the EXP 006 row no longer says it has not run');
  noMissing(withEntry, 'the home page with nina\'s entry');
  const exp005Before = readFileSync(join(dist, 'journal/jev-as-a-fast-gate.html'), 'utf8').replace(/<p id="exp006">.*?<\/p>/, '<p id="exp006">That experiment is pre-registered: <a href="nina-reviews-the-change.html">EXP 006, nina reviews the change</a>.</p>');
  const exp005 = qualifyExp005Note(exp005Before, data);
  assert(exp005.includes(`<p id="exp006">That experiment has been measured, ${dd}: <a href="nina-reviews-the-change.html#results">EXP 006, nina reviews the change</a>, bar met, nina in the spotlight.</p>`));
  assert(!exp005.includes('That experiment is pre-registered'));
});

test('FAIL-bar, FAIL-manipulation (19 of 180 blind) and held each render NO entry and name the condition that failed', () => {
  const cases = [
    ['FAIL-bar', page(FAIL_BAR, { refute: 'refute-r1-ship' }), 'Measured — bar not met', /No spotlight\. Held by the pre-registered rule: the bar was not met \(missed-drift does not hold\)\./],
    ['FAIL-manipulation', page(FAIL_MANIP, { refute: 'refute-r1-ship' }), 'Measured — bar not met, manipulation check failed', /the manipulation check failed: 19 of 180 runs were diff-blind, more than the 18 of 180 allowed\./],
    ['held (no refute SHIP yet)', page(PASS), 'Measured — bar met, spotlight held', /No spotlight\. Held by the pre-registered rule: no independent results refute SHIP is named yet\./],
    ['no decision committed', page(PASS, { decision: false }), 'Measured — bar met, spotlight held', /No spotlight: no spotlight decision is committed yet\./],
  ];
  for (const [label, data, status, why] of cases) {
    assert.equal(data.gate.shown, false, label);
    assert.equal(renderNinaEntry(data.gate), '', label);
    assert.equal(addNinaEntry(home(), data.gate), home(), `${label}: the home page gains no entry`);
    const out = amendNote6(note(), data);
    assert(out.includes(`<strong>${status}.</strong>`), `${label}: ${status}`);
    assert.match(text(out), why, label);
    assert(!out.includes(`href="../#${entryId}"`), `${label}: no link to an entry that is not there`);
    noMissing(out, label);
    const row = qualifyHome6(addJournalRow(home(), prereg6), data);
    assert(row.includes(`: ${status.replace('Measured — ', '')}. <span class="amendment-qualifier">`), `${label}: the home row`);
    noMissing(row, `${label}: the home page`);
  }
  // FAIL-manipulation reports the blind count against the pre-registered maximum, from the record.
  assert(amendNote6(note(), page(FAIL_MANIP)).includes('<strong>FAIL</strong>: 19 of 180 counted runs were diff-blind, 0 of them harness failures, against the pre-registered maximum of 18 of 180.'));
  // A PASS decision whose gate is closed for another reason (here: not frozen) says so, plainly.
  const unfrozen = resultsData({ ...PASS, decisionBytes: bytes(decide6({ ...PASS, refuteShip: 'refute-r1-ship', decidedOn: DAY })), freeze: { PREREG6_SHA256: null, AMENDMENT6_SHA256: null } });
  assert.match(text(amendNote6(note(), unfrozen)), /No spotlight: the spotlight gate is closed: the pre-registration is not frozen/);
  // EXP 006 amendment 01 (A5): the gate binds the amendment too, and the page says which binding closed it.
  const decided = bytes(decide6({ ...PASS, refuteShip: 'refute-r1-ship', decidedOn: DAY }));
  const otherAmendment = resultsData({ ...PASS, decisionBytes: decided, freeze: { ...FREEZE, AMENDMENT6_SHA256: 'c'.repeat(64) } });
  assert.match(text(amendNote6(note(), otherAmendment)), /No spotlight: the spotlight gate is closed: the results were made under another EXP 006 amendment 01 than the frozen one\./);
  const amendmentNotFrozen = resultsData({ ...PASS, decisionBytes: decided, freeze: { ...FREEZE, AMENDMENT6_SHA256: null } });
  assert.match(text(amendNote6(note(), amendmentNotFrozen)), /EXP 006 amendment 01 is not frozen/);
});

test('a partial run renders "decides nothing" and no entry; the note\'s tables fit 375 and 320 px', () => {
  const r = JSON.parse(PASS.resultsBytes);
  const partial = { ...r, partial: [{ reason: 'spend-cap', detail: 'stopped before run 91' }], manipulation: { ...r.manipulation, state: null }, spotlight: { ...r.spotlight, verdict: 'FAIL', reasons: ['a partial run gives no spotlight'] }, spotlightEligible: false };
  const data = resultsData({ resultsBytes: bytes(partial), reviewerBytes: PASS.reviewerBytes, freeze: FREEZE });
  assert.equal(measuredStatus6(data), 'Measured — partial run, decides nothing');
  const out = amendNote6(note(), data);
  assert(out.includes('This run was partial: spend-cap (stopped before run 91).') && out.includes('<strong>Not decided (partial run)</strong>'));
  assert.equal(data.gate.shown, false);
  noMissing(out, 'the partial note');
  // The static width check the pre-registration's note carries, on the note with its results section.
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  for (const html of [amendNote6(note(), page(PASS, { refute: 'refute-r1-ship' })), amendNote6(note(), page(FAIL_MANIP)), out]) {
    const body = html.split('<article class="article-body">')[1].split('</article>')[0];
    for (const t of body.match(/<table>[\s\S]*?<\/table>/g) ?? []) assert((t.match(/<tr>[\s\S]*?<\/tr>/)[0].match(/<t[hd]>/g) ?? []).length <= 4, 'a results table has at most four columns');
    const runs = stripTags(stripBlocks(body, ['pre'], ' '), ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
    for (const width of [375, 320]) {
      const wide = runs.filter(t => t.length > Math.floor((width - 32) / 9));
      assert(wide.length === 0 || wraps, `At ${width}px, ${wide.length} unbroken runs are wider than the column and nothing lets them wrap`);
    }
  }
});

test('the build refuses a rehearsal (or any non-recomputing) results record in the committed directory; publishing copies byte for byte', () => {
  const root = scratchDir('nc-committed');
  try {
    mkdirSync(join(root, RESULTS_DIR), { recursive: true });
    const rehearsal = JSON.parse(PASS.resultsBytes); rehearsal.rehearsal = true;
    writeFileSync(join(root, RESULTS_DIR, FILES.results), bytes(rehearsal));
    assert.throws(() => checkResults6(root), /a rehearsal is never written into experiments\/nina-changes\/results/);
    assert.throws(() => check6({ root }), /a rehearsal is never written into/);
    writeFileSync(join(root, RESULTS_DIR, FILES.results), PASS.resultsBytes);
    assert.throws(() => checkResults6(root), /no reviewer run record/);
    // publishResults6 publishes what exists (results byte for byte, the reviewer record as publicReviewer6's copy) and
    // names each written file's sha256 for the build's dist check.
    writeFileSync(join(root, RESULTS_DIR, FILES.reviewer), PASS.reviewerBytes);
    const out = publishResults6(root);
    assert.deepEqual(out, [{ file: FILES.results, sha256: sha(PASS.resultsBytes) }, { file: FILES.reviewer, sha256: sha(publicReviewer6(PASS.reviewerBytes)) }]);
    for (const { file, sha256: want } of out) assert.equal(sha(readFileSync(join(root, 'site/data/nina-changes', file))), want);
  } finally { removeScratch(root); }
  // The committed tree: with no EXP 006 results nothing is checked, published or rendered; with them, they recompute.
  if (!existsSync(join(RESULTS_DIR, FILES.results))) assert.equal(checkResults6(), null);
  else assert.equal(checkResults6().results.experiment, 'EXP 006');
  assert(!renderResultsSection6.toString().includes('0.1') && !renderResultsSection6.toString().includes('180'), 'no threshold or denominator typed in the renderer');
});

test('with no EXP 006 results the build is byte-identical to the one before this wiring (cfcb90ab\'s build.mjs, unchanged through 11a90e09; fixture), except the build stamp', { timeout: 900_000, skip: existsSync(join(RESULTS_DIR, FILES.results)) && 'EXP 006 results are committed: the pre-results identity no longer applies' }, async () => {
  const OLD = 'scripts/fixtures/cfcb90ab/build.mjs.txt';
  // The fixture is cfcb90ab's scripts/build.mjs, byte for byte (the sha the cfcb90ab witnesses recorded for it).
  assert.equal(sha(readFileSync(OLD)), 'e6f97fecc93134f1359079e72e46b7e56942a1805f381e27db368dd0d027f70a');
  assert.notEqual(sha(readFileSync('scripts/build.mjs')), sha(readFileSync(OLD)), 'build.mjs was changed, so the comparison means something');
  const now = join(builtCopy(), 'dist');
  const root = scratchDir('nc-cfcb90ab');
  try {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const rel of files) { if (!existsSync(rel)) continue; mkdirSync(dirname(join(root, rel)), { recursive: true }); cpSync(rel, join(root, rel), { verbatimSymlinks: true }); }
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'));
    writeFileSync(join(root, 'scripts/build.mjs'), readFileSync(OLD));
    // The witness receipts name the generator inputs by sha256; the same receipts, re-stamped for the old build.mjs.
    const manifestPath = join(root, 'site/data/witnesses/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    {
      manifest.generatorInputSha256 = await hashInputs({ root, relativePaths: generatorInputs });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const git = (...args) => execFileSync('git', ['-c', 'user.name=build-copy', '-c', 'user.email=build-copy@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
      git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'cfcb90ab build copy');
      const r = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const old = join(root, 'dist');
      const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
      const rel = (base, list) => list.map(f => f.slice(base.length + 1)).sort();
      const STAMP = ['data/site.json', 'data/witnesses/manifest.json']; // build time/revision; the re-stamped receipt
      const a = rel(now, walk(now)).filter(f => !STAMP.includes(f)), b = rel(old, walk(old)).filter(f => !STAMP.includes(f));
      assert.deepEqual(a, b, 'the same files');
      const differ = a.filter(f => !readFileSync(join(now, f)).equals(readFileSync(join(old, f))));
      assert.deepEqual(differ, [], 'byte-identical');
      assert.ok(a.length > 50);
    }
  } finally { removeScratch(root); }
});

test('the published reviewer record masks exactly the per-call digests its own text reproduces; everything else is the record', () => {
  const src = PASS.reviewerBytes, run = JSON.parse(src);
  const pub = JSON.parse(publicReviewer6(src));
  const expected = run.calls.reduce((n, c) => n + callDigests6(c.toolCalls, c.result, c.hook).filter(([p, h]) => p.reduce((o, k) => o?.[k], c) === h).length, 0);
  assert.ok(expected > 180, 'the builder\'s record carries per-call digests');
  assert.equal(maskedDigests6(src), expected);
  const unmask = v => JSON.stringify(v, (k, x) => (x === '<sha256>' ? undefined : x));
  const drop = v => JSON.stringify(v, (k, x) => (/^(outputSha256|resultSha256)$/.test(k) || (k === 'sha256' && typeof x === 'string') ? undefined : x));
  assert.equal(drop(pub), drop(run), 'only digest fields differ');
  assert.equal(unmask({ ...pub, calls: 0 }), unmask({ ...run, calls: 0 }), 'the header is the record\'s');
  // A digest the text does not reproduce is not a runner digest here: it stays as recorded (and check.mjs scans it).
  const tampered = structuredClone(run); tampered.calls[0].resultSha256 = 'a'.repeat(64);
  assert.equal(JSON.parse(publicReviewer6(Buffer.from(JSON.stringify(tampered)))).calls[0].resultSha256, 'a'.repeat(64));
  assert.equal(JSON.parse(publicReviewer6(src)).calls[0].resultSha256, '<sha256>');
  // Bounded confirm N-a: a digest the side record names as superseded by the re-scrub is masked too, and only it.
  const t2 = structuredClone(run); t2.calls[2].toolCalls[0].outputSha256 = 'b'.repeat(64);
  const t2b = Buffer.from(JSON.stringify(t2));
  const p2 = JSON.parse(publicReviewer6(t2b, ['calls.2.toolCalls.0.outputSha256']));
  assert.equal(p2.calls[2].toolCalls[0].outputSha256, '<sha256>');
  assert.equal(maskedDigests6(t2b, ['calls.2.toolCalls.0.outputSha256']), maskedDigests6(t2b) + 1);
  assert.equal(JSON.parse(publicReviewer6(t2b)).calls[2].toolCalls[0].outputSha256, 'b'.repeat(64), 'without the side record it stays');
});

test('results refute N2, N3: the practice pre-flight override and the pre-scrub result digests are stated, from the records', () => {
  // From the page data built over the builder's record: the committed dry-run records' overrides, and a digest count.
  const data = page(PASS);
  const dry = readdirSync('experiments/nina-changes/dry-run').filter(f => f.endsWith('.json')).sort()
    .filter(f => JSON.parse(readFileSync(join('experiments/nina-changes/dry-run', f), 'utf8')).pins?.preflight?.override);
  assert.deepEqual(data.practiceOverrides.map(x => x.file), dry);
  const lines = runLimits(data);
  if (dry.length) assert.match(lines[0], new RegExp(`recorded in pins\\.preflight\\.override of ${dry.join(', ').replaceAll('.', '\\.')}`));
  assert.match(lines.at(-1), /^resultSha256 is the sha256 of the result text as the client returned it, before the write-time scrub; .* For 0 of the 180 calls the scrub changed/);
  // A call whose published result text does not reproduce its digest is named.
  const run = JSON.parse(PASS.reviewerBytes); run.calls[5].result = `${run.calls[5].result} (scrubbed)`;
  const edited = resultsData({ resultsBytes: PASS.resultsBytes, reviewerBytes: bytes(run), freeze: FREEZE });
  assert.match(runLimits(edited).at(-1), new RegExp(`For 1 of the 180 calls \\(${run.calls[5].id} run ${run.calls[5].run}\\) the scrub changed the result text`));
  // The counted pre-flight's override, when its record is committed, is stated from it.
  const counted = runLimits({ ...data, countedOverride: { override: null } });
  assert(counted.some(l => l.includes("The counted run's pre-flight record records no override: it scanned the default roots.")));
  assert(amendNote6(note(), data).includes(escapeHtml(lines.at(-1))));
});

test('results refute N1: no committed or published EXP 006 file holds the local account name (read at run time, never written)', { timeout: 600_000 }, t => {
  const names = localNames();
  if (!names.length) { t.skip('a generic CI account (no private account name on this host to look for)'); return; }
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter(f => /^(experiments\/nina-changes\/|site\/data\/nina-changes\/)/.test(f) || f === 'site/journal/nina-reviews-the-change.html');
  const dist = join(builtCopy(), 'dist');
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const built = [...walk(join(dist, 'data/nina-changes')), join(dist, 'journal/nina-reviews-the-change.html'), join(dist, 'index.html'), join(dist, 'journal/jev-as-a-fast-gate.html')];
  const files = [...tracked.filter(f => existsSync(f)), ...built];
  assert.ok(files.length > 20, 'the scan covers the EXP 006 files');
  // Count only: the message names the file and the count, never the name.
  const holding = files.map(f => [f, names.reduce((n, name) => n + readFileSync(f, 'latin1').split(name).length - 1, 0)]).filter(([, n]) => n > 0).map(([f, n]) => `${f.startsWith(dist) ? `dist${f.slice(dist.length)}` : f} (${n})`);
  assert.deepEqual(holding, [], 'files that hold the local account name');
  // The committed record is its recorded scrubbed bytes; the rule finds nothing left to replace.
  if (existsSync(RESCRUB_MANIFEST)) assert.doesNotThrow(() => checkRescrub());
  // The rule itself, on a synthetic record: a whole word in any string, never inside a longer word.
  const r = scrubNames({ a: 'drwxr-xr-x  6 someone  staff  192 .', b: ['someone', 'someone_else', 'xsomeone', 'owned by someone.', 'someone.txt'] }, ['someone']);
  assert.deepEqual([r.record.a, r.record.b, r.replacements, r.fields.map(f => f.path)], ['drwxr-xr-x  6 <user>  staff  192 .', ['<user>', 'someone_else', 'xsomeone', 'owned by <user>.', 'someone.txt'], 3, ['a', 'b.0', 'b.3']]);
});
