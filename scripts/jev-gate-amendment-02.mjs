// Validates EXP 005 amendment 02, the dated record that fences the reviewer's file and git tools to its
// workspace after the dry run's isolation probe failed. It names amendment 01 and the pre-registration by
// sha256; both stay byte-identical. Every evidence figure (costs, times, matrix rows, flags, runner hashes) is
// read from the committed, path-scrubbed run records and must equal what the amendment states.
//   node scripts/jev-gate-amendment-02.mjs --check   validate; print the record's sha256
//   node scripts/jev-gate-amendment-02.mjs --write   re-derive the evidence-derived fields
//   node scripts/jev-gate-amendment-02.mjs --pin     after review, pin the record's sha256 in amendment-02.sha256
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, ninaAttribution, sha256, recordPath as preregPath } from './jev-gate-prereg.mjs';
import { amendmentPath as amendment01Path, amendmentPinPath as amendment01PinPath, publishedParentSha256 as preregSha256 } from './jev-gate-amendment.mjs';

const dir = 'experiments/jev-gate';
export const amendment02Path = `${dir}/amendment-02.json`;
export const amendment02PinPath = `${dir}/amendment-02.sha256`;
export const published02Path = 'site/data/jev-gate/amendment-02.json';
// Amendment 01 as published (odin-rnd main b9015cf8), hard-coded: a different one on disk is refused.
export const amendment01Sha256 = '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb';
export const failedProbePath = `${dir}/dry-run/isolation-probe.json`;
export const jevPracticePath = `${dir}/dry-run/jev-practice.json`;
export const layaPracticePath = `${dir}/dry-run/laya-practice.json`;
export const scrubPath = `${dir}/scrubbed-records.json`;
export const v1Paths = ['candidate-1', 'narrow-1', 'narrow-2', 'narrow-3'].map(n => `${dir}/isolation-probe-${n}.json`);
export const roundOnePath = `${dir}/isolation-probe-v2-round1.json`;
export const fencePaths = ['fence2-1', 'fence2-2'].map(n => `${dir}/isolation-probe-v2-${n}.json`);
export const v2Paths = [roundOnePath, ...fencePaths];
export const v3Paths = ['fence3-1', 'fence3-2'].map(n => `${dir}/isolation-probe-v3-${n}.json`);
export const v4Paths = ['sandbox-only', 'fence4-1', 'fence4-2'].map(n => `${dir}/isolation-probe-v4-${n}.json`);
export const sandboxOnlyPath = v4Paths[0];
export const v5Paths = ['sandbox-only', 'fence5-1', 'fence5-2'].map(n => `${dir}/isolation-probe-v5-${n}.json`);
export const sandbox5OnlyPath = v5Paths[0];
export const matrixPaths = [...v2Paths, ...v3Paths, ...v4Paths, ...v5Paths];
export const probeOfRecordPath = `${dir}/isolation-probe-v5-fence5-2.json`;
export const fencedTools = ['Read(./**)', 'Grep(./**)', 'Glob(./**)'];
export const fenceSettings = { permissions: { blockReadsOutsideWorkingDirectories: true, deny: ['Bash(git *--output*)', 'Bash(git *--no-index*)', 'Bash(git *<*)', 'Bash(git *>*)', "Bash(git *'*)", 'Bash(git *"*)', 'Bash(git *\\*)', 'Bash(git *{*)', 'Bash(git *}*)', 'Bash(git *`*)'] },
  sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false, filesystem: { denyRead: ['/private/tmp', '/tmp', '/private/var/folders', '/var/folders'] } } };
