// Governance fences for the latent-handoff experiment: the diff base a PR is judged against, the files a
// latent-handoff branch may touch, and the rule that a restricted fingerprint is removed only together with
// the sha256 commitment of a signed permission record. The rules a change is judged by are the fences module
// AS IT IS AT ITS BASE (loadBaseModule), so a widening of the rules takes effect only after it lands on its own.
// The test files themselves run from the PR head (see the honest limit at gateEditViolations). No network
// except the one deepen a shallow CI checkout needs to see the merge commit's base parent.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (args, cwd) => { try { return git(args, cwd); } catch { return null; } };

export const fencesFile = 'scripts/latent-handoff-fences.mjs';
export const fingerprintFile = 'scripts/latent-handoff-private-terms.mjs';
export const fingerprintLine = /^export const restrictedFingerprints = (\{.*\});$/m;
// The gate files guard each other: every one present at the base must still exist at the head.
export const gateFiles = [fencesFile, fingerprintFile, 'scripts/latent-handoff-private-terms.test.mjs', 'scripts/latent-handoff-scope.test.mjs', 'scripts/latent-handoff-fingerprint-removal.test.mjs'];

export function parseFingerprintMap(source) {
  if (source === null || source === undefined) throw new Error(`${fingerprintFile} is missing`);
  const lines = source.match(new RegExp(fingerprintLine.source, 'gm')) ?? [];
  if (lines.length !== 1) throw new Error(`restrictedFingerprints must be declared on exactly one line (found ${lines.length})`);
  return JSON.parse(lines[0].match(fingerprintLine)[1]);
}

export const fingerprintEntries = map => new Set(Object.entries(map).flatMap(([size, digests]) => digests.map(digest => `${size}:${digest}`)));
export const parseFingerprints = source => fingerprintEntries(parseFingerprintMap(source));

// Every size:digest pair at the base that the head no longer carries.
export function removedFingerprints(baseSource, headSource) {
  const head = parseFingerprints(headSource);
  return [...parseFingerprints(baseSource)].filter(entry => !head.has(entry));
}

export const commitmentPath = 'experiments/latent-handoff/permission.sha256';

// The commitment file is append-only: one sha256 per permitted removal, never edited or deleted. A removal is
// allowed only when the same diff ADDS a line; any diff that drops or rewrites an earlier line is refused.
const commitmentLines = text => (text ?? '').split('\n').filter(line => line !== '');
export function removalVerdict({ removed, commitmentAtBase, commitmentAtHead }) {
  const before = commitmentLines(commitmentAtBase), after = commitmentLines(commitmentAtHead);
  if (!after.every(line => /^[0-9a-f]{64}$/.test(line))) return { ok: false, reason: `every line of ${commitmentPath} must be exactly 64 lowercase hex characters` };
  if (before.some((line, i) => after[i] !== line)) return { ok: false, reason: `${commitmentPath} is append-only: an earlier commitment was removed or changed` };
  if (new Set(after).size !== after.length) return { ok: false, reason: `${commitmentPath} lines must be distinct: one signed record per removal` };
  if (removed.length === 0) return { ok: true, reason: 'no fingerprint removed' };
  if (after.length <= before.length) return { ok: false, reason: `${removed.length} fingerprint(s) removed without adding a commitment line to ${commitmentPath}` };
  return { ok: true, reason: `${removed.length} fingerprint(s) removed with a signed-record commitment` };
}

// Files a latent-handoff branch may touch: its own, plus shared files declared per branch slug. The site is shared
// only with a publish branch (slug `publish` or `publish-*`: bundle 4's page, bundle 6's field note).
export const declaredShared = [
  { slug: /^publish(-[a-z0-9-]+)?$/, paths: [/^site\//] },
];
const ownPaths = [/^experiments\/latent-handoff\//, /^scripts\/latent-handoff[^/]*$/];

export function scopeViolations(branch, paths) {
  const match = /^exp\/latent-handoff-(.+)$/.exec(branch ?? '');
  if (!match) return [];
  const shared = declaredShared.filter(entry => entry.slug.test(match[1])).flatMap(entry => entry.paths);
  return paths.filter(path => ![...ownPaths, ...shared].some(rule => rule.test(path)));
}

export function currentBranch(cwd) {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  return tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)?.trim() ?? null;
}

// The commit a change is judged against. In a pull_request run the checkout is the shallow merge commit, so
// its first parent (the base branch tip) is fetched and used. Locally it is the merge base with origin/main.
// Returns null when no base can be established; callers decide whether that fails closed.
export function diffBase(cwd) {
  if (process.env.GITHUB_ACTIONS && process.env.GITHUB_EVENT_NAME === 'pull_request') {
    // Test files run in parallel and each may deepen the same shallow clone; the loser of the shallow.lock race
    // fails, so poll for the parent and retry the deepen instead of reading one failure as "no base".
    for (let attempt = 0; attempt < 20; attempt++) {
      const parent = tryGit(['rev-parse', '--verify', '--quiet', 'HEAD^1'], cwd)?.trim();
      if (parent) return parent;
      tryGit(['fetch', '--quiet', '--no-tags', '--deepen=1', 'origin'], cwd);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    return null;
  }
  return tryGit(['merge-base', 'origin/main', 'HEAD'], cwd)?.trim() || null;
}

// Committed change only (base..HEAD): CI regenerates tracked records before the tests run, and those working-tree
// edits are not part of the change.
export function changedPaths(base, cwd) {
  return git(['diff', '--name-only', '--no-renames', base, 'HEAD'], cwd).split('\n').filter(Boolean);
}

export function fileAt(rev, path, cwd) {
  return tryGit(['show', `${rev}:${path}`], cwd);
}

// A gate module as it is at the base, imported from a private temporary copy, so a change is judged by the
// rules it is changing rather than by its own. Null when the base predates the module (the change that
// introduces it is judged by itself, once). Gate modules therefore import only node: builtins.
export async function loadBaseModule(base, path, cwd) {
  const source = fileAt(base, path, cwd);
  if (source === null) return null;
  const dir = mkdtempSync(join(tmpdir(), 'latent-handoff-base-'));
  try {
    const file = join(dir, 'module.mjs');
    writeFileSync(file, source);
    return await import(pathToFileURL(file).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export const loadBaseFences = (base, cwd) => loadBaseModule(base, fencesFile, cwd);

// Gate files change only on the fences branch, so an edit that guts a gate is a fences change in review, never a
// side effect of other work. Honest limit: node --test runs the gate TEST files from the PR head, so a change
// that guts a gate test (on any branch) disarms it in that change's own CI run. In-repo tests are a tripwire;
// the enforcing gates are external: the private-term scan and review in the governed publish path, and (a
// ruleset change, not made here) a required code-owner review on scripts/latent-handoff-*.
export const gateEditBranch = /^exp\/latent-handoff-fences(-[a-z0-9-]+)?$/;
export function gateEditViolations(branch, paths, gates = gateFiles) {
  return gateEditBranch.test(branch ?? '') ? [] : paths.filter(path => gates.includes(path));
}
