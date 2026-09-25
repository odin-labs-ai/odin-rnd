// Turn a list of file edits against a tree into a unified git diff, and back.
//
// An edit is one of:
//   { path, replace: [from, to] }   exact substring, must occur exactly once
//   { path, content }               create or overwrite the file
//   { path, delete: true }          remove the file
//   { path, renameTo }              move the file (applied before any edit on the new path)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'exp005', GIT_AUTHOR_EMAIL: 'exp005', GIT_COMMITTER_NAME: 'exp005', GIT_COMMITTER_EMAIL: 'exp005',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

export function git(cwd, args, input) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export function applyEdits(dir, edits) {
  for (const e of edits) {
    const abs = join(dir, e.path);
    if (e.renameTo) {
      mkdirSync(dirname(join(dir, e.renameTo)), { recursive: true });
      renameSync(abs, join(dir, e.renameTo));
    } else if (e.delete) {
      rmSync(abs);
    } else if (e.content !== undefined) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, e.content);
    } else if (e.replace) {
      const [from, to] = e.replace;
      if (!existsSync(abs)) throw new Error(`edit target missing: ${e.path}`);
      const text = readFileSync(abs, 'utf8');
      const count = text.split(from).length - 1;
      if (count !== 1) throw new Error(`replace in ${e.path}: expected exactly one match, found ${count}: ${JSON.stringify(from)}`);
      writeFileSync(abs, text.replace(from, () => to));
    } else {
      throw new Error(`unknown edit: ${JSON.stringify(e)}`);
    }
  }
}

/** The unified diff (git format, rename detection on, 3 lines of context) that `edits` make to `treeDir`. */
export function diffFor(treeDir, edits) {
  const dir = mkdtempSync(join(tmpdir(), 'exp005-diff-'));
  try {
    cpSync(treeDir, dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'base']);
    applyEdits(dir, edits);
    git(dir, ['add', '-A']);
    const diff = git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff', '-M', '-U3', 'HEAD']);
    if (!diff.trim()) throw new Error('edits produced an empty diff');
    return diff;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Diff many edit lists against one tree with a single scratch repository (fast path for the whole
 * corpus). Gives exactly the same text as diffFor for each entry.
 */
export function diffsFor(treeDir, editLists) {
  const dir = mkdtempSync(join(tmpdir(), 'exp005-diffs-'));
  try {
    cpSync(treeDir, dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'base']);
    return editLists.map(edits => {
      applyEdits(dir, edits);
      git(dir, ['add', '-A']);
      const diff = git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff', '-M', '-U3', 'HEAD']);
      git(dir, ['reset', '-q', '--hard', 'HEAD']);
      git(dir, ['clean', '-fdq']);
      if (!diff.trim()) throw new Error('edits produced an empty diff');
      return diff;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** True when `patch` applies cleanly to `treeDir` (git apply --check). */
export function appliesTo(treeDir, patch) {
  const dir = mkdtempSync(join(tmpdir(), 'exp005-check-'));
  try {
    cpSync(treeDir, dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['apply', '--check', '-'], patch);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