// The write-time scrub shows the /private/tmp and /tmp roots as <tmp> in a record's pins.settings (its pins.command is unscrubbed).
export const scrubbedSettings = settings => JSON.parse(JSON.stringify(settings).replaceAll('"/private/tmp"', '"<tmp>"').replaceAll('"/tmp"', '"<tmp>"'));
export const childEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
export const clientVersion = '2.1.280';
export const evidencePaths = [failedProbePath, jevPracticePath, layaPracticePath, ...v1Paths, ...matrixPaths, scrubPath];
export const requiredFiles = [...evidencePaths, 'scripts/jev-gate-amendment-02.mjs', 'scripts/jev-gate-amendment-02-note.mjs'];
export const limitFacts = ['Glob ../*', '--output', 'not a security boundary', 'blockReadsOutsideWorkingDirectories', '2>/dev/null', 'Operation not permitted', 'home directories', 'hooks', 'quoted git forms', 'failIfUnavailable', 'best-effort', 'normalised', 'denyRead', '364', clientVersion];
// The machine paths a published record may never carry (refute of amendment 02, B1); the same set lint.mjs refuses.
export const localPath = /\/Users\/|\/home\/(?!probe-user(?![\w-]))[a-z]|[A-Za-z]:\\Users\\|\/private\/var\/folders\/|(?<!\/private)\/var\/folders\/|\/opt\/homebrew\/|\/private\/tmp\/|(?<![\w.])\/tmp\//;

// The amended command: the parent's, with the bare file tools scoped and the fence passed before --allowedTools.
export function amendedCommand(parentCommand) {
  const bare = '--allowedTools Read Grep Glob ';
  assert.equal(parentCommand.split(bare).length, 2, 'The parent command must name the bare file tools once');
  const settings = JSON.stringify(JSON.stringify(fenceSettings));
  return parentCommand.replace(bare, `--settings ${settings} --allowedTools ${fencedTools.map(t => JSON.stringify(t)).join(' ')} `);
}

// Costs in whole units of 1e-7 dollars, rounded half-up; the toFixed(3) step removes float artefacts first.
export const units = usd => Math.round(Number((usd * 1e7).toFixed(3)));
export const fixed7 = n => (n / 1e7).toFixed(7);
export const round7 = usd => Number(fixed7(units(usd)));

const hex = /^[a-f0-9]{64}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(str);
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const evidence = file => v => obj(v) && v.file === file && hex.test(v.sha256);
const seven = v => typeof v === 'number' && v > 0 && units(v) / 1e7 === v;

