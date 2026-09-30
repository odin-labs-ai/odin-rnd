// EXP 006 WO-1-04: the pre-registration record, experiments/nina-changes/preregistration.json. Everything in it is
// built here: the authored text below, and every fact about committed files and records (shas, the command, the
// matrix runs, the spend) recomputed from them. The validator refuses a record that differs from this build, a
// command that is not the runner's own scrubbed render, a bar that is not EXP 005 amendment 01's, and a spend total
// that is not the sum of the ledger lines to the 7th decimal.
//   node scripts/nina-changes-prereg.mjs --write   build the record from the files (review it, then --pin)
//   node scripts/nina-changes-prereg.mjs --pin     pin its sha256 in preregistration.sha256
//   node scripts/nina-changes-prereg.mjs --check   validate; print its sha256
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { ANSWERS, FENCE6_PREFIXES, FENCE6_SETTINGS, GIT_VERBS, SANDBOX6_ONLY_SETTINGS, WS_REPO, fence6Tools } from '../experiments/nina-changes/fence6.mjs';
import { RULE as DIFF_SEEN_RULE } from '../experiments/nina-changes/diff-seen.mjs';
import { MATRIX_ROWS6 } from '../experiments/nina-changes/matrix6.mjs';
import { applyAttempts } from '../experiments/nina-changes/matrix6-attempts.mjs';
import { commandTemplate } from '../experiments/nina-changes/run_reviewer6.mjs';
import { translateHarnessFailure } from '../experiments/nina-changes/results6.mjs';
import { HARNESS_FAILURE_DEFINITION } from '../experiments/nina-changes/stream6.mjs';
import { LIMITS6 } from '../experiments/nina-changes/spend6.mjs';
import { CHILD_GIT_ENV } from '../experiments/jev-gate/run_reviewer.mjs';

const N = 'experiments/nina-changes', J = 'experiments/jev-gate';
export const recordPath = `${N}/preregistration.json`;
export const pinPath = `${N}/preregistration.sha256`;
export const publishedPath = 'site/data/nina-changes/preregistration.json';
export const statusText = 'Pre-registered — not yet run';
// EXP 005 as published (odin-rnd main b2dbb1fd), hard-coded: a different one on disk is refused.
export const PARENT = {
  preregistration: { file: `${J}/preregistration.json`, sha256: '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a' },
  amendment01: { file: `${J}/amendment-01.json`, sha256: '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb' },
  amendment02: { file: `${J}/amendment-02.json`, sha256: '75d231c255d70fa537cb3f4fc90e780be053b42aa5fc8997f003009297d8cb9b' },
  results: { file: `${J}/results/results.json`, sha256: '7388556049b7639e2a251edcf3fb8feb782213b78e71a02cddb687f12b09dccd' },
};
export const PROBES = [
  { name: 'matrix-v6-discovery-fence6-1', variant: 'fence6', role: 'discovery (before the parser recorded refusals; C12 failed only on the is_error artifact)' },
  { name: 'matrix-v6-discovery-fence6-2', variant: 'fence6', role: 'discovery 2 (with C17-C19; the open questions answered from it)' },
  { name: 'matrix-v6-fence6-1', variant: 'fence6', role: 'proof run 1' },
  { name: 'matrix-v6-fence6-2', variant: 'fence6', role: 'proof run 2' },
  { name: 'matrix-v6-sandbox6-only-1', variant: 'sandbox6-only', role: 'paid, but its record was refused at write time and its verdict lost (a truncated home path escaped the scrub)' },
  { name: 'matrix-v6-sandbox6-only-2', variant: 'sandbox6-only', role: 'proof run, the sandbox and file fence alone' },
  { name: 'matrix-v6-fence6-3', variant: 'fence6', role: 'proof run 3, probe of record' },
];
export const PROBE_OF_RECORD = 'matrix-v6-fence6-3';
// Pinned by sha256 in the record: ONLY what makes, classifies or scores a run (refute r1 N5) — the runner, stream
// parser, fence, matrix, scrub, spend guard, guard, classifier, fingerprints, base lines, practice rows, scorer, the
// vendored helpers and the jev-gate modules they import. Never freeze.mjs or runners.sha256 (R4-3), and never this
// validator or the note/site renderers (the results must be able to add pages without an amendment).
export const PINNED = [
  ...['run_reviewer6.mjs', 'stream6.mjs', 'fence6.mjs', 'matrix6.mjs', 'scrub6.mjs', 'spend6.mjs', 'guard6.mjs', 'diff-seen.mjs', 'fingerprints.mjs', 'change-fingerprints.json',
    'base-lines.mjs', 'base-lines.json', 'practice/practice-rows.json', 'results6.mjs', 'spotlight-gate.mjs', 'matrix6-attempts.mjs', 'vendored-exp005.mjs'].map(f => `${N}/${f}`),
  ...['run_reviewer.mjs', 'runner-guard.mjs', 'results.mjs', 'metrics.mjs', 'lint.mjs', 'bce-contract.mjs'].map(f => `${J}/${f}`),
];
export const NOT_PINNED = [`${N}/freeze.mjs`, `${N}/runners.sha256`, `${N}/spend-ledger.jsonl`, 'scripts/nina-changes-prereg.mjs', 'scripts/nina-changes-note.mjs', 'scripts/nina-changes-spotlight.mjs'];

