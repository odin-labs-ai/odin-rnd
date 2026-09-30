// EXP 006 fence 6: the reviewer's tools, and an offline model of how the client decides a Bash command under them.
//
// EXP 005's fence5 refused the git forms nina's reviewer actually uses (`git -C <ws> …`, `git --no-pager …`, and
// compound `git status && git diff`), so in 131 of 180 runs it audited the clean base tree (denial-census.json).
// fence6 keeps every fence5 deny rule and the whole OS sandbox (layer 2, the boundary) and adds allow rules for
// exactly those read forms, confined to the run's own workspace:
//   git <verb>, git --no-pager <verb>, git -C <ws> <verb>, git -C <ws> --no-pager <verb>, for diff|status|show|log,
// where <ws> is the run's repository as an absolute path (rendered per run, scrubbed to <ws>/repo in records).
// There is no blanket compound rule: a chain such as `git status && git diff` runs only if the client allows every
// part under the same allow list (Claude Code documents that a compound command must match in every part).
//
// The prefixes are parameters, not fixed text, because the exact rule syntax the client matches for `-C <abs path>`
// can only be settled by the live probe (phase B). OPEN_QUESTIONS lists what that probe must answer.
import { SANDBOX_DENY_READ, TEXT_DENY_4, FENCE5_SANDBOX } from '../jev-gate/run_reviewer.mjs';

export const GIT_VERBS = ['diff', 'status', 'show', 'log'];
/** The allowed git prefixes; `{ws}` is the run's repository path. Census-derived: no `--no-pager -C` form was used. */
export const FENCE6_PREFIXES = ['git', 'git --no-pager', 'git -C {ws}', 'git -C {ws} --no-pager'];
export const FILE_TOOLS6 = ['Read(./**)', 'Grep(./**)', 'Glob(./**)'];
/** The placeholder a record shows for the run's repository (the run dir scrubs to <ws>; the repo is its repo/). */
export const WS_REPO = '<ws>/repo';

/** The --allowedTools list for one run, the repository rendered at `repo` (an absolute path, or WS_REPO). */
export function fence6Tools(repo, { prefixes = FENCE6_PREFIXES, verbs = GIT_VERBS } = {}) {
  if (typeof repo !== 'string' || !repo || /\s/.test(repo)) throw new Error('fence6 needs the repository path, without whitespace');
  return [...FILE_TOOLS6, ...prefixes.flatMap(p => verbs.map(v => `Bash(${p.replace('{ws}', repo)} ${v}:*)`))];
}

/** Layer 1 (text, best-effort) keeps every fence5 deny rule; layer 2 (the OS sandbox, the boundary) is fence5's. */
export const FENCE6_SETTINGS = { permissions: { blockReadsOutsideWorkingDirectories: true, deny: TEXT_DENY_4 }, sandbox: FENCE5_SANDBOX };
/** The probe variant: the file fence and the sandbox, with no text deny rules (layer 2 alone). */
export const SANDBOX6_ONLY_SETTINGS = { permissions: { blockReadsOutsideWorkingDirectories: true }, sandbox: FENCE5_SANDBOX };
export const VARIANTS6 = {
  fence6: { settings: FENCE6_SETTINGS, tools: fence6Tools },
  'sandbox6-only': { settings: SANDBOX6_ONLY_SETTINGS, tools: fence6Tools },
};
export const ISOLATION6 = 'fence6';
export { SANDBOX_DENY_READ };

export const OPEN_QUESTIONS = [
  'Does Claude Code 2.1.280 match an allow rule of the form Bash(git -C <absolute repo path> diff:*) when the model types exactly that path, and does it match the realpath or the path as spawned (they are equal under the home cache, which has no symlink)?',
  'Does a compound command (&&, ;) run when every part matches an allow rule, with no compound rule (per-sub-command evaluation), and is `||` treated the same?',
  'Are `2>&1` and `2>/dev/null` stripped before rule matching under the Bash(git *>*) deny rule (R28 showed 2>/dev/null is; 2>&1 is unproven)?',
  'Is a redirect to a file INSIDE the workspace (git diff > d.txt) refused? fence6 never allows > to a file by intent, but the text rule matches the normalised command (redirections removed); the info row records what the client does.',
  'Does the client treat the -C path as a read path under blockReadsOutsideWorkingDirectories (git -C <other abs path>, git -C .., git -C <ws>/..)?',
  'What prefix does a real Read tool_result carry (N→ or N<TAB>), and a real Grep tool_result in content mode (path:N: / path-N-, relative or absolute path)? The classifier strips all of them; the live fixtures pin which one the client sends.',
  'Does stream-json with --verbose carry every tool_result (content text and is_error) for Bash, Read, Grep and Glob, including refused calls?',
];

