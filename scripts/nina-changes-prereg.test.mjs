import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRecords } from '../experiments/jev-gate/runner-guard.mjs';
import { commandTemplate } from '../experiments/nina-changes/run_reviewer6.mjs';
import { computeResults6 } from '../experiments/nina-changes/results6.mjs';
import { assertFenceUnaffected, buildRecord, checkRecord, FENCE_FILES, NOT_PINNED, PARENT, PINNED, PROOF_RUNS, pinPath, proofRunDiffs, recordPath, units, validateRecord } from './nina-changes-prereg.mjs';
import { addJournalRow, articlePath, assertNoteCurrent, exp005SpotlightHref, renderAmendedNote, renderJournalRow, renderNote, slug } from './nina-changes-note.mjs';
import { checkAmendment } from './nina-changes-amendment.mjs';
import { exp006NoteHref, renderHarnessSection, checkResults } from './jev-gate-results-site.mjs';
import { builtCopy } from './test-build.mjs';
import { qualifyRow } from './nina-changes-amendment-note.mjs';
import { checkResults6, qualifyHome6 } from './nina-changes-results-site.mjs';

// EXP 006 WO-1-04 and WO-1-05: the pre-registration record, its validator, and its public pages.

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { record, sha256: digest } = checkRecord();
const copy = () => structuredClone(record);

test('the record is pinned, and it is exactly the build of the committed files', () => {
  assert.equal(readFileSync(pinPath, 'utf8').split(/\s+/)[0], sha256(readFileSync(recordPath)));
  assert.equal(digest, sha256(readFileSync(recordPath)));
  assert.deepEqual(record, buildRecord());
  // Each pinned file hashes to its pin, or, for a file EXP 006 amendment 01 re-pins, to the amendment's new pin.
  const amendment = JSON.parse(readFileSync('experiments/nina-changes/amendment-01.json', 'utf8'));
  for (const [file, want] of Object.entries(record.files)) assert.equal(sha256(readFileSync(file)), amendment.pins[file] ? amendment.pins[file].to : want, file);
  for (const [file, p] of Object.entries(amendment.pins)) assert.equal(record.files[file], p.from, `${file}: the amendment re-pins it from this record's pin`);
  for (const f of NOT_PINNED) assert(!(f in record.files), `${f} is never pinned in the pre-registration`);
});

test('the command is the runner\'s own scrubbed render, in the field the runner reads', () => {
  const { prereg } = checkRecords({ mode: 'practice' });
  assert.equal(record.reviewer.command, commandTemplate(prereg, 'fence6'));
  assert.match(record.reviewer.command, /--output-format stream-json --verbose/);
  assert.match(record.reviewer.command, /Bash\(git -C <ws>\/repo --no-pager diff:\*\)/);
  const bad = copy(); bad.reviewer.command = bad.reviewer.command.replace('--verbose ', '');
  assert.throws(() => validateRecord(bad), /reviewer\.command/);
});

