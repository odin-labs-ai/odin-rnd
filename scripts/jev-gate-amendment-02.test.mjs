import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { sha256 } from './jev-gate-prereg.mjs';
import { amendNote, qualifyHome, cardQualifier } from './jev-gate-amendment-note.mjs';
import { checkAmendment } from './jev-gate-amendment.mjs';
import { amendedCommand, amendment01Sha256, amendment02PinPath, assertEvidence02, checkAmendment02, derive02, evidencePaths, localPath, v3Paths, v4Paths, v5Paths, sandboxOnlyPath, sandbox5OnlyPath, scrubbedSettings, childEnv, probeOfRecordPath, published02Path, requiredFiles, roundOnePath, scrubPath, spendSum, units, validateAmendment02 } from './jev-gate-amendment-02.mjs';
import { amendNote02, cardQualifier02, noteQualifier02, qualifyHome02, qualifyStation02, renderAmendment02Line, renderAmendment02Section, section02Id, stationQualifier02 } from './jev-gate-amendment-02-note.mjs';
import { articlePath } from './jev-gate-journal.mjs';
import { renderStations } from './station-render.mjs';

const prereg = JSON.parse(readFileSync('experiments/jev-gate/preregistration.json', 'utf8'));
const a01 = checkAmendment();
const { record, sha256: digest, bytes } = checkAmendment02();
const context = { prereg, amendment01: a01.record };
const html = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const copy = () => structuredClone(record);
const built = () => amendNote02(amendNote(readFileSync(articlePath, 'utf8'), a01.record, a01.sha256), record, digest);

test('amendment 02 is pinned, names amendment 01 and the pre-registration, and both stay byte-identical', () => {
  assert.equal(readFileSync(amendment02PinPath, 'utf8').split(/\s+/)[0], digest);
  assert.equal(a01.sha256, amendment01Sha256, 'Amendment 01 must stay byte-identical');
  assert.equal(record.parent.sha256, amendment01Sha256);
  assert.equal(sha256(readFileSync('experiments/jev-gate/preregistration.json')), record.preregistration.sha256);
  assert.equal(readFileSync(published02Path, 'utf8'), bytes.toString('utf8'), 'The published copy is the committed amendment 02');
  for (const file of requiredFiles) { const changed = copy(); delete changed.files[file]; assert.throws(() => validateAmendment02(changed, context), /does not pin/); }
});

test('the flags are the fence5 flags: the parent command with the file tools scoped, the fence, the git deny rules and the OS sandbox with denyRead', () => {
  const r = record.changes.reviewer;
  assert.deepEqual(r.allowedTools, ['Read(./**)', 'Grep(./**)', 'Glob(./**)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)', 'Bash(git log:*)']);
  assert.deepEqual(r.settings, { permissions: { blockReadsOutsideWorkingDirectories: true, deny: ['Bash(git *--output*)', 'Bash(git *--no-index*)', 'Bash(git *<*)', 'Bash(git *>*)', "Bash(git *'*)", 'Bash(git *"*)', 'Bash(git *\\*)', 'Bash(git *{*)', 'Bash(git *}*)', 'Bash(git *`*)'] }, sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false, filesystem: { denyRead: ['/private/tmp', '/tmp', '/private/var/folders', '/var/folders'] } } });
  assert.deepEqual(r.childEnv, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  assert.deepEqual(childEnv, r.childEnv);
  assert.equal(r.command, amendedCommand(prereg.gates.reviewer.command));
  assert.equal(r.command.replace(` --settings ${JSON.stringify(r.settingsArgument)}`, '').replace('"Read(./**)" "Grep(./**)" "Glob(./**)"', 'Read Grep Glob'), prereg.gates.reviewer.command, 'Nothing else in the command moves');
  assert(r.command.indexOf('--settings') < r.command.indexOf('--allowedTools'), '--settings comes before the variadic --allowedTools');
  for (const file of v5Paths.slice(1)) {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(run.pins.settings, scrubbedSettings(r.settings), `${file} recorded these settings, with the temp roots scrubbed to <tmp>`);
    assert.equal(run.pins.command, r.command, `${file} ran exactly this command`);
    assert.deepEqual(run.calls[0].childGitEnv, r.childEnv, `${file} ran with this git environment`);
  }
  for (const mutate of [
    x => { x.changes.reviewer.settings.permissions.deny.pop(); },
    x => { x.changes.reviewer.allowedTools[1] = 'Grep'; },
    x => { x.changes.reviewer.command = x.changes.reviewer.command.replace('--effort high', '--effort low'); },
    x => { x.changes.reviewer.clientVersion = '2.1.281'; },
    x => { delete x.changes.reviewer.childEnv.GIT_CONFIG_NOSYSTEM; },
    x => { x.changes.reviewer.settings.sandbox.allowUnsandboxedCommands = true; },
    x => { x.changes.reviewer.settings.sandbox.filesystem.denyRead.pop(); },
    x => { x.changes.reviewer.settings.permissions.deny = x.changes.reviewer.settings.permissions.deny.filter(d => !d.includes('{')); },
  ]) { const changed = copy(); mutate(changed); assert.throws(() => validateAmendment02(changed, context)); }
});