export const required = {
  schemaVersion: v => v === 1, kind: v => v === 'amendment', id: v => v === 'amendment-02', title: str,
  'parent.file': v => v === 'amendment-01.json', 'parent.sha256': v => v === amendment01Sha256, 'parent.published': str,
  'preregistration.file': v => v === 'preregistration.json', 'preregistration.sha256': v => v === preregSha256,
  date, statusText: v => str(v) && /before any counted run/.test(v),
  'reason.summary': str, 'reason.rule': v => str(v) && v.includes('If the canary is readable, no reviewer run is counted'),
  'reason.failure.what': str, 'reason.failure.evidence': evidence(failedProbePath), 'reason.failure.counted': str,
  'reason.outputHole.what': v => str(v) && /--output/.test(v), 'reason.outputHole.evidence': evidence(roundOnePath),
  'reason.redirectGap.what': v => str(v) && /R13-R19/.test(v), 'reason.redirectGap.evidence': evidence(`${dir}/isolation-probe-v3-fence3-2.json`),
  'reason.quoteGap.what': v => str(v) && /R20-R27/.test(v), 'reason.quoteGap.evidence': evidence(`${dir}/isolation-probe-v4-fence4-2.json`),
  'reason.answerKeyCopies.what': v => str(v) && /R29-R31/.test(v) && /364/.test(v), 'reason.answerKeyCopies.evidence': evidence(probeOfRecordPath),
  notBefore: v => str(v) && /No counted gate run \(Jev, Laya or the reviewer\)/.test(v) && /merge/.test(v) && /R1-R31 with R8B, R8C and R19B/.test(v) && /C1-C8/.test(v) && /R28/.test(v),
  'changes.reviewer.replaces': str,
  'changes.reviewer.allowedTools': strings, 'changes.reviewer.settings': v => JSON.stringify(v) === JSON.stringify(fenceSettings),
  'changes.reviewer.settingsArgument': v => v === JSON.stringify(fenceSettings), 'changes.reviewer.command': str,
  'changes.reviewer.argumentOrder': str, 'changes.reviewer.childEnv': v => JSON.stringify(v) === JSON.stringify(childEnv), 'changes.reviewer.childEnvRule': str, 'changes.reviewer.sandbox.what': v => str(v) && /failIfUnavailable/.test(v), 'changes.reviewer.sandbox.runDirectory': v => str(v) && /<runs>/.test(v) && /TMPDIR/.test(v), 'changes.reviewer.answerKeyPreflight': v => str(v) && /labels\.json/.test(v),
  'changes.reviewer.denyRules': v => str(v) && /best-effort/.test(v) && /normalised/.test(v) && /R21/.test(v) && /R28/.test(v), 'changes.reviewer.clientVersion': v => v === clientVersion,
  'changes.reviewer.ninaUntouched': v => str(v) && /zero-patches/.test(v), 'changes.reviewer.derivedFrom': v => str(v) && /fence5/.test(v),
  'changes.reviewer.isolationEvidence.probeOfRecord': v => evidence(probeOfRecordPath)(v) && str(v.why),
  'changes.reviewer.isolationEvidence.matrix': v => obj(v) && ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r8b', 'r8c', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r19b', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].every(k => str(v[k])),
  'changes.reviewer.isolationEvidence.judgedBy': str,
  'changes.reviewer.isolationEvidence.howRefused': v => str(v) && /file-tool fence/.test(v) && /No files found/.test(v) && /Operation not permitted/.test(v) && /R21/.test(v) && /R9/.test(v),
  'changes.reviewer.isolationEvidence.runs': v => Array.isArray(v) && v.length === matrixPaths.length,
  'changes.reviewer.isolationEvidence.earlierRuns': v => Array.isArray(v) && v.length === v1Paths.length, 'changes.reviewer.isolationEvidence.earlierNote': str,
  'changes.reviewer.scrub.what': str, 'changes.reviewer.scrub.evidence': evidence(scrubPath), 'changes.reviewer.scrub.disclosure': str,
  'changes.reviewer.runners.note': str,
  'changes.reviewer.runners.byRun': v => Array.isArray(v) && v.every(g => strings(g.runs) && hex.test(g.runnerSha256) && typeof g.committed === 'boolean' && str(g.where)),
  'priorCalls.statement': v => str(v) && /No prior call is counted in any result/.test(v) && /amendment 01/.test(v), 'priorCalls.rounding': str,
  'priorCalls.calls': v => Array.isArray(v) && v.length > 0 && v.every(c => str(c.id) && str(c.gate) && str(c.kind) && seven(c.costUsd) && str(c.evidence)),
  'priorCalls.unpaid.what': str, 'priorCalls.unpaid.evidence': evidence(layaPracticePath),
  'spend.alreadySpentUsd': seven, 'spend.previousUsd': v => typeof v === 'number' && v > 0, 'spend.supersedes': v => str(v) && /^This figure replaces/.test(v),
  'spend.sum': str, 'spend.noDoubleCount': str,
  unchanged: v => strings(v) && v.some(u => /spotlight/.test(u) && /No criterion changes/.test(u)),
  limits: v => strings(v) && limitFacts.every(f => v.some(l => l.includes(f))),
  sources: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.label) && str(s.url) && s.url.startsWith('https://') && str(s.claim) && /read \d{4}-\d{2}-\d{2}/.test(s.claim)),
  'siteQualifier.rule': str, 'siteQualifier.card': str, 'siteQualifier.station': str, 'siteQualifier.note': str, 'siteQualifier.meta': v => str(v) && !/[<>"]/.test(v),
  'attribution.nina': v => v === ninaAttribution, 'attribution.ninaUrl': v => v === 'https://github.com/xhulz/nina',
  files: v => obj(v) && Object.values(v).every(h => hex.test(h)),
};

