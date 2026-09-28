// Validates EXP 005 amendment 01, the dated record that re-pins the LLM reviewer to nina 0.34.0 and
// pre-registers the spotlight bar. It names its parent by sha256; the parent stays byte-identical.
// Every probe-derived field (the files nina writes, the base sha, the prompt hook's text) is read from
// the committed probe record and must equal what the amendment states.
//   node scripts/jev-gate-amendment.mjs --check   validate; print the record's sha256
//   node scripts/jev-gate-amendment.mjs --write   re-derive the probe- and disk-derived fields
//   node scripts/jev-gate-amendment.mjs --pin     after review, pin the record's sha256 in amendment-01.sha256
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, ninaAttribution, percent, sha256, recordPath as parentPath, pinPath as parentPinPath } from './jev-gate-prereg.mjs';

const dir = 'experiments/jev-gate';
export const amendmentPath = `${dir}/amendment-01.json`;
export const amendmentPinPath = `${dir}/amendment-01.sha256`;
export const publishedPath = 'site/data/jev-gate/amendment-01.json';
export const probePath = `${dir}/nina-probe-0.34.0.json`;
// The published parent, hard-coded: a different parent on disk is refused, whatever its own pin says.
export const publishedParentSha256 = '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a';
export const nina = {
  package: '@xhulz/nina', release: '0.34.0', previousRelease: '0.28.10',
  commit: 'be546e32ce30acb2a18ec9b55ff4a3b23a7b4890', repoTree: 'a3b25852cd8616947f5a66153b1a25b1fa8a566d', releaseTree: 'b11435f6064634ea00693b7bde844dc263b91327',
  tarball: { url: 'https://registry.npmjs.org/@xhulz/nina/-/nina-0.34.0.tgz', integrity: 'sha512-M/Vtu9DGe931tYBA+jJ60LtSiFGnu0y7fNBUYZEIXbMbji70aBVRvleOTpq6N8MceW0lXbeIvkDA94QM91fUjg==' },
};
export const initArgv = ['init', '--project', '.', '--core', nina.release, '--surfaces', '', '--no-ask'];
export const composeArgv = ['compose', '--project', '.'];
export const baseIdentity = { GIT_AUTHOR_NAME: 'base', GIT_AUTHOR_EMAIL: 'base@example.invalid', GIT_COMMITTER_NAME: 'base', GIT_COMMITTER_EMAIL: 'base@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
export const baseGitConfig = ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
// The founder's answers of 2026-09-28, verbatim.
export const founderAnswers = ['"Pre-registered bar (Recommended)"', '"Amend to 0.34.0 (Recommended)"', '"Open autonomously"'];
// The four spotlight criteria, exactly: a record may not drop, rename or re-aim one. Thresholds stay in the record.
export const spotlightShapes = {
  'missed-drift': { metric: 'missedDrift', level: 'run', refutedWhen: 'greater-than', bound: '≤', n: s => s.redItems * s.k },
  'false-reject': { metric: 'falseReject', level: 'run', refutedWhen: 'greater-than', bound: '≤', n: s => s.greenItems * s.k },
  'self-agreement': { metric: 'selfAgreement', level: 'change', refutedWhen: 'less-than', bound: '≥', n: s => s.items },
  'zero-patches': { metric: 'harnessFailureRate', level: 'run', refutedWhen: 'patched-or-greater-than', bound: '≤', n: s => s.items * s.k },
};
export const hookLimitPrefix = "Every reviewer run receives this text from nina's UserPromptSubmit hook, before its prompt, on the clean base and on a change alike (quoted verbatim from the probe):";
export const hookLimit = text => `${hookLimitPrefix} ${text}`;
// Files the amendment's verdict and its pages depend on. The record may pin more, never fewer.
export const priorCallsPath = `${dir}/prior-calls/2026-09-28-accidental-reviewer-runs.json`;
export const requiredFiles = [priorCallsPath, probePath, `${dir}/nina-probe.mjs`, `${dir}/probe/practice-probe.patch`, 'scripts/jev-gate-amendment.mjs', 'scripts/jev-gate-amendment-note.mjs'];

const hex = /^[a-f0-9]{64}$/, sha1 = /^[a-f0-9]{40}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(str);
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fraction = v => typeof v === 'number' && v > 0 && v < 1;
const pos = v => Number.isInteger(v) && v > 0;
const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

export const required = {
  schemaVersion: v => v === 1, kind: v => v === 'amendment', id: v => v === 'amendment-01', title: str,
  'parent.file': v => v === 'preregistration.json', 'parent.sha256': v => v === publishedParentSha256, 'parent.published': str,
  date, statusText: str, 'reason.summary': str, 'reason.founder': strings, 'reason.founderDate': date, 'reason.paidCallsSoFar': v => str(v) && /G2/.test(v) && /not a corpus item/.test(v),
  notBefore: v => str(v) && /merge/i.test(v) && /notBefore/.test(v),
  'changes.reviewer.replaces': str, 'changes.reviewer.nina': v => JSON.stringify(v && { ...v, verification: undefined }) === JSON.stringify({ ...nina, verification: undefined }), 'changes.reviewer.nina.verification': str,
  'changes.reviewer.reportFormat': v => str(v) && v.includes('VERDICT: APPROVED') && /Gates/.test(v),
  'changes.reviewer.toolRestrictionInteraction': v => str(v) && v.includes('pnpm harness:check'),
  'changes.reviewer.install.commands': v => strings(v) && v.some(c => c.startsWith('tar -xzf')) && v.includes('ln -s ../@xhulz/nina/bin/nina.mjs node_modules/.bin/nina'),
  'changes.reviewer.install.assert': str, 'changes.reviewer.install.rule': str,
  'changes.reviewer.workspace.description': str,
  'changes.reviewer.workspace.init': v => JSON.stringify(v) === JSON.stringify(initArgv), 'changes.reviewer.workspace.initCommand': v => str(v) && v.includes("--surfaces '' --no-ask"),
  'changes.reviewer.workspace.compose': v => JSON.stringify(v) === JSON.stringify(composeArgv), 'changes.reviewer.workspace.wire': str,
  'changes.reviewer.workspace.vocabulary': v => v === null || (obj(v) && Object.values(v).every(x => typeof x === 'string')), 'changes.reviewer.workspace.vocabularyRule': str,
  'changes.reviewer.workspace.fragments': v => obj(v) && Object.entries(v).every(([k, x]) => k.startsWith('.nina/') && typeof x === 'string'), 'changes.reviewer.workspace.fragmentsRule': str,
  'changes.reviewer.workspace.patchRule': v => str(v) && /patch/.test(v) && /zero-patches/.test(v),
  'changes.reviewer.workspace.gitignore': v => v === 'node_modules/\n',
  'changes.reviewer.workspace.files': strings, 'changes.reviewer.workspace.packageJsonScripts': v => obj(v) && Object.keys(v).length > 0,
  'changes.reviewer.workspace.order': v => strings(v) && v.length === 11,
  'changes.reviewer.workspace.baseCommit.env': v => JSON.stringify(v) === JSON.stringify(baseIdentity),
  'changes.reviewer.workspace.baseCommit.gitConfig': v => JSON.stringify(v) === JSON.stringify(baseGitConfig),
  'changes.reviewer.workspace.baseCommit.message': v => v === 'base', 'changes.reviewer.workspace.baseCommit.sha': v => sha1.test(v), 'changes.reviewer.workspace.baseCommit.rule': str,
  'changes.reviewer.workspace.ninaData': v => str(v) && v.includes('NINA_DATA'),
  'changes.reviewer.hooks.declared': str, 'changes.reviewer.hooks.commandsOutsideAllowedTools': v => str(v) && /canary/.test(v),
  'changes.reviewer.hooks.promptContextOnCleanBase': v => typeof v === 'string', 'changes.reviewer.hooks.promptContextEmpty': v => typeof v === 'boolean',
  'changes.reviewer.hooks.promptContextSameOnPracticeDiff': v => typeof v === 'boolean', 'changes.reviewer.hooks.rule': str, 'changes.reviewer.hooks.errors': str,
  'changes.reviewer.billing': v => str(v) && v.includes('src/commands/eval.mjs'),
  'changes.reviewer.probe.file': v => v === probePath, 'changes.reviewer.probe.script': v => v === `${dir}/nina-probe.mjs`, 'changes.reviewer.probe.summary': str,
  'changes.spotlight.appliesTo': str, 'changes.spotlight.k': pos, 'changes.spotlight.items': pos, 'changes.spotlight.redItems': pos, 'changes.spotlight.greenItems': pos, 'changes.spotlight.countedRuns': pos,
  'changes.spotlight.rule': v => str(v) && /partial run/i.test(v) && /no spotlight/.test(v) && /neutrally/.test(v),
  'changes.spotlight.criteria': v => Array.isArray(v) && v.length === Object.keys(spotlightShapes).length,
  'changes.spotlight.supersedes': str, 'changes.spotlight.judging': v => str(v) && /Wilson/.test(v) && /item-level/.test(v) && /refuted/.test(v),
  'changes.spotlight.labelPhrase': v => str(v) && v.includes('passes, not established at this N'), 'changes.spotlight.thresholdSource': str,
  'priorCalls.statement': v => str(v) && /No prior call is counted in any result/.test(v), 'priorCalls.plainly': str, 'priorCalls.cause': str, 'priorCalls.criteriaTiming': str,
  'priorCalls.evidence.file': v => v === priorCallsPath, 'priorCalls.evidence.sha256': v => hex.test(v), 'priorCalls.evidence.note': str,
  'priorCalls.calls': v => Array.isArray(v) && v.length > 0 && v.every(c => str(c.id) && str(c.gate) && str(c.release)),
  'spend.alreadySpentUsd': v => typeof v === 'number' && v > 0, 'spend.supersedes': str, 'spend.sum': str, 'spend.reason': str,
  unchanged: strings, limits: strings,
  'attribution.nina': v => v === ninaAttribution, 'attribution.ninaUrl': v => v === 'https://github.com/xhulz/nina',
  files: v => obj(v) && Object.values(v).every(h => hex.test(h)),
  sources: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.label) && str(s.url) && s.url.startsWith('https://') && str(s.claim)),
};
const criterionFields = { id: str, metric: str, level: str, numerator: str, denominator: str, n: pos, refutedWhen: str, statement: str };

