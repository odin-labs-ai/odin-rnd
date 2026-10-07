// EXP 007 bundle 2 test helpers (the EXP 006 refute r6 B1 pattern): no test may ever reach a real, metered client call.
// A test that calls the census runner in a metered mode (practice, counted) does it inside claudeFree7: PATH is an empty
// scratch directory, so no client can be found whatever the guards decide; the runner also refuses a metered call under
// the Node test runner, and the served-record fetch refuses there too. censusCallSites is the structural check over the
// test sources: every runCensus call is a rehearsal (the committed fake) or inside claudeFree7 spreading its options.
// codeOnly and testSources are EXP 006's (scripts/nina-changes-claude-free.mjs), imported, not copied.
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_BIN, FAKE_CLAUDE7 } from '../experiments/blueprint-floor/census-run.mjs';
import { CensusLedger } from '../experiments/blueprint-floor/census-spend.mjs';
import { codeOnly, testSources } from './nina-changes-claude-free.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

export { codeOnly, testSources };

/**
 * Runs fn(free) with PATH set to an empty scratch directory; restores PATH and removes the directories. `free` carries a
 * scratch stateDir (refute A1-B2), so a metered runCensus in a test never takes the repository's run lock, never reads
 * its ledger mirror and never races another test file.
 */
export async function claudeFree7(fn) {
  const dir = scratchDir('bf-claude-free');
  const stateDir = scratchDir('bf-claude-free-state');
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try { return await fn({ stateDir }); } finally {
    if (saved === undefined) delete process.env.PATH; else process.env.PATH = saved;
    removeScratch(dir);
    removeScratch(stateDir);
  }
}

const RUNNER_CALL = /\b(runCensus)\(/g;

function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return code.length;
}

/** The first argument's top-level keys and spreads, in order (code-only text of the call's parens). */
function firstArgEntries(args) {
  let depth = 0, end = args.length;
  const depthAt = [];
  for (let i = 0; i < args.length; i += 1) {
    if ('([{'.includes(args[i])) depth += 1;
    depthAt.push(depth);
    if (')]}'.includes(args[i])) depth -= 1;
    if (args[i] === ',' && depth === 1) { end = i; break; }
  }
  const first = args.slice(0, end);
  if (!/^\(\s*\{/.test(first)) return { first, entries: [] };
  const entries = [...first.matchAll(/(\.\.\.[A-Za-z_$][\w$]*|\b[A-Za-z_$][\w$]*)\s*(:)?/g)]
    .filter(m => depthAt[m.index] === 2 && (m[1].startsWith('...') || m[2]) && /[{,]\s*$/.test(first.slice(0, m.index)))
    .map(m => ({ key: m[1], at: m.index }));
  return { first, entries };
}

/**
 * Every census runner call site in `src`, classified from its code only (comments and strings blanked) and its FIRST
 * argument only; for a key given twice the last wins, and a later spread (other than ...free) decides nothing:
 *   'rehearsal'   mode: 'rehearsal' at the first argument's own level (the fake client; the runner refuses any other);
 *   'claude-free' inside a claudeFree7(...) call and spreading its options (...free);
 *   'UNSAFE'      anything else.
 */
export function censusCallSites(src, file = '<source>') {
  const code = codeOnly(src);
  const wrappers = [];
  for (const m of code.matchAll(/\bclaudeFree7\(/g)) { const open = m.index + m[0].length - 1; wrappers.push([open, closing(code, open)]); }
  const sites = [];
  for (const m of code.matchAll(RUNNER_CALL)) {
    const open = m.index + m[0].length - 1;
    if (/function\s*$|async\s+function\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    const end = closing(code, open);
    const args = code.slice(open, end), raw = src.slice(open, end);
    const line = src.slice(0, m.index).split('\n').length;
    const { entries } = firstArgEntries(args);
    const decisive = key => {
      const i = entries.map(e => e.key).lastIndexOf(key);
      if (i < 0) return null;
      return entries.slice(i + 1).some(e => e.key.startsWith('...') && e.key !== '...free') ? null : entries[i];
    };
    const mode = decisive('mode');
    let kind = 'UNSAFE';
    if (mode !== null && /^mode\s*:\s*(['"])rehearsal\1\s*[,}]/.test(raw.slice(mode.at))) kind = 'rehearsal';
    else if (entries.some(e => e.key === '...free') && wrappers.some(([a, b]) => a < m.index && m.index < b)) kind = 'claude-free';
    sites.push({ file, line, kind });
  }
  return sites;
}

/** Imports the scan could not attribute: an aliased runner name or a destructured rename. */
export function censusImportIssues(src, file = '<source>') {
  const code = codeOnly(src);
  return [...code.matchAll(/\brunCensus\s+as\s+\w+|\brunCensus\s*:\s*[A-Za-z_$]/g)].map(m => ({ file, line: src.slice(0, m.index).split('\n').length, issue: 'aliased runCensus' }));
}

/** A rehearsal workspace: the fake first on PATH, its plan, scratch outputs. */
export async function withFake(plan, fn, config = {}) {
  const dir = scratchDir('bf-rehearsal');
  const saved = process.env.PATH;
  try {
    chmodSync(FAKE_CLAUDE7, 0o755);
    mkdirSync(join(dir, 'bin'));
    symlinkSync(FAKE_CLAUDE7, join(dir, 'bin', CLIENT_BIN));
    writeFileSync(join(dir, 'bin', 'fake7.json'), JSON.stringify({ plan, ...config }));
    process.env.PATH = `${join(dir, 'bin')}:${saved}`;
    const paths = { outDir: join(dir, 'out'), ledgerPath: join(dir, 'ledger.jsonl'), practicePath: join(dir, 'practice.json'), stateDir: join(dir, 'state') };
    const log = () => (existsSync(join(dir, 'bin', 'fake7.log.jsonl')) ? readFileSync(join(dir, 'bin', 'fake7.log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
    return await fn({ dir, paths, log, ledger: new CensusLedger(paths.ledgerPath, { stateDir: paths.stateDir }) });
  } finally { process.env.PATH = saved; removeScratch(dir); }
}