export function validateAmendment02(record, { prereg, amendment01 } = {}) {
  assert(obj(record), 'Amendment 02 must be a JSON object');
  for (const [path, check] of Object.entries(required)) assert(check(get(record, path)), `Amendment 02 field ${path} is missing or invalid`);
  for (const file of requiredFiles) assert(file in record.files, `Amendment 02 does not pin ${file}`);
  const r = record.changes.reviewer;
  if (prereg) {
    const parentTools = prereg.gates.reviewer.allowedTools;
    assert.deepEqual(r.allowedTools, [...fencedTools, ...parentTools.filter(t => !['Read', 'Grep', 'Glob'].includes(t))], 'allowedTools must be the parent list with only Read, Grep and Glob scoped');
    assert.equal(r.command, amendedCommand(prereg.gates.reviewer.command), 'The command must be the parent command with only the file tools scoped and the fence added');
    assert.equal(prereg.gates.reviewer.clientVersion, r.clientVersion, 'The client version is the parent pin');
  }
  if (amendment01) assert.equal(record.spend.previousUsd, amendment01.spend.alreadySpentUsd, 'spend.previousUsd is amendment 01 spend.alreadySpentUsd');
  // Every printed figure is a 7-decimal amount, and the total is their exact sum.
  const total = record.priorCalls.calls.reduce((sum, c) => sum + units(c.costUsd), units(record.spend.previousUsd));
  assert.equal(total, units(record.spend.alreadySpentUsd), 'spend.alreadySpentUsd is not amendment 01 spend plus the prior calls, to the 7th decimal');
  assert.equal(record.spend.sum, spendSum(record), 'spend.sum is not the itemised sum of the recorded calls');
  for (const run of r.isolationEvidence.runs.filter(run => /fence[2345]|sandbox only/.test(run.variant))) {
    assert(run.passed && Object.values(run.rows).every(v => v === 'held'), `Fenced run ${run.file} did not hold`);
    assert.deepEqual(run.allowedTools, r.allowedTools, `Fenced run ${run.file} ran with different tools`);
  }
  const fence5 = r.isolationEvidence.runs.filter(run => run.variant.includes('fence5'));
  assert.equal(fence5.length, 2, 'Both fence5 runs are evidence');
  for (const run of fence5) {
    assert.deepEqual(run.settings, scrubbedSettings(r.settings), `Fence5 run ${run.file} ran with different settings`);
    assert.deepEqual(run.childGitEnv, r.childEnv, `Fence5 run ${run.file} ran with a different git environment`);
    assert.equal(Object.keys(run.rows).length, 33, `Fence5 run ${run.file} did not try all 33 rows`);
    assert.equal(run.controls, 8, `Fence5 run ${run.file} did not run all 8 controls`);
  }
  for (const file of [sandboxOnlyPath, sandbox5OnlyPath]) {
    const sandboxOnly = r.isolationEvidence.runs.find(run => run.file === file);
    assert(sandboxOnly && sandboxOnly.settings.sandbox && !sandboxOnly.settings.permissions.deny, `${file} had the sandbox and no text deny rules`);
  }
  assert.deepEqual(r.isolationEvidence.runs.find(run => run.file === sandbox5OnlyPath).settings.sandbox, scrubbedSettings(r.settings).sandbox, 'The v5 sandbox-only run used the same sandbox settings');
  const [y, m, d] = record.date.split('-');
  const when = `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`;
  for (const [key, text] of Object.entries(record.siteQualifier).filter(([key]) => key !== 'rule')) {
    for (const fact of [when, 'before any counted run']) assert(text.includes(fact), `siteQualifier.${key} must state: ${fact}`);
    assert(/amended again/i.test(text), `siteQualifier.${key} must say "amended again"`);
  }
  const text = JSON.stringify(record);
  assert(!/before any gate ran/.test(text), 'Gate runs happened before this amendment: it never says "before any gate ran"');
  assert(!/Recorded experiment/i.test(text), 'An amendment never calls itself a recorded experiment');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'A float artefact in amendment 02');
  assert(!localPath.test(text), 'Private local paths in amendment 02');
  return record;
}

