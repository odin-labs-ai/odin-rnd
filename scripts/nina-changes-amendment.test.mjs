import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { practiceItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { loadBaseLines } from '../experiments/nina-changes/base-lines.mjs';
import { classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { fingerprintItem, loadFingerprints } from '../experiments/nina-changes/fingerprints.mjs';
import { baseOnlyCalls, seenCalls, workspaceView } from '../experiments/nina-changes/fixtures/synthetic6.mjs';
import { isRunnerDigest6, leakFields, lint6, lintRecord6, maskDigests6, publicRecord6 } from '../experiments/nina-changes/scrub6.mjs';
import { callDigests6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { AMENDMENT6_NOT_BEFORE, AMENDMENT6_SHA256 } from '../experiments/nina-changes/freeze.mjs';
import { isGitCommand, keepsOutput, recordToolCalls, subCommands } from '../experiments/nina-changes/stream6.mjs';
import { amendmentPath, amendmentPinPath, buildAmendment, checkAmendment, ENCODED_TERM_LIMIT, PARENT, PIN_REASONS, publishedPath, validateAmendment } from './nina-changes-amendment.mjs';
import { amendNote, qualifyRow, renderAmendmentSection, sectionId } from './nina-changes-amendment-note.mjs';
import { articlePath, assertNoteCurrent, renderAmendedNote, renderJournalRow, renderNote, slug } from './nina-changes-note.mjs';
import { checkRecord, recordPath as preregPath } from './nina-changes-prereg.mjs';
import { builtCopy } from './test-build.mjs';

// EXP 006 amendment 01 (WO-1-09): A1 the record lint and digests, A2 the git call, A3-A4 the record, A5 the guard
// (its tests sit with the guard's in nina-changes-units.test.mjs and nina-changes-spotlight.test.mjs), A6 the pages.

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { record: amendment, sha256: amendmentSha } = checkAmendment();
const bash = (command, output, over = {}) => ({ tool: 'Bash', input: { command }, isError: false, refused: false, parentToolUseId: null, output, ...over });

// A tool output whose sha256 contains a restricted-term window, found at run time (check.mjs keeps the terms only as
// fingerprints, so no such digest, and no term, is ever written into the repository).
const RESTRICTED = (() => {
  for (let i = 0; i < 2_000_000; i += 1) {
    const output = `EXP 006 amendment 01 digest probe ${i}\n`, d = sha256(output);
    if (!lint6(d).includes('a restricted term')) continue;
    for (const len of [4, 8, 9, 12, 13]) for (let at = 0; at + len <= 64; at += 1) {
      const w = d.slice(at, at + len);
      if (lint6(w).includes('a restricted term')) return { output, digest: d, window: w };
    }
  }
  throw new Error('no digest with a restricted window found');
})();

// ------------------------------------------------------------------ A1: the record lint (runner digests only)

test('A1: a genuine runner-computed outputSha256 that contains a restricted window passes (the F1 case)', () => {
  const { output, digest: d } = RESTRICTED;
  assert.ok(lint6(d).includes('a restricted term'), 'the digest carries a restricted window (the F1 condition)');
  // The real record path: the stream's tool calls, recorded by recordToolCalls, digests from callDigests6.
  const calls = [{ tool: 'Bash', input: { command: 'wc -l x' }, isError: false, refused: false, output: 'ok\n' }, { tool: 'Bash', input: { command: 'ls' }, isError: false, refused: false, output }];
  const rec = { id: 'p06', run: 2, toolCalls: recordToolCalls(calls), result: 'fine', resultSha256: sha256('fine') };
  assert.equal(rec.toolCalls[1].outputSha256, d);
  assert.equal('output' in rec.toolCalls[1], false, 'a non-git call keeps no output text: only the digest is in the record');
  const digests = callDigests6(calls, 'fine', null);
  assert.deepEqual(publicRecord6(rec, 't', digests), rec);
  assert.deepEqual(leakFields(rec, digests), []);
  // Without the runner's digests it is refused, exactly as the dry run's p06 run 2 was.
  assert.throws(() => publicRecord6(rec, 't'), /a restricted term/);
  assert.deepEqual(leakFields(rec), ['toolCalls.1.outputSha256']);
  // The header: a code sha the guard computed is exempt at its own path only.
  assert.deepEqual(publicRecord6({ code: { 'a.mjs': d } }, 't', [[['code', 'a.mjs'], d]]), { code: { 'a.mjs': d } });
  assert.throws(() => publicRecord6({ code: { 'b.mjs': d } }, 't', [[['code', 'a.mjs'], d]]), /a restricted term/, 'another path is not exempt');
});

test('A1: a 64-hex value carrying a restricted term that the runner did not compute is refused, under a hash key or anywhere else', () => {
  const { output, window: w } = RESTRICTED;
  // The restricted term hex-encoded into exactly 64 lowercase hex characters (model-produced, not the runner's sha).
  const forged = `${w}${'0'.repeat(64 - w.length)}`;
  assert.match(forged, /^[0-9a-f]{64}$/);
  const calls = [{ tool: 'Bash', input: { command: 'ls' }, isError: false, refused: false, output }];
  const digests = callDigests6(calls, 'fine', null);
  const forgedRec = { toolCalls: [{ ...recordToolCalls(calls)[0], outputSha256: forged }] };
  assert.notEqual(forged, sha256(output));
  assert.throws(() => publicRecord6(forgedRec, 't', digests), /a restricted term/, 'under outputSha256 but not equal to sha256(output)');
  assert.deepEqual(leakFields(forgedRec, digests), ['toolCalls.0.outputSha256']);
  for (const rec of [
    { result: `the reviewer quoted ${forged}`, resultSha256: sha256(`the reviewer quoted ${forged}`) },
    { result: forged },
    { toolCalls: [{ tool: 'Bash', input: { command: `git show ${forged}` } }] },
    { toolCalls: [{ tool: 'Read', output: forged }] },
    { hook: { text: 'x', sha256: forged } },
    { resultSha256: forged },
  ]) {
    assert.throws(() => publicRecord6(rec, 't', digests), /a restricted term/, JSON.stringify(rec).slice(0, 70));
    assert.ok(leakFields(rec, digests).length > 0, JSON.stringify(rec).slice(0, 70));
  }
  // A runner digest pair is honoured only for exactly 64 lowercase hex and only for an equal value.
  assert.equal(isRunnerDigest6(['resultSha256'], forged, [[['resultSha256'], forged.toUpperCase()]]), false);
  assert.equal(isRunnerDigest6(['resultSha256'], forged, [[['resultSha256'], sha256('fine')]]), false);
  assert.deepEqual(maskDigests6({ resultSha256: sha256('fine'), output: sha256('fine') }, [[['resultSha256'], sha256('fine')]]), { resultSha256: '<sha256>', output: sha256('fine') });
});

test('A1: every other refusal still holds (home path, session uid, credential shapes), runner digest or not', () => {
  const home = ['', 'Users', 'someone', 'x'].join('/'), uid = `claude-${'5'.repeat(3)}`;
  assert.ok(lintRecord6({ output: home }).some(f => /home path|private path/.test(f)), 'a home path (publicRecord6 scrubs it to ~ first)');
  assert.throws(() => publicRecord6({ output: `session ${uid}` }, 't'), /uid/);
  assert.throws(() => publicRecord6({ outputSha256: uid }, 't', [[['outputSha256'], uid]]), /uid/, 'not 64 hex: never exempt');
  assert.deepEqual(leakFields({ a: 'clean', b: { c: [home, 'ok'] }, outputSha256: uid }), ['b.c.0', 'outputSha256']);
});

test('A1: the committed dry-run records and the pre-registered probe records all pass the amended lint', () => {
  for (const f of ['experiments/nina-changes/dry-run/practice-a.json', 'experiments/nina-changes/dry-run/practice-b.json', ...readdirSync('experiments/nina-changes/probes').map(f => `experiments/nina-changes/probes/${f}`)]) {
    assert.deepEqual(lintRecord6(JSON.parse(readFileSync(f, 'utf8'))), [], f);
  }
});

// ------------------------------------------------------------------ A2: the git call

const baseSet = new Set(loadBaseLines().sha256s);
const jevPractice = practiceItems('experiments/jev-gate/practice/practice-rows.json');
const dryRunA = JSON.parse(readFileSync('experiments/nina-changes/dry-run/practice-a.json', 'utf8'));
const rules = readFileSync('experiments/jev-gate/rules.txt', 'utf8');

test('A2: the two dry-run commands that were counted BLIND, replayed with a real p01/p02 diff, are now kept and SEEN', () => {
  for (const [id, run] of [['p01', 2], ['p02', 1]]) {
    const call = dryRunA.calls.find(c => c.id === id && c.run === run);
    assert.equal(call.diffSeen.seen, false, `${id} run ${run} was BLIND in the dry run`);
    const t = call.toolCalls[0];
    assert.equal('output' in t, false, 'its output was not kept (the F2 defect)');
    const patch = jevPractice.find(i => i.id === id).patch, fp = fingerprintItem(patch, baseSet), v = workspaceView(patch);
    // The synthetic output of exactly that command: rules.txt, the echo (p02), the short status, the diff.
    const output = `${rules}${t.input.command.includes('echo ----') ? '----\n' : ''}${v.status}${v.diff}`;
    const replay = bash(t.input.command, output);
    assert.equal(isGitCommand(replay), true, t.input.command);
    const [kept] = recordToolCalls([replay]);
    assert.equal(kept.output, output, 'the whole scrubbed output is kept');
    const r = classifyDiffSeen({ calls: [kept], fp });
    assert.deepEqual([r.seen, r.rule], [true, 'a'], `${id}: ${t.input.command}`);
    // The same call refused, or made by a sub-agent, still counts for nothing.
    assert.equal(classifyDiffSeen({ calls: [{ ...kept, refused: true }], fp }).seen, false);
    assert.equal(classifyDiffSeen({ calls: [{ ...kept, parentToolUseId: 'toolu_task_1' }], fp }).seen, false);
  }
});

test('A2: what is and is not a git call (unquoted &&, ||, ; and | only; allowed fence6 forms only)', () => {
  const git = c => isGitCommand(bash(c, ''));
  for (const c of ['git diff', 'git status --short && git diff', 'cat rules.txt; git status --short; git diff', 'cat a || git --no-pager diff', 'echo x | git -C <ws>/repo status --short', 'cat a && git -C <ws>/repo --no-pager log -p', 'git -c color.status=always status']) assert.equal(git(c), true, c);
  for (const c of ['echo git; cat f', 'echo git diff', 'cat a && git branch', 'echo "a; git diff"', "echo 'a && git diff'", 'cat a\\; git diff', 'cat a\ngit diff', 'cat a & git diff', 'echo $(git diff)', 'digit diff', 'GIT_DIR=x git diff; cat a', 'cat b; git -C .. diff']) assert.equal(git(c), false, c);
  assert.deepEqual(subCommands('cat rules.txt; echo ----; git status --short; git diff 2>&1 | head'), ['cat rules.txt', 'echo ----', 'git status --short', 'git diff 2>&1', 'head']);
  assert.equal(keepsOutput(bash('cat x; git diff', '')), true);
  assert.equal(keepsOutput(bash('cat x; echo git', '')), false);
  assert.equal(isGitCommand({ tool: 'Read', input: { command: 'git diff' } }), false);
});

test('A2: a cat of a file cannot pass for a diff line; rule (b) may read an untracked entry from a compound output', () => {
  const id = 'p01', patch = jevPractice.find(i => i.id === id).patch, fp = fingerprintItem(patch, baseSet);
  // The changed file's content, every fingerprint line in it WITHOUT a sign, printed by a git call's cat part.
  const content = fp.plus.join('\n');
  assert.equal(classifyDiffSeen({ calls: [bash('cat src/domain/money.ts; git status --short', `${content}\n M src/domain/money.ts\n`)], fp }).seen, false, 'no sign, no rule (a)');
  assert.equal(classifyDiffSeen({ calls: [bash('cat src/domain/money.ts', fp.plus.map(l => `+${l}`).join('\n'))], fp }).seen, false, 'not a git call at all');
  // Rule (b) for a practice row that adds a file: the untracked entry from a compound call, then a Read of the file.
  const rows = JSON.parse(readFileSync('experiments/nina-changes/practice/practice-rows.json', 'utf8')).items;
  const p04 = rows.find(r => r.id === 'p04'), fp04 = fingerprintItem(p04.patch, baseSet);
  const [, , read] = seenCalls(p04.patch);
  const r = classifyDiffSeen({ calls: [bash('cat rules.txt; git status --short', `${rules}?? src/reports/\n`), read], fp: fp04 });
  assert.deepEqual([r.seen, r.rule], [true, 'b']);
});

test('A2: base-only 60/60 BLIND and synthetic-seen 60/60 SEEN still hold, with every git call wrapped in a compound', () => {
  const fp = loadFingerprints(), ids = Object.keys(fp.items).sort(), JEV = 'experiments/jev-gate';
  const files = {};
  const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else files[relative(`${JEV}/base`, p)] = readFileSync(p, 'utf8'); } };
  walk(`${JEV}/base`);
  files['rules.txt'] = rules;
  const wrap = calls => calls.map(c => (c.tool === 'Bash' ? { ...c, input: { command: `cat rules.txt; ${c.input.command}` }, output: `${rules}${c.output}` } : c));
  const base = wrap(baseOnlyCalls(files));
  assert.deepEqual(ids.filter(id => classifyDiffSeen({ calls: base, fp: fp.items[id] }).seen), [], 'base-only stays BLIND for all 60');
  const patch = id => readFileSync(`${JEV}/corpus/${id}.patch`, 'utf8');
  assert.deepEqual(ids.filter(id => !classifyDiffSeen({ calls: wrap(seenCalls(patch(id))), fp: fp.items[id] }).seen), [], 'synthetic-seen stays SEEN for all 60');
});

// ------------------------------------------------------------------ A3-A4, A7: the record

test('the amendment is pinned, exactly the build of the files, and names the published pre-registration, which is byte-identical', () => {
  assert.equal(readFileSync(amendmentPinPath, 'utf8').split(/\s+/)[0], sha256(readFileSync(amendmentPath)));
  assert.deepEqual(amendment, buildAmendment());
  assert.equal(sha256(readFileSync(preregPath)), PARENT.sha256);
  assert.equal(checkRecord().sha256, '41efb90da633b42acca619ab4d761e15e608ca06e496bafbc73ccfd9df03b98a', 'prereg --check still passes on the published record');
  assert.equal(amendment.parent.sha256, PARENT.sha256);
  assert.equal(amendment.parent.notBefore, '2026-09-30T19:26:46Z');
  assert.match(amendment.statusText, /^Amended 01 Oct 2026, before any counted run$/);
});

test('A4: the findings carry the dry-run evidence (record shas, ledger lines), and the re-pins are exactly the changed files', () => {
  const [f1, f2, f3] = amendment.reason.findings;
  assert.deepEqual([f1.evidence.id, f1.evidence.run, f1.evidence.leakFields, f1.evidence.ledgerLine], ['p06', 2, ['toolCalls.4.outputSha256'], 24]);
  assert.deepEqual(f2.evidence.blindRuns.map(b => [b.id, b.run, b.outputBytes, b.outputKept, b.ledgerLine]), [['p01', 2, 687, false, 9], ['p02', 1, 648, false, 11]]);
  assert.match(f2.what, /2 of 17 completed calls \(11\.8%\)/);
  assert.deepEqual([f3.evidence.dryRunCatCallsRefused, f3.evidence.outsideCatRows[0], f3.evidence.sandboxStopped], [0, 'R17', ['R9', 'R45', 'R29', 'R30']]);
  for (const r of amendment.reason.dryRun.records) assert.equal(sha256(readFileSync(r.file)), r.sha256, r.file);
  const prereg = JSON.parse(readFileSync(preregPath, 'utf8'));
  assert.deepEqual(Object.keys(amendment.pins).sort(), Object.keys(PIN_REASONS).sort(), 'every changed pinned file is re-pinned with its reason');
  for (const [f, p] of Object.entries(amendment.pins)) assert.deepEqual([p.from, p.to], [prereg.files[f], sha256(readFileSync(f))], f);
  assert(!('experiments/nina-changes/fence6.mjs' in amendment.pins) && !('experiments/nina-changes/matrix6.mjs' in amendment.pins), 'A3: no fence or matrix change');
  assert.match(amendment.changes.fence.unchanged, /no escape row's verdict changed; no new paid matrix run/);
  assert.match(amendment.changes.fence.correction, /built-in read-only commands/);
});

test('A4: the spend is itemised to the 7th decimal ($7.1003162: 7 matrix + 17 practice lines), no counted call, projection within $60', () => {
  const s = amendment.spend, p = amendment.projection;
  assert.deepEqual([s.calls.length, s.spentUsd, s.matrixUsd, s.practiceUsd], [24, 7.1003162, 4.0821826, 3.0181336]);
  assert.deepEqual([s.calls.filter(c => c.kind === 'isolation-matrix').length, s.calls.filter(c => c.kind === 'practice').length], [7, 17]);
  assert.deepEqual([p.meanUsd, p.p90Usd, p.maxUsd, p.projectedMeanUsd, p.projectedP90Usd, p.withinCap], [0.1775373, 0.204864, 0.2279082, 40.3661365, 45.2849478, true], "the mean projection from the unrounded mean, rounded once");
  assert.match(amendment.countedCalls, /No counted call has been made/);
  assert.match(amendment.notBefore, /merge time of the odin-rnd pull request that adds this file/);
});

test('the record discloses that the lint does not decode hex or base64 (an encoded term passes it), and the validator requires it', () => {
  assert.equal(ENCODED_TERM_LIMIT, 'The record lint compares text fingerprints and does not decode hex or base64, so a restricted term encoded byte by byte (or in base64) would pass it. This gap predates this amendment: the pre-registered lint6 (EXP 006, scrub6.mjs) and the site-wide check.mjs behave the same way. The answer-key files are not protected by the lint. They are protected by the OS sandbox (reads of the temp roots and of home outside the run are denied) and by the counted pre-flight scan.');
  assert(amendment.limits.includes(ENCODED_TERM_LIMIT));
  const r = structuredClone(amendment); r.limits = r.limits.filter(l => l !== ENCODED_TERM_LIMIT);
  assert.throws(() => validateAmendment(r), /encoded-term gap/);
});

test('the validator refuses a re-pin without a reason, a wrong old pin, a spend that does not add up, a counted line', () => {
  const bad = f => { const r = structuredClone(amendment); f(r); return r; };
  const [first] = Object.keys(amendment.pins);
  assert.throws(() => validateAmendment(bad(r => { r.pins[first].reason = null; })), /no stated reason/);
  assert.throws(() => validateAmendment(bad(r => { r.pins[first].from = 'a'.repeat(64); })), /old pin/);
  assert.throws(() => validateAmendment(bad(r => { r.pins[first].to = 'a'.repeat(64); })), /new pin/);
  assert.throws(() => validateAmendment(bad(r => { delete r.pins[first]; })), /not re-pinned/);
  assert.throws(() => validateAmendment(bad(r => { r.spend.spentUsd = 7.1; })));
  assert.throws(() => validateAmendment(bad(r => { r.spend.calls[0].kind = 'counted'; })), /no counted or pre-run call/);
  assert.throws(() => validateAmendment(bad(r => { r.parent.sha256 = 'a'.repeat(64); })), /published EXP 006 pre-registration/);
  assert.throws(() => validateAmendment(bad(r => { r.changes.gitCall.registeredRule = 'x'; })), /verbatim/);
});

test('A5: freeze.mjs carries the amendment constants: both null until the re-freeze, then this amendment\'s sha and a later not-before', () => {
  const src = readFileSync('experiments/nina-changes/freeze.mjs', 'utf8');
  assert.deepEqual([...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]), ['PREREG6_SHA256', 'NOT_BEFORE6', 'AMENDMENT6_SHA256', 'AMENDMENT6_NOT_BEFORE']);
  // Branches on the committed freeze (as the units guard test does), so the re-freeze keeps the suite green.
  if (AMENDMENT6_SHA256 === null) assert.equal(AMENDMENT6_NOT_BEFORE, null, 'both amendment constants or neither');
  else {
    assert.equal(AMENDMENT6_SHA256, amendmentSha, 'the frozen amendment is this one');
    assert.ok(Date.parse(AMENDMENT6_NOT_BEFORE) > Date.parse(amendment.parent.notBefore), 'its not-before is after the pre-registration\'s');
  }
});

// ------------------------------------------------------------------ A6: the pages

test('A6: the EXP 006 note carries the dated amendment section; the home row carries its line, linked #amendment-01', () => {
  const { record: prereg, sha256: preregSha } = checkRecord();
  assert.doesNotThrow(() => assertNoteCurrent(), 'the committed note is the amended render, and the site copy the record');
  const built = readFileSync(articlePath, 'utf8');
  assert.equal(built, amendNote(renderNote(prereg, preregSha), amendment, amendmentSha));
  assert.equal(built, renderAmendedNote(prereg, preregSha, { record: amendment, sha256: amendmentSha }));
  assert.equal(slug, 'nina-reviews-the-change');
  assert(built.includes(`<section id="${sectionId}" class="article-amendment">`));
  assert(built.includes(renderAmendmentSection(amendment, amendmentSha)));
  assert.match(built, / · AMENDED 01 OCT 2026 · NOT YET RUN<\/p>/);
  assert(built.includes(`href="#${sectionId}">${amendment.siteQualifier.note.replaceAll("'", '&#39;')}</a>`));
  assert(built.includes(amendmentSha) && built.includes(PARENT.sha256));
  assert(!/undefined|NaN|\bnull\b/.test(renderAmendmentSection(amendment, amendmentSha).replace(/<[^>]+>/g, ' ')), 'no undefined, NaN or bare null');
  assert.throws(() => amendNote(built, amendment, amendmentSha), /exactly once|already amended/);
  const row = qualifyRow(renderJournalRow(checkRecord().record), amendment);
  assert(row.includes(`href="journal/nina-reviews-the-change.html#${sectionId}"`));
  assert(row.includes('Amended 01 Oct 2026, before any counted run.'));
});

test('A6: the amended note cannot scroll sideways at 375px or 320px (long tokens wrap)', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  const section = renderAmendmentSection(amendment, amendmentSha).replace(/<pre[\s\S]*?<\/pre>/g, ' ');
  const runs = section.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  for (const width of [375, 320]) {
    const wide = runs.filter(t => t.length > Math.floor((width - 32) / 9));
    assert(wide.length === 0 || wraps, `At ${width}px, ${wide.length} unbroken runs are wider than the column and nothing lets them wrap`);
  }
});

test('A6: the built site publishes the amendment byte for byte, the amended note and the qualified row (fresh build copy)', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  assert.equal(sha256(readFileSync(join(dist, publishedPath.slice('site/'.length)))), amendmentSha);
  assert.equal(sha256(readFileSync(publishedPath)), amendmentSha, 'the committed site copy is the record');
  const note = readFileSync(join(dist, articlePath.slice('site/'.length)), 'utf8');
  assert(note.includes(renderAmendmentSection(amendment, amendmentSha)));
  assert(readFileSync(join(dist, 'index.html'), 'utf8').includes(qualifyRow(renderJournalRow(checkRecord().record), amendment)));
  assert(existsSync(join(dist, 'data/nina-changes/preregistration.json')));
});
