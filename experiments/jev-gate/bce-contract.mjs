// EXP 005 ground-truth contract: how one tree is scored by the released bce-engine.
//
// Contract (pinned before the corpus was authored):
//   1. The tree is copied into a fresh temporary directory, optionally patched with `git apply`,
//      then turned into a git repository with exactly one commit made under a fixed identity and
//      a fixed date, so the commit sha (and with it the report) is reproducible.
//   2. bce-engine 0.3.1 runs:
//        node node_modules/bce-engine/dist/cli.js run --blueprint <bp> --ct-repo <dir> --extractor ast --out <json>
//   3. The exit code and the JSON report must agree:
//        exit 0  <=> verdict "pass", score 100, no violations    -> GREEN
//        exit 1  <=> verdict "fail", at least one violation      -> RED
//      Anything else (a disagreement, another exit code, a missing report) throws. It is never
//      recoded into a label.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
export const BCE_PACKAGE = 'bce-engine';
export const BCE_VERSION = '0.3.1';
export const BCE_CLI = join(REPO_ROOT, 'node_modules', BCE_PACKAGE, 'dist', 'cli.js');
export const EXTRACTOR = 'ast';

// A fixed commit identity and date: the tree content alone decides the commit sha.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'exp005',
  GIT_AUTHOR_EMAIL: 'exp005',
  GIT_COMMITTER_NAME: 'exp005',
  GIT_COMMITTER_EMAIL: 'exp005',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function assertBceVersion() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules', BCE_PACKAGE, 'package.json'), 'utf8'));
  if (pkg.version !== BCE_VERSION) throw new Error(`bce-engine ${pkg.version} is installed; the EXP 005 contract pins ${BCE_VERSION}`);
  return pkg.version;
}

function git(cwd, args, input) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in the scratch repo: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Copy `treeDir` into a fresh temp dir, apply `patch` (text) if given, then git init + one commit. */
export function materialise(treeDir, patch) {
  if (!existsSync(treeDir)) throw new Error(`tree not found: ${treeDir}`);
  const dir = mkdtempSync(join(tmpdir(), 'exp005-'));
  try {
    cpSync(treeDir, dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    if (patch !== undefined) {
      git(dir, ['apply', '--check', '--whitespace=nowarn', '-'], patch);
      git(dir, ['apply', '--whitespace=nowarn', '-'], patch);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'tree']);
    return dir;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Map an exit code + report to GREEN/RED, throwing when the two disagree. */
export function interpret(exitCode, report) {
  if (!report || typeof report !== 'object') throw new Error(`bce produced no report (exit ${exitCode})`);
  const violations = Array.isArray(report.violations) ? report.violations : null;
  if (!violations) throw new Error('bce report has no violations array');
  const { verdict, score } = report;
  if (exitCode === 0) {
    if (verdict !== 'pass' || score !== 100 || violations.length !== 0) {
      throw new Error(`bce exit 0 disagrees with its report: verdict=${verdict} score=${score} violations=${violations.length}`);
    }
  } else if (exitCode === 1) {
    if (verdict !== 'fail' || violations.length === 0 || !(score < 100)) {
      throw new Error(`bce exit 1 disagrees with its report: verdict=${verdict} score=${score} violations=${violations.length}`);
    }
  } else {
    throw new Error(`bce exited ${exitCode}; only 0 (pass) and 1 (fail) are labels`);
  }
  return {
    label: exitCode === 0 ? 'GREEN' : 'RED',
    verdict,
    score,
    rules: [...new Set(violations.map(v => v.constraintId))].sort(),
    violations: violations
      .map(v => ({ rule: v.constraintId, ref: v.evidenceRef, observed: v.observed }))
      .sort((a, b) => (a.rule + '\0' + a.ref).localeCompare(b.rule + '\0' + b.ref)),
  };
}

function runCli(blueprint, repoDir) {
  const out = join(repoDir, '.git', 'bce-report.json');
  const args = [BCE_CLI, 'run', '--blueprint', resolve(blueprint), '--ct-repo', repoDir, '--extractor', EXTRACTOR, '--out', out];
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
      resolvePromise({ exitCode: code, report, output });
    });
  });
}

/**
 * Score one tree: materialise (+ patch), run bce, interpret. Always removes the temp dir.
 * Returns { label, verdict, score, rules, violations, exitCode }.
 */
export async function scoreTree({ blueprint, tree, patch }) {
  assertBceVersion();
  const dir = materialise(tree, patch);
  try {
    const { exitCode, report, output } = await runCli(blueprint, dir);
    try {
      return { ...interpret(exitCode, report), exitCode };
    } catch (e) {
      e.message += `\n--- bce output ---\n${output.trim()}`;
      throw e;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const CONTROLS = {
  blueprint: join(HERE, 'controls', 'blueprint.json'),
  green: join(HERE, 'controls', 'green'),
  red: join(HERE, 'controls', 'red'),
};

// `node experiments/jev-gate/bce-contract.mjs` runs both controls on demand.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const which of ['green', 'red']) {
    const r = await scoreTree({ blueprint: CONTROLS.blueprint, tree: CONTROLS[which] });
    console.log(`${which} control: exit ${r.exitCode}, verdict ${r.verdict}, score ${r.score}, ${r.violations.length} violation(s)${r.rules.length ? ' [' + r.rules.join(', ') + ']' : ''}`);
  }
}
