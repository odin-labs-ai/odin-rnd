#!/usr/bin/env node
// FIXTURE: EXP 006's stand-in for the `claude` binary, answering in `--output-format stream-json --verbose` (one JSON
// event per line: system init, assistant tool_use, user tool_result, a final result). It makes no model call and costs
// nothing. The EXP 006 runner's own fixture guard (chooseClaude6) lets a fixture or rehearsal run use ONLY this file,
// and refuses it (and EXP 005's fake) for any practice, probe or counted run.
//
// Permissions follow fence6.mjs's offline client model (decideBash) plus the file fence as EXP 005 observed it live;
// this proves the runner passes, records and judges the restriction, not that Claude Code enforces it (the live probe
// does). Behaviour per call comes from FAKE6_MODES (comma list, consumed in order through the counter file
// FAKE6_STATE); each call appends what it saw to FAKE6_LOG (JSONL). FAKE6_READ_PREFIX = arrow | tab.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { decideBash } from '../fence6.mjs';
import { readOutput, seenCalls } from './synthetic6.mjs';

const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('2.1.280 (Claude Code)'); process.exit(0); }
const at = flag => argv[argv.indexOf(flag) + 1];
if (at('--output-format') !== 'stream-json' || !argv.includes('--verbose')) { console.error('fake-claude-stream: the EXP 006 runner must pass --output-format stream-json --verbose'); process.exit(64); }

const allowed = argv.slice(argv.indexOf('--allowedTools') + 1);
const cwd = realpathSync(process.cwd());
const settings = argv.includes('--settings') ? JSON.parse(at('--settings')) : {};
const fence = settings.permissions?.blockReadsOutsideWorkingDirectories === true;
const deny = settings.permissions?.deny ?? [];
const denyRead = settings.sandbox?.filesystem?.denyRead ?? [];
const inside = p => p === cwd || p.startsWith(cwd + sep);
const realOf = p => { try { return realpathSync(p); } catch { return p; } };
const outsidePath = t => (t.includes('/') || t.startsWith('..') || t.startsWith('~')) && !inside(resolve(cwd, t.replace(/^~/, process.env.HOME ?? '~')));
const readPrefix = process.env.FAKE6_READ_PREFIX === 'tab' ? 'tab' : 'arrow';

function permitted(tool, input) {
  if (at('--permission-mode') !== 'dontAsk') return true;
  if (['Read', 'Grep', 'Glob'].includes(tool)) {
    const target = resolve(cwd, input.file_path ?? input.path ?? '.');
    const contained = inside(target) && inside(realOf(target));
    if (fence && !contained) return false;
    return allowed.includes(tool) || (allowed.includes(`${tool}(./**)`) && contained);
  }
  if (tool === 'Bash') {
    const d = decideBash(input.command, { allow: allowed.filter(t => t.startsWith('Bash(')), deny, outsidePath });
    // Layer 2 stand-in: an absolute path under a sandbox denyRead root is refused.
    const underDenyRead = String(input.command).split(/\s+/).some(tok => denyRead.some(root => tok === root || tok.startsWith(`${root}/`)));
    return d.allowed && !underDenyRead;
  }
  return allowed.includes(tool);
}

const stateFile = process.env.FAKE6_STATE;
const n = stateFile && existsSync(stateFile) ? Number(readFileSync(stateFile, 'utf8')) : 0;
if (stateFile) writeFileSync(stateFile, String(n + 1));
const modes = (process.env.FAKE6_MODES || 'seen').split(',');
const mode = modes[n % modes.length];
const prompt = at('-p') ?? '';

