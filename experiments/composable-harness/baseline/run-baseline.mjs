// EXP 009 bundle 3 WO-04: the real-filter baseline for P2.
//
// Runs odin-agent's extension filter (and its proven-core floor) UNCHANGED, at pinned odin-suite commits, over the
// 120 blind-authored corpus configs. The private source is never copied here (founder D4): this file and
// driver.mjs are ours; the filter is imported in place from detached, read-only odin-suite worktrees, and only
// its per-config outputs plus the source sha256s and commit ids are written. No timestamps, so two runs are
// byte-identical.
//
//   node run-baseline.mjs --suite-git <odin-suite repo> --pre-wt <worktree at PRE_PIN> --current-wt <worktree at
//        CURRENT_PIN> --deps <dir holding node_modules with skill-contracts@0.7.0 + tsx> [--out <dir>] [--check]
//
// The pre-floor pin is the parent of the commit that floored the q trio (2026-09-28); the current pin is the
// plan's pinned origin/main. extension-filter.ts is byte-identical at both pins; only proven-core differs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRE_PIN = 'd6431af9bad7455be086e69feafe7bc8db606629';
export const CURRENT_PIN = '2d522f50538026e773a83539b6ab4c94bee0d69e';
export const SOURCES = ['odin-agent/src/config/extension-filter.ts', 'odin-agent/src/config/proven-core.ts'];
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', 'corpus', 'authored');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function verifyWorktree(wt, pin) {
  const head = git(wt, 'rev-parse', 'HEAD').trim();
  if (head !== pin) throw new Error(`worktree HEAD ${head} is not the pin ${pin}`);
  const dirty = git(wt, 'status', '--porcelain');
  if (dirty) throw new Error(`worktree at ${pin.slice(0, 8)} is not clean:\n${dirty}`);
}

function linkDeps(wt, deps) {
  const link = join(wt, 'odin-agent', 'node_modules');
  if (existsSync(link) || (() => { try { lstatSync(link); return true; } catch { return false; } })()) return;
  symlinkSync(join(resolve(deps), 'node_modules'), link); // odin-suite's .gitignore covers node_modules/
}

// Source identity comes from the commit object, not the worktree, and is checked against the worktree bytes.
function sourceRecord(suiteGit, wt, pin) {
  return Object.fromEntries(SOURCES.map(path => {
    const blob = execFileSync('git', ['-C', suiteGit, 'show', `${pin}:${path}`]);
    const onDisk = readFileSync(join(wt, path));
    if (sha(blob) !== sha(onDisk)) throw new Error(`${path} in the worktree differs from ${pin}`);
    return [path, sha(blob)];
  }));
}

export function classify(cfg, row) {
  const retained = new Set(row.retained);
  // The filter decides only enabled-or-not at boot; this is the same rule as the spec's "enabled".
  const specEnabled = cfg.registry.map(p => p.name).filter(n => cfg.expectedAtBoot[n] !== 'excluded');
  return {
    agreesWithSpecEnabledAtBoot: specEnabled.length === retained.size && specEnabled.every(n => retained.has(n)),
    signalled: row.diagnostics.length > 0,
    // intended plugins the filter kept although they will not work (an unmet need, or withdrawn later), with no signal
    silentInert: cfg.intended.filter(n => retained.has(n) && cfg.expected[n] !== 'active'),
    // intended plugins the filter removed, with no signal
    silentDropped: cfg.intended.filter(n => !retained.has(n)),
  };
}