test('the evidence is the scrubbed run records: the old flags leaked, round 1 wrote outside, every later fence held', () => {
  assert.deepEqual(record, derive02(record));
  assert.doesNotThrow(() => assertEvidence02(record));
  const ev = record.changes.reviewer.isolationEvidence;
  assert.equal(ev.probeOfRecord.file, probeOfRecordPath);
  assert.equal(ev.probeOfRecord.sha256, 'fe4af853da310d7e49f8951b7b9ba2eb3af8e98e5c8aa56ecbb87295e7b9fb2e');
  assert.equal(record.reason.answerKeyCopies.evidence.sha256, ev.probeOfRecord.sha256);
  assert.equal(record.reason.quoteGap.evidence.sha256, 'a5670b22daf514df8187a1f2a4e2cff8503fcd0c41b9cc31d4134ad8a8b8c8c1');
  assert.equal(record.reason.redirectGap.evidence.sha256, '7dda29e39b891e371783a7149e4894a0b585e77e035fe93b2cd5a9b84cd91e9d');
  assert.equal(record.reason.failure.evidence.sha256, 'f4e6d888b957ee73e6fdd6a50e9de8b9616801d48f1b0cf3e1cbf58df374b944');
  assert.equal(record.reason.outputHole.evidence.file, roundOnePath);
  const round1 = ev.runs.find(run => run.file === roundOnePath);
  assert.deepEqual(Object.entries(round1.rows).filter(([, v]) => v !== 'held').map(([k, v]) => `${k} ${v}`), ['r11 WROTE OUTSIDE', 'r12 WROTE OUTSIDE']);
  for (const run of ev.runs.filter(run => run.file !== roundOnePath)) assert(run.passed && run.controlsWorked && Object.values(run.rows).every(v => v === 'held'));
  assert.deepEqual(ev.runs.map(run => Object.keys(run.rows).length), [14, 14, 14, 21, 21, 30, 30, 30, 33, 33, 33], 'v2 tried 14 rows, v3 21, v4 30, v5 33');
  for (const k of ['r29', 'r30', 'r31']) assert(ev.runs.slice(8).every(run => run.rows[k] === 'held'), `${k} held in round 5`);
  for (const k of ['r19b', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27']) assert(ev.runs.slice(5).every(run => run.rows[k] === 'held'), `${k} held in round 4`);
  assert(ev.runs.slice(5).every(run => run.controls === 8 && run.info.r28 === 'ran, not refused'), 'Rounds 4 and 5 ran C1-C8, and R28 ran');
  const sandboxOnly = ev.runs.find(run => run.file === sandboxOnlyPath);
  assert(!sandboxOnly.settings.permissions.deny && sandboxOnly.settings.sandbox.enabled, 'The sandbox-only run had no text rules');
  for (const file of [sandboxOnlyPath, sandbox5OnlyPath]) assert(JSON.parse(readFileSync(file, 'utf8')).calls[0].result.includes('Operation not permitted'));
  // R4-B1: in both fence5 runs R9 and R21 passed the permission layer and the sandbox stopped them; R31 was refused by it.
  for (const file of v5Paths.slice(1)) {
    const call = JSON.parse(readFileSync(file, 'utf8')).calls[0], denied = JSON.stringify(call.permissionDenials);
    assert(!denied.includes('canary-r9') && !denied.includes('canary-r29') && denied.includes('escape-r31'));
    assert(call.result.includes("could not open '../escape-r21.txt' for writing: Operation not permitted"));
  }
  assert.match(record.changes.reviewer.denyRules, /normalised/); assert.match(record.changes.reviewer.denyRules, /best-effort/);
  assert.doesNotMatch(JSON.stringify(record), /command text the rules match is the argument list/, 'The refuted fence4 claim is gone');
  const moved = copy(); moved.changes.reviewer.isolationEvidence.runs[1].costUsd += 1;
  assert.notDeepEqual(moved, derive02(moved));
});

test('no local machine path anywhere in the amendment or the evidence it pins', () => {
  for (const file of [...evidencePaths, 'experiments/jev-gate/amendment-02.json']) assert.doesNotMatch(readFileSync(file, 'utf8'), localPath, `${file} carries a local path`);
  for (const leak of ['/private/var/folders/ab/cd/T/x', '/var/folders/ab/T/x', '/opt/homebrew/bin/claude', '/tmp/x', '/Users/x/y', '/home/someone/x']) assert.match(leak, localPath);
  assert.doesNotMatch('<ws>/home/probe-user/canary.txt', localPath);
  const scrub = JSON.parse(readFileSync(scrubPath, 'utf8'));
  for (const entry of scrub.files) assert.equal(sha256(readFileSync(`experiments/jev-gate/${entry.path}`)), entry.scrubbedSha256);
});

test('which runner made which run is stated from the records', () => {
  const groups = record.changes.reviewer.runners.byRun;
  const hashOf = file => JSON.parse(readFileSync(`experiments/jev-gate/${file}`, 'utf8')).code['experiments/jev-gate/run_reviewer.mjs'];
  for (const g of groups) for (const file of g.runs) assert.equal(hashOf(file), g.runnerSha256);
  assert.equal(new Set(groups.map(g => g.runnerSha256)).size, groups.length, 'Each group is one runner, and no runner is listed twice');
  assert.deepEqual(groups.filter(g => g.committed).map(g => [g.runs.join(','), g.runnerSha256.slice(0, 16)]), [['isolation-probe-v5-sandbox-only.json', '732c3c9ece0d7fe8']], 'Only runners.sha256\'s run_reviewer.mjs is committed, and it made the v5 sandbox-only run');
  assert.equal(groups.find(g => g.runs.includes('isolation-probe-v5-fence5-2.json')).runnerSha256.slice(0, 16), 'bb3f196965fcf100', 'The probe of record was made by a squashed development runner');
  for (const g of groups.filter(g => !g.committed)) assert.match(g.where, /recorded in the run's code field; the source commits were squashed before publication/);
  assert.doesNotMatch(JSON.stringify(record), /differed by one line/);
});

test('every paid call since amendment 01 is itemised to 7 decimals and the printed sums add up exactly', () => {
  const p = record.priorCalls;
  assert.equal(p.calls.length, 19);
  assert.equal(record.spend.previousUsd, a01.record.spend.alreadySpentUsd);
  assert.equal(record.spend.alreadySpentUsd, 5.5808946);
  assert.equal(record.spend.sum, spendSum(record));
  // Re-add every printed equation from its printed terms.
  const [, before, since, total, sinceAgain, groups] = record.spend.sum.match(/^(\d+\.\d{7}) \(amendment 01\) \+ (\d+\.\d{7}) \(since\) = (\d+\.\d{7}), where (\d+\.\d{7}) = (.*)\.$/);
  assert.equal(units(Number(before)) + units(Number(since)), units(Number(total)));
  assert.equal(since, sinceAgain);
  assert.equal([...groups.matchAll(/(\d+\.\d{7}) \(/g)].reduce((s, [, n]) => s + units(Number(n)), 0), units(Number(since)), 'The group totals add up to the amount since amendment 01');
  for (const [, total, terms] of record.spend.sum.matchAll(/(\d+\.\d{7}) \([^:()]+: ([\d. +]+)\)/g)) assert.equal(terms.split(' + ').reduce((s, n) => s + units(Number(n)), 0), units(Number(total)), `${terms} does not add up to ${total}`);
  assert(/1\.1283930 \(amendment 01\) \+ 4\.4525016 \(since\) = 5\.5808946/.test(record.spend.sum));
  assert(record.spend.sum.includes('1.1830890 (three v5 matrix runs: 0.3708746 + 0.4585124 + 0.3537020)'));
  assert(record.spend.sum.includes('1.0967582 (three v4 matrix runs: 0.4200926 + 0.3389342 + 0.3377314)'));
  assert(record.spend.sum.includes('0.6031066 (two v3 matrix runs: 0.3472386 + 0.2558680)'));
  for (const mutate of [x => { x.spend.alreadySpentUsd = 5.5808947; }, x => { x.priorCalls.calls.pop(); }, x => { x.spend.sum = x.spend.sum.replace('0.6874040', '0.6874044'); }]) {
    const changed = copy(); mutate(changed); assert.throws(() => validateAmendment02(changed, context));
  }
  assert(p.calls.every(c => c.item === null || /^p0\d$/.test(c.item)), 'No corpus item was used');
  assert.match(p.statement, /amendment 01/);
  assert.doesNotMatch(bytes.toString('utf8'), /\d\.\d*(?:0{6,}|9{6,})\d/, 'No float artefact in the record');
});

test('the clock covers every counted gate, nothing else changes, and the limits say what the fence does not cover', () => {
  assert.match(record.notBefore, /No counted gate run \(Jev, Laya or the reviewer\)/);
  assert.match(record.notBefore, /R1-R31 with R8B, R8C and R19B, controls C1-C8, and the information row R28/);
  assert(record.limits.some(l => /do not fire on redirections/.test(l) && /corrects the v3 draft/.test(l)), 'The v3 2>/dev/null claim is corrected');
  assert(!record.limits.some(l => /also refuses a harmless 2>\/dev\/null/.test(l)), 'The wrong v3 claim is gone');
  assert(record.unchanged.some(u => /spotlight/.test(u) && /No criterion changes/.test(u)));
  for (const phrase of ['Glob ../* was not refused but returned nothing', '--output', 'not a security boundary', 'blockReadsOutsideWorkingDirectories', 'Operation not permitted', 'denyRead covers the shared temp roots', 'quoted git forms', 'outside the sandbox', 'failIfUnavailable', 'best-effort', '364 leaked test temp directories', 'rest on it alone', '2.1.280']) assert(record.limits.some(l => l.includes(phrase)), `Limits must state: ${phrase}`);
  assert(!record.limits.some(l => /documented best-effort/.test(l)), 'The docs call only the Read rules on Grep and Glob best-effort');
  assert.match(record.spend.supersedes, /^This figure replaces/);
  const ran = copy(); ran.reason.summary += ' This was before any gate ran.';
  assert.throws(() => validateAmendment02(ran, context), /before any gate ran/);
});

test('the home card, station 06 and the note say "amended again", from the record, beside amendment 01', () => {
  const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
  const reports = ['migration-witness', 'test-witness', 'ci-witness'].map(id => JSON.parse(readFileSync(`site/data/witnesses/${id}.json`, 'utf8')));
  // Pre-registration mode (results null): the measured station replaces this exhibit and has its own test.
  const exhibit = renderStations(report, reports, undefined, undefined, undefined, undefined, undefined, null).split('id="station-triage"')[1].split('</article>')[0];
  assert(exhibit.includes(`${stationQualifier02(record)}</p>`) && exhibit.includes(renderAmendment02Line(record)));
  const home = qualifyHome02(qualifyHome(readFileSync('site/index.html', 'utf8'), a01.record), record);
  assert(home.includes(`Published before any gate runs.${cardQualifier(a01.record)}${cardQualifier02(record)}</p>`));
  const note = built();
  assert(note.includes(renderAmendment02Section(record, digest)) && note.includes(`${noteQualifier02(record)}</p>`) && note.includes(html(record.siteQualifier.meta)));
  assert.match(note, /AMENDED 28 SEP 2026 · AMENDED AGAIN 28 SEP 2026 · NO RESULTS YET/);
  assert(note.indexOf('id="amendment-01"') < note.indexOf(`id="${section02Id}"`), 'Amendment 02 follows amendment 01');
  for (const text of [record.reason.summary, record.reason.outputHole.what, record.changes.reviewer.command, record.changes.reviewer.isolationEvidence.howRefused, record.spend.sum, ...record.limits, ...record.unchanged, digest]) assert(note.includes(html(text)), `Section is missing: ${String(text).slice(0, 60)}`);
  assert.doesNotMatch(note.split(`id="${section02Id}"`)[1].split('</section>')[0], /\d\.\d*(?:0{6,}|9{6,})\d/, 'No float artefact on the page');
  // Built pages from a fresh build in a disposable copy (test-build.mjs): independent of whether ./dist exists
  // or is stale, and of other test files reading the checkout in parallel.
  const dist = join(builtCopy(), 'dist');
  const page = readFileSync(join(dist, 'index.html'), 'utf8');
  // Once results are committed, station 06 shows the measured exhibit, which has no pre-registration sentence to qualify.
  assert(page.includes(cardQualifier02(record)) && (existsSync('experiments/jev-gate/results/results.json') || page.includes(stationQualifier02(record))), 'the built home page is not qualified by the committed amendment 02');
  assert(readFileSync(join(dist, 'journal/jev-as-a-fast-gate.html'), 'utf8').includes(noteQualifier02(record)), 'The built note is not qualified by the committed amendment 02');
  const changed = copy(); changed.siteQualifier.card = changed.siteQualifier.card.replace('Amended again', 'Amended');
  assert.throws(() => validateAmendment02(changed, context), /amended again/);
  assert.throws(() => amendNote02(note, record, digest), /already carries/);
  assert.throws(() => qualifyStation02('<p>no sentence here</p>', record), /exactly once/);
});

test('the amended journal cannot scroll sideways at 375px or 320px', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  const body = built().split('<article class="article-body">')[1].split('</article>')[0].replace(/<pre[\s\S]*?<\/pre>/g, ' ');
  const runs = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  for (const width of [375, 320]) {
    const wide = runs.filter(t => t.length > Math.floor((width - 32) / 9));
    assert(wide.length === 0 || wraps, `At ${width}px, ${wide.length} unbroken runs are wider than the column and nothing lets them wrap`);
  }
});