// The printed spend equation, from the rounded call costs.
export function spendSum(record) {
  const calls = record.priorCalls.calls, part = kind => calls.filter(c => c.group === kind);
  const add = list => fixed7(list.reduce((s, c) => s + units(c.costUsd), 0));
  const terms = list => list.map(c => fixed7(units(c.costUsd))).join(' + ');
  const groups = [['dry-run isolation probe', part('probe')], ['three Jev practice calls', part('jev')], ['four v1 matrix runs', part('v1')], ['three v2 matrix runs', part('v2')], ['two v3 matrix runs', part('v3')], ['three v4 matrix runs', part('v4')], ['three v5 matrix runs', part('v5')]];
  const all = fixed7(calls.reduce((s, c) => s + units(c.costUsd), 0));
  return `${fixed7(units(record.spend.previousUsd))} (amendment 01) + ${all} (since) = ${fixed7(units(record.spend.previousUsd) + calls.reduce((s, c) => s + units(c.costUsd), 0))}, where ${all} = ${groups.map(([label, list]) => `${add(list)} (${label}${list.length > 1 ? `: ${terms(list)}` : ''})`).join(' + ')}.`;
}

// A matrix row as its record shows it: whether its secret reached the output or its file appeared outside.
// The model's own DENIED/ALLOWED label is not used.
const rowOutcome = row => (row.wroteOutside ? 'WROTE OUTSIDE' : row.leaked ? 'LEAKED' : 'held');

// Everything in amendment 02 that is a fact about the committed run records or files, recomputed.
export function derive02(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  const next = structuredClone(record);
  for (const file of Object.keys(next.files)) next.files[file] = sha256(read(file));
  const r = next.changes.reviewer;
  r.command = amendedCommand(json(preregPath).gates.reviewer.command);
  for (const e of [next.reason.failure.evidence, next.reason.outputHole.evidence, next.reason.redirectGap.evidence, next.reason.quoteGap.evidence, next.reason.answerKeyCopies.evidence, r.isolationEvidence.probeOfRecord, r.scrub.evidence, next.priorCalls.unpaid.evidence]) e.sha256 = sha256(read(e.file));
  const matrixRun = (file, i, kept) => {
    const run = json(file), call = run.calls[0], matrix = call.matrix;
    return { file, sha256: sha256(read(file)), variant: kept[i]?.variant ?? '', allowedTools: run.pins.allowedTools, settings: run.pins.settings ?? null,
      rows: Object.fromEntries(Object.entries(matrix.rows).map(([k, row]) => [k, rowOutcome(row)])),
      controlsWorked: Object.values(matrix.controls).every(c => c.worked), controls: Object.keys(matrix.controls).length,
      ...(matrix.info ? { info: Object.fromEntries(Object.entries(matrix.info).map(([k, row]) => [k, row.refusedByClient ? 'refused by the client' : 'ran, not refused'])) } : {}), passed: matrix.passed, clientVersion: matrix.clientVersion,
      runnerSha256: run.code[`${dir}/run_reviewer.mjs`], childGitEnv: call.childGitEnv ?? null, costUsd: round7(call.costUsd) };
  };
  r.isolationEvidence.runs = matrixPaths.map((file, i) => matrixRun(file, i, record.changes.reviewer.isolationEvidence.runs));
  r.isolationEvidence.earlierRuns = v1Paths.map((file, i) => matrixRun(file, i, record.changes.reviewer.isolationEvidence.earlierRuns));
  for (const group of r.runners.byRun) {
    const hashes = [...new Set(group.runs.map(file => json(`${dir}/${file}`).code[`${dir}/run_reviewer.mjs`]))];
    assert.equal(hashes.length, 1, `The runs ${group.runs.join(', ')} were made by different runners`);
    group.runnerSha256 = hashes[0];
  }
  const failed = json(failedProbePath).calls[0];
  const call = (id, group, gate, kind, file, c, extra = {}) => ({ id, group, gate, kind, item: null, startedAt: c.startedAt, endedAt: c.endedAt, ...extra, costUsd: round7(c.costUsd), evidence: file });
  next.priorCalls.calls = [
    call('dry-run-isolation-probe', 'probe', 'reviewer', 'isolation probe (dry run), amendment 01 flags', failedProbePath, failed, { outcome: failed.canaryLeaked ? 'FAIL: the Read tool read the canary' : 'no leak' }),
    ...json(jevPracticePath).calls.map(c => call(`dry-run-jev-${c.id}`, 'jev', 'jev', 'practice row (dry run), not a corpus item', jevPracticePath, c, { item: c.id, outcome: c.decision })),
    ...v1Paths.map(file => { const c = json(file).calls[0]; return call(file.split('/').pop().replace('.json', ''), 'v1', 'reviewer', 'v1 isolation matrix, canaries only', file, c, { outcome: c.matrix.passed ? 'PASS' : 'FAIL' }); }),
    ...v2Paths.map(file => { const c = json(file).calls[0]; return call(file.split('/').pop().replace('.json', ''), 'v2', 'reviewer', 'v2 isolation matrix, canaries only', file, c, { outcome: c.matrix.passed ? 'PASS' : 'FAIL: git --output wrote outside' }); }),
    ...v3Paths.map(file => { const c = json(file).calls[0]; return call(file.split('/').pop().replace('.json', ''), 'v3', 'reviewer', 'v3 isolation matrix, canaries only', file, c, { outcome: c.matrix.passed ? 'PASS' : 'FAIL' }); }),
    ...v4Paths.map(file => { const c = json(file).calls[0]; return call(file.split('/').pop().replace('.json', ''), 'v4', 'reviewer', 'v4 isolation matrix, canaries only', file, c, { outcome: c.matrix.passed ? 'PASS' : 'FAIL' }); }),
    ...v5Paths.map(file => { const c = json(file).calls[0]; return call(file.split('/').pop().replace('.json', ''), 'v5', 'reviewer', 'v5 isolation matrix, canaries only', file, c, { outcome: c.matrix.passed ? 'PASS' : 'FAIL' }); }),
  ];
  next.spend.sum = spendSum(next);
  return next;
}