test('the parent, the reused inputs and the bar are EXP 005\'s, verbatim', () => {
  for (const [k, v] of Object.entries(PARENT)) assert.equal(record.parent[k].sha256, v.sha256);
  assert.equal(record.reused.corpusSha256, 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9');
  assert.equal(record.reused.baseCommit, '3e35e4e274932a61bc0d92f378f8d506a9bb4ce0');
  assert.deepEqual([record.reused.k, record.reused.timeoutSeconds, record.reused.clientVersion, record.reused.model, record.reused.effort], [3, 600, '2.1.280', 'claude-opus-5-5', 'high']);
  const a01 = JSON.parse(readFileSync(PARENT.amendment01.file, 'utf8'));
  assert.deepEqual(record.bar.criteria, a01.changes.spotlight.criteria);
  assert.equal(record.bar.judging, a01.changes.spotlight.judging);
  assert.deepEqual([record.bar.manipulation.maxBlindRuns, record.bar.manipulation.countedRuns], [18, 180]);
  const changed = copy(); changed.bar.criteria[0].threshold = 0.2;
  assert.throws(() => validateRecord(changed), /amendment 01/);
  assert.match(record.parent.finding, /131 of 180/);
  assert.equal(record.attribution.nina, 'nina (github.com/xhulz/nina) — used with the permission of its author, as confirmed by Odin Labs');
});

test('the scorer takes its bar from this record (bar.criteria, bar.harnessFailure, bar.manipulation)', () => {
  const { prereg, amendment } = checkRecords({ mode: 'practice' });
  // An empty fixture run is refused on shape, not on the bar: the bar the record carries is accepted as the scorer's.
  assert.throws(() => computeResults6({ exp005: { prereg, amendment }, bar6: record.bar, labels: { items: [] }, run: {}, fingerprints: {}, fingerprintsSha256: '', stamp: {} }), /schemaVersion|gate run/);
});

test('the spend is itemised to the 7th decimal and the pre-counted remainder is stated (D4)', () => {
  const s = record.spend;
  assert.equal(s.calls.length, 7);
  assert.equal(units(s.spentUsd), 40821826);
  assert.equal(units(s.preCountedRemainingUsd), 59178174);
  assert.equal(units(s.reserveUsd), 6545558);
  assert.equal(units(s.dryRunHeadroomUsd), 52632616, 'B2: $10 - $4.0821826 - $0.6545558 = $5.2632616');
  assert.match(s.bundle2, /prerun-matrix/); assert.match(s.bundle2, /fewer than its 18 practice runs/);
  assert.match(s.bundle2, /post-merge probe is dropped/i);
  for (const c of s.calls) assert.equal(sha256(readFileSync(c.record.file)), c.record.sha256);
  const bad = copy(); bad.spend.spentUsd = 4.1;
  assert.throws(() => validateRecord(bad));
});

test('the fence proof: fence6 x3 on one command, the D1 statement, the lost-verdict run disclosed', () => {
  const iso = record.isolationEvidence;
  assert.equal(iso.probeOfRecord.file, 'experiments/nina-changes/probes/matrix-v6-fence6-3.json');
  const N = 'experiments/nina-changes';
  const early = ['diff-seen.mjs', 'guard6.mjs', 'results6.mjs', 'run_reviewer6.mjs', 'scrub6.mjs', 'spend6.mjs', 'stream6.mjs'].map(f => `${N}/${f}`);
  const late = early.filter(f => !f.endsWith('scrub6.mjs'));
  assert.deepEqual(iso.proofRuns.map(r => [r.name, r.commit, r.differsFromPinned.map(d => d.file)]), [['matrix-v6-fence6-1', '14ba08d', early], ['matrix-v6-fence6-2', '14ba08d', early], ['matrix-v6-fence6-3', '2ab2c27', late], ['matrix-v6-sandbox6-only-2', '2ab2c27', late]]);
  assert.ok(iso.proofRuns.every(r => r.differsFromPinned.every(d => d.reason)), 'every difference has a reason');
  assert.match(iso.codeStatement, /14ba08d/); assert.match(iso.codeStatement, /2ab2c27/);
  assert.match(iso.refusedByAllowList, /R32-R35, R38, R43/);
  assert.match(iso.lostVerdict, /\$0\.5472840/);
  const fence6 = iso.runs.filter(r => r.variant === 'fence6' && !r.name.includes('discovery'));
  assert.deepEqual(fence6.map(r => [r.rowsHeld, r.controlsWorked]), [['48/48', '19/19'], ['48/48', '19/19'], ['48/48', '19/19']]);
  assert.equal(record.fence.answers.length, 7);
});

test('the limits state the two layers, the prompt confound, the is_error artifact and the machine', () => {
  const text = record.limits.join('\n');
  for (const phrase of ['best-effort', 'the OS sandbox', 'Reviewer only', 'the corpus is public', '14 items that add a file', '9 of them add only files', 'is_error', 'never read tool-level is_error', 'one machine']) assert(text.includes(phrase), phrase);
  // D3's claim is true of EXP 005's classifier: it never reads tool-level is_error.
  assert.doesNotMatch(readFileSync('experiments/jev-gate/diff-visibility.mjs', 'utf8'), /is_error|isError|tool_result/);
  assert.match(record.notBefore, /merge time of the odin-rnd pull request that adds this file/);
});

test('the field note is exactly the render of the record (amended by amendment 01), links to EXP 005\'s held spotlight, and states no result', () => {
  assert.doesNotThrow(() => assertNoteCurrent());
  const note = readFileSync(articlePath, 'utf8');
  assert.equal(note, renderAmendedNote(record, digest, checkAmendment()));
  assert(note.startsWith(renderNote(record, digest).split(' · NOT YET RUN</p>')[0].split('<meta name="description"')[0]), 'the pre-registration\'s render, amended in place');
  assert(note.includes(`href="${exp005SpotlightHref}"`));
  assert(note.includes(digest));
  assert.match(note, /PRE-REGISTERED 30 SEP 2026 · AMENDED 01 OCT 2026 · NOT YET RUN/);
  assert(readFileSync('site/sitemap.xml', 'utf8').includes(`journal/${slug}.html`));
  assert(!/(?<!\w)\/(?:Users|private\/tmp)\//.test(note), 'no local path on the page');
});

test('EXP 005\'s held-spotlight section links to EXP 006, and the home row is added above EXP 005\'s', () => {
  const data = checkResults();
  const section = renderHarnessSection(data);
  assert(section.includes(`<a href="${exp006NoteHref}">EXP 006, nina reviews the change</a>`));
  assert.equal(exp006NoteHref, `${slug}.html`);
  const home = readFileSync('site/index.html', 'utf8');
  const built = addJournalRow(home, record);
  const row = name => built.indexOf(`<a class="journal-row" href="journal/${name}.html`);
  assert(row(slug) > 0 && row(slug) < row('jev-as-a-fast-gate'), 'the EXP 006 row leads the field notes');
  assert(built.includes(qualifyRow(renderJournalRow(record), checkAmendment().record)));
  assert.throws(() => addJournalRow(built, record), /already there/);
});

test('the built site publishes the record byte for byte and carries the row and the links (fresh build copy)', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  assert.equal(sha256(readFileSync(join(dist, 'data/nina-changes/preregistration.json'))), digest);
  // The row as built: the pre-registration's row, qualified in place by EXP 006 amendment 01.
  const amendment = JSON.parse(readFileSync('experiments/nina-changes/amendment-01.json', 'utf8'));
  // Once EXP 006's results are committed, the results renderer also switches the row's lead and the EXP 005 #exp006
  // line to the measured status (linked to the results section).
  const measured = checkResults6(), row = qualifyRow(renderJournalRow(record), amendment);
  assert(readFileSync(join(dist, 'index.html'), 'utf8').includes(measured ? qualifyHome6(row, measured) : row));
  assert(existsSync(join(dist, `journal/${slug}.html`)));
  assert(readFileSync(join(dist, 'journal/jev-as-a-fast-gate.html'), 'utf8').includes(`href="${exp006NoteHref}${measured ? '#results' : ''}"`));
});

test('the EXP 006 note cannot scroll sideways at 375px or 320px (long tokens wrap)', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  const body = readFileSync(articlePath, 'utf8').split('<article class="article-body">')[1].split('</article>')[0].replace(/<pre[\s\S]*?<\/pre>/g, ' ');
  const runs = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  for (const width of [375, 320]) {
    const wide = runs.filter(t => t.length > Math.floor((width - 32) / 9));
    assert(wide.length === 0 || wraps, `At ${width}px, ${wide.length} unbroken runs are wider than the column and nothing lets them wrap`);
  }
});