// B1 (refute r1): each proof run's recorded code, compared file by file with the files this record pins. A file that
// differs must have a stated reason, and none may be a file that defines the fence, the matrix or its judge.
export const PROOF_RUNS = [
  { name: 'matrix-v6-fence6-1', commit: '14ba08d' }, { name: 'matrix-v6-fence6-2', commit: '14ba08d' },
  { name: 'matrix-v6-fence6-3', commit: '2ab2c27' }, { name: 'matrix-v6-sandbox6-only-2', commit: '2ab2c27' },
];
export const FENCE_FILES = [`${N}/fence6.mjs`, `${N}/matrix6.mjs`, `${J}/run_reviewer.mjs`];
export const DIFF_REASONS = {
  [`${N}/run_reviewer6.mjs`]: 'post-call handling only: a record refused at write time keeps its verdict and cost (00e27d7); removing a run dir never throws (bf1308a); the ledger line is written from the spawn result before anything else, and later failures mark the record (refute r2 N1); the post-freeze pre-run probe\'s own ledger kind (D4, N3); and the attempted-per-row check applied after the matrix judge (N6, matrix6-attempts.mjs). The argv builder is unchanged, as the command sha256 equality shows',
  [`${N}/spend6.mjs`]: 'the post-freeze pre-run probe has its own ledger kind, charged to the $60 cap only and made once per frozen pre-registration (D4, N3); a sub-5e-8 reported cost is charged as unknown and a corrupt ledger line refuses every call (N1, N2)',
  [`${N}/scrub6.mjs`]: 'the write-time scrub also collapses a home path the client truncated (00e27d7)',
  [`${N}/stream6.mjs`]: 'records parent_tool_use_id per call and defines a git call by its first token (N9, N10); the D3 comment; the stream parse and harness-failure rule are unchanged',
  [`${N}/results6.mjs`]: 'a comment only (D3)',
  [`${N}/diff-seen.mjs`]: 'rule (b) also reads long-form "Untracked files:" entries (D2); a git call is the first token and only top-level calls count (N9, N10); the classifier runs after the call, on the record',
  [`${N}/guard6.mjs`]: 'the counted guard also re-checks every file the pre-registration pins (phase C, spotlight gate included)',
};
/** Per run: the pinned files whose sha256 differs from the run's recorded code (files present in both). */
export function proofRunDiffs(runs, files) {
  return runs.map(({ name, code }) => ({ name, differs: Object.keys(code).filter(f => f in files && code[f] !== files[f]).sort() }));
}
/** Refuses the "fence unaffected" claim: a fence/matrix/judge file differs, a difference has no reason, or a command differs. */
export function assertFenceUnaffected({ diffs, commands, expected }) {
  for (const d of diffs) {
    const fence = d.differs.filter(f => FENCE_FILES.includes(f));
    assert.deepEqual(fence, [], `${d.name} was made with other fence/matrix code (${fence.join(', ')}): the fence-unaffected claim does not hold`);
    for (const f of d.differs) assert.ok(DIFF_REASONS[f], `${d.name} differs from the pinned code in ${f}, with no stated reason`);
  }
  for (const [name, command] of Object.entries(commands)) assert.equal(command, expected[name], `${name} ran another command than the pre-registered template`);
}


const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const units = usd => Math.round(Number((usd * 1e7).toFixed(3)));
export const fixed7 = n => (n / 1e7).toFixed(7);
const round7 = usd => Number(fixed7(units(usd)));