function main() {
  const suiteGit = arg('--suite-git'), preWt = arg('--pre-wt'), curWt = arg('--current-wt'), deps = arg('--deps');
  const out = resolve(arg('--out', HERE));
  if (!suiteGit || !preWt || !curWt || !deps) throw new Error('usage: --suite-git --pre-wt --current-wt --deps [--out] [--check]');
  verifyWorktree(preWt, PRE_PIN); verifyWorktree(curWt, CURRENT_PIN);
  linkDeps(preWt, deps); linkDeps(curWt, deps);

  const index = JSON.parse(readFileSync(join(CORPUS, 'index.json'), 'utf8'));
  const configs = index.configs.map(r => JSON.parse(readFileSync(join(CORPUS, r.file), 'utf8')));
  const tsx = join(resolve(deps), 'node_modules', '.bin', 'tsx');
  const raw = execFileSync(tsx, [join(HERE, 'driver.mjs'), resolve(preWt), resolve(curWt)], {
    input: JSON.stringify(configs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const rows = JSON.parse(raw);

  // The filter must not have written anything into either worktree.
  verifyWorktree(preWt, PRE_PIN); verifyWorktree(curWt, CURRENT_PIN);

  const byId = new Map(configs.map(c => [c.id, c]));
  const outputs = rows.map(row => ({ ...row, label: byId.get(row.id).label, faultClass: byId.get(row.id).faultClass, baseline: classify(byId.get(row.id), row) }));
  const faulty = outputs.filter(o => o.label === 'faulty'), clean = outputs.filter(o => o.label === 'clean');
  const depVersion = name => JSON.parse(readFileSync(join(resolve(deps), 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version;
  const source = {
    schema: 'odin-rnd.exp009.baseline-source.v1',
    repository: 'odin-suite (private; source not vendored)',
    pins: {
      pre: { commit: PRE_PIN, role: 'parent of the commit that added the q trio to the floor', sha256: sourceRecord(suiteGit, preWt, PRE_PIN) },
      current: { commit: CURRENT_PIN, role: 'plan-pinned origin/main', sha256: sourceRecord(suiteGit, curWt, CURRENT_PIN) },
    },
    runtime: { node: process.versions.node.split('.')[0], tsx: depVersion('tsx'), skillContracts: depVersion('@odinlabs-ai/skill-contracts') },
    corpusIndexSha256: sha(readFileSync(join(CORPUS, 'index.json'))),
  };
  const count = (rowsIn, pred) => rowsIn.filter(pred).length;
  const summary = {
    schema: 'odin-rnd.exp009.baseline-summary.v1',
    configs: outputs.length,
    faulty: faulty.length, clean: clean.length,
    filterAgreesWithSpecEnabledAtBoot: count(outputs, o => o.baseline.agreesWithSpecEnabledAtBoot),
    faultySignalled: count(faulty, o => o.baseline.signalled),
    cleanSignalled: count(clean, o => o.baseline.signalled),
    faultyWithSilentInert: count(faulty, o => o.baseline.silentInert.length > 0),
    faultyWithSilentDropped: count(faulty, o => o.baseline.silentDropped.length > 0),
    byFaultClass: Object.fromEntries([...new Set(faulty.map(o => o.faultClass))].sort().map(k => [k, {
      n: count(faulty, o => o.faultClass === k),
      signalled: count(faulty, o => o.faultClass === k && o.baseline.signalled),
      silentInert: count(faulty, o => o.faultClass === k && o.baseline.silentInert.length > 0),
      silentDropped: count(faulty, o => o.faultClass === k && o.baseline.silentDropped.length > 0),
    }])),
  };

  const files = {
    'outputs.json': `${JSON.stringify(outputs, null, 1)}\n`,
    'SOURCE.json': `${JSON.stringify(source, null, 2)}\n`,
    'summary.json': `${JSON.stringify(summary, null, 2)}\n`,
  };
  if (process.argv.includes('--check')) {
    const drift = Object.entries(files).filter(([f, body]) => !existsSync(join(out, f)) || readFileSync(join(out, f), 'utf8') !== body).map(([f]) => f);
    if (drift.length) { console.error(`baseline differs from the committed record: ${drift.join(', ')}`); process.exit(1); }
    console.log('baseline reproduces the committed record byte-for-byte');
  } else {
    mkdirSync(out, { recursive: true });
    for (const [f, body] of Object.entries(files)) writeFileSync(join(out, f), body);
  }
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