test('B1: the per-run diff is derived against the pinned files; an extra difference is reported, a fence change refuses', () => {
  const runs = PROOF_RUNS.map(p => ({ name: p.name, code: JSON.parse(readFileSync(`experiments/nina-changes/probes/${p.name}.json`, 'utf8')).code }));
  const diffs = proofRunDiffs(runs, record.files);
  assert.deepEqual(diffs.map(d => d.differs), record.isolationEvidence.proofRuns.map(r => r.differsFromPinned.map(d => d.file)));
  // A synthetic extra difference in a pinned file is reported, and refused while it has no reason.
  const extra = structuredClone(runs); extra[3].code['experiments/nina-changes/base-lines.json'] = '0'.repeat(64);
  const extraDiffs = proofRunDiffs(extra, record.files);
  assert(extraDiffs[3].differs.includes('experiments/nina-changes/base-lines.json'));
  const commands = Object.fromEntries(PROOF_RUNS.map(p => [p.name, 'c'])), expected = { ...commands };
  assert.throws(() => assertFenceUnaffected({ diffs: extraDiffs, commands, expected }), /no stated reason/);
  // A difference in a fence / matrix / judge file refuses the fence-unaffected claim.
  for (const f of FENCE_FILES) {
    const fence = structuredClone(runs); fence[0].code[f] = '0'.repeat(64);
    assert.throws(() => assertFenceUnaffected({ diffs: proofRunDiffs(fence, record.files), commands, expected }), /fence-unaffected claim does not hold/);
  }
  // A proof run with another command refuses too.
  assert.throws(() => assertFenceUnaffected({ diffs, commands: { ...commands, 'matrix-v6-fence6-3': 'other' }, expected }), /another command/);
  assert.doesNotThrow(() => assertFenceUnaffected({ diffs, commands, expected }));
});

test('N5: the record pins exactly what makes, classifies or scores a run; never the validator or the site renderers', () => {
  assert.deepEqual(Object.keys(record.files), PINNED);
  for (const f of ['scripts/nina-changes-prereg.mjs', 'scripts/nina-changes-note.mjs', 'scripts/nina-changes-spotlight.mjs', 'experiments/nina-changes/freeze.mjs', 'experiments/nina-changes/runners.sha256']) assert(!(f in record.files), f);
  assert.match(record.siteChecks, /headless Chromium/); assert.match(record.siteChecks, /static repository test/);
});