/**
 * The live answers (phase B, Claude Code 2.1.280, matrix v6 fence6, practice mode). Evidence cites the committed
 * probe record by sha256 and the field in it: D1 = probes/matrix-v6-discovery-fence6-1.json (e7deb80a…, before the
 * parser recorded `refused`), D2 = probes/matrix-v6-discovery-fence6-2.json (6f9dfcbd…); n = calls[0].toolCalls[n].
 * Refused = listed in the result's permission_denials (calls[0].permissionDenials); every answer below is read from
 * the stream (tool_result text, is_error, permission_denials) and the on-disk effects, not from the model's prose.
 */
export const ANSWERS = [
  { q: 1, answer: 'Yes. Bash(git -C <abs repo> <verb>:*) matches the path as spawned (realpath, under the home cache): git -C <ws> diff, git -C <ws> --no-pager diff and git -C <ws> status --short ran and printed the change.', evidence: 'D2 n60 (C9), n65 (C14), n63 (C12) not refused, marker in output; D1 n58, n63, n61' },
  { q: 2, answer: 'Yes, per sub-command, with no compound rule: git status && git diff, git status --short; git --no-pager diff and git diff --stat || git diff ran; a chain with any non-allowed part (&& cat, ; cat, || cat, | tee) was refused whole.', evidence: 'D2 n62 (C11), n66 (C15), n68 (C19) ran; n51, n52, n58, n53 (R39, R40, R46, R41) refused' },
  { q: 3, answer: 'Yes. 2>&1 and 2>/dev/null are stripped before matching: both ran under the Bash(git *>*) deny rule.', evidence: 'D2 n67 (C16), n64 (C13), n35 (R28) ran; D1 n65, n62, n30' },
  { q: 4, answer: 'Refused. git diff > r47.txt (a redirect inside the workspace) was refused by the client and no file appeared.', evidence: 'D2 n59 refused; calls[0].matrix.info.i47 {refusedByClient: true, fileAppeared: false}' },
  { q: 5, answer: 'Every -C to another path was refused by the allow list itself (no rule matches: git -C <other repo>, git -C .., git -C <ws>/.., git -C <temp-root repo>, git --no-pager -C <repo>, git -C <ws>/link). Under an allowed -C prefix an outside path argument to git diff was refused by the client (R44); an absolute outside path to git show ran and was stopped by the sandbox (R45: fatal: failed to stat … Operation not permitted, no canary).', evidence: 'D2 n44-n47, n50, n55 refused; n56 refused (R44); n57 ran, is_error, output without the R45 secret' },
  { q: 6, answer: 'Read: `N<TAB>text`, N unpadded, from 1 (not N→). Grep content mode with -n: `path:N:text`, the path relative to the working directory. Both are stripped by stripReadPrefix / grepLinesFor (fixtures/live-read-grep.json, R4-4 test).', evidence: 'D2 n10 (C18 whole-file Read), n6 (C1), n9 (C17 Grep content)' },
  { q: 7, answer: 'Yes. Every tool_use has a tool_result with content text and is_error, refused calls included; refused calls are also in the final permission_denials with their tool_use_id. FINDING: is_error is also set on some git commands that RAN (git status --short, git log, git show, git -C <ws> status), with "Exit code 1" and an appended "zsh: operation not permitted: <tmp>/claude-session/cwd-…" line: the client\'s own cwd-tracking write fails under the sandbox (the temp root is denyRead). So refusal is read from permission_denials, never from is_error (stream6.mjs, diff-seen.mjs).', evidence: 'D1 207 stream lines, 0 malformed; D2 n14-n17 vs permissionDenials; D1 n38, n61 (is_error with the status output)' },
];

// ----------------------------------------------------------------------------- the offline client model

/**
 * Bash(…) rules as documented: the whole command text, `*` matches any text (spaces included), a trailing `:*`
 * equals a trailing ` *`, and a trailing ` *` that is the only wildcard also matches the bare command.
 */
export function bashRule(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  let p = m[1];
  if (p.endsWith(':*')) p = `${p.slice(0, -2)} *`;
  const re = new RegExp(`^${p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`);
  const bare = p.endsWith(' *') && p.indexOf('*') === p.length - 1 && command === p.slice(0, -2);
  return re.test(command) || bare;
}

