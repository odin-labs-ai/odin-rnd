// Refute r6 B1: no test may ever reach a real, paid client call, before or after the freeze. A test that calls the
// EXP 006 runner in a paid mode (practice, probe, pre-run probe, counted; to see a refusal) does it inside claudeFree:
// PATH is an empty scratch directory and the tarball does not exist, so no client can be found or staged whatever the
// guard decides. The runner also refuses a paid run under the Node test runner (run_reviewer6.mjs). paidCallSites is
// the structural check over the test sources: every runner call is a fixture run, a rehearsal, or inside claudeFree.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

export const NO_TARBALL = '/nonexistent/nina-0.34.0.tgz';

/** Runs fn({ tarball }) with PATH set to an empty scratch directory; restores PATH and removes the directory. */
export async function claudeFree(fn) {
  const dir = scratchDir('nc-claude-free');
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try { return await fn({ tarball: NO_TARBALL }); } finally {
    if (saved === undefined) delete process.env.PATH; else process.env.PATH = saved;
    removeScratch(dir);
  }
}

// ----------------------------------------------------------------------------- the structural check

const RUNNER_CALL = /\b(runReviewer6|reviewerRun6)\(/g;

/** The source with comments and string/template contents blanked (same length), so parens in them are not counted. */
export function codeOnly(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let i = a; i < b; i += 1) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0, last = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j); i = j + 1; last = c; continue;
    }
    // A regex literal: a slash where an operand is expected. Its body is blanked (escaped parens, quotes).
    if (c === '/' && (last === '' || '(,=:[!&|?{};'.includes(last))) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j += 1; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j += 1; }
      blank(i + 1, j); i = j + 1; last = '/'; continue;
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return out.join('');
}

/** The index just past the paren that closes the one at `open` (in code-only text). */
function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return code.length;
}

/**
 * The call's FIRST argument (refute r8): its code-only text and, per top-level key or spread, the entries in order.
 * `args` is the code-only text of the call's parens; only an object literal first argument has entries.
 */
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
 * Every runner call site in `src`, classified from the call's code only (comments and string contents blanked, so a
 * string or comment saying "fixture: true" does not count; refute r7), and from its FIRST argument only (refute r8).
 * For a key given twice the LAST one wins, and a spread after it (other than claudeFree's ...free) could override it,
 * so it then decides nothing:
 *   'fixture'     the property fixture: true, exactly, followed by , or }, at the first argument's own level;
 *   'rehearsal'   mode: 'rehearsal' there (either runner call), or rehearsal: true (reviewerRun6 only: runReviewer6
 *                 takes the mode);
 *   'claude-free' inside a claudeFree(...) call and spreading its options (...free);
 *   'UNSAFE'      anything else.
 */
export function paidCallSites(src, file = '<source>') {
  const code = codeOnly(src);
  const wrappers = [];
  for (const m of code.matchAll(/\bclaudeFree\(/g)) { const open = m.index + m[0].length - 1; wrappers.push([open, closing(code, open)]); }
  const sites = [];
  for (const m of code.matchAll(RUNNER_CALL)) {
    const open = m.index + m[0].length - 1;
    if (/function\s*$|async\s+function\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue; // a definition
    const end = closing(code, open);
    const args = code.slice(open, end), raw = src.slice(open, end);
    const line = src.slice(0, m.index).split('\n').length;
    const { first, entries } = firstArgEntries(args);
    /** The last entry for `key`, if no spread (other than ...free) comes after it. */
    const decisive = key => {
      const i = entries.map(e => e.key).lastIndexOf(key);
      if (i < 0) return null;
      return entries.slice(i + 1).some(e => e.key.startsWith('...') && e.key !== '...free') ? null : entries[i];
    };
    const valueIs = (entry, re) => entry !== null && re.test(first.slice(entry.at));
    const fixture = valueIs(decisive('fixture'), /^fixture\s*:\s*true\s*[,}]/);
    // The mode literal's quotes survive in the code-only text and its contents sit at the same offsets in the source.
    const mode = decisive('mode');
    const modeRehearsal = mode !== null && /^mode\s*:\s*(['"])rehearsal\1\s*[,}]/.test(raw.slice(mode.at));
    const rehearsalFlag = m[1] === 'reviewerRun6' && valueIs(decisive('rehearsal'), /^rehearsal\s*:\s*true\s*[,}]/);
    let kind = 'UNSAFE';
    if (fixture) kind = 'fixture';
    else if (modeRehearsal || rehearsalFlag) kind = 'rehearsal';
    else if (entries.some(e => e.key === '...free') && wrappers.some(([a, b]) => a < m.index && m.index < b)) kind = 'claude-free';
    sites.push({ file, line, fn: m[1], kind });
  }
  return sites;
}

/**
 * Imports the scan could not attribute or might not follow: an aliased runner name, a double-quoted relative import,
 * and a dynamic import() of a relative module (refute r8). testSources follows literal relative dynamic imports too;
 * the structural test lists the ones it accepts by name.
 */
export function importIssues(src, file = '<source>') {
  const code = codeOnly(src);
  const issues = [];
  const at = i => src.slice(0, i).split('\n').length;
  for (const m of code.matchAll(/\b(runReviewer6|reviewerRun6)\s+as\s+\w+|\b(runReviewer6|reviewerRun6)\s*:\s*[A-Za-z_$]/g)) issues.push({ file, line: at(m.index), issue: `aliased ${m[1] ?? m[2]}` });
  for (const m of src.matchAll(/\bfrom\s+"\.{1,2}\//g)) if (code.startsWith('from', m.index)) issues.push({ file, line: at(m.index), issue: 'a double-quoted relative import' });
  for (const m of src.matchAll(/\bimport\s*\(\s*(['"`])(\.{1,2}\/[^'"`]*)\1/g)) if (code.startsWith('import', m.index)) issues.push({ file, line: at(m.index), issue: `a dynamic import of ${m[2]}` });
  return issues;
}

/** The test files and the local helper modules they import (transitively, under scripts/). */
export function testSources(files) {
  const seen = new Set();
  const visit = f => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8'), code = codeOnly(src);
    // Only an import in code (not one quoted inside a string or a comment); either quote style.
    for (const m of src.matchAll(/\bfrom\s+(['"])(\.\.?\/[^'"]+\.mjs)\1/g)) if (code.startsWith('from', m.index)) visit(resolve(dirname(f), m[2]));
    for (const m of src.matchAll(/\bimport\s*\(\s*(['"`])(\.\.?\/[^'"`]+\.m?js)\1/g)) if (code.startsWith('import', m.index)) visit(resolve(dirname(f), m[2]));
  };
  for (const f of files) visit(resolve(f));
  return [...seen].filter(f => f.includes(`${join('scripts', '')}`));
}
