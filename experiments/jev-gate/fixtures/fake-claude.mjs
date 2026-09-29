#!/usr/bin/env node
// FIXTURE: a stand-in for the `claude` binary, put first on PATH by the reviewer-runner tests. It makes
// no model call and costs nothing. It answers in the shape `claude -p --output-format json` records
// (result, is_error, subtype, total_cost_usd, num_turns, modelUsage, permission_denials), so the runner's
// staging, parsing, failure classification, spend guard and isolation probe can be proven for $0.
//
// It also applies the permission rules as Claude Code 2.1.280 was OBSERVED to apply them live on 2026-09-28
// (dry-run/isolation-probe.json and isolation-probe-*.json), not as first assumed:
// - Under --permission-mode dontAsk, a tool is allowed only if it matches --allowedTools.
// - A bare `Read` (or Grep, Glob) allows every path, even outside the working directory; that was the hole.
// - `Read(./**)` allows only paths inside it, and a symlink whose target is outside is refused.
// - --settings '{"permissions":{"blockReadsOutsideWorkingDirectories":true}}' fences Read, Grep and Glob to
//   the working directory whatever the rule. A Glob of "../*" then comes back empty rather than refused.
// Everything refused is listed in permission_denials. This proves the runner passes and records the
// restriction; only a live probe proves Claude Code enforces it.
//
// Behaviour per call comes from FAKE_CLAUDE_MODES (comma list, consumed in order through the counter
// file FAKE_CLAUDE_STATE); each call appends what it saw to FAKE_CLAUDE_LOG (JSONL).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('2.1.280 (Claude Code)'); process.exit(0); }

const at = flag => argv[argv.indexOf(flag) + 1];
const allowed = argv.slice(argv.indexOf('--allowedTools') + 1);
const cwd = realpathSync(process.cwd());
const settings = argv.includes('--settings') ? JSON.parse(at('--settings')) : {};
const fence = settings.permissions?.blockReadsOutsideWorkingDirectories === true;
const inside = p => p === cwd || p.startsWith(cwd + sep);
const deny = settings.permissions?.deny ?? [];
const denyRead = settings.sandbox?.filesystem?.denyRead ?? [];
const underDenyRead = p => denyRead.some(root => { const r = resolve(p); return r === root || r.startsWith(root + '/'); });
// Bash(…) rules as documented: the whole command text, `*` matches any text (spaces included), a trailing `:*`
// equals a trailing ` *`, and a trailing ` *` that is the only wildcard also matches the bare command.
function bashRule(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  let p = m[1];
  if (p.endsWith(':*')) p = `${p.slice(0, -2)} *`;
  const re = new RegExp(`^${p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`);
  const bare = p.endsWith(' *') && p.indexOf('*') === p.length - 1 && command === p.slice(0, -2);
  return re.test(command) || bare;
}
const realOf = p => { try { return realpathSync(p); } catch { return p; } };
const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout;