test('N1-N3: precise wording; the false-BLIND forms and the hedged is_error limit are stated', () => {
  const text = JSON.stringify(record);
  for (const phrase of ['demonstrably', 'actually obtained', 'proven on canaries', 'It affected EXP 005']) assert(!text.includes(phrase), phrase);
  assert.match(record.question, /a tool output shows at least one changed line of that item/);
  const limits = record.limits.join('\n');
  for (const f of ['--color=always', '--word-diff', 'git diff -R', '--porcelain=v2', '-z', '../ paths', 'likely affected', 'cannot be checked']) assert(limits.includes(f), f);
});

test('refute r2 N4/N5/N7/N8/N10/N11: the headroom rule, malformed-stream charging, -O, the sandbox wording, sub-agents and coloured status are stated', () => {
  assert.match(record.spend.headroomRule, /only while no call exceeds the current reserve/);
  const limits = record.limits.join('\n');
  for (const phrase of ['malformed line is charged the upper bound', 'git diff -O<file>', 'reads outside the repository within home and the temp roots are denied', 'Nothing is canaried anywhere else', 'Only TOP-LEVEL calls count', 'coloured git status']) assert(limits.includes(phrase), phrase);
  assert.match(record.classifier.gitCall, /FIRST token is git/);
  assert.match(record.isolationEvidence.attemptedCheck, /no verdict changed/);
  assert(PINNED.includes('experiments/nina-changes/spotlight-gate.mjs') && PINNED.includes('experiments/nina-changes/matrix6-attempts.mjs'));
});

test('refute r3: the gate sentence is true as built (gateOpen owns the records), and the attempted-row normalisation is disclosed', () => {
  assert.match(record.spotlightArtefact.gate, /gateOpen\(root\), owns the paths of the results record, the spotlight decision and the reviewer run record/);
  assert.match(record.spotlightArtefact.renderer, /holds no record path and no gate logic and renders only what gateOpen returns/);
  assert.match(record.limits.join('\n'), /after the client's own normalisation only \(a 2>&1 or 2>\/dev\/null redirection stripped\)/);
  const gateSrc = readFileSync('experiments/nina-changes/spotlight-gate.mjs', 'utf8');
  for (const p of ['experiments/nina-changes/results/results.json', 'experiments/nina-changes/results/spotlight-decision.json', 'export function gateOpen']) assert(gateSrc.includes(p), p);
});

test('refute r4: the gate sentence (real counted measurement under the frozen sha), the committed-ledger and intent rules, N3 and N4 are stated', () => {
  for (const p of ['not a fixture, not a rehearsal, not partial', 'frozen in freeze.mjs (which must be set)', 'names the results record AND the reviewer run record by sha256', 'Measured date comes only from it']) assert(record.spotlightArtefact.gate.includes(p), p);
  assert.match(record.spend.rule, /Every paid run \(practice, probe, pre-run probe, counted\) appends to this one committed ledger/);
  assert.match(record.spend.rule, /intent line/);
  const limits = record.limits.join('\n');
  assert.match(limits, /Untested residual: git diff --no-index given an in-workspace symlink/);
  assert.match(limits, /a dated amendment with a new not-before/);
});

test('refute r5: the gate sentence names the reviewer-record cross-checks; the one-worktree, lock and reconciled-prerun limits are stated', () => {
  for (const p of ['a complete counted EXP 006 reviewer run (kind gate-run, experiment EXP 006, gate reviewer, mode counted, not partial', 'with the same not-before and code as the results', 'its calls exactly the runs the results scored', 'as many as the manipulation denominator', 'a parseable end time']) assert(record.spotlightArtefact.gate.includes(p), p);
  const limits = record.limits.join('\n');
  assert.match(limits, /bundles 2 and 3 run from ONE worktree \(named in experiments\/nina-changes\/README\.md\)/);
  assert.match(limits, /exclusive lock file \(experiments\/nina-changes\/run\.lock, created O_EXCL\)/);
  assert.match(limits, /A reconciled pre-run probe line without a pre-registration sha counts as made under the current one \(fail closed\)/);
});

test('refute r6: the env-prefixed git forms are named as untested; the gate matches each call\'s decision, harness failure and class', () => {
  const limits = record.limits.join('\n');
  assert.match(limits, /Untested in the matrix: git forms with an environment prefix \(GIT_DIR=…, GIT_EXTERNAL_DIFF=…, GIT_CONFIG_PARAMETERS=… before git\)/);
  assert.match(limits, /R9, R29, R30 and R45, and the sandbox-only run\)\. No live row was added/);
  assert(record.spotlightArtefact.gate.includes('(as id, run, decision, harness failure and diff-visibility class, in order)'));
  const note = readFileSync('site/journal/nina-reviews-the-change.html', 'utf8');
  assert(note.includes(`<p>${record.isolationEvidence.matrix.judgedBy.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`), 'the note prints how the matrix is judged');
});
