// EXP 006 amendment 01 (WO-1-09): the dated record, experiments/nina-changes/amendment-01.json, that fixes forward what
// the bundle-2 dry run found before any counted call. It names the pre-registration by sha256; the pre-registration
// stays byte-identical. Everything in it is built here: the authored text below, and every fact about committed files
// and records (the dry-run findings, the re-pinned files, the spend, the projection) recomputed from them. The
// validator refuses a record that differs from this build, a re-pinned file without a stated reason, a spend total
// that is not the sum of the ledger lines to the 7th decimal, and a ledger that holds a counted or pre-run line.
//   node scripts/nina-changes-amendment.mjs --write   build the record from the files (review it, then --pin)
//   node scripts/nina-changes-amendment.mjs --pin     pin its sha256 in amendment-01.sha256
//   node scripts/nina-changes-amendment.mjs --check   validate; print its sha256
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { percentile } from '../experiments/jev-gate/results.mjs';
import { practiceItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { loadBaseLines } from '../experiments/nina-changes/base-lines.mjs';
import { fingerprintItem } from '../experiments/nina-changes/fingerprints.mjs';
import { REGISTERED_RULE, RULE } from '../experiments/nina-changes/diff-seen.mjs';
import { DIGEST_KEY6 } from '../experiments/nina-changes/scrub6.mjs';
import { LIMITS6 } from '../experiments/nina-changes/spend6.mjs';
import { GIT_FORMS6, subCommands } from '../experiments/nina-changes/stream6.mjs';
import { fixed7, localPath, PINNED, pinPath as preregPinPath, recordPath as preregPath, units } from './nina-changes-prereg.mjs';

const N = 'experiments/nina-changes';
export const amendmentPath = `${N}/amendment-01.json`;
export const amendmentPinPath = `${N}/amendment-01.sha256`;
export const publishedPath = 'site/data/nina-changes/amendment-01.json';
// The EXP 006 pre-registration as published (odin-rnd #17, main 3f9fc9f1), hard-coded: a different one is refused.
export const PARENT = { file: 'preregistration.json', sha256: '41efb90da633b42acca619ab4d761e15e608ca06e496bafbc73ccfd9df03b98a', notBefore: '2026-09-30T19:26:46Z' };
export const DRY_RUN = [
  { name: 'practice-a', file: `${N}/dry-run/practice-a.json`, practiceRows: 'experiments/jev-gate/practice/practice-rows.json', rows: 'p01-p03 (the EXP 005 practice rows, experiments/jev-gate/practice/practice-rows.json)' },
  { name: 'practice-b', file: `${N}/dry-run/practice-b.json`, practiceRows: `${N}/practice/practice-rows.json`, rows: 'p04-p06 (experiments/nina-changes/practice/practice-rows.json)' },
];
export const LEDGER = `${N}/spend-ledger.jsonl`;
export const PROBE_OF_RECORD = `${N}/probes/matrix-v6-fence6-3.json`;
/** Why each pre-registered file this amendment re-pins changed. A re-pinned file without a reason here is refused. */
export const PIN_REASONS = {
  [`${N}/scrub6.mjs`]: 'A1: the write-time lint no longer scans a digest field (64 hex under a sha256-named key, or a value of the record\'s code map) for restricted terms; everything else is linted as before',
  [`${N}/stream6.mjs`]: 'A2: a git call is also a Bash call in which any sub-command (split on unquoted &&, ||, ; and |) is an allowed fence6 git form; such a call\'s output is kept',
  [`${N}/diff-seen.mjs`]: 'A2: the classifier uses the amended git call; its rule text is amended (RULE) and the registered text is kept verbatim (REGISTERED_RULE); rules (a) and (b) are otherwise unchanged',
  [`${N}/guard6.mjs`]: 'A5: a counted run also needs this amendment: its sha256 frozen as AMENDMENT6_SHA256, every pin as re-pinned here, and a start after AMENDMENT6_NOT_BEFORE',
  [`${N}/results6.mjs`]: 'A5: the scorer checks the run\'s amendment6Sha256 against the stamp (and the frozen AMENDMENT6_SHA256), uses the amendment\'s not-before, and carries the sha in the results record',
  [`${N}/spotlight-gate.mjs`]: 'A5: the gate also requires the results\' amendment6Sha256 to equal the frozen AMENDMENT6_SHA256 and the reviewer run record to name the same one; the predicate and every other check are unchanged',
  [`${N}/run_reviewer6.mjs`]: 'A5: the run record carries the guard\'s amendment6Sha256; the argv builder is unchanged',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const round7 = usd => Number(fixed7(units(usd)));
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
export const DATE = '2026-10-01';
export const statusText = `Amended ${longDate(DATE)}, before any counted run`;
const pct = (n, d) => `${(Math.round((n / d) * 1000) / 10).toFixed(1)}%`;

/** The ledger lines, numbered from 1. */
export const ledgerLines = (root = '.') => readFileSync(join(root, LEDGER), 'utf8').trim().split('\n').map((l, i) => ({ line: i + 1, ...JSON.parse(l) }));

/** The record, built from the files under `root`. */
export function buildAmendment(root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  const prereg = json(preregPath);
  const ledger = ledgerLines(root);
  const lineFor = c => ledger.find(l => l.ts === c.endedAt && l.id === c.id && l.run === c.run);
  const records = Object.fromEntries(DRY_RUN.map(d => [d.name, json(d.file)]));
  const calls = DRY_RUN.flatMap(d => records[d.name].calls.map(c => ({ ...c, record: d.name })));

  // F1: the refused call, from the record's partial and the call's leakFields (the refused record itself was not written).
  const b = records['practice-b'], refused = calls.filter(c => c.lintRefused);
  assert.equal(refused.length, 1, 'the dry run has exactly one lint-refused call');
  const r = refused[0], rLine = lineFor(r);
  assert(rLine, `no ledger line for ${r.id} run ${r.run}`);
  // F2: the recorded runs counted BLIND, each with its first Bash call's command and output size.
  const recorded = calls.filter(c => !c.lintRefused);
  // What each blind run's report shows of its change: the changed files named, and a changed line quoted verbatim.
  const baseSet = new Set(loadBaseLines().sha256s);
  const blind = recorded.filter(c => c.diffSeen && !c.diffSeen.seen).map(c => {
    const t = c.toolCalls.find(x => x.tool === 'Bash'), l = lineFor(c), d = DRY_RUN.find(x => x.name === c.record);
    assert(l, `no ledger line for ${c.id} run ${c.run}`);
    const fp = fingerprintItem(practiceItems(join(root, d.practiceRows)).find(i => i.id === c.id).patch, baseSet);
    const result = c.result ?? '';
    return {
      record: { file: d.file, sha256: sha256(read(d.file)) }, id: c.id, run: c.run, decision: c.decision, toolCall: t.n, command: t.input.command, subCommands: subCommands(t.input.command),
      outputBytes: t.outputBytes, outputKept: 'output' in t, refused: t.refused, ledgerLine: l.line, costUsd: round7(l.costUsd),
      reportNamesChangedFiles: [...fp.modified, ...fp.added].every(f => result.includes(f)), reportQuotesChangedLine: [...fp.plus, ...fp.minus].some(x => result.includes(x)),
    };
  });
  // F3: every top-level Bash call of the dry run that ran `cat` on a workspace path, and whether any was refused.
  const catCalls = calls.flatMap(c => (c.toolCalls ?? []).filter(t => t.tool === 'Bash' && subCommands(t.input.command).some(p => /^cat (?!\.\.\/|\/)/.test(p))));
  const probe = json(PROBE_OF_RECORD).calls[0];
  const denied = (probe.permissionDenials ?? []).map(d => String(d.input?.command ?? ''));
  const outsideCatRefused = denied.filter(d => /(^|[;&|`(]\s*|\$\()cat \.\.\//.test(d));
  const catRows = outsideCatRefused.map(d => (/canary-r(\d+b?)\.txt/.exec(d) ? `R${/canary-r(\d+b?)\.txt/.exec(d)[1]}` : '?'));
  assert(catRows[0] === 'R17' && outsideCatRefused[0] === 'cat ../canary-r17.txt', 'the probe of record refused R17 (a bare outside cat)');
  // The sandbox rows, as the pre-registration's validator reads them: not refused, and git failed with the OS error.
  const sandboxRows = Object.entries({ R9: /^git show <ws>\/canary-r9\.txt$/, R45: /^git -C <ws>\/repo --no-pager show <ws>\/canary-r45\.txt$/, R29: /^git show <tmp>\/exp005-canary-r29-/, R30: /^git show <tmp>\/exp005-canary-r30-/ })
    .filter(([, re]) => probe.toolCalls.some(t => re.test(String(t.input?.command ?? '')) && !denied.includes(t.input.command) && /Operation not permitted/.test(t.output ?? ''))).map(([row]) => row);
  assert.equal(sandboxRows.length, 4, 'R9, R45, R29 and R30 were stopped by the sandbox in the probe of record');

  // The re-pinned files: every file the pre-registration pins whose bytes differ now.
  const pins = Object.fromEntries(PINNED.filter(f => sha256(read(f)) !== prereg.files[f]).map(f => [f, { from: prereg.files[f], to: sha256(read(f)), reason: PIN_REASONS[f] ?? null }]));

  // The spend: every ledger line, itemised; the projection from the practice lines (EXP 005 percentile).
  const spend = ledger.map(l => ({ line: l.line, ts: l.ts, kind: l.kind, id: l.id, run: l.run, costUsd: round7(l.costUsd), costBasis: l.costBasis }));
  const total = spend.reduce((s, l) => s + units(l.costUsd), 0);
  const byKind = kind => spend.filter(l => l.kind === kind);
  const sumOf = list => list.reduce((s, l) => s + units(l.costUsd), 0);
  const practice = byKind('practice').map(l => l.costUsd), matrix = byKind('isolation-matrix');
  const largest = Math.max(...spend.map(l => units(l.costUsd)));
  const reserve = Math.max(largest, units(LIMITS6.unknownCostFloorUsd));
  const prerun = Math.max(...matrix.map(l => units(l.costUsd)));
  const mean = Math.round(practice.reduce((s, c) => s + units(c), 0) / practice.length), p90 = units(percentile(practice, 90)), max = Math.max(...practice.map(units));
  const project = per => total + LIMITS6.countedRuns * per + prerun + reserve;
  const completed = recorded.length + refused.length;

  return {
    schemaVersion: 1, kind: 'amendment', id: 'amendment-01', experiment: 'EXP 006',
    title: 'Amendment 01: a digest is not a restricted term, a compound git call counts, and the client\'s built-in reads are disclosed',
    parent: {
      file: PARENT.file, sha256: PARENT.sha256, notBefore: PARENT.notBefore,
      published: `odin-rnd #17, merged ${PARENT.notBefore} (GitHub mergedAt), the pre-registration's not-before. It stays byte-identical and is still served as published; where this amendment and it differ, this amendment wins, and only on what it lists.`,
    },
    date: DATE, statusText,
    reason: {
      summary: `The bundle-2 dry run (practice rows only, never scored; ${calls[0].startedAt.slice(0, 10)} ${calls[0].startedAt.slice(11, 16)}-${calls.at(-1).endedAt.slice(11, 16)} UTC, ${completed} paid calls) found two defects in the pre-registered record pipeline and one statement in the pre-registration that the client's behaviour contradicts. Left as registered, the first would very likely void a counted run by chance and the second would fail the manipulation check on a classifier artefact. None concerns the bar, the corpus, the prompt, the command, or the fence's settings and allow list. Each is fixed forward here, before any counted call.`,
      dryRun: {
        records: DRY_RUN.map(d => ({ file: d.file, sha256: sha256(read(d.file)), rows: d.rows, mode: records[d.name].mode, calls: records[d.name].calls.length, partial: records[d.name].partial ? records[d.name].partial.reason : null })),
        ledgerLines: `${Math.min(...byKind('practice').map(l => l.line))}-${Math.max(...byKind('practice').map(l => l.line))} of ${LEDGER} (kind practice, one per completed call, the refused one included)`,
        completedCalls: completed, recordedCalls: recorded.length,
      },
      findings: [
        {
          id: 'F1', title: 'A false-positive lint refusal',
          what: `${r.id} run ${r.run}'s record was refused at write time ("a restricted term"), and the run stopped partial. The only leaking field was ${r.leakFields.join(', ')}: a random sha256 digest of a tool output that happened to contain one of check.mjs's short restricted-term fingerprint windows. With about a hundred digests in each run record, a 180-run counted run would very likely be stopped, and so voided, by chance.`,
          evidence: { record: { file: DRY_RUN[1].file, sha256: sha256(read(DRY_RUN[1].file)) }, partial: b.partial.reason, id: r.id, run: r.run, leakFields: r.leakFields, ledgerLine: rLine.line, costUsd: round7(rLine.costUsd) },
          fix: 'A1',
        },
        {
          id: 'F2', title: 'A false-BLIND classification',
          what: `${blind.map(x => `${x.id} run ${x.run}`).join(' and ')} ran ${blind.map(x => `\`${x.command}\``).join(' and ')}. The client ran each (${blind.map(x => `${x.outputBytes} bytes of output`).join(', ')}; not refused), ${blind.every(x => x.reportNamesChangedFiles) ? 'each report names the changed file' : 'not every report names the changed file'} and ${blind.filter(x => x.reportQuotesChangedLine).length} of ${blind.length} quote a changed line verbatim, but the registered classifier treats a Bash call as a git call only when its FIRST token is git (refute r2 N9), so the output was not kept and the run was classified BLIND. That is ${blind.length} of ${completed} completed calls (${pct(blind.length, completed)}), above the manipulation check's 10% limit.`,
          evidence: { blindRuns: blind },
          fix: 'A2',
        },
        {
          id: 'F3', title: 'A fence fact the pre-registration states wrongly',
          what: `The client ran cat on files inside the workspace with no allow rule for cat (${catCalls.length} top-level Bash calls in the dry run, ${catCalls.filter(t => t.refused).length} refused): Claude Code runs its built-in read-only commands on workspace paths without an allow rule. The pre-registration says only Read, Grep, Glob and the four git verbs are allowed, and that a chain with any other part is refused whole. Outside reads stayed closed: in the probe of record ${outsideCatRefused.length} commands that cat a file outside the workspace (${catRows[0]}, a bare cat ../canary-r17.txt, and the chains and command substitutions ${catRows.slice(1).join(', ')}) were refused by the permission layer, and ${sandboxRows.join(', ')} were stopped by the OS sandbox.`,
          evidence: { dryRunCatCalls: catCalls.length, dryRunCatCallsRefused: catCalls.filter(t => t.refused).length, probeOfRecord: { file: PROBE_OF_RECORD, sha256: sha256(read(PROBE_OF_RECORD)) }, outsideCatRefused, outsideCatRows: catRows, sandboxStopped: sandboxRows },
          fix: 'A3',
        },
      ],
    },
    changes: {
      lint: {
        id: 'A1', file: `${N}/scrub6.mjs`,
        rule: 'A digest field is not scanned for restricted terms: a value of exactly 64 lowercase hex characters under a key named sha256 or ending in Sha256, or a value of the record\'s top-level code map (file to sha256). The record is linted with every digest field masked, and each digest value is still linted for paths, the session uid and credential shapes. Everything else is scanned as before: keys, prose, tool outputs, and a 64-hex value under any other key.',
        digestKeyPattern: DIGEST_KEY6.source,
        digestFields: ['toolCalls.N.outputSha256', 'resultSha256', 'hook.sha256', 'pins.promptSha256', 'pins.fingerprintsSha256', 'pins.baseLinesSha256', 'prereg6Sha256', 'amendment6Sha256', 'parentSha256', 'amendmentSha256', 'amendment02Sha256', 'corpusSha256', 'code.<file>'],
      },
      gitCall: {
        id: 'A2', files: [`${N}/stream6.mjs`, `${N}/diff-seen.mjs`],
        definition: 'A git call is a top-level (not sub-agent) Bash call whose first token is git, as registered, or one in which ANY sub-command, split on the unquoted control operators &&, ||, ; and |, is an allowed fence6 git form. Its full scrubbed output is kept in the record and read by the classifier. Rule (a) still needs a sign-matched whole diff line of the item in that output: a cat of a file prints no + or - prefix, so file content cannot pass for a diff line. Rule (b)\'s untracked entry may come from such an output, and still needs a Read or Grep of the added file.',
        allowedForms: GIT_FORMS6,
        separators: ['&&', '||', ';', '|'],
        examples: { gitCall: blind.map(x => x.command), notGitCall: ['echo git; cat f', 'cat a && git branch'] },
        registeredRule: REGISTERED_RULE,
        rule: RULE,
      },
      fence: {
        id: 'A3',
        correction: 'The pre-registration\'s fence statements (fence.compound and answer 2) are corrected: besides Read, Grep, Glob and the allowed git forms, the client runs its built-in read-only commands (cat, for example) on workspace paths without an allow rule, alone or as a part of a chain. A chain that reads outside the workspace is refused whole (R18, R39, R40, R46), a bare outside read is refused (R17), and reads outside the repository that pass the permission layer are stopped by the OS sandbox (R9, R29, R30, R45). The sandbox remains the boundary.',
        unchanged: 'fence6\'s settings, deny rules and allow list, matrix6, its rows and its judge are unchanged; no escape row\'s verdict changed; no new paid matrix run was made.',
      },
      guard: {
        id: 'A5', files: [`${N}/guard6.mjs`, `${N}/results6.mjs`, `${N}/spotlight-gate.mjs`, `${N}/run_reviewer6.mjs`, `${N}/freeze.mjs`],
        rule: 'Counted runs require this amendment too. freeze.mjs gains AMENDMENT6_SHA256 (this file\'s sha256) and AMENDMENT6_NOT_BEFORE (the merge time of the pull request that adds it), both left unset until the re-freeze. The counted guard refuses unless the pre-registration hashes to PREREG6_SHA256, this file hashes to AMENDMENT6_SHA256 and names that pre-registration as its parent, every pre-registered file hashes to its pin as re-pinned below, every file this amendment pins hashes to its pin, and the call starts after AMENDMENT6_NOT_BEFORE (which the run records as its notBefore). The run record and the results record carry amendment6Sha256; the scorer checks it; the spotlight gate opens only when the results and the bound reviewer run record name the frozen AMENDMENT6_SHA256. The gate\'s predicate and every other check are unchanged.',
      },
    },
    pins,
    runnersPins: `${N}/runners.sha256 is re-pinned for the ${Object.keys(pins).length} files above and freeze.mjs (which the re-freeze changes again); every other pin in it is unchanged.`,
    spend: {
      capUsd: LIMITS6.capUsd, preCountedCeilingUsd: LIMITS6.preCountedCeilingUsd, ledger: LEDGER,
      calls: spend,
      spentUsd: Number(fixed7(total)), matrixUsd: Number(fixed7(sumOf(matrix))), practiceUsd: Number(fixed7(sumOf(byKind('practice')))),
      sum: `${fixed7(sumOf(matrix))} (${matrix.length} isolation-matrix lines, the pre-registration's) + ${fixed7(sumOf(byKind('practice')))} (${byKind('practice').length} practice lines, the dry run) = ${fixed7(total)}`,
      preCountedRemainingUsd: Number(fixed7(units(LIMITS6.preCountedCeilingUsd) - total)),
      reserveUsd: Number(fixed7(reserve)),
      preCountedHeadroomUsd: Number(fixed7(units(LIMITS6.preCountedCeilingUsd) - total - reserve)),
    },
    projection: {
      dryRunRuns: practice.length, meanUsd: Number(fixed7(mean)), p90Usd: Number(fixed7(p90)), maxUsd: Number(fixed7(max)),
      method: 'per-run cost of the dry run\'s practice lines; p90 by results.mjs percentile (numpy linear interpolation)',
      prerunProbeUsd: Number(fixed7(prerun)), prerunProbeRule: 'the largest isolation-matrix line so far, as the estimate of the measured run\'s one pre-run matrix probe',
      countedRuns: LIMITS6.countedRuns,
      formula: 'spent + 180 × per-run cost + pre-run probe + reserve',
      projectedMeanUsd: Number(fixed7(project(mean))), projectedP90Usd: Number(fixed7(project(p90))), projectedMaxUsd: Number(fixed7(project(max))),
      withinCap: project(p90) <= units(LIMITS6.capUsd),
      statement: `Projected counted spend at the dry run's p90: $${fixed7(total)} + 180 × $${fixed7(p90)} + $${fixed7(prerun)} + $${fixed7(reserve)} = $${fixed7(project(p90))}, within the $${LIMITS6.capUsd} cap (at the mean $${fixed7(project(mean))}, at the max $${fixed7(project(max))}).`,
    },
    countedCalls: `No counted call has been made: the ledger holds ${matrix.length} isolation-matrix lines and ${byKind('practice').length} practice lines, and no counted or pre-run line.`,
    notBefore: 'No counted reviewer run starts before the merge time of the odin-rnd pull request that adds this file; that time is recorded after publication, frozen with this file\'s sha256 in freeze.mjs (AMENDMENT6_NOT_BEFORE, AMENDMENT6_SHA256), and every counted call must start after it. It replaces the pre-registration\'s not-before as the counted clock. The answer-key pre-flight record must end after it.',
    unchanged: [
      'The pre-registration, byte for byte (sha256 41efb90d…), and everything in it this amendment does not list.',
      'The question, the bar (EXP 005 amendment 01\'s four criteria, thresholds, denominators, hold rule and labels), the run-state mapping and the manipulation limit (at most 18 of 180 runs BLIND).',
      'The corpus, inputs, labels, rules, base commit, prompt, reviewer (nina 0.34.0), client, model, effort, k and timeout, and the registered command (its sha256 is unchanged).',
      'fence6 (settings, deny rules, sandbox and allow list), matrix6 and its judge, the attempted-per-row check, and every escape row\'s verdict.',
      'The change fingerprints, the base lines, the practice rows and the harness-failure definition.',
      'The spend cap ($60), the pre-counted ceiling ($10), the unknown-cost upper bound and the ledger rule.',
      'The spotlight decision rule, the artefact a PASS publishes, and the spotlight gate\'s predicate.',
    ],
    limits: [
      'The two dry-run runs counted BLIND kept no tool output (that was the defect), so they are not re-classified here; the amended rule is shown on synthetic outputs built from the same two commands and a real p01 and p02 diff, and the base-only and synthetic-seen checks over all 60 items still hold.',
      'A git command reached only through a newline, a lone &, $(…) or backticks is not split out, so such a call is not a git call and a run that saw the change only that way is counted BLIND: an error against the bar and the manipulation check, never toward a spotlight.',
      'A git call\'s whole scrubbed output is kept, including the output of its other parts (the dry run\'s cat of rules.txt): it is scrubbed and linted like every other kept output, and the rules.txt text is EXP 005\'s public rules file.',
      'A digest field is recognised by its key and its exact form only; a 64-hex value under any other key is still scanned, so a chance match there would still refuse a record.',
      'The projection assumes the counted runs cost like the 17 practice runs; the spend guard, not the projection, enforces the cap before every call.',
    ],
    siteQualifier: {
      rule: 'The build adds these lines, from this record, to the EXP 006 field note and to its row on the home page, linked to this amendment\'s section (#amendment-01).',
      note: `${statusText}: the record lint no longer mistakes a digest for a restricted term, a compound git call now counts as a git call, and the client's built-in reads are disclosed.`,
      row: `${statusText}.`,
      meta: `${statusText}.`,
    },
    attribution: { nina: prereg.attribution.nina, ninaUrl: prereg.attribution.ninaUrl },
    files: Object.fromEntries([...DRY_RUN.map(d => d.file), PROBE_OF_RECORD].map(f => [f, sha256(read(f))])),
  };
}

const hex = /^[a-f0-9]{64}$/;

/** The invariants a record must hold, beyond being exactly the build of the files. */
export function validateAmendment(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const prereg = JSON.parse(read(preregPath));
  assert.equal(record.kind, 'amendment');
  assert.equal(record.id, 'amendment-01');
  assert.equal(record.parent.sha256, PARENT.sha256, 'the parent is the published EXP 006 pre-registration');
  assert.equal(record.statusText, statusText);
  assert.match(record.statusText, /before any counted run/);
  // The re-pinned files: each has a reason, its old pin is the pre-registration's, its new pin is the file on disk.
  assert(Object.keys(record.pins).length > 0, 'an amendment that re-pins nothing');
  for (const [f, p] of Object.entries(record.pins)) {
    assert(PINNED.includes(f), `${f} is not a file the pre-registration pins`);
    assert.equal(p.from, prereg.files[f], `${f}: the old pin is not the pre-registration's`);
    assert.equal(p.to, sha256(read(f)), `${f}: the new pin is not the file on disk`);
    assert.notEqual(p.from, p.to, `${f} is re-pinned to the same sha256`);
    assert.ok(p.reason, `${f} is re-pinned with no stated reason`);
  }
  for (const f of PINNED) if (!(f in record.pins)) assert.equal(sha256(read(f)), prereg.files[f], `${f} differs from the pre-registration and is not re-pinned by this amendment`);
  assert(!(`${N}/fence6.mjs` in record.pins) && !(`${N}/matrix6.mjs` in record.pins), 'the fence and the matrix are unchanged (A3)');
  // The spend: the itemised lines are the ledger, they sum to the total to the 7th decimal; no counted call yet.
  const s = record.spend;
  assert.equal(units(s.spentUsd), s.calls.reduce((t, c) => t + units(c.costUsd), 0));
  assert.equal(units(s.spentUsd), units(s.matrixUsd) + units(s.practiceUsd));
  assert(s.calls.every(c => c.costUsd > 0), 'never a $0 line');
  assert(s.calls.every(c => ['isolation-matrix', 'practice'].includes(c.kind)), 'no counted or pre-run call before this amendment');
  assert.equal(record.projection.withinCap, true, 'the projected counted spend is within the cap; otherwise the founder is asked first');
  // The text: the pre-registration's registered rule is kept verbatim, the amended rule is the runner's.
  assert.equal(record.changes.gitCall.registeredRule, prereg.classifier.rule, 'the registered rule is the pre-registration\'s, verbatim');
  assert.equal(record.changes.gitCall.rule, RULE, 'the amended rule is the one the runner stamps');
  for (const f of Object.keys(record.files)) assert(hex.test(record.files[f]), `${f} pin`);
  const text = JSON.stringify(record);
  assert(!localPath.test(text), 'a local machine path in the amendment');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'a float artefact in the amendment');
  assert(!/before any gate ran|Recorded experiment/i.test(text), 'wording an amendment never uses');
  return record;
}