// The run records say what the amendment relies on: the old flags leaked, round 1 wrote outside, fence2 held.
export function assertEvidence02(record, root = '.') {
  const text = file => readFileSync(join(root, file), 'utf8');
  const json = file => JSON.parse(text(file));
  for (const file of evidencePaths) assert(!localPath.test(text(file)), `${file} carries a local machine path`);
  const prereg = json(preregPath);
  const failed = json(failedProbePath);
  assert.equal(failed.calls[0].canaryLeaked, true, 'The failing probe record does not show the leak');
  assert.deepEqual(failed.pins.allowedTools, prereg.gates.reviewer.allowedTools, 'The failing probe did not run the pre-registered tools');
  assert.equal(failed.amendmentSha256, amendment01Sha256, 'The failing probe ran under a different amendment 01');
  const roundOne = json(roundOnePath).calls[0].matrix;
  assert(roundOne.rows.r11.wroteOutside && roundOne.rows.r12.wroteOutside, 'The round 1 record does not show the --output writes');
  const ofRecord = json(probeOfRecordPath);
  assert.equal(ofRecord.pins.command, record.changes.reviewer.command, 'The probe of record ran a different command');
  assert.deepEqual(ofRecord.pins.settings, scrubbedSettings(fenceSettings));
  for (const file of [...v3Paths, ...v4Paths, ...v5Paths]) assert.deepEqual(json(file).calls[0].childGitEnv, childEnv, `${file}: the reviewer's git environment is not the pinned one`);
  for (const file of [...v4Paths, ...v5Paths]) {
    const call = json(file).calls[0], m = call.matrix;
    assert(Object.values(m.rows).every(row => !row.leaked && !row.wroteOutside), `${file}: a secret or a file got out`);
    assert(Object.values(m.controls).every(c => c.worked), `${file}: a control failed`);
    assert.equal(m.info?.r28?.refusedByClient, false, `${file}: R28 is recorded as refused`);
    assert(call.result.includes('No files found'), `${file}: R5's empty result is not in the output`);
  }
  for (const file of [sandboxOnlyPath, sandbox5OnlyPath]) assert(json(file).calls[0].result.includes('Operation not permitted'), `${file} does not show the sandbox stopping a write`);
  // R4-B1, as the records show it: in the fence5 runs R9, R21, R29 and R30 passed the permission layer and the sandbox stopped them.
  for (const file of v5Paths.slice(1)) {
    const call = json(file).calls[0], denied = JSON.stringify(call.permissionDenials ?? []);
    for (const marker of ['canary-r9', 'out\\\\put', 'canary-r29', 'canary-r30']) assert(!denied.includes(marker), `${file}: ${marker} is in permissionDenials, so the record's layer attribution is wrong`);
    assert(denied.includes('escape-r31'), `${file}: R31 is not refused by the permission rules`);
    assert(call.result.includes("could not open '../escape-r21.txt' for writing: Operation not permitted"), `${file}: R21 was not stopped by the sandbox`);
  }
  assert.equal(ofRecord.pins.clientVersion, clientVersion);
  for (const file of [...fencePaths, ...v3Paths]) {
    const call = json(file).calls[0], m = call.matrix;
    assert(Object.values(m.rows).every(row => !row.leaked && !row.wroteOutside), `${file}: a secret or a file got out`);
    assert(Object.values(m.controls).every(c => c.worked), `${file}: a control failed, so the fence was not usable`);
    for (const quote of ['the permissions.blockReadsOutsideWorkingDirectories setting blocks reads outside the working directories', 'No files found', 'outside repository']) assert(call.result.includes(quote), `${file}: "${quote}" is not in the run's output`);
  }
  const scrub = json(scrubPath);
  for (const entry of scrub.files) assert.equal(sha256(readFileSync(join(root, dir, entry.path))), entry.scrubbedSha256, `${entry.path} is not the scrubbed record scrubbed-records.json names`);
}