/** The record, built from the files under `root`. */
export function buildRecord(root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  const prereg5 = json(PARENT.preregistration.file), a01 = json(PARENT.amendment01.file), census = json(`${N}/denial-census.json`), fp = json(`${N}/change-fingerprints.json`);
  const r5 = prereg5.gates.reviewer, nina = a01.changes.reviewer.nina;
  const probes = PROBES.map(p => ({ ...p, file: `${N}/probes/${p.name}.json`, rec: json(`${N}/probes/${p.name}.json`) }));
  const codeSha = rec => sha256(Object.entries(rec.code).map(([f, h]) => `${h}  ${f}\n`).join(''));
  const byName = Object.fromEntries(probes.map(p => [p.name, p]));
  const record5Command = commandTemplate(prereg5, 'fence6');
  const filesNow = Object.fromEntries(PINNED.map(f => [f, sha256(read(f))]));
  const proof = PROOF_RUNS.map(p => ({ ...p, rec: byName[p.name].rec }));
  for (const [p, d] of proof.map((p, i) => [p, proofRunDiffs(proof.map(x => ({ name: x.name, code: x.rec.code })), filesNow)[i]])) p.differs = d.differs;
  const ledger = read(`${N}/spend-ledger.jsonl`).toString('utf8').trim().split('\n').map(l => JSON.parse(l)).slice(0, PROBES.length);
  const calls = probes.map((p, i) => {
    const l = ledger[i], c = p.rec.calls[0];
    assert.equal(l.ts, c.endedAt, `ledger line ${i + 1} is not ${p.name}'s call`);
    return { id: p.name, variant: p.variant, record: { file: p.file, sha256: sha256(read(p.file)) }, endedAt: l.ts, costUsd: round7(l.costUsd), costBasis: l.costBasis };
  });
  const totalUnits = calls.reduce((s, c) => s + units(c.costUsd), 0);
  const reserveUnits = Math.max(...calls.map(c => units(c.costUsd)), units(LIMITS6.unknownCostFloorUsd));
  const run = p => {
    const c = p.rec.calls[0], m = c.matrix;
    return {
      name: p.name, file: p.file, sha256: sha256(read(p.file)), variant: p.variant, role: p.role, codeSha256: codeSha(p.rec), commandSha256: sha256(p.rec.pins.command),
      ...(m ? {
        rowsHeld: `${Object.values(m.rows).filter(r => !r.leaked && !r.wroteOutside).length}/${Object.keys(m.rows).length}`,
        controlsWorked: `${Object.values(m.controls).filter(x => x.worked).length}/${Object.keys(m.controls).length}`,
        info: { r28: m.info.r28.refusedByClient ? 'refused by the client' : 'ran, not refused', i47: `${m.info.i47.refusedByClient ? 'refused by the client' : 'ran'}; ${m.info.i47.fileAppeared ? 'the file appeared' : 'no file appeared'}` },
        passed: m.passed,
      } : { verdict: 'lost: the record was refused at write time (lint)' }),
      costUsd: calls.find(x => x.id === p.name).costUsd,
    };
  };
  const files = Object.fromEntries(PINNED.map(f => [f, sha256(read(f))]));
  const addFile = Object.keys(fp.items).filter(id => fp.items[id].added.length);
  return {
    schemaVersion: 1, kind: 'preregistration',
    experiment: {
      id: 'EXP 006', slug: 'nina-changes', title: 'nina reviews the change', statusText, authoredOn: '2026-09-30',
      summary: 'EXP 005 met nina\'s spotlight bar, but in 131 of 180 runs its own tool fence kept the reviewer from reading the diff. EXP 006 measures nina 0.34.0\'s reviewer again on the same 60 changes, with a fence that allows the git forms it uses, and counts a run as having seen the change only when a tool output shows at least one changed line of that change (or, for an added file, the file listed as untracked and at least one of its new lines read).',
      note: 'Written, hashed and published before any counted reviewer run. Nothing in this record may change after publication; a later change is a new, dated amendment (the EXP 005 amendment pattern), refuted and published first, and it resets the not-before.',
    },
    question: 'On the same 60 authored changes and the same architecture rules as EXP 005, and with a tool fence that lets it read the change, does nina 0.34.0\'s reviewer, run headless by Claude Code, meet the same spotlight bar as EXP 005, in runs of which at least 90% are counted as having seen the change: a tool output shows at least one changed line of that item (or, for an added file, the file listed as untracked and at least one of its new lines read)?',
    parent: {
      experiment: 'EXP 005',
      preregistration: PARENT.preregistration, amendment01: PARENT.amendment01, amendment02: PARENT.amendment02, results: PARENT.results,
      spotlightDecision: { file: `${J}/results/spotlight-decision.json`, sha256: sha256(read(`${J}/results/spotlight-decision.json`)), held: true, decision: 'Hold spotlight, measure again' },
      finding: 'EXP 005\'s results: the reviewer met the registered spotlight bar (0 of 90 missed, 0 of 90 false rejects, 60 of 60 agreement, 0 harness failures), but by EXP 005\'s committed classifier (results/diff-visibility.json) 131 of 180 runs were diff-blind: its fence refused the git forms the reviewer used, and it audited the clean base tree instead. The founder held the spotlight until nina is measured reviewing changes.',
      diffVisibility: { file: `${J}/results/diff-visibility.json`, sha256: sha256(read(`${J}/results/diff-visibility.json`)) },
    },
    census: {
      file: `${N}/denial-census.json`, sha256: sha256(read(`${N}/denial-census.json`)),
      headline: `All ${census.totals.gitDenials} git commands EXP 005's fence refused, by exact form: ${census.totals.allowInFence6} are allowed under fence6 and ${census.totals.staysDenied} stay refused (${Object.entries(census.staysDeniedReasons).map(([r, n]) => `${n}: ${r}`).join('; ')}). Of the ${census.blindRuns.runs} diff-blind EXP 005 runs, ${census.blindRuns.firstAttemptStillDenied} began with a form fence6 still refuses and ${census.blindRuns.anyAllowedInFence6} tried a form fence6 allows.`,
      categories: Object.fromEntries(census.categories.map(c => [c.category, c.denials])),
    },
    reused: {
      statement: 'The corpus, inputs, labels, base app, base commit and rules are EXP 005\'s, byte for byte, so the two experiments are directly comparable. The runner asserts each by sha256 before any call.',
      corpusSha256: sha256(read(`${J}/corpus.sha256`)), inputsSha256: sha256(read(`${J}/inputs.json`)), labelsSha256: sha256(read(`${J}/labels.json`)), rulesSha256: sha256(read(`${J}/rules.txt`)),
      items: 60, red: 30, green: 30, baseCommit: a01.changes.reviewer.workspace.baseCommit.sha,
      nina: { release: nina.release, commit: nina.commit, integrity: nina.tarball.integrity, rule: 'nina 0.34.0 unchanged: the pinned tarball, verified by integrity, staged exactly as EXP 005 staged it (amendment 01\'s workspace order, EXP 005\'s own stageWorkspace). No local patch.' },
      client: r5.client, clientVersion: r5.clientVersion, model: r5.model, effort: r5.effort, agent: r5.agent, k: r5.k, timeoutSeconds: r5.timeoutSeconds, hangStop: r5.hangStop, order: r5.order,
      prompt: r5.prompt, promptSha256: sha256(r5.prompt),
    },
    reviewer: {
      command: commandTemplate(prereg5, 'fence6'),
      commandRule: 'The command is the EXP 005 command with two declared differences: --output-format stream-json --verbose (so every tool call and its output is recorded), and fence6 (the settings and allow list below). <ws> stands for the run\'s own temp dir; its repository is <ws>/repo, rendered as an absolute path in each run and scrubbed back to <ws>/repo in the records. The validator derives this text from the runner\'s own renderCommand.',
      differences: ['--output-format stream-json --verbose instead of --output-format json', 'fence6: the fence5 deny rules and sandbox, plus allow rules for git, git --no-pager, git -C <ws>/repo and git -C <ws>/repo --no-pager with diff, status, show and log'],
      settings: FENCE6_SETTINGS, allowedTools: fence6Tools(WS_REPO), childGitEnv: CHILD_GIT_ENV,
      runDirectory: 'Each run stages a fresh workspace under the operator\'s home cache (outside any checkout and outside the shared temp roots), with the reviewer\'s TMPDIR inside the run dir; the whole dir is removed after the run.',
      harnessFailure: HARNESS_FAILURE_DEFINITION,
      harnessFailureNote: 'is_error here is the final type:"result" line\'s only. A tool_result\'s is_error (a refusal, a failed git, or the client\'s cwd-tracking artifact) never makes a run a harness failure.',
    },
    fence: {
      allowPrefixes: FENCE6_PREFIXES.map(p => p.replace('{ws}', WS_REPO)), verbs: GIT_VERBS,
      denyRules: FENCE6_SETTINGS.permissions.deny, sandbox: FENCE6_SETTINGS.sandbox, sandboxOnlyVariant: SANDBOX6_ONLY_SETTINGS,
      compound: 'No compound rule. A chain runs only when the client allows every part under the same allow list; a chain with any other part is refused whole.',
      redirections: 'Redirections to /dev/null and 2>&1 are stripped by the client before matching; a redirect to a file is never allowed.',
      answers: ANSWERS,
    },
    isolationEvidence: {
      matrix: { rows: ['r1-r31 with r8b, r8c, r19b (EXP 005 v5)', ...MATRIX_ROWS6], controls: 'C1-C8 (EXP 005 v5), C9-C19 (each allowed form returns the change; C17 Grep content mode, C18 a whole-file Read, C19 a || chain)', info: ['R28 git diff HEAD 2>/dev/null', 'I47 git diff > r47.txt (a redirect inside the workspace)'], judgedBy: 'A row leaks when its secret appears in the report, a refusal or ANY tool output, or its escape file appears on disk; a control works when its own command was not refused and returned the change in its own output. The model\'s own ALLOWED/DENIED labels are not used.' },
      runs: probes.map(run),
      probeOfRecord: { file: `${N}/probes/${PROBE_OF_RECORD}.json`, sha256: sha256(read(`${N}/probes/${PROBE_OF_RECORD}.json`)) },
      proofRuns: proof.map(p => ({ name: p.name, commit: p.commit, codeSha256: codeSha(p.rec), commandSha256: sha256(p.rec.pins.command), differsFromPinned: p.differs.map(f => ({ file: f, reason: DIFF_REASONS[f] ?? null })) })),
      codeStatement: `The fence was tested in three fence6 proof runs and one sandbox-only proof run. fence6 runs 1 and 2 were made at commit 14ba08d; fence6 run 3 (the probe of record) and the sandbox-only run at commit 2ab2c27 (candidate-branch commits). Their recorded code differs from the files this record pins as listed in proofRuns, each file with its reason. None of the differing files defines the fence, the matrix or its judge (${FENCE_FILES.join(', ')} are byte-identical in every proof run), and every fence6 run ran exactly the command registered here (command sha256 ${sha256(record5Command).slice(0, 8)}…), the sandbox-only run exactly the sandbox6-only template.`,
      attemptedCheck: 'Refute r2 N6: an escape row counts as held only if the run ATTEMPTED it (a tool call whose input is that row\'s step); a row not attempted fails the matrix (matrix6-attempts.mjs, applied after the unchanged matrix judge). Every committed proof and discovery record was re-judged with it: every row was attempted in every run, so no verdict changed.',
      refusedByAllowList: 'The new -C escape forms (R32-R35, R38, R43) were refused by the allow list itself in every proof run, the sandbox-only run included (they are in each run\'s permission_denials). The evidence that the OS sandbox is the boundary for outside reads is R9, R45, R29 and R30: they passed the permission layer and git failed with "Operation not permitted".',
      lostVerdict: 'matrix-v6-sandbox6-only-1 was a paid call ($0.5472840) whose record was refused at write time: a home path the client had truncated in a tool output was not matched by the scrub, so the record was not written and its verdict was lost. The scrub was fixed forward and the run repeated (matrix-v6-sandbox6-only-2).',
    },
    classifier: {
      rule: DIFF_SEEN_RULE,
      fingerprints: { file: `${N}/change-fingerprints.json`, sha256: sha256(read(`${N}/change-fingerprints.json`)), rule: fp.rule, min: fp.summary.minFingerprints, max: fp.summary.maxFingerprints },
      baseLines: { file: `${N}/base-lines.json`, sha256: sha256(read(`${N}/base-lines.json`)), baseCommit: fp.baseCommit },
      practiceRows: { file: `${N}/practice/practice-rows.json`, sha256: sha256(read(`${N}/practice/practice-rows.json`)), ids: ['p04', 'p05', 'p06'], note: 'Practice rows for the dry run (a new directory, a rename, a mixed change); never scored.' },
      addFileItems: addFile, addOnlyItems: fp.summary.addOnlyItems,
      rename: 'c018 renames a file with 100% similarity: the pure rename has no hunk and yields no fingerprint; its modify hunks carry its fingerprints (rule a).',
      gitCall: 'A git call is a Bash command whose FIRST token is git (not any command that merely contains the word), and only top-level calls count: a sub-agent\'s calls (parent_tool_use_id set) never make a run SEEN.',
      refusals: 'A refused call is one listed in the result\'s permission_denials. is_error alone is not a refusal: live, the client sets it on git commands that ran and printed when its own cwd-tracking write fails under the sandbox.',
      recompute: 'Each counted run record keeps, per tool call, the tool, the scrubbed input, is_error, refused, the output sha256 and length, and the scrubbed output text of git Bash calls and Read/Grep/Glob calls. The scorer recomputes every run\'s class from those outputs and the committed fingerprints and refuses a record whose stamped class differs.',
    },
    bar: {
      statement: 'The same spotlight bar as EXP 005: amendment 01\'s four criteria, thresholds, denominators, hold rule and three-state labels, computed by EXP 005\'s own spotlightVerdict. The only change is the run-state mapping below.',
      rule: a01.changes.spotlight.rule, judging: a01.changes.spotlight.judging, labelPhrase: a01.changes.spotlight.labelPhrase,
      criteria: a01.changes.spotlight.criteria,
      harnessFailure: translateHarnessFailure(a01.changes.spotlight.criteria.find(c => c.id === 'zero-patches').harnessFailure),
      states: prereg5.thresholdRule.states,
      runStates: { 'SEEN-DECIDED': 'diff-seen, with a verdict line', 'SEEN-ABSTAIN': 'diff-seen, no verdict line', BLIND: 'not diff-seen, whatever it decided', 'HARNESS-FAIL': 'a harness failure (also BLIND in the manipulation check)' },
      mapping: 'A BLIND run, harness failures included, is scored as an error in missed drift and false reject, at run level and in the item majority (where it counts as the wrong answer), and as a disagreement in self-agreement: its decision is treated as no decision before EXP 005\'s formulas run.',
      manipulation: { maxBlindRuns: 18, countedRuns: 180, rule: 'BLIND runs (harness failures included) at most 18 of the 180 counted runs (10%): the manipulation check PASSES. More than 18: it FAILS, and there is no spotlight whatever the bar says.' },
      hookErrors: 'Hook errors are recorded and their rate published beside the bar; they are not a criterion (as in EXP 005).',
      diffSeenOnly: 'The same rates over the diff-seen runs only are reported beside the primary figures, never in their place.',
      partial: 'A partial run (the spend cap, the hang-stop, a crash, or coverage other than exactly runs 1..3 of all 60 items) decides nothing.',
      percentile: 'p90 (and any percentile) is results.mjs percentile: numpy\'s linear interpolation.',
      scorer: { file: `${N}/results6.mjs`, sha256: sha256(read(`${N}/results6.mjs`)) },
    },
    spotlightDecision: 'Automatic and pre-registered: a spotlight-decision record with held: false is committed if and only if the bar PASSES, the manipulation check PASSES, and the independent results refute SHIPs; otherwise held: true, naming the condition that failed. A founder decision is asked only if a refute raises a doubt this rule does not decide.',
    spotlightArtefact: {
      pass: 'On a PASS (the bar PASSES, the manipulation check PASSES, and the committed EXP 006 spotlight decision says held: false), the home page\'s "Tools leaving the factory" list gains nina\'s entry, next after 002 Laya, in the same shape as the Laya entry (number and category, a title linking to the evidence, one paragraph, links, an attribution note, a spec list): nina, harness orchestration for Claude Code, by Marcos Schulz (xhulz), https://github.com/xhulz/nina, with the attribution "used with the permission of its author, as confirmed by Odin Labs", and links to the EXP 006 measurement, to EXP 005 (#spotlight) and to the upstream fixes opened by Odin Labs (xhulz/nina#39, merged; xhulz/nina#41, stated as its live state at publish time: merged or open). Every figure in it is rendered from the EXP 006 results record at build time. It takes the list\'s next free number, 005, the slot EXP 005\'s gated nina card held; there is only one nina entry.',
      fail: 'On a FAIL, or when the spotlight is held for any reason, there is no entry, and the results page says plainly which condition failed (the bar, the manipulation check, the refute, or a partial run).',
      gate: 'WHETHER the entry shows is decided only by experiments/nina-changes/spotlight-gate.mjs, pinned in files below and re-checked by the counted guard: the bar PASSES AND the manipulation check PASSES AND spotlightEligible is exactly true AND the committed decision\'s held is the boolean false, and the decision names the results record by sha256. It carries EXP 005\'s card gate (spotlightShown) byte-identical, with a slice test. A missing decision record, a non-boolean held or any FAIL shows nothing.',
      renderer: 'HOW it looks is scripts/nina-changes-spotlight.mjs, the markup, not pinned: it imports the gate and holds no gate logic, and every figure in it is read from the results record (and the PR states from the committed upstream.json), so the results can feed it without an amendment.',
    },
    spend: {
      capUsd: LIMITS6.capUsd, preCountedCeilingUsd: LIMITS6.preCountedCeilingUsd, ledger: 'experiments/nina-changes/spend-ledger.jsonl',
      rule: 'Every paid call of EXP 006 (matrix probes, the dry run, the counted run) appends one ledger line, cost to 7 decimals from the client\'s total_cost_usd (API-equivalent). A call whose cost is unknown is charged its upper bound, max(the largest EXP 006 call so far, $0.60), marked upper-bound; never a $0 line. Before a call the runner refuses it when the recorded total plus a reserve of max(largest call so far, $0.60) would exceed $60, and a pre-counted call when the pre-counted total plus that reserve would exceed $10: enforced in code (spend6.mjs).',
      calls, spentUsd: Number(fixed7(totalUnits)),
      sum: `${calls.map(c => c.costUsd.toFixed(7)).join(' + ')} = ${fixed7(totalUnits)}`,
      preCountedRemainingUsd: Number(fixed7(units(LIMITS6.preCountedCeilingUsd) - totalUnits)),
      reserveUsd: Number(fixed7(reserveUnits)),
      headroomRule: 'The headroom holds only while no call exceeds the current reserve: the reserve is max(the largest call so far, $0.60) and rises with the largest call, so a dearer call lowers the headroom for the calls after it.',
      dryRunHeadroomUsd: Number(fixed7(units(LIMITS6.preCountedCeilingUsd) - totalUnits - reserveUnits)),
      bundle2: `D4: the separate post-merge probe is dropped. The measured run's own pre-run matrix probe, made after the freeze on the frozen runner, is the post-freeze proof; it has its own ledger kind (prerun-matrix) and is charged only against the $60 cap, never the $10 pre-counted ceiling. Pre-freeze probes and the practice dry run stay under the $10 ceiling. The real headroom for the dry run: $10 − $${fixed7(totalUnits)} spent − $${fixed7(reserveUnits)} reserve = $${fixed7(units(LIMITS6.preCountedCeilingUsd) - totalUnits - reserveUnits)} before the last allowed call; the reserve is max(the largest call so far, $0.60), which is also the unknown-cost upper bound, so it cannot be lowered. Reaching the ceiling stops the dry run and asks the founder: bundle 2 may then complete fewer than its 18 practice runs, and its acceptance (every completed run diff-seen and hand-read) is judged on the runs completed, with the shortfall reported; whether that is enough to go on is the founder's call.`,
      askFork: 'Reaching the $10 pre-counted ceiling stops the run and asks the founder (raise the cap or trim scope). Before the counted run: if spent + 180 × p90(dry-run per-run cost) + one pre-run probe + $0.60 > $60, the founder is asked first.',
    },
    preflight: 'Answer-key pre-flight, EXP 005\'s mechanism with EXP 006\'s pins file and not-before: one counted pre-flight record written before the measured run (runner-guard.mjs --preflight --mode counted --write-record --pins-file experiments/nina-changes/runners.sha256), ended at most 2 h before the first counted call and after the not-before, bound to that runner code and commit, and committed with the results; no commit between the record and the last counted call\'s start.',
    siteChecks: 'The page widths were checked two ways: a real headless Chromium render (playwright-isolated, served from the built site) of the home page, this note and the EXP 005 note at 375 px and 320 px, finding no horizontal overflow (document scrollWidth equal to the viewport); and a static repository test that no unbroken run in the note is wider than the column unless the stylesheet lets it wrap.',
    notBefore: 'No counted reviewer run starts before the merge time of the odin-rnd pull request that adds this file; that time is recorded after publication, frozen with this record\'s sha256 in freeze.mjs, and every counted call must start after it. Practice runs and matrix probes on canaries do not wait for it.',
    limits: [
      'Two layers: the text deny rules are best-effort (the client matches a normalised command); the OS sandbox is the boundary: reads outside the repository are denied (R9 and R45 read a file outside it and got "Operation not permitted"), and so are reads of the temp roots; writes are confined and there is no unsandboxed retry. No canary sits anywhere but inside the operator\'s home and the temp roots, so the matrix tests the sandbox where the answer files could be.',
      'git diff -O<file> (an orderfile) is allowed under the git diff rules and makes git read that file to order its output; it prints none of the file\'s content, so at most it is a side channel (whether an outside path exists or parses). Documented as a residual; no live row was added (no paid call).',
      'A stream with a malformed line is charged the upper bound even if a final result line reported a cost (conservative: the line cannot be trusted).',
      'Sub-agents: a run can spawn a sub-agent whose own tool calls appear in the stream with a parent_tool_use_id. Only TOP-LEVEL calls count toward DIFF-SEEN (a sub-agent\'s calls are recorded but never make a run SEEN), so a run whose change was read only by a sub-agent counts BLIND.',
      'Reviewer only: Jev, Laya and the cascade are not re-run; this measures nina 0.34.0\'s reviewer on mechanical architecture rules and nothing else about nina.',
      'Same corpus, inputs, labels and rules as EXP 005, so the results compare; the corpus is public, and the reviewer is fenced from the answer files by the sandbox and the answer-key pre-flight.',
      'Prompt confound: the prompt says "the change is everything that git diff shows", which is false for the 14 items that add a file (9 of them add only files): git diff does not show untracked files. The prompt is EXP 005\'s, unchanged, so the results compare.',
      'Client artifact: Claude Code 2.1.280 marks some git commands that ran (git status --short, git log, git show) is_error, with "Exit code 1" and a line for its failed cwd-tracking write under the sandbox. It likely affected EXP 005\'s tool results too; EXP 005\'s records keep no tool output, so this cannot be checked (its classifier never read tool-level is_error). EXP 006 reads refusals from permission_denials and never from is_error.',
      'Known false-BLIND forms: the classifier does not recognise a change shown only through git diff --color=always, git diff --word-diff, git diff -R, a coloured git status (-c color.status=always), git status --porcelain=v2 or -z, or a long-form status run from a subdirectory (its ../ paths). A run that saw the change only that way is counted BLIND: an error against the bar and the manipulation check, never toward a spotlight. Each form is pinned BLIND by a unit test (documented behaviour, not a silent gap).',
      'The runs are sequential, on one machine, under whatever load it has; latency is recorded, not judged.',
      `Paid calls before this record: ${calls.length} matrix probes, $${fixed7(totalUnits)}, itemised in spend.calls; none is counted in any result.`,
    ],
    attribution: { nina: ninaAttribution, ninaUrl: 'https://github.com/xhulz/nina' },
    files,
  };
}