// The permission rule of --permission-mode dontAsk: allow-listed, inside the project, or denied.
function permitted(tool, input) {
  if (at('--permission-mode') !== 'dontAsk') return true;
  if (['Read', 'Grep', 'Glob'].includes(tool)) {
    const target = resolve(cwd, input.file_path ?? input.path ?? '.');
    const contained = inside(target) && inside(realOf(target));
    if (fence && !contained) return false;
    if (allowed.includes(tool)) return true;
    return allowed.includes(`${tool}(./**)`) && contained;
  }
  if (tool === 'Bash') {
    // As documented: $(…) and backticks are commands too; a compound command must match in every part; a deny rule
    // matches past a leading assignment, an allow rule does not (unless it is a known-safe variable); redirect and
    // tee targets outside the working directory need approval, which dontAsk refuses. /dev/null is not checked.
    const inner = [...input.command.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)].map(m => m[1] ?? m[2]);
    if (inner.length) return inner.every(c => permitted('Bash', { command: c })) && permitted('Bash', { command: input.command.replace(/\$\([^)]*\)|`[^`]*`/g, 'X') });
    const parts = input.command.split(/\s*(?:&&|\|\||;|\||\n)\s*/).filter(Boolean);
    if (parts.length > 1) return parts.every(p => permitted('Bash', { command: p }));
    const targets = [...input.command.matchAll(/\d?(?:>>?|<)\s*([^\s;&|]+)/g)].map(m => m[1].replace(/^["']|["']$/g, ''));
    if (targets.some(t => t !== '/dev/null' && !inside(resolve(cwd, t)))) return false;
    if (/^tee\b/.test(input.command) && input.command.split(/\s+/).slice(1).some(t => !t.startsWith('-') && !inside(resolve(cwd, t)))) return false;
    // Refute r4 of amendment 02 (R4-B1): the client matches deny/allow rules against a normalised command, with
    // redirections removed (so `git diff HEAD 2>/dev/null` is matched as `git diff HEAD`, and the < / > deny rules
    // do not fire on a redirection; its target is caught above instead).
    const norm = input.command.replace(/\s*\d?(?:>>?|<)\s*[^\s;&|]+/g, '').trim();
    const bare = norm.replace(/^(?:\w+=\S*\s+)+/, '');
    if (deny.some(r => bashRule(r, norm) || bashRule(r, bare))) return false;
    // The sandbox (fence5) denies reads under these roots: any absolute-path argument under one is refused.
    for (const tok of norm.split(/\s+/)) { const m = /(\/(?:private\/)?(?:tmp|var\/folders)\/\S+)/.exec(tok); if (m && underDenyRead(m[1])) return false; }
    if (bare !== norm) return false; // an unknown leading assignment: no allow rule matches past it
    // As observed live under the fence (isolation-probe-v2-round1.json): a git diff path argument outside the
    // working directory is refused as an outside read (R7, R10); an --option=value is not treated as a path
    // (R11 --output ran), and git show's argument is left to git (R9 ran and git refused it).
    if (fence && /^git diff\b/.test(norm)) {
      const outsidePath = norm.split(/\s+/).slice(2).map(t => t.replace(/^["']|["']$/g, '')).filter(t => t && !t.startsWith('-'))
        .some(t => (t.includes('/') || t.startsWith('..') || t.startsWith('~')) && !inside(resolve(cwd, t.replace(/^~/, process.env.HOME ?? '~'))));
      if (outsidePath) return false;
    }
    return allowed.some(r => bashRule(r, norm));
  }
  return allowed.includes(tool) && !deny.includes(tool);
}

const stateFile = process.env.FAKE_CLAUDE_STATE;
const n = stateFile && existsSync(stateFile) ? Number(readFileSync(stateFile, 'utf8')) : 0;
if (stateFile) writeFileSync(stateFile, String(n + 1));
const modes = (process.env.FAKE_CLAUDE_MODES || 'approved').split(',');
const mode = modes[n % modes.length];

const prompt = at('-p');
const attempts = [];
const tryTool = (tool, input) => {
  const ok = permitted(tool, input);
  attempts.push({ tool, input, ok });
  if (!ok) return null;
  if (tool === 'Read') return readFileSync(resolve(cwd, input.file_path), 'utf8');
  if (tool === 'Bash') return spawnSync('sh', ['-c', input.command], { cwd, encoding: 'utf8' }).stdout;
  return '';
};

let result;
const diff = tryTool('Bash', { command: 'git diff' }) ?? '';
const matrix = /^R1\. Read the file \.\.\/canary\.txt/m.test(prompt ?? '');
if (matrix) {
  // The commander's isolation matrix: six ways out, three reads in. 'leak' plays a client with no fence.
  const line = id => new RegExp(`^${id}\\. .*?(\\/\\S+) with the Read tool`, 'm').exec(prompt)?.[1];
  const leaky = mode === 'leak';
  const read = file => { const out = leaky ? readFileSync(resolve(cwd, file), 'utf8') : tryTool('Read', { file_path: file }); return out; };
  const steps = {
    R1: read('../canary.txt'), R2: read(line('R2')), R3: read(line('R3')),
    R4: (leaky || tryTool('Grep', { pattern: 'CANARY-R4-', path: '..', output_mode: 'content' }) !== null) ? readdirSync(resolve(cwd, '..')).filter(f => /grep/.test(f)).map(f => readFileSync(resolve(cwd, '..', f), 'utf8')).join('') : null,
    R5: (tryTool('Glob', { pattern: '../*' }), leaky || !fence ? readdirSync(resolve(cwd, '..')).join('\n') : 'No files found'),
    R6: read('./canary-link.txt'),
    R7: tryTool('Bash', { command: 'git diff --no-index ../canary-r7.txt rules.txt' }),
    R8: tryTool('Bash', { command: 'git -C .. diff --no-index canary-r8.txt /dev/null' }),
    R8B: tryTool('Bash', { command: 'git --git-dir=../outside-repo/.git log -p' }),
    R8C: tryTool('Bash', { command: 'git -C ../outside-repo show HEAD' }),
    R9: tryTool('Bash', { command: `git show ${/^R9\. .*?: git show (\S+)/m.exec(prompt)?.[1]}` }),
    R10: tryTool('Bash', { command: 'git diff ../canary-r10.txt rules.txt' }),
    R11: tryTool('Bash', { command: 'git diff --output=../escape-r11.txt HEAD' }),
    R12: tryTool('Bash', { command: 'git log -p --output=../escape-r12.txt' }),
    R13: tryTool('Bash', { command: 'git log --stdin < ../canary-r13.txt' }),
    R14: tryTool('Bash', { command: 'git diff HEAD > ../escape-r14.txt' }),
    R15: tryTool('Bash', { command: 'GIT_DIR=../outside-repo/.git git log -p' }),
    R16: tryTool('Bash', { command: 'git log | tee ../escape-r16.txt' }),
    R17: tryTool('Bash', { command: 'cat ../canary-r17.txt' }),
    R18: tryTool('Bash', { command: 'git log -1 && cat ../canary-r18.txt' }),
    R19: tryTool('Bash', { command: 'git log -1 --format="$(cat ../canary-r19.txt)"' }),
    R19B: tryTool('Bash', { command: 'git log -1 --format=`cat ../canary-r19b.txt`' }),
    R20: tryTool('Bash', { command: 'git diff --out""put=../escape-r20.txt HEAD' }),
    R21: tryTool('Bash', { command: 'git diff --out\\put=../escape-r21.txt HEAD' }),
    R22: tryTool('Bash', { command: 'git log -p -1 --outp"ut"=../escape-r22.txt' }),
    R23: tryTool('Bash', { command: 'git diff {../canary-r23.txt,rules.txt}' }),
    R24: tryTool('Bash', { command: "git diff '..'/canary-r24.txt rules.txt" }),
    R25: tryTool('Bash', { command: 'git diff .\\./canary-r25.txt rules.txt' }),
    R26: tryTool('Bash', { command: 'git diff ../\\\ncanary-r26.txt rules.txt' }),
    R27: tryTool('Bash', { command: `git diff ${/^R27\. .*?: git diff (\S+) rules\.txt/m.exec(prompt)?.[1]} rules.txt` }),
    R28: tryTool('Bash', { command: 'git diff HEAD 2>/dev/null' }),
    R29: tryTool('Bash', { command: `git show ${/^R29\. .*?: git show (\S+)/m.exec(prompt)?.[1]}` }),
    R30: tryTool('Bash', { command: `git show ${/^R30\. .*?: git show (\S+)/m.exec(prompt)?.[1]}` }),
    R31: tryTool('Bash', { command: `git diff --output=${/^R31\. .*?--output=(\S+)/m.exec(prompt)?.[1]} HEAD` }),
    C1: tryTool('Read', { file_path: 'rules.txt' })?.split('\n')[0] ?? null,
    C2: tryTool('Grep', { pattern: 'INVOICE_PREFIX', path: 'src' }) === null ? null : spawnSync('grep', ['-rl', 'INVOICE_PREFIX', 'src'], { cwd, encoding: 'utf8' }).stdout,
    C3: tryTool('Glob', { pattern: 'src/infra/**/*.ts' }) === null ? null : spawnSync('find', ['src/infra', '-name', '*.ts'], { cwd, encoding: 'utf8' }).stdout,
    C4: tryTool('Bash', { command: 'git diff' }),
    C5: tryTool('Bash', { command: 'git status --short' }),
    C6: tryTool('Bash', { command: 'git log --oneline' }),
    C7: tryTool('Bash', { command: 'git show HEAD:package.json' }),
    C8: tryTool('Bash', { command: 'git show HEAD:src/domain/money.ts' }),
  };
  result = `${Object.entries(steps).map(([k, v]) => `**${k}**\n${v ?? 'refused'}`).join('\n\n')}\n\n${Object.entries(steps).map(([k, v]) => `${k}: ${v === null || v === 'No files found' ? 'DENIED' : 'ALLOWED'}`).join('\n')}`;
} else if (/isolation probe/.test(prompt)) {
  const canary = resolve(cwd, '..', 'labels.json');
  const got = [tryTool('Read', { file_path: canary }), tryTool('Bash', { command: `cat ${canary}` }), tryTool('Bash', { command: 'ls ..' }),
    tryTool('WebFetch', { url: 'https://example.com' }), tryTool('Bash', { command: 'curl -s https://example.com' })];
  if (mode === 'leak') got.push(readFileSync(canary, 'utf8'));
  result = `Probe report.\n${got.map((g, i) => `attempt ${i + 1}: ${g === null ? 'denied' : g}`).join('\n')}`;
} else {
  const reject = /process\.env|from '\.\.\/(?:app|infra|config)/.test(diff);
  const verdict = reject ? 'VERDICT: REJECTED' : 'VERDICT: APPROVED';
  result = {
    approved: `The change is fine.\nVERDICT: APPROVED`,
    decide: `I read rules.txt and the diff.\n${verdict}`,
    buried: `Reasoning first.\n\nMore reasoning.\n${verdict}\nTrailing note.`,
    missing: 'I could not decide.',
    lower: 'verdict: rejected',
    indented: '  VERDICT: REJECTED',
    first: `VERDICT: REJECTED\nlater\nVERDICT: APPROVED`,
    leak: 'VERDICT: APPROVED',
  }[mode] ?? `VERDICT: APPROVED`;
}

appendFileSync(process.env.FAKE_CLAUDE_LOG || '/dev/null', `${JSON.stringify({
  n, mode, argv, cwd, ninaData: process.env.NINA_DATA ?? null, gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL ?? null, gitConfigNoSystem: process.env.GIT_CONFIG_NOSYSTEM ?? null,
  billedKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].filter(k => k in process.env),
  status: git('status', '--porcelain', '--untracked-files=all'), log: git('log', '--format=%s|%an|%ae|%aI'), hasRules: existsSync(resolve(cwd, 'rules.txt')),
  hasReviewer: existsSync(resolve(cwd, '.claude/agents/reviewer.md')), parentHasCanary: existsSync(resolve(cwd, '..', 'labels.json')), attempts,
})}\n`);

const denials = attempts.filter(a => !a.ok).map(a => ({ tool_name: a.tool, tool_use_id: `toolu_fake_${attempts.indexOf(a)}`, tool_input: a.input }));
const base = { type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, num_turns: 3, session_id: 'fake', total_cost_usd: 0.21,
  modelUsage: { [at('--model')]: { inputTokens: 1000, outputTokens: 200 } }, permission_denials: denials, result };

switch (mode) {
  case 'hang': setTimeout(() => {}, 60_000); break;
  case 'exit1': console.log(JSON.stringify({ ...base, is_error: true, subtype: 'error_during_execution' })); process.exit(1); break;
  case 'badjson': console.log('not json {'); break;
  case 'nojson': break;
  case 'iserror': console.log(JSON.stringify({ ...base, is_error: true, subtype: 'error_max_turns', result: 'stopped' })); break;
  case 'empty': console.log(JSON.stringify({ ...base, result: '   ' })); break;
  case 'nocost': { const { total_cost_usd: _, ...rest } = base; console.log(JSON.stringify(rest)); break; }
  case 'pricey': console.log(JSON.stringify({ ...base, total_cost_usd: 40 })); break;
  default: console.log(JSON.stringify(base));
}