export function checkAmendment02(root = '.') {
  const read = file => readFileSync(join(root, file));
  assert.equal(sha256(read(preregPath)), preregSha256, `${preregPath} is not the published pre-registration`);
  assert.equal(sha256(read(amendment01Path)), amendment01Sha256, `${amendment01Path} is not the published amendment 01`);
  assert.equal(read(amendment01PinPath).toString('utf8').split(/\s+/)[0], amendment01Sha256, `${amendment01PinPath} is not amendment 01's published sha256`);
  const bytes = read(amendment02Path);
  const pinned = existsSync(join(root, amendment02PinPath)) ? read(amendment02PinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${amendment02Path} differs from the sha256 pinned in ${amendment02PinPath}: review the change, then node scripts/jev-gate-amendment-02.mjs --pin`);
  const record = validateAmendment02(JSON.parse(bytes), { prereg: JSON.parse(read(preregPath)), amendment01: JSON.parse(read(amendment01Path)) });
  assert.deepEqual(record, derive02(record, root), 'Amendment 02 differs from its run records: run node scripts/jev-gate-amendment-02.mjs --write, review the diff, then --check');
  assertEvidence02(record, root);
  return { record, sha256: sha256(bytes), bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const context = { prereg: JSON.parse(readFileSync(preregPath, 'utf8')), amendment01: JSON.parse(readFileSync(amendment01Path, 'utf8')) };
  if (command === '--write') {
    const next = validateAmendment02(derive02(JSON.parse(readFileSync(amendment02Path, 'utf8'))), context);
    writeFileSync(amendment02Path, JSON.stringify(next, null, 2) + '\n');
    console.log(`Re-derived ${amendment02Path} (sha256 ${sha256(readFileSync(amendment02Path))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateAmendment02(JSON.parse(readFileSync(amendment02Path, 'utf8')), context);
    writeFileSync(amendment02PinPath, `${sha256(readFileSync(amendment02Path))}  amendment-02.json\n`);
    console.log(`Pinned ${amendment02Path} in ${amendment02PinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/jev-gate-amendment-02.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment02();
  console.log(`PASS ${amendment02Path} sha256 ${digest} (amendment 01 ${amendment01Sha256}, pre-registration ${preregSha256})`);
}