export function validateAmendment(record, parent) {
  assert(obj(record), 'The amendment must be a JSON object');
  for (const [path, check] of Object.entries(required)) assert(check(get(record, path)), `Amendment field ${path} is missing or invalid`);
  for (const answer of founderAnswers) assert(record.reason.founder.some(line => line.endsWith(answer)), `The founder's answer ${answer} must be quoted verbatim`);
  for (const file of requiredFiles) assert(file in record.files, `The amendment does not pin ${file}`);
  const s = record.changes.spotlight;
  assert.equal(s.k % 2, 1, 'k must be odd so that a majority exists');
  assert.equal(s.items, s.redItems + s.greenItems, 'Spotlight item counts do not add up');
  assert.equal(s.countedRuns, s.items * s.k, 'countedRuns must be every item times k');
  if (parent) {
    assert.equal(s.k, parent.gates.reviewer.k, 'The spotlight k differs from the parent reviewer k');
    assert.deepEqual([s.items, s.redItems, s.greenItems], [parent.corpus.items, parent.corpus.groundTruthRed, parent.corpus.groundTruthGreen], 'The spotlight is over the full parent corpus');
  }
  assert.deepEqual(s.criteria.map(c => c.id), Object.keys(spotlightShapes), 'The spotlight criteria are exactly missed-drift, false-reject, self-agreement, zero-patches, in that order');
  for (const c of s.criteria) {
    for (const [key, check] of Object.entries(criterionFields)) assert(check(c[key]), `Spotlight criterion ${c.id} field ${key} is missing or invalid`);
    const shape = spotlightShapes[c.id];
    for (const key of ['metric', 'level', 'refutedWhen']) assert.equal(c[key], shape[key], `Spotlight criterion ${c.id} ${key} must be ${shape[key]}`);
    assert.equal(c.n, shape.n(s), `Spotlight criterion ${c.id} n disagrees with the counts`);
    assert(c.denominator.includes(String(c.n)), `Spotlight criterion ${c.id} denominator must state n = ${c.n}`);
    const threshold = c.id === 'zero-patches' ? c.harnessFailureMax : c.threshold;
    assert(fraction(threshold), `Spotlight criterion ${c.id} needs a threshold`);
    assert(c.statement.includes(`${shape.bound} ${percent(threshold)}`), `Spotlight criterion ${c.id} statement disagrees with its threshold`);
    if (c.id === 'zero-patches') assert(str(c.harnessFailure) && /abstention/.test(c.harnessFailure) && !('threshold' in c), 'zero-patches defines harness failure and carries only harnessFailureMax');
    else assert(!('harnessFailureMax' in c), `Spotlight criterion ${c.id} carries a threshold, not harnessFailureMax`);
  }
  const p = record.priorCalls;
  assert.equal(p.calls[0].id, 'G2', 'The G2 planning check comes first in priorCalls');
  if (parent) assert.equal(p.calls[0].costUsd, parent.spendCap.alreadySpentUsd, 'G2 costs what the parent already counted');
  const charged = c => c.costUsd ?? c.costCharged;
  for (const c of p.calls) {
    assert(typeof charged(c) === 'number' && charged(c) > 0, `Prior call ${c.id} must charge a cost, never 0 or nothing`);
    if (c.costUsd === null) assert(str(c.costChargedRule), `Prior call ${c.id} has no recorded cost, so it states how it is charged`);
  }
  assert.equal(Math.round(p.calls.reduce((sum, c) => sum + charged(c), 0) * 1e7), Math.round(record.spend.alreadySpentUsd * 1e7), 'spend.alreadySpentUsd is not the sum of the prior calls');
  if (parent) assert(record.spend.alreadySpentUsd > parent.spendCap.alreadySpentUsd, 'The amount already spent only grows');
  const hooks = record.changes.reviewer.hooks;
  assert.equal(hooks.promptContextEmpty, hooks.promptContextOnCleanBase === '', 'promptContextEmpty disagrees with the recorded text');
  if (!hooks.promptContextEmpty) assert(record.limits.includes(hookLimit(hooks.promptContextOnCleanBase)), 'A non-empty prompt-hook context must be quoted verbatim in limits');
  const text = JSON.stringify(record);
  assert(!/Recorded experiment/i.test(text), 'An amendment never calls itself a recorded experiment');
  assert(!/\/Users\/|\/private\/|\/home\/[^\s"]+|\/var\/folders/.test(text), 'Private local paths in the amendment');
  return record;
}

// Everything in the amendment that is a fact about the probe record or the files on disk, recomputed.
export function derive(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const next = structuredClone(record);
  for (const file of Object.keys(next.files)) next.files[file] = sha256(read(file));
  const probe = JSON.parse(read(probePath));
  const w = probe.workspaces.a, step = n => w.steps.find(s => s.step === n);
  const r = next.changes.reviewer;
  r.workspace.files = [...step(3).written.added, ...step(3).written.changed, ...step(5).written.added, ...step(5).written.changed].sort();
  r.workspace.packageJsonScripts = step(3).packageJsonDelta;
  r.workspace.baseCommit.sha = probe.baseSha;
  const context = list => list.filter(v => v !== null).join('\n');
  r.hooks.promptContextOnCleanBase = context(probe.promptHookContextOnCleanBase);
  r.hooks.promptContextEmpty = r.hooks.promptContextOnCleanBase === '';
  r.hooks.promptContextSameOnPracticeDiff = context(probe.promptHookContextOnPracticeDiff) === r.hooks.promptContextOnCleanBase;
  next.priorCalls.evidence.sha256 = sha256(read(priorCallsPath));
  r.probe.summary = `Run ${probe.date}: nina ${probe.pin.version} composed from the unmodified tarball in two fresh workspaces, with no patch and no manual answer (zeroPatch ${probe.zeroPatch}); both base commits are ${probe.baseSha}; the package's releases/${probe.pin.version} tree is ${step(2).releaseTree}. No model was called.`;
  next.limits = next.limits.filter(l => !l.startsWith(hookLimitPrefix));
  if (!r.hooks.promptContextEmpty) next.limits.splice(1, 0, hookLimit(r.hooks.promptContextOnCleanBase));
  return next;
}

// The probe record must say what the amendment relies on: zero patches, one base sha, the pinned package.
export function assertProbe(record, root = '.') {
  const probe = JSON.parse(readFileSync(join(root, probePath), 'utf8'));
  assert.equal(probe.zeroPatch, true, 'The probe needed a patch');
  assert.deepEqual(probe.patchesNeeded, [], 'The probe needed a patch');
  assert.deepEqual(probe.manualAnswers, [], 'The probe needed a manual answer');
  assert.equal(probe.baseShaIdenticalAcrossWorkspaces, true, 'The probe base sha differs between workspaces');
  assert.equal(probe.promptHookContextIdenticalAcrossWorkspaces, true, 'The prompt hook context differs between workspaces');
  assert.equal(probe.tarball.integrity, nina.tarball.integrity);
  assert.equal(probe.tarball.url, nina.tarball.url);
  for (const key of ['commit', 'repoTree', 'releaseTree']) assert.equal(probe.pin[key], nina[key], `The probe pinned a different ${key}`);
  assert.equal(probe.pin.version, nina.release);
  for (const w of Object.values(probe.workspaces)) {
    const step = n => w.steps.find(s => s.step === n);
    assert.equal(step(2).releaseTreeMatchesPin, true, 'The installed release tree differs from the pin');
    assert.equal(step(2).packageInstalled, true);
    assert.deepEqual(step(3).profile.surfaces, []);
    assert.equal(step(3).commands[0].command, `node_modules/.bin/nina ${initArgv.map(a => (a === '' ? "''" : a)).join(' ')}`, 'The probe ran a different init');
    assert.equal(step(5).commands[0].command, `node_modules/.bin/nina ${composeArgv.join(' ')}`, 'The probe ran a different compose');
    for (const n of [3, 5]) assert.equal(step(n).commands[0].exitCode, 0, `Probe step ${n} failed`);
    assert.equal(step(8).baseSha, record.changes.reviewer.workspace.baseCommit.sha);
  }
}

// The prior reviewer runs listed in the amendment are exactly the completed runs in their committed record,
// and a run with no recorded cost is charged the largest cost seen.
export function assertPriorCalls(record, root = '.') {
  const evidence = JSON.parse(readFileSync(join(root, priorCallsPath), 'utf8'));
  const listed = record.priorCalls.calls.filter(c => c.item && c.costUsd !== null);
  const recorded = evidence.calls.map(c => ({ item: c.id, run: c.run, startedAt: c.startedAt, endedAt: c.endedAt, verdict: c.verdictLine ?? null, costUsd: c.costUsd }));
  assert.deepEqual(listed.map(c => ({ item: c.item, run: c.run, startedAt: c.startedAt, endedAt: c.endedAt, verdict: c.verdict, costUsd: c.costUsd })), recorded, 'priorCalls disagrees with the committed record of the runs');
  const labels = JSON.parse(readFileSync(join(root, dir, 'labels.json'), 'utf8'));
  for (const c of record.priorCalls.calls.filter(c => c.item)) assert.equal(c.label, labels.items.find(i => i.id === c.item)?.label, `Prior call ${c.id} states the wrong label`);
  const largest = Math.max(...recorded.map(c => c.costUsd));
  for (const c of record.priorCalls.calls.filter(c => c.item && c.costUsd === null)) assert.equal(c.costCharged, largest, `Prior call ${c.id} must be charged the largest single run seen`);
}

export function checkAmendment(root = '.') {
  const read = file => readFileSync(join(root, file));
  const parentBytes = read(parentPath);
  assert.equal(sha256(parentBytes), publishedParentSha256, `${parentPath} is not the published parent`);
  assert.equal(read(parentPinPath).toString('utf8').split(/\s+/)[0], publishedParentSha256, `${parentPinPath} is not the published parent's sha256`);
  const bytes = read(amendmentPath);
  const pinned = existsSync(join(root, amendmentPinPath)) ? read(amendmentPinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${amendmentPath} differs from the sha256 pinned in ${amendmentPinPath}: review the change, then node scripts/jev-gate-amendment.mjs --pin`);
  const record = validateAmendment(JSON.parse(bytes), JSON.parse(parentBytes));
  assert.deepEqual(record, derive(record, root), 'The amendment differs from the probe record or the files on disk: run node scripts/jev-gate-amendment.mjs --write, review the diff, then --check');
  assertProbe(record, root);
  assertPriorCalls(record, root);
  return { record, sha256: sha256(bytes), bytes };
}

export const loadAmendment = (root = '.') => checkAmendment(root).record;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const parent = JSON.parse(readFileSync(parentPath, 'utf8'));
  if (command === '--write') {
    const next = validateAmendment(derive(JSON.parse(readFileSync(amendmentPath, 'utf8'))), parent);
    writeFileSync(amendmentPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Re-derived ${amendmentPath} (sha256 ${sha256(readFileSync(amendmentPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateAmendment(JSON.parse(readFileSync(amendmentPath, 'utf8')), parent);
    writeFileSync(amendmentPinPath, `${sha256(readFileSync(amendmentPath))}  amendment-01.json\n`);
    console.log(`Pinned ${amendmentPath} in ${amendmentPinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/jev-gate-amendment.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment();
  console.log(`PASS ${amendmentPath} sha256 ${digest} (parent ${publishedParentSha256})`);
}
