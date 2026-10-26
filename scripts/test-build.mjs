// A site build for tests, made in a disposable copy of the checkout, never in the checkout itself.
//
// `node --test` runs test files in parallel. A test that ran scripts/build.mjs in the checkout deleted and
// re-created dist/ and re-copied site/data/jev-gate/*.json while other files read them, so those reads
// failed now and then (station 06, the amendment qualifiers; seen 2026-09-28). Building here instead
// removes the race, and a test that checks built pages no longer depends on whether `pnpm build` ran first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let root = null;

/** Builds once per process into a temp copy (the working files, committed or not) and returns its root. */
export function builtCopy() {
  if (root) return root;
  // The copy holds the whole checkout, including experiments/jev-gate/*.json (the answer files). A killed or
  // timed-out test run must not strand it in a temp root, where the answer-key pre-flight would then find it
  // (bundle-3 refute r3 addendum). So the dir carries a recognisable `jev-gate-build-` prefix and is removed on
  // normal exit, on an uncaught error, and on SIGINT/SIGTERM/SIGHUP. (SIGKILL cannot be caught; jev-gate-tempdirs
  // covers the ordinary paths.)
  const dir = mkdtempSync(join(tmpdir(), 'jev-gate-build-'));
  // force: true already ignores a dir that is gone, so anything caught here is a real failure that strands the copy.
  // Say so on stderr, synchronously (this also runs inside the 'exit' handler), naming the error and the path, so a
  // jev-gate-tempdirs failure shows why the copy survived instead of a silent leftover.
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch (error) {
      try { writeSync(2, `test-build: could not remove the build copy ${dir}: ${error?.code ?? ''} ${error?.message ?? error}\n`); } catch { /* stderr closed */ }
    }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { cleanup(); process.exit(1); });
  try {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const rel of files) {
      if (!existsSync(join(REPO, rel))) continue; // deleted in the working tree
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(join(REPO, rel), join(dir, rel), { verbatimSymlinks: true });
    }
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=build-copy', '-c', 'user.email=build-copy@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    // Auto maintenance off, in the copy's own config so every later git in it (build.mjs's too) sees it: from git 2.55
    // the commit below starts a detached `git maintenance run --auto` that, for a copy this size (~1,800 loose objects),
    // repacks .git/objects for seconds after the commit returns. A precaution, so nothing writes into the copy behind
    // the test's back; it is not shown to cause the jev-gate-tempdirs leftover (odin-rnd #105).
    git('init', '-q'); git('config', 'maintenance.auto', 'false'); git('config', 'gc.auto', '0');
    git('add', '-A'); git('commit', '-qm', 'build copy');
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: dir, stdio: 'pipe' });
  } catch (error) {
    cleanup(); // don't strand a half-built copy of the answer files if the build throws
    throw error;
  }
  root = dir;
  return root;
}
