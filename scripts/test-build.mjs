// A site build for tests, made in a disposable copy of the checkout, never in the checkout itself.
//
// `node --test` runs test files in parallel. A test that ran scripts/build.mjs in the checkout deleted and
// re-created dist/ and re-copied site/data/jev-gate/*.json while other files read them, so those reads
// failed now and then (station 06, the amendment qualifiers; seen 2026-09-28). Building here instead
// removes the race, and a test that checks built pages no longer depends on whether `pnpm build` ran first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let root = null;

/** Builds once per process into a temp copy (the working files, committed or not) and returns its root. */
export function builtCopy() {
  if (root) return root;
  const dir = mkdtempSync(join(tmpdir(), 'odin-rnd-build-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const rel of files) {
    if (!existsSync(join(REPO, rel))) continue; // deleted in the working tree
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(dir, rel), { verbatimSymlinks: true });
  }
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=build-copy', '-c', 'user.email=build-copy@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'build copy');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: dir, stdio: 'pipe' });
  root = dir;
  return root;
}
