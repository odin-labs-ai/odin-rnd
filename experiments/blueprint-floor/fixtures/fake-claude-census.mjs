#!/usr/bin/env node
// EXP 007 rehearsal fake of the model client (WO-2-02). It is NEVER a model: it reads the prompt from stdin and prints a
// canned `--output-format json` result object. A paid run refuses it (census-run.mjs chooseClaude7); a rehearsal must
// resolve `claude` to exactly this file. The census runner's child environment is an allowlist, so the fake takes no
// configuration from the environment: it reads fake7.json and keeps fake7.state / fake7.log.jsonl in the directory of
// the path it was invoked by (the test's symlink directory, which the test puts first on PATH).
//   fake7.json (optional): { "plan": { "<1-based call index>": "<behaviour>" } } with a behaviour of
//     garbage | nocost | wrong-model | exit1 | is-error | no-result | canary-leak | timeout | j7-pattern (a translator
//     answer of class not whose rationale quotes a home-directory regex, to exercise the J7 withholding)
// Default answers: the canary answers NONE; the translator answers expressible for the first rule of each shape
// (input kind, flags line, contract form) it sees, partial for the second, and not for every other; the adjudicator
// confirms the stated class, and disputes to not on every seventh adjudicator call.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2.1.280 (Claude Code)\n'); process.exit(0); }

const home = dirname(process.argv[1]);
const at = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const read = (p, d) => (existsSync(p) ? readFileSync(p, 'utf8') : d);
const config = JSON.parse(read(join(home, 'fake7.json'), '{}'));
const state = JSON.parse(read(join(home, 'fake7.state'), '{"calls":0,"adjudicator":0,"shapes":{}}'));
const stdin = readFileSync(0, 'utf8');
state.calls += 1;
const index = state.calls;
const model = at('--model');
const promptFile = at('--system-prompt-file') ?? '';
const role = basename(promptFile).replace(/\.md$/, '');
const behaviour = config.plan?.[String(index)] ?? null;

appendFileSync(join(home, 'fake7.log.jsonl'), `${JSON.stringify({
  index, role, model, argv, envKeys: Object.keys(process.env).sort(), tmpdir: process.env.TMPDIR ?? null, cwd: process.cwd(),
  cwdEntries: readdirSync(process.cwd()), stdinSha256: createHash('sha256').update(stdin).digest('hex'), behaviour,
})}\n`);

const line = (re, s = stdin) => { const m = re.exec(s); return m ? m[1] : null; };
const id = line(/^id: (item-[0-9a-f]{12})$/m);
const inputKind = line(/^input kind: (\w+)$/m);
const flags = line(/^this rule is a regular expression; its flags: (.*)$/m);
const moduleGraph = stdin.includes('module-graph form');

const PROBES = {
  toolCall: { c: { id: 'c1', type: 'forbiddenPattern', pattern: 'rm -rf', path: '.floor/command.txt' }, v: { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, ok: { tool_name: 'Bash', tool_input: { command: 'ls' } } },
  diff: { c: { id: 'c1', type: 'forbiddenPattern', pattern: 'debugger', path: '.floor/added-lines.txt' }, v: { patch: '--- /dev/null\n+++ b/src/app/zz-probe.ts\n@@ -0,0 +1 @@\n+debugger;\n' }, ok: { patch: '--- /dev/null\n+++ b/src/app/zz-probe.ts\n@@ -0,0 +1 @@\n+const zz = 1;\n' } },
  control: { c: { id: 'c1', type: 'forbiddenPattern', pattern: 'debugger', path: 'src/**' }, v: { patch: '--- /dev/null\n+++ b/src/app/zz-probe.ts\n@@ -0,0 +1 @@\n+debugger;\n' }, ok: { patch: '--- /dev/null\n+++ b/src/app/zz-probe.ts\n@@ -0,0 +1 @@\n+const zz = 1;\n' } },
  stopTranscript: { c: { id: 'c1', type: 'forbiddenPattern', pattern: 'todo-left', path: '.floor/final-message.txt' }, v: { transcript: [{ type: 'assistant' }], final_message: 'todo-left in the code' }, ok: { transcript: [{ type: 'assistant' }], final_message: 'done' } },
  file: { c: { id: 'c1', type: 'forbiddenPattern', pattern: 'password=', path: '.floor/files/**' }, v: { path: 'cfg.txt', content: 'password=1' }, ok: { path: 'cfg.txt', content: 'x=1' } },
};

let text;
if (role === 'translator' && stdin.startsWith('List every experiment')) text = behaviour === 'canary-leak' ? 'This is about EXP 005 and the odin-rnd repository.' : 'NONE';
else if (role === 'adjudicator' && stdin.startsWith('List every experiment')) text = behaviour === 'canary-leak' ? 'I see a rule set named nina.' : 'NONE';
else if (role === 'translator') {
  const shape = `${moduleGraph ? 'control' : inputKind}|${flags ?? '-'}`;
  const seen = (state.shapes[shape] = (state.shapes[shape] ?? 0) + 1);
  const p = PROBES[moduleGraph ? 'control' : inputKind];
  const cls = seen === 1 ? 'expressible' : seen === 2 ? 'partial' : 'not';
  text = JSON.stringify(cls === 'not'
    ? { ruleId: id, class: 'not', constraints: [], coverage: '', residual: 'Does the input break the rule as written?', probes: null, rationale: 'Rehearsal answer: the rule needs judgement.' }
    : { ruleId: id, class: cls, constraints: [p.c], coverage: 'the literal form', residual: cls === 'partial' ? 'Does the input break the rule in a form the pattern misses?' : null, probes: { violating: p.v, compliant: p.ok }, rationale: 'Rehearsal answer: a literal pattern decides it.' });
} else if (role === 'adjudicator') {
  state.adjudicator += 1;
  const stated = line(/The stated class to confirm or dispute: (\w+)\s*$/);
  const dispute = state.adjudicator % 7 === 0;
  text = JSON.stringify({ ruleId: id, verdict: dispute ? 'dispute' : 'confirm', proposedClass: dispute ? 'not' : stated, reason: 'Rehearsal adjudication.' });
} else text = 'unknown role';

if (behaviour === 'j7-pattern') text = JSON.stringify({ ruleId: id, class: 'not', constraints: [], coverage: '', residual: 'Does the input read a key under /home/[^/]+/\\.ssh?', probes: null, rationale: 'The rule names /home/[^/]+/\\.ssh as its pattern.' });
writeFileSync(join(home, 'fake7.state'), JSON.stringify(state));
if (behaviour === 'garbage') text = 'this is not json {';
if (behaviour === 'timeout') { setTimeout(() => {}, 3_600_000); } else {
  const cost = role === 'adjudicator' ? 0.0130211 : 0.0421337;
  const out = { type: 'result', subtype: behaviour === 'is-error' ? 'error_during_execution' : 'success', is_error: behaviour === 'is-error', duration_ms: 1234, num_turns: 1, session_id: 'rehearsal' };
  if (behaviour !== 'no-result') out.result = text;
  if (behaviour !== 'nocost') out.total_cost_usd = cost;
  out.modelUsage = { [behaviour === 'wrong-model' ? 'claude-haiku-4-5' : model]: { inputTokens: 100, outputTokens: 50, costUSD: cost } };
  process.stdout.write(JSON.stringify(out));
  process.exit(behaviour === 'exit1' ? 1 : 0);
}