export function checkAmendment(root = '.') {
  const read = file => readFileSync(join(root, file));
  assert.equal(sha256(read(preregPath)), PARENT.sha256, `${preregPath} is not the published EXP 006 pre-registration`);
  assert.equal(read(preregPinPath).toString('utf8').split(/\s+/)[0], PARENT.sha256, `${preregPinPath} is not the published pre-registration's sha256`);
  const bytes = read(amendmentPath);
  const pinned = existsSync(join(root, amendmentPinPath)) ? read(amendmentPinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${amendmentPath} differs from the sha256 pinned in ${amendmentPinPath}: review the change, then node scripts/nina-changes-amendment.mjs --pin`);
  const record = validateAmendment(JSON.parse(bytes), root);
  assert.deepEqual(record, buildAmendment(root), `${amendmentPath} differs from its build: run node scripts/nina-changes-amendment.mjs --write, review the diff, then --pin`);
  return { record, sha256: sha256(bytes), bytes };
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    writeFileSync(amendmentPath, render(validateAmendment(buildAmendment())));
    console.log(`Built ${amendmentPath} (sha256 ${sha256(readFileSync(amendmentPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateAmendment(JSON.parse(readFileSync(amendmentPath, 'utf8')));
    writeFileSync(amendmentPinPath, `${sha256(readFileSync(amendmentPath))}  amendment-01.json\n`);
    console.log(`Pinned ${amendmentPath} in ${amendmentPinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/nina-changes-amendment.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment();
  console.log(`PASS ${amendmentPath} sha256 ${digest} (parent ${PARENT.sha256})`);
}
