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
// Pinned by sha256 in the record: what makes, classifies and scores a run. Never freeze.mjs or runners.sha256 (R4-3).
export const PINNED = [
  ...['run_reviewer6.mjs', 'fence6.mjs', 'matrix6.mjs', 'stream6.mjs', 'spend6.mjs', 'scrub6.mjs', 'guard6.mjs', 'vendored-exp005.mjs', 'diff-seen.mjs', 'fingerprints.mjs', 'base-lines.mjs', 'results6.mjs', 'denial-census.mjs',
    'change-fingerprints.json', 'base-lines.json', 'denial-census.json', 'practice/practice-rows.json', 'practice/author-practice6.mjs',
    'fixtures/fake-claude-stream.mjs', 'fixtures/synthetic6.mjs', 'fixtures/live-read-grep.json', 'fixtures/diff-seen-table.json'].map(f => `${N}/${f}`),
  ...PROBES.map(p => `${N}/probes/${p.name}.json`),
  ...['run_reviewer.mjs', 'runner-guard.mjs', 'results.mjs', 'metrics.mjs', 'corpus.sha256', 'inputs.json', 'labels.json', 'rules.txt'].map(f => `${J}/${f}`),
  'scripts/nina-changes-prereg.mjs', 'scripts/nina-changes-note.mjs',
];
export const NOT_PINNED = [`${N}/freeze.mjs`, `${N}/runners.sha256`, `${N}/spend-ledger.jsonl`];

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
  const final = byName[PROBE_OF_RECORD].rec, early = byName['matrix-v6-fence6-1'].rec;
  const codeDiff = Object.keys(final.code).filter(f => final.code[f] !== early.code[f]).sort();
  const ledger = read(`${N}/spend-ledger.jsonl`).toString('utf8').trim().split('\n').map(l => JSON.parse(l)).slice(0, PROBES.length);
  const calls = probes.map((p, i) => {
    const l = ledger[i], c = p.rec.calls[0];
    assert.equal(l.ts, c.endedAt, `ledger line ${i + 1} is not ${p.name}'s call`);
    return { id: p.name, variant: p.variant, record: { file: p.file, sha256: sha256(read(p.file)) }, endedAt: l.ts, costUsd: round7(l.costUsd), costBasis: l.costBasis };
  });
  const totalUnits = calls.reduce((s, c) => s + units(c.costUsd), 0);
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
      summary: 'EXP 005 met nina\'s spotlight bar, but in 131 of 180 runs its own tool fence kept the reviewer from reading the diff. EXP 006 measures nina 0.34.0\'s reviewer again on the same 60 changes, with a fence that allows the git forms it uses, and counts a run only if the reviewer demonstrably obtained the change.',
      note: 'Written, hashed and published before any counted reviewer run. Nothing in this record may change after publication; a later change is a new, dated amendment (the EXP 005 amendment pattern), refuted and published first, and it resets the not-before.',
    },
    question: 'On the same 60 authored changes and the same architecture rules as EXP 005, and with a tool fence that lets it read the change, does nina 0.34.0\'s reviewer, run headless by Claude Code, meet the same spotlight bar as EXP 005, while the tool-call records show it actually obtained the change in at least 90% of runs?',
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
      codeStatement: `fence6 ran three proof times on the same fence (settings, allow list and command template; command sha256 ${sha256(final.pins.command).slice(0, 8)}… in all three). Proof runs 1 and 2 were made at commit 14ba08d, whose code differs from the final code only in ${codeDiff.join(' and ')}: the write-time scrub and the handling of a record refused at write time, post-processing only, after the call. Proof run 3 (the probe of record) and the sandbox-only proof run were made on the final code.`,
      codeDiff,
      lostVerdict: 'matrix-v6-sandbox6-only-1 was a paid call ($0.5472840) whose record was refused at write time: a home path the client had truncated in a tool output was not matched by the scrub, so the record was not written and its verdict was lost. The scrub was fixed forward and the run repeated (matrix-v6-sandbox6-only-2).',
    },
    classifier: {
      rule: DIFF_SEEN_RULE,
      fingerprints: { file: `${N}/change-fingerprints.json`, sha256: sha256(read(`${N}/change-fingerprints.json`)), rule: fp.rule, min: fp.summary.minFingerprints, max: fp.summary.maxFingerprints },
      baseLines: { file: `${N}/base-lines.json`, sha256: sha256(read(`${N}/base-lines.json`)), baseCommit: fp.baseCommit },
      practiceRows: { file: `${N}/practice/practice-rows.json`, sha256: sha256(read(`${N}/practice/practice-rows.json`)), ids: ['p04', 'p05', 'p06'], note: 'Practice rows for the dry run (a new directory, a rename, a mixed change); never scored.' },
      addFileItems: addFile, addOnlyItems: fp.summary.addOnlyItems,
      rename: 'c018 renames a file with 100% similarity: the pure rename has no hunk and yields no fingerprint; its modify hunks carry its fingerprints (rule a).',
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
    spend: {
      capUsd: LIMITS6.capUsd, preCountedCeilingUsd: LIMITS6.preCountedCeilingUsd, ledger: 'experiments/nina-changes/spend-ledger.jsonl',
      rule: 'Every paid call of EXP 006 (matrix probes, the dry run, the counted run) appends one ledger line, cost to 7 decimals from the client\'s total_cost_usd (API-equivalent). A call whose cost is unknown is charged its upper bound, max(the largest EXP 006 call so far, $0.60), marked upper-bound; never a $0 line. Before a call the runner refuses it when the recorded total plus a reserve of max(largest call so far, $0.60) would exceed $60, and a pre-counted call when the pre-counted total plus that reserve would exceed $10: enforced in code (spend6.mjs).',
      calls, spentUsd: Number(fixed7(totalUnits)),
      sum: `${calls.map(c => c.costUsd.toFixed(7)).join(' + ')} = ${fixed7(totalUnits)}`,
      preCountedRemainingUsd: Number(fixed7(units(LIMITS6.preCountedCeilingUsd) - totalUnits)),
      bundle2: `The separate post-merge probe is dropped: the counted run's own pre-run matrix probe, on the frozen runner, is the post-freeze proof. The pre-counted remainder, $${fixed7(units(LIMITS6.preCountedCeilingUsd) - totalUnits)}, covers the 18-run practice dry run (p01-p06, k=3).`,
      askFork: 'Reaching the $10 pre-counted ceiling stops the run and asks the founder (raise the cap or trim scope). Before the counted run: if spent + 180 × p90(dry-run per-run cost) + one pre-run probe + $0.60 > $60, the founder is asked first.',
    },
    preflight: 'Answer-key pre-flight, EXP 005\'s mechanism with EXP 006\'s pins file and not-before: one counted pre-flight record written before the measured run (runner-guard.mjs --preflight --mode counted --write-record --pins-file experiments/nina-changes/runners.sha256), ended at most 2 h before the first counted call and after the not-before, bound to that runner code and commit, and committed with the results; no commit between the record and the last counted call\'s start.',
    notBefore: 'No counted reviewer run starts before the merge time of the odin-rnd pull request that adds this file; that time is recorded after publication, frozen with this record\'s sha256 in freeze.mjs, and every counted call must start after it. Practice runs and matrix probes on canaries do not wait for it.',
    limits: [
      'Two layers: the text deny rules are best-effort (the client matches a normalised command); the OS sandbox (reads of home outside the run and of the temp roots denied, writes confined, no unsandboxed retry) is the boundary.',
      'Reviewer only: Jev, Laya and the cascade are not re-run; this measures nina 0.34.0\'s reviewer on mechanical architecture rules and nothing else about nina.',
      'Same corpus, inputs, labels and rules as EXP 005, so the results compare; the corpus is public, and the reviewer is fenced from the answer files by the sandbox and the answer-key pre-flight.',
      'Prompt confound: the prompt says "the change is everything that git diff shows", which is false for the 14 items that add a file (9 of them add only files): git diff does not show untracked files. The prompt is EXP 005\'s, unchanged, so the results compare.',
      'Client artifact: Claude Code 2.1.280 marks some git commands that ran (git status --short, git log, git show) is_error, with "Exit code 1" and a line for its failed cwd-tracking write under the sandbox. It affected EXP 005\'s tool results too; EXP 005\'s classifier never read tool-level is_error (its records keep refusals and reports only). EXP 006 reads refusals from permission_denials and never from is_error.',
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
  assert.ok(record.spend.calls.every(c => c.costUsd > 0 && hex.test(c.record.sha256)));
  // The proof: every fence6 and sandbox-only proof run held every row and every control on the same fence.
  const runs = record.isolationEvidence.runs;
  const fence6 = runs.filter(r => r.variant === 'fence6' && !r.name.includes('discovery'));
  assert.equal(fence6.length, 3);
  assert.equal(new Set(fence6.map(r => r.commandSha256)).size, 1, 'the three fence6 proof runs ran the same command');
  for (const r of [...fence6, runs.find(x => x.name === 'matrix-v6-sandbox6-only-2')]) assert.ok(r.passed && /^(\d+)\/\1$/.test(r.rowsHeld) && /^(\d+)\/\1$/.test(r.controlsWorked), `${r.name} held and was usable`);
  const ofRecord = json(record.isolationEvidence.probeOfRecord.file);
  assert.equal(ofRecord.pins.command, record.reviewer.command, 'the probe of record ran the pre-registered command');
  assert.deepEqual(record.isolationEvidence.codeDiff, ['experiments/nina-changes/run_reviewer6.mjs', 'experiments/nina-changes/scrub6.mjs'], 'proof runs 1-2 differ from the final code only in post-processing');
  assert.equal(record.fence.answers.length, 7);
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