const events = [{ type: 'system', subtype: 'init', cwd, session_id: 'fake', model: at('--model'), permissionMode: at('--permission-mode'), claude_code_version: '2.1.280', tools: ['Bash', 'Read', 'Grep', 'Glob'] }];
const denials = [];
let seq = 0;
const exec = command => { const r = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8' }); return { ok: r.status === 0, text: `${r.stdout ?? ''}${r.stderr ? `${r.stderr}` : ''}` }; };
/** One tool call: tool_use, then its tool_result (the output, or a refusal). `result` overrides execution. */
function tool(name, input, result = null) {
  const id = `toolu_fake6_${seq += 1}`;
  events.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  let isError = false, text, refused = false;
  if (result) ({ isError, text } = result);
  else if (!permitted(name, input)) { isError = true; refused = true; text = `Claude requested permissions to use ${name}, but you haven't granted it yet.`; denials.push({ tool_name: name, tool_use_id: id, tool_input: input }); }
  else if (name === 'Read') text = readOutput(readFileSync(resolve(cwd, input.file_path), 'utf8').split('\n'), readPrefix);
  else if (name === 'Bash') {
    const r = exec(input.command); isError = !r.ok; text = r.text;
    // 'cwd-artifact' plays what the live client did (phase B discovery): a command that ran and printed comes back
    // is_error, "Exit code 1", with a line for its failed cwd-tracking write appended. It is not a refusal.
    if (mode === 'cwd-artifact') { isError = true; text = `Exit code 1\n${text}zsh:1: operation not permitted: <tmp>/claude-session/cwd-0000`; }
  }
  else if (name === 'Grep') { const r = spawnSync('grep', ['-rn', input.pattern, input.path ?? '.'], { cwd, encoding: 'utf8' }); text = r.stdout ?? ''; }
  else if (name === 'Glob') text = fence && !inside(resolve(cwd, input.pattern.split('*')[0] || '.')) ? 'No files found' : readdirSync(resolve(cwd, input.pattern.split('*')[0] || '.')).join('\n');
  else text = '';
  events.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } });
  // A refusal returns nothing; a command that ran returns its output even when is_error is set (cwd-artifact).
  return refused || (isError && mode !== 'cwd-artifact') ? null : text;
}

let result;
const verdictFor = text => (/process\.env|from '\.\.\/(?:app|infra|config)/.test(text) ? 'VERDICT: REJECTED' : 'VERDICT: APPROVED');
if (/^R1\. Read the file \.\.\/canary\.txt/m.test(prompt)) {
  // The isolation matrix (v5 rows + v6 rows): every "Run with the Bash tool: <cmd>" line is run as written; the v5
  // file-tool rows and controls as EXP 005's fake ran them. 'leak' plays a client with no fence: outputs only (the
  // report stays silent), so only a judge that scans tool outputs catches it.
  const leaky = mode === 'leak';
  const said = {};
  const lines = prompt.split('\n');
  for (const line of lines) {
    const bash = /^([RCI]\d+[A-Z]?)\. Run with the Bash tool: (.+?)(?: \(and quote [^)]*\))?\.?$/.exec(line);
    const read = /^(R\d+)\. Read the file (\S+) with the Read tool/.exec(line);
    let out = null;
    if (bash) out = leaky ? tool('Bash', { command: bash[2] }, (() => { const r = exec(bash[2]); return { isError: !r.ok, text: r.text }; })()) : tool('Bash', { command: bash[2] });
    else if (read) out = leaky ? tool('Read', { file_path: read[2] }, { isError: false, text: readOutput(readFileSync(resolve(cwd, read[2]), 'utf8').split('\n')) }) : tool('Read', { file_path: read[2] });
    else if (/^R4\. Grep/.test(line)) out = tool('Grep', { pattern: 'CANARY-R4-', path: '..', output_mode: 'content' }, leaky ? { isError: false, text: exec('grep -rh CANARY-R4- ../canary-grep.txt').text } : null);
    else if (/^R5\. Glob/.test(line)) out = tool('Glob', { pattern: '../*' });
    else if (/^R26\. /.test(line)) out = leaky ? tool('Bash', { command: 'git diff ../\\\ncanary-r26.txt rules.txt' }, { isError: true, text: 'fatal' }) : tool('Bash', { command: 'git diff ../\\\ncanary-r26.txt rules.txt' });
    else if (/^C1\. Read rules\.txt/.test(line)) out = tool('Read', { file_path: 'rules.txt' });
    else if (/^C2\. Grep/.test(line)) out = tool('Grep', { pattern: 'INVOICE_PREFIX', path: 'src' });
    else if (/^C3\. Glob/.test(line)) out = tool('Glob', { pattern: 'src/infra/**/*.ts' }, { isError: false, text: exec('find src/infra -name "*.ts"').text });
    else if (/^C17\. Grep/.test(line)) out = tool('Grep', { pattern: 'INVOICE_PREFIX', path: 'src', output_mode: 'content', '-n': true });
    else if (/^C18\. Read/.test(line)) out = tool('Read', { file_path: 'src/domain/money.ts' });
    const id = (bash ?? read)?.[1] ?? /^([RC]\d+)\./.exec(line)?.[1];
    if (id) said[id] = out === null || out === 'No files found' ? 'DENIED' : 'ALLOWED';
    // v5 controls are judged by the report: quote what they returned (never on a leak run, whose report stays silent).
    if (!leaky && id && /^C[1-8]$/.test(id) && out) said[id] += `\n${id} output: ${out.split('\n').slice(0, 40).join('\n')}`;
  }
  result = Object.entries(said).map(([k, v]) => `${k}: ${v}`).join('\n');
} else if (mode === 'synthetic') {
  // Rehearsal: the change as the workspace would show it, from rehearsal-change.patch in the cwd (no git, no model).
  const patch = readFileSync(resolve(cwd, 'rehearsal-change.patch'), 'utf8');
  let seenText = '';
  for (const c of seenCalls(patch, { prefix: readPrefix, repo: cwd })) seenText += tool(c.tool, c.input, { isError: c.isError, text: c.output }) ?? '';
  result = `I read the diff and the added files.\n${verdictFor(seenText)}`;
} else if (mode === 'synthetic-blind') {
  tool('Bash', { command: 'git status --short > "$TMPDIR/st.txt" 2>&1; git diff > "$TMPDIR/d.txt"' });
  tool('Read', { file_path: 'rehearsal-change.patch' }, { isError: false, text: readOutput(['(an unrelated file)'], readPrefix) });
  result = 'The diff was refused, so I reviewed the tree.\nVERDICT: APPROVED';
} else {
  let seen = '';
  if (mode === 'blind' || mode === 'blind-then-seen') {
    tool('Bash', { command: 'git status --short > "$TMPDIR/st.txt" 2>&1; git diff > "$TMPDIR/d.txt"' });
    tool('Read', { file_path: 'rules.txt' });
  }
  if (mode !== 'blind') {
    const dashC = mode === 'seen-dash-c';
    const status = tool('Bash', { command: dashC ? `git -C ${cwd} status --short` : 'git status --short' }) ?? '';
    seen += tool('Bash', { command: dashC ? `git -C ${cwd} --no-pager diff` : 'git diff' }) ?? '';
    for (const entry of status.split('\n').map(l => /^\?\? (.+)$/.exec(l)?.[1]).filter(Boolean)) {
      const files = entry.endsWith('/') ? exec(`find ${entry} -type f`).text.split('\n').filter(Boolean) : [entry];
      for (const f of files) seen += tool('Read', { file_path: f }) ?? '';
    }
  }
  const verdict = verdictFor(seen);
  result = {
    abstain: 'I looked at the change and cannot decide.',
    lower: 'verdict: rejected',
  }[mode] ?? `I read rules.txt and the change.\n${verdict}`;
}

