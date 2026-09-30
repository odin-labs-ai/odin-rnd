// EXP 007 J3 (PLAN-DETAIL R2-1, R2-2): a pull-request diff check that EXP 007 leaves EXP 006's files alone. Run by the
// refute and by the publish step, never by `pnpm test` (EXP 006 will legitimately change its own files later).
//   node scripts/blueprint-floor-isolation.mjs --base <sha>
// FAILS when `git diff --name-status <base>..HEAD` lists any EXP 006-owned path (every file EXP 006's pre-registration
// commit added relative to EXP 005's main, every experiments/jev-gate/** file, every scripts/jev-gate-*.mjs file), when a
// shared file changes by anything but pure insertion (.gitignore, scripts/build.mjs: no removed line; site/sitemap.xml:
// the new text is the old text with <url>...</url> entries inserted), or when site/index.html changes.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const EXP005_MAIN = 'b2dbb1f';
export const EXP006_PREREG = 'cfcb90ab7d3b8f4355f24b0dedb79db8ecd557d4';
export const SHARED_LINE_INSERTION = ['.gitignore', 'scripts/build.mjs'];
export const SITEMAP = 'site/sitemap.xml';
export const UNTOUCHABLE = ['site/index.html'];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

/** The EXP 006-owned set: the files cfcb90ab added relative to b2dbb1f, plus the jev-gate trees. */
export function exp006Owned() {
  const added = git('diff', '--name-only', '--diff-filter=A', `${EXP005_MAIN}..${EXP006_PREREG}`).split('\n').filter(Boolean);
  return { added: new Set(added), owns: p => added.includes(p) || p.startsWith('experiments/jev-gate/') || /^scripts\/jev-gate-[^/]*\.mjs$/.test(p) };
}

/** The sitemap's <url> entries in order. */
const urls = xml => [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map(m => m[0]);
/** True when `next` is `prev` with zero or more <url> entries inserted and nothing else changed. */
export function sitemapIsInsertion(prev, next) {
  const a = urls(prev), b = urls(next);
  let i = 0;
  for (const u of b) if (i < a.length && u === a[i]) i++;
  if (i !== a.length) return false;
  const strip = xml => xml.replace(/<url>[\s\S]*?<\/url>/g, '');
  return strip(prev) === strip(next);
}

export function check(base) {
  const { added, owns } = exp006Owned();
  const changes = git('diff', '--name-status', `${base}..HEAD`).split('\n').filter(Boolean).map(l => l.split('\t'));
  const problems = [];
  for (const [status, ...paths] of changes) {
    for (const p of paths) {
      if (owns(p)) problems.push(`${status} ${p}: an EXP 006-owned path`);
      if (UNTOUCHABLE.includes(p)) problems.push(`${status} ${p}: not edited by EXP 007`);
    }
  }
  const changed = new Set(changes.flatMap(([, ...paths]) => paths));
  for (const f of SHARED_LINE_INSERTION) {
    if (!changed.has(f)) continue;
    const removed = git('diff', '-U0', `${base}..HEAD`, '--', f).split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
    if (removed.length) problems.push(`${f}: ${removed.length} removed line(s); only pure insertion is allowed`);
  }
  if (changed.has(SITEMAP) && !sitemapIsInsertion(git('show', `${base}:${SITEMAP}`), git('show', `HEAD:${SITEMAP}`))) problems.push(`${SITEMAP}: not a pure <url> insertion`);
  return { base, head: git('rev-parse', 'HEAD').trim(), exp006Added: added.size, changed: changes.length, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--base');
  const base = at > 0 ? process.argv[at + 1] : null;
  if (!base) { console.error('usage: node scripts/blueprint-floor-isolation.mjs --base <sha>'); process.exit(2); }
  const r = check(base);
  console.log(`base ${r.base}  head ${r.head}  EXP 006-added files ${r.exp006Added}  paths changed ${r.changed}`);
  for (const p of r.problems) console.log(`FAIL ${p}`);
  if (r.problems.length) process.exit(1);
  console.log('PASS: no EXP 006-owned path changed; shared files changed by pure insertion only; site/index.html untouched.');
}
