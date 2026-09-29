// EXP 005: which counted reviewer runs saw the change they were asked to review. A deterministic classifier over
// the committed reviewer record, results/reviewer.json. It uses the tool evidence the record keeps and falls
// back on the report's own words only where it must:
//   - Tool evidence. The record keeps every refused tool call (permissionDenials), not the calls that succeeded.
//     A run "was refused a change-reading git command" when one of its refused Bash commands runs git diff, git
//     show, git status or git log.
//   - The report's words. Whether the report says it never saw or ran the diff (NOT_SEEN), or describes the
//     diff as seen (SAW). The phrase sets follow the independent results refute (refute-results q3b), widened
//     only by the forms listed here.
// A run is diff-blind when it was refused a change-reading git command AND its report says it did not see the
// diff AND the report does not describe the diff as seen. It is diff-seen when the report describes the diff as
// seen and does not say otherwise. Everything else is unclear. The diff-blind count is therefore a lower bound.
//   node experiments/jev-gate/diff-visibility.mjs --write   write results/diff-visibility.json
//   node experiments/jev-gate/diff-visibility.mjs --check   the committed file is exactly what this computes
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
export const outFile = join(DIR, 'results', 'diff-visibility.json');
export const NOT_SEEN = new RegExp('('
  + "(couldn.t|could not|can.t|cannot|unable to|wasn.t able to|was not able to|didn.t|did not) (run|use|execute|get|open|read|see|view|show|confirm from) (`?git( -C [^`]*)? ?(diff|status)`?|git|the diff|the change|the actual diff|any git|the git)"
  + '|never (saw|ran|seen|run) (`?git diff`?|the diff|the change|the actual diff)'
  + '|haven.t (seen|read) the (diff|change)'
  + '|without (seeing )?the diff'
  + '|(git|bash|shell)[^.\\n]{0,40}(blocked|denied|refused)[^.\\n]{0,60}(so|instead)'
  + '|(every|all) (bash|shell)[^.\\n]{0,30}(blocked|denied|refused)'
  + '|bash (is|was) (blocked|denied)'
  + ')', 'i');
export const SAW = /(plain `?git diff`?( and `?git status`?)? (worked|ran|succeeded)|i saw the whole change|the diff (shows|adds|contains|changes|is)|`git diff` shows|git diff shows|git status` shows|git status shows|read the diff with plain)/i;
const CHANGE_READING = /\bgit\b[\s\S]*\b(diff|show|status|log)\b/;

const deniedCommands = call => (call.permissionDenials ?? []).map(d => String(d.input?.command ?? d.tool_input?.command ?? ''));
export function classifyRun(call) {
  const text = call.result ?? '';
  const refusedChangeRead = deniedCommands(call).some(cmd => CHANGE_READING.test(cmd));
  const saysNotSeen = NOT_SEEN.test(text), saysSaw = SAW.test(text);
  const cls = refusedChangeRead && saysNotSeen && !saysSaw ? 'diff-blind' : saysSaw && !saysNotSeen ? 'diff-seen' : 'unclear';
  return { id: call.id, run: call.run, class: cls, refusedChangeRead, saysNotSeen, saysSaw, gitToolDenials: call.gitToolDenials ?? 0, decision: call.decision, costUsd: call.costUsd, latencyMs: call.latencyMs, numTurns: call.numTurns };
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
    rule: 'diff-blind: refused a change-reading git command, the report says it did not see or run the diff, and it does not describe the diff as seen. diff-seen: the report describes the diff as seen and does not say otherwise. unclear: everything else. The diff-blind count is a lower bound.',
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