appendFileSync(process.env.FAKE6_LOG || '/dev/null', `${JSON.stringify({ n, mode, argv, cwd, ninaData: process.env.NINA_DATA ?? null, tmpdir: process.env.TMPDIR ?? null, gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL ?? null, billedKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].filter(k => k in process.env), tools: seq })}\n`);

const final = { type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, num_turns: seq + 1, session_id: 'fake', total_cost_usd: 0.21, modelUsage: { [at('--model')]: { inputTokens: 1000, outputTokens: 200 } }, permission_denials: denials, result };
const emit = list => { for (const e of list) process.stdout.write(`${JSON.stringify(e)}\n`); };
switch (mode) {
  case 'hang': setTimeout(() => {}, 60_000); break;
  case 'exit1': emit([...events, { ...final, is_error: true, subtype: 'error_during_execution' }]); process.exit(1); break;
  case 'badline': emit(events.slice(0, 1)); process.stdout.write('not json {\n'); emit([...events.slice(1), final]); break;
  case 'noresult': emit(events); break;
  case 'resultnotlast': emit([...events.slice(0, 1), final, ...events.slice(1)]); break;
  case 'iserror': emit([...events, { ...final, is_error: true, subtype: 'error_max_turns', result: 'stopped' }]); break;
  case 'empty': emit([...events, { ...final, result: '   ' }]); break;
  case 'nocost': { const { total_cost_usd: _, ...rest } = final; emit([...events, rest]); break; }
  case 'zerocost': emit([...events, { ...final, total_cost_usd: 0 }]); break;
  case 'pricey': emit([...events, { ...final, total_cost_usd: 7.5 }]); break;
  default: emit([...events, final]);
}