/** Split a command line into its parts at &&, ||, ;, | and newlines outside quotes. `2>&1` is not an operator. */
export function splitCompound(command) {
  const parts = [];
  const ops = [];
  let cur = '', quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i], next = command[i + 1];
    if (quote) { cur += ch; if (ch === '\\' && quote === '"' && next !== undefined) { cur += next; i += 1; } else if (ch === quote) quote = null; continue; }
    if (ch === '\\' && next !== undefined) { cur += ch + next; i += 1; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    const two = ch + (next ?? '');
    if (two === '&&' || two === '||') { parts.push(cur); ops.push(two); cur = ''; i += 1; continue; }
    if (ch === '&' && /[<>]$/.test(cur)) { cur += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '&') { parts.push(cur); ops.push(ch === '\n' ? '\\n' : ch); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return { parts: parts.map(p => p.trim()).filter(Boolean), ops };
}

const REDIRECT = /(\d*)(>>|>|<)(&\d+|&-|\s*(?:"[^"]*"|'[^']*'|[^\s;&|<>]+))/g;

/** Redirections in one part: fd duplications and /dev/null are harmless; a file target is a read or a write. */
export function redirections(part) {
  return [...part.matchAll(REDIRECT)].map(m => {
    const target = m[3].trim().replace(/^["']|["']$/g, '');
    const kind = m[3].startsWith('&') ? 'fd-dup' : target === '/dev/null' ? 'dev-null' : m[2] === '<' ? 'input-file' : 'output-file';
    return { text: m[0].trim(), fd: m[1] || null, op: m[2], target, kind };
  });
}

/** The part as the client matches rules against it: redirections removed (R28), spaces collapsed. */
export const normalisePart = part => part.replace(REDIRECT, ' ').replace(/\s+/g, ' ').trim();

/**
 * The offline decision for one Bash command under an allow list and deny list: every part must be allowed. Returns
 * {allowed, reason, parts:[{part, normalised, allowed, reason}]}. This models the client as documented and as
 * observed live in EXP 005 (fence5 matrices); it proves nothing about the client. The live probe does.
 */
export function decideBash(command, { allow, deny = TEXT_DENY_4, outsidePath = null }) {
  const { parts, ops } = splitCompound(String(command));
  const decided = parts.map(part => {
    const reds = redirections(part);
    const norm = normalisePart(part);
    const say = (allowed, reason) => ({ part, normalised: norm, allowed, reason });
    if (reds.some(r => r.kind === 'output-file')) return say(false, 'redirect to a file (fence6 never allows > to a file)');
    if (reds.some(r => r.kind === 'input-file')) return say(false, 'input redirect from a file');
    if (/^\w+=/.test(norm)) return say(false, 'a leading variable assignment (no allow rule matches past it)');
    if (/\$\(|`/.test(norm)) return say(false, 'command substitution');
    if (!/^git(\s|$)/.test(norm)) return say(false, `not a git command (${norm.split(/\s+/)[0]}): no allow rule, and no blanket rule`);
    const denied = deny.find(r => bashRule(r, norm));
    if (denied) return say(false, `deny rule ${denied}`);
    if (/\$/.test(norm)) return say(false, 'a shell variable expansion');
    if (!allow.some(r => bashRule(r, norm))) return say(false, 'no allow rule matches (verb or prefix not allowed)');
    // As observed live under the file fence (EXP 005 v2-round1): a git diff path argument outside the working
    // directory is refused as an outside read (R7, R10). `outsidePath` is the caller's test (the fake has a cwd).
    if (outsidePath && /^git (?:-C \S+ )?(?:--no-pager )?diff\b/.test(norm) && norm.split(/\s+/).slice(1).filter(t => !t.startsWith('-')).some(outsidePath)) return say(false, 'a path argument outside the working directory');
    return say(true, null);
  });
  const first = decided.find(d => !d.allowed);
  return { allowed: decided.length > 0 && !first, reason: first ? first.reason : null, compound: parts.length > 1, ops, parts: decided };
}

/** The fence6 decision for a command as a record shows it (the repository scrubbed to <ws>/repo). */
export const decideFence6 = (command, repo = WS_REPO) => decideBash(command, { allow: fence6Tools(repo).filter(t => t.startsWith('Bash(')), deny: TEXT_DENY_4 });
/** The fence5 decision (EXP 005's allow list), for the census's before/after. */
export const decideFence5 = command => decideBash(command, { allow: ['Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)', 'Bash(git log:*)'], deny: TEXT_DENY_4 });
