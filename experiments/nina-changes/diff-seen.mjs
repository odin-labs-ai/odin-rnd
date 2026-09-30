// EXP 006 WO-1-03 classifier (R2-2, as replaced by R3-2 and R4-4): did a counted reviewer run actually obtain the
// change it was asked to review? Decided from the run's recorded tool calls (tool, scrubbed input, is_error, scrubbed
// output) and the committed fingerprints, never from the report's wording.
//
// A run is DIFF-SEEN iff at least one of:
//  (a) a successful Bash call running git printed a SIGN-MATCHED fingerprint line of the item: an output line whose
//      first character is + or -, whose remainder trimmed equals a fingerprint of that sign (whole line, never a
//      substring). Base-commit output (git show HEAD, git log -p) cannot match: + fingerprints exclude every base line
//      and a root commit prints no - line.
//  (b) for an item with added files: a successful Bash git output carries an untracked `?? <path>` entry naming an added
//      path or a directory prefix of it (`?? src/jobs/`), AND a successful Read or Grep of THAT added path returned one
//      of its + fingerprint lines (Read's `N→` / `N<TAB>` line-number prefix and Grep's `path:N:` / `path-N-` prefixes
//      are stripped first; whole trimmed line).
// Otherwise DIFF-BLIND. A harness failure (timeout, crash, unparseable stream) is never diff-seen. Rule (c) of R2-2 is
// dropped (R3-2): c018's rename is 100% similar and is covered by rule (a) through its modify hunks.
import { PREREG6_SHA256 } from './freeze.mjs';

export const RULE = 'DIFF-SEEN iff (a) a successful Bash git call printed a whole diff line +<fp> or -<fp> equal to one of the item\'s fingerprints of that sign; or (b) for an item with added files, a successful Bash git output lists `?? <added path or a directory prefix of it>` and a successful Read/Grep of that added path returned one of its + fingerprint lines (line-number and path prefixes stripped). Otherwise DIFF-BLIND. A harness failure is never DIFF-SEEN.';
/** The classifier is frozen with the pre-registration: once PREREG6_SHA256 is set, its rule text is pinned there. */
export const FROZEN = PREREG6_SHA256 !== null;

const isGitBash = call => call.tool === 'Bash' && /(^|[\s;&|(])git(\s|$)/.test(String(call.input?.command ?? ''));
const ok = call => call.isError !== true && typeof call.output === 'string';

/** Strip a Read line-number prefix: `     12→text` (arrow) or `    12\ttext` (tab). */
export const stripReadPrefix = line => line.replace(/^\s*\d+(?:→|\t)/, '');

/** A path as a record shows it: scrubbed `<ws>/repo/…`, `./…` or relative; normalised to the repo-relative path. */
export const repoPath = p => String(p ?? '').replace(/^<ws>\/repo\//, '').replace(/^\.\//, '');

/** Content lines of a Grep result that belong to `path`, with the `path:N:` / `path-N-` / `path:` prefix removed. */
export function grepLinesFor(call, path) {
  const out = [];
  const single = repoPath(call.input?.path) === path;
  for (const raw of call.output.split('\n')) {
    // Path first (a path may itself hold `-<digits>-`): the line must start with exactly this path.
    const rel = repoPath(raw);
    const m = rel.startsWith(path) ? (/^([:-])(\d+)\1(.*)$/.exec(rel.slice(path.length)) ?? /^:(.*)$/.exec(rel.slice(path.length))) : null;
    if (m) out.push(m.length === 4 ? m[3] : m[1]);
    else if (single) out.push(raw.replace(/^\d+[:-]/, ''));
  }
  return out;
}

/** Whole-line, sign-matched fingerprint hits in one git output. */
export function diffLineHits(output, fp) {
  const plus = new Set(fp.plus), minus = new Set(fp.minus);
  const hits = [];
  for (const line of output.split('\n')) {
    const sign = line[0], rest = line.slice(1).trim();
    if ((sign === '+' && plus.has(rest)) || (sign === '-' && minus.has(rest))) hits.push(`${sign}${rest}`);
  }
  return hits;
}

/** Untracked entries in a git output (`?? path`), exactly as git prints them for --short / --porcelain. */
export const untrackedEntries = output => output.split('\n').map(l => /^\?\? (.+)$/.exec(l)?.[1]).filter(Boolean);
const names = (entry, path) => entry === path || (entry.endsWith('/') && path.startsWith(entry));

/**
 * The classification of one run. `calls` are its recorded tool calls ({tool, input, isError, output}); `fp` the
 * item's fingerprints. Returns {seen, rule, evidence} with evidence as indices into `calls`.
 */
export function classifyDiffSeen({ calls = [], fp, harnessFailure = null }) {
  if (harnessFailure) return { seen: false, rule: null, evidence: [], reason: 'harness failure' };
  if (!fp) throw new Error('no fingerprints for this item');
  const a = calls.map((c, i) => [c, i]).filter(([c]) => isGitBash(c) && ok(c) && diffLineHits(c.output, fp).length > 0).map(([, i]) => i);
  if (a.length) return { seen: true, rule: 'a', evidence: a };
  for (const path of fp.added ?? []) {
    const content = new Set(fp.addedContent?.[path] ?? []);
    if (!content.size) continue;
    const status = calls.map((c, i) => [c, i]).filter(([c]) => isGitBash(c) && ok(c) && untrackedEntries(c.output).some(e => names(e, path))).map(([, i]) => i);
    if (!status.length) continue;
    const read = calls.map((c, i) => [c, i]).filter(([c]) => ok(c) && (
      (c.tool === 'Read' && repoPath(c.input?.file_path) === path && c.output.split('\n').some(l => content.has(stripReadPrefix(l).trim())))
      || (c.tool === 'Grep' && grepLinesFor(c, path).some(l => content.has(l.trim())))
    )).map(([, i]) => i);
    if (read.length) return { seen: true, rule: 'b', evidence: [...status, ...read].sort((x, y) => x - y), path };
  }
  return { seen: false, rule: null, evidence: [] };
}

/** Per-call boolean: does this call's output carry a fingerprint of the item (either rule's content test)? */
export function callHitsFingerprint(call, fp) {
  if (!ok(call) || !fp) return false;
  if (isGitBash(call) && diffLineHits(call.output, fp).length) return true;
  return (fp.added ?? []).some(path => {
    const content = new Set(fp.addedContent?.[path] ?? []);
    return (call.tool === 'Read' && repoPath(call.input?.file_path) === path && call.output.split('\n').some(l => content.has(stripReadPrefix(l).trim())))
      || (call.tool === 'Grep' && grepLinesFor(call, path).some(l => content.has(l.trim())));
  });
}

/** The per-run table for a whole run record (the build recomputes it and asserts it equals the recorded one). */
export function classifyRecord(run, fingerprints) {
  return run.calls.filter(c => !c.stageError).map(c => {
    const r = classifyDiffSeen({ calls: c.toolCalls ?? [], fp: fingerprints.items[c.id], harnessFailure: c.harnessFailure });
    return { id: c.id, run: c.run, seen: r.seen, rule: r.rule, evidence: r.evidence };
  });
}