const hex = /^[a-f0-9]{64}$/;
export const localPath = /\/Users\/|\/home\/(?!probe-user(?![\w-]))[a-z]|\/private\/var\/folders\/|(?<!\/private)\/var\/folders\/|\/opt\/homebrew\/|\/private\/tmp\/|(?<![\w.])\/tmp\//;

/** The invariants a record must hold, beyond being exactly the build of the files. */
export function validateRecord(record, root = '.') {
  const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const prereg5 = json(PARENT.preregistration.file), a01 = json(PARENT.amendment01.file);
  assert.equal(record.kind, 'preregistration');
  assert.equal(record.experiment.statusText, statusText);
  for (const [k, v] of Object.entries(PARENT)) assert.equal(record.parent[k].sha256, v.sha256, `parent ${k}`);
  assert.equal(record.reviewer.command, commandTemplate(prereg5, 'fence6'), 'reviewer.command is the runner\'s own scrubbed render (the runner reads this field)');
  assert.match(record.reviewer.command, /--output-format stream-json --verbose/);
  assert.equal(record.reused.prompt, prereg5.gates.reviewer.prompt, 'the prompt is EXP 005\'s, byte for byte');
  assert.deepEqual(record.bar.criteria, a01.changes.spotlight.criteria, 'the bar is EXP 005 amendment 01\'s, unchanged');
  assert.equal(record.bar.judging, a01.changes.spotlight.judging, 'the hold rule is EXP 005\'s, verbatim');
  assert.equal(record.bar.harnessFailure, HARNESS_FAILURE_DEFINITION, 'the harness-failure definition is the runner\'s');
  assert.deepEqual([record.bar.manipulation.maxBlindRuns, record.bar.manipulation.countedRuns], [18, 180]);
  // The spend: the itemised lines sum to the total to the 7th decimal; the remainder is the ceiling less it.
  const total = record.spend.calls.reduce((s, c) => s + units(c.costUsd), 0);
  assert.equal(units(record.spend.spentUsd), total);
  assert.equal(units(record.spend.preCountedRemainingUsd), units(record.spend.preCountedCeilingUsd) - total);
  const reserve = Math.max(...record.spend.calls.map(c => units(c.costUsd)), units(LIMITS6.unknownCostFloorUsd));
  assert.equal(units(record.spend.reserveUsd), reserve, 'the reserve is max(largest call so far, $0.60)');
  assert.equal(units(record.spend.dryRunHeadroomUsd), units(record.spend.preCountedCeilingUsd) - total - reserve, 'the dry-run headroom is the ceiling less the spend less the reserve');
  assert.ok(record.spend.calls.every(c => c.costUsd > 0 && hex.test(c.record.sha256)));
  // The proof: every fence6 and sandbox-only proof run held every row and every control on the same fence.
  const runs = record.isolationEvidence.runs;
  const fence6 = runs.filter(r => r.variant === 'fence6' && !r.name.includes('discovery'));
  assert.equal(fence6.length, 3);
  assert.equal(new Set(fence6.map(r => r.commandSha256)).size, 1, 'the three fence6 proof runs ran the same command');
  for (const r of [...fence6, runs.find(x => x.name === 'matrix-v6-sandbox6-only-2')]) assert.ok(r.passed && /^(\d+)\/\1$/.test(r.rowsHeld) && /^(\d+)\/\1$/.test(r.controlsWorked), `${r.name} held and was usable`);
  const ofRecord = json(record.isolationEvidence.probeOfRecord.file);
  assert.equal(ofRecord.pins.command, record.reviewer.command, 'the probe of record ran the pre-registered command');
  // B1: each proof run's code against the files pinned here, derived, never typed; the fence claim checked.
  const probe = name => json(`${N}/probes/${name}.json`);
  const diffs = proofRunDiffs(PROOF_RUNS.map(p => ({ name: p.name, code: probe(p.name).code })), record.files);
  assert.deepEqual(record.isolationEvidence.proofRuns.map(r => ({ name: r.name, differs: r.differsFromPinned.map(d => d.file) })), diffs, 'proofRuns must state exactly the files each proof run differs in');
  assertFenceUnaffected({ diffs, commands: Object.fromEntries(PROOF_RUNS.map(p => [p.name, probe(p.name).pins.command])),
    expected: Object.fromEntries(PROOF_RUNS.map(p => [p.name, probe(p.name).pins.isolation === 'sandbox6-only' ? commandTemplate(prereg5, 'sandbox6-only') : record.reviewer.command])) });
  // N4: the -C escape forms refused by the allow list in every proof run; R9/R45/R29/R30 stopped by the sandbox.
  // N6: every committed proof/discovery record re-judged with the attempted check keeps its verdict.
  for (const name of PROBES.filter(p => !p.name.includes('sandbox6-only-1')).map(p => p.name)) {
    const c = probe(name).calls[0];
    const again = applyAttempts(c.matrix, c.toolCalls);
    assert.equal(again.passed, c.matrix.passed, `${name}: the attempted check changes its verdict`);
    assert.equal(again.allAttempted, true, `${name}: a row was not attempted`);
  }
  for (const p of PROOF_RUNS) {
    const c = probe(p.name).calls[0], denied = (c.permissionDenials ?? []).map(d => String(d.input?.command ?? ''));
    for (const prefix of ['git -C <ws>/other-repo-r32 ', 'git -C .. ', 'git -C <ws>/repo/.. ', 'git -C <tmp>/exp006-canary-r35-', 'git --no-pager -C <ws>/canary-repo-r38 ', 'git -C <ws>/repo/link-r43 ']) assert(denied.some(d => d.startsWith(prefix)), `${p.name}: ${prefix.trim()} is not refused by the permission layer`);
    for (const re of [/^git show <ws>\/canary-r9\.txt$/, /^git -C <ws>\/repo --no-pager show <ws>\/canary-r45\.txt$/, /^git show <tmp>\/exp005-canary-r29-/, /^git show <tmp>\/exp005-canary-r30-/]) {
      const t = c.toolCalls.find(x => re.test(String(x.input?.command ?? '')));
      assert(t && !denied.includes(t.input.command) && /Operation not permitted/.test(t.output ?? ''), `${p.name}: ${re} was not stopped by the sandbox`);
    }
  }
  assert.equal(record.fence.answers.length, 7);
  for (const phrase of ['Tools leaving the factory', 'next after 002 Laya', 'Marcos Schulz (xhulz)', 'used with the permission of its author, as confirmed by Odin Labs', 'xhulz/nina#39', 'xhulz/nina#41', '#spotlight', 'rendered from the EXP 006 results record']) assert(record.spotlightArtefact.pass.includes(phrase), `spotlightArtefact.pass must state: ${phrase}`);
  assert.match(record.spotlightArtefact.fail, /no entry/);
  assert(`${N}/spotlight-gate.mjs` in record.files, 'the spotlight gate is pinned (refute r2 B1)');
  for (const f of NOT_PINNED) assert(!(f in record.files), `${f} is never pinned in the pre-registration (R4-3)`);
  assert.equal(record.attribution.nina, ninaAttribution);
  const text = JSON.stringify(record);
  assert(!localPath.test(text), 'a local machine path in the pre-registration');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'a float artefact in the pre-registration');
  return record;
}

export function checkRecord(root = '.') {
  const read = file => readFileSync(join(root, file));
  for (const [k, v] of Object.entries(PARENT)) assert.equal(sha256(read(v.file)), v.sha256, `${v.file} is not EXP 005's published ${k}`);
  const bytes = read(recordPath);
  const pinned = existsSync(join(root, pinPath)) ? read(pinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}: review the change, then node scripts/nina-changes-prereg.mjs --pin`);
  const record = validateRecord(JSON.parse(bytes), root);
  assert.deepEqual(record, buildRecord(root), `${recordPath} differs from its build: run node scripts/nina-changes-prereg.mjs --write, review the diff, then --pin`);
  return { record, sha256: sha256(bytes), bytes };
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    writeFileSync(recordPath, render(validateRecord(buildRecord())));
    console.log(`Built ${recordPath} (sha256 ${sha256(readFileSync(recordPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateRecord(JSON.parse(readFileSync(recordPath, 'utf8')));
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  preregistration.json\n`);
    console.log(`Pinned ${recordPath} in ${pinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/nina-changes-prereg.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest}`);
}
