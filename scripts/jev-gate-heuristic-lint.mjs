// EXP 005 baseline (b): a line-regex linter written straight from rules.txt. It resolves relative
// import paths but parses no syntax, and it reads only inputs.json (see baselines.mjs). A real
// baseline a gate has to beat, not a strawman.
//
//   node scripts/jev-gate-heuristic-lint.mjs            print the score and record it in baselines.json
//   node scripts/jev-gate-heuristic-lint.mjs --check    recompute and compare with baselines.json
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseState, runBaseline } from '../experiments/jev-gate/baselines.mjs';

const ALLOWED_ENV = new Set(['PORT', 'DATABASE_URL', 'LOG_LEVEL', 'SMTP_HOST', 'SMTP_FROM', 'INVOICE_PREFIX']);
const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"`]([^'"`$]*)/g;

function breaksARule(file, line) {
  const layer = /^src\/(domain|app|infra|config)\//.exec(file ?? '')?.[1];
  if (!layer || !file.endsWith('.ts')) return false;
  if (layer === 'config') {
    // line 8: process.env.NAME outside the allowlist, or process.env[...], comments included
    return [...line.matchAll(/process\.env(?:\[|\.(\w+))/g)].some(m => !m[1] || !ALLOWED_ENV.has(m[1]));
  }
  if (line.includes('process.env')) return true; // line 7: domain, app and infra, comments included
  if (COMMENT.test(line)) return false;
  for (const [, spec] of line.matchAll(SPECIFIER)) {
    const target = spec.startsWith('.') ? posix.join(posix.dirname(file), spec) : spec;
    if (spec === 'pg' && (layer === 'domain' || layer === 'app')) return true; // line 5
    if (layer === 'domain' && /^src\/(app|infra|config)(\/|$)/.test(target)) return true; // lines 2-4
    if (layer === 'app' && /^src\/infra\/[^/]+\//.test(target)) return true; // line 6
  }
  return false;
}

export const predict = state => parseState(state).added.some(({ file, line }) => breaksARule(file, line));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBaseline('heuristic-lint', fileURLToPath(import.meta.url),
    'line-regex linter of rules.txt lines 2-8 over added lines: relative specifiers resolved against the file path, comments skipped for imports only', predict);
}
