// EXP 005: which counted reviewer runs saw the change they were asked to review. A deterministic classifier over
// the committed reviewer record, results/reviewer.json. The record keeps every refused tool call
// (permissionDenials) and the final report, but not the calls that succeeded or their output, so there is no
// recorded evidence of a successful git diff: the classifier uses the refusals, and the report's own words where
// it must.
//   - Tool evidence: a run "was refused a change-reading git command" when one of its refused Bash commands runs
//     git diff, git show, git status or git log.
//   - The report says it ran git diff and got its output (STRONG_SAW): diff-seen, whatever else it says.
//   - The report says it never saw, ran or was allowed to run the diff (NOT_SEEN), or describes the diff as seen
//     (SAW). A SAW phrase inside a conditional or hypothetical clause ("if the diff shows…", "whatever the diff
//     contains", "what git diff shows") is not evidence; git status output is not the diff.
// A run is diff-blind when it was refused a change-reading git command AND its report says it did not see the
// diff AND the report does not describe the diff as seen. It is diff-seen when the report describes the diff as
// seen and does not say otherwise. Everything else is unclear: those reports say neither, or say both. The
// phrase sets were checked by reading every run the independent results refute disputed and every unclear run.
//   node experiments/jev-gate/diff-visibility.mjs --write   write results/diff-visibility.json
//   node experiments/jev-gate/diff-visibility.mjs --check   the committed file is exactly what this computes
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
export const outFile = join(DIR, 'results', 'diff-visibility.json');
export const NOT_SEEN = new RegExp('('
  + "(couldn.t|could not|can.t|cannot|unable to|wasn.t able to|was not able to|didn.t|did not) (run|use|execute|get|open|read|see|view|show|confirm from) (`?git( -C [^`]*)? ?diff`?|git|the diff|the change|the actual diff|any git|the git)"
  + '|never (saw|ran|seen|run) (`?git diff`?|the diff|the change|the actual diff)'
  + '|haven.t (seen|read) the (diff|change)'
  + '|without (seeing )?the diff'
  + '|(`?git diff`?|the diff)[^.\\n]{0,40}(never ran|was denied|were denied|was blocked|were blocked)'
  + '|(every|all) (bash|shell)[^.\\n]{0,30}(blocked|denied|refused)'
  + '|bash (is|was) (blocked|denied)'
  + "|(blocked|denied|refused) `?git diff`?[^.\\n]{0,40}(so|instead)"
  + "|(wasn.t|was not|weren.t|were not) allowed to (run|use) `?git diff"
  + ')', 'i');
export const SAW = /(plain `?git diff`?( and `?git status`?)? (worked|ran|succeeded)|i saw the whole change|the diff (shows|adds|contains|changes|is(?! part of))|`git diff` shows|git diff shows|read the diff with plain)/gi;
export const STRONG_SAW = /(i ran `?git diff`?[^.\n]{0,60}(on (their|its) own|separately|directly)|both printed their full output|`?git diff`? (printed|returned) (the|its) (full )?(output|diff))/i;
const HYPO = /\b(what|whatever|if|whether|unless|once|when)\b/i;
const sentenceStart = (t, i) => Math.max(t.lastIndexOf('. ', i), t.lastIndexOf('\n', i), t.lastIndexOf(': ', i)) + 1;
const sawOutsideHypothesis = text => [...text.matchAll(SAW)].some(m => !HYPO.test(text.slice(sentenceStart(text, m.index), m.index)));
const CHANGE_READING = /\bgit\b[\s\S]*\b(diff|show|status|log)\b/;

const deniedCommands = call => (call.permissionDenials ?? []).map(d => String(d.input?.command ?? d.tool_input?.command ?? ''));
export function classifyRun(call) {
  const text = call.result ?? '';
  const refusedChangeRead = deniedCommands(call).some(cmd => CHANGE_READING.test(cmd));
  const saysNotSeen = NOT_SEEN.test(text), saysRanDiff = STRONG_SAW.test(text), saysSaw = saysRanDiff || sawOutsideHypothesis(text);
  const cls = saysRanDiff ? 'diff-seen' : refusedChangeRead && saysNotSeen && !saysSaw ? 'diff-blind' : saysSaw && !saysNotSeen ? 'diff-seen' : 'unclear';
  return { id: call.id, run: call.run, class: cls, refusedChangeRead, saysNotSeen, saysSaw, saysRanDiff, gitToolDenials: call.gitToolDenials ?? 0, decision: call.decision, costUsd: call.costUsd, latencyMs: call.latencyMs, numTurns: call.numTurns };
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Per run, and per class: how many, how many decided correctly against the committed labels, cost, latency, turns.
export function classify({ reviewer, labels }) {
  const truth = Object.fromEntries(labels.items.map(i => [i.id, i.label]));
  const runs = reviewer.calls.map(classifyRun).map(r => ({ ...r, correct: (r.decision === 'REJECT') === (truth[r.id] === 'RED') }));
  const classes = ['diff-blind', 'diff-seen', 'unclear'];
  const summary = Object.fromEntries(classes.map(cls => {
    const s = runs.filter(r => r.class === cls);
    return [cls, s.length ? { runs: s.length, correct: s.filter(r => r.correct).length, meanCostUsd: mean(s.map(r => r.costUsd)), medianLatencyMs: median(s.map(r => r.latencyMs)), meanTurns: mean(s.map(r => r.numTurns)) } : { runs: 0 }];
  }));
  const items = [...new Set(runs.map(r => r.id))];
  const blindPerItem = items.map(id => runs.filter(r => r.id === id && r.class === 'diff-blind').length);
  return {
    schemaVersion: 1, kind: 'diff-visibility', source: 'results/reviewer.json',
    rule: 'diff-blind: refused a change-reading git command, the report says it did not see, run or was not allowed to run the diff, and it does not describe the diff as seen outside a conditional. diff-seen: the report says it ran git diff and got its output, or describes the diff as seen and does not say otherwise. unclear: the report says neither, or says both. The record keeps refused tool calls, not successful ones or their output.',
    runsTotal: runs.length, summary,
    items: { total: items.length, majorityDiffBlind: blindPerItem.filter(n => n * 2 > runs.length / items.length).length, allRunsDiffBlind: blindPerItem.filter(n => n === runs.length / items.length).length },
    runs,
  };
}

const load = () => ({ reviewer: JSON.parse(readFileSync(join(DIR, 'results', 'reviewer.json'), 'utf8')), labels: JSON.parse(readFileSync(join(DIR, 'labels.json'), 'utf8')) });
export const render = record => JSON.stringify(record, null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const record = classify(load());
  if (command === '--write') writeFileSync(outFile, render(record));
  else if (command === '--check') assert.equal(readFileSync(outFile, 'utf8'), render(record), `${outFile} differs from what this classifier computes`);
  else { console.error('usage: node experiments/jev-gate/diff-visibility.mjs --write | --check'); process.exit(2); }
  console.log(JSON.stringify({ runsTotal: record.runsTotal, summary: record.summary, items: record.items }));
}
