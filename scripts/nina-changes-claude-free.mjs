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
 * Every runner call site in `src`, classified: 'fixture' (fixture: true), 'rehearsal' (mode 'rehearsal' or
 * rehearsal: true), 'claude-free' (inside a claudeFree(...) call and spreading its options), or 'UNSAFE'.
 */
export function paidCallSites(src, file = '<source>') {
  const code = codeOnly(src);
  const wrappers = [];
  for (const m of code.matchAll(/\bclaudeFree\(/g)) { const open = m.index + m[0].length - 1; wrappers.push([open, closing(code, open)]); }
  const sites = [];
  for (const m of code.matchAll(RUNNER_CALL)) {
    const open = m.index + m[0].length - 1;
    if (/function\s*$|async\s+function\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue; // a definition
    const args = src.slice(open, closing(code, open));
    const line = src.slice(0, m.index).split('\n').length;
    let kind = 'UNSAFE';
    if (/\bfixture:\s*true\b/.test(args)) kind = 'fixture';
    else if (/\bmode:\s*'rehearsal'|\brehearsal:\s*true\b/.test(args)) kind = 'rehearsal';
    else if (/\.\.\.free\b/.test(args) && wrappers.some(([a, b]) => a < m.index && m.index < b)) kind = 'claude-free';
    sites.push({ file, line, fn: m[1], kind });
  }
  return sites;
}

/** The test files and the local helper modules they import (transitively, under scripts/). */
export function testSources(files) {
  const seen = new Set();
  const visit = f => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from '(\.\/[^']+\.mjs)'/g)) visit(resolve(dirname(f), m[1]));
  };
  for (const f of files) visit(resolve(f));
  return [...seen].filter(f => f.includes(`${join('scripts', '')}`));
}
