// EXP 011 (reviewer-keep): proves that the pre-registration leaves every file of EXP 005-009 alone. Run by the refute and
// by the publish step, never by `pnpm test` (the other experiments will legitimately change their own files later).
//   node scripts/reviewer-keep-isolation.mjs --base <sha>               the working tree (tracked and untracked) against <base>
//   node scripts/reviewer-keep-isolation.mjs --base <sha> --committed   HEAD against <base>
// FAILS when a changed path is owned by another experiment (its experiments/<dir>/**, its scripts/<prefix>-*.mjs, an
// existing journal page or its site/data/<dir>/**), when a shared file changes by anything but pure insertion
// (scripts/build.mjs and site/index.html: no removed line; site/sitemap.xml: the old text with <url> entries inserted),
// or when any path outside EXP 011's own set, the shared files and the re-recorded witness receipts changes.
// site/data/witnesses/** is RE-RECORDED, not inserted into: scripts/build.mjs is a pinned input of the witness receipts,
// so editing it obliges `node scripts/run-roi-demos.mjs`; those paths are listed as such, never silently allowed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OWNED_DIRS = ['experiments/jev-gate/', 'experiments/nina-changes/', 'experiments/blueprint-floor/', 'experiments/laya-vs-jev/', 'experiments/latent-handoff/', 'experiments/composable-harness/'];
export const OWNED_SCRIPTS = /^scripts\/(?:jev-gate|nina-changes|blueprint-floor|laya|latent-handoff|composable)[^/]*\.mjs$/;
export const OWNED_DATA = /^site\/data\/(?:jev-gate|nina-changes|blueprint-floor|laya-vs-jev|latent-handoff|composable-harness)\//;
export const OWN = /^(?:experiments\/reviewer-keep\/|scripts\/reviewer-keep-[^/]+\.mjs$|site\/journal\/where-a-model-reviewer-earns-its-keep\.html$|site\/data\/reviewer-keep\/)/;
export const LINE_INSERTION = ['scripts/build.mjs', 'site/index.html'];
export const SITEMAP = 'site/sitemap.xml';
export const RE_RECORDED = /^site\/data\/witnesses\/[^/]+\.json$/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

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

/** Classifies one changed path. Returns null when it is allowed, else the reason it is not. */
export function classify(path, existingJournal) {
  if (OWNED_DIRS.some(d => path.startsWith(d)) || OWNED_SCRIPTS.test(path) || OWNED_DATA.test(path)) return 'owned by another experiment';
  if (path.startsWith('site/journal/') && existingJournal.has(path)) return 'an existing field note';
  if (OWN.test(path) || LINE_INSERTION.includes(path) || path === SITEMAP || RE_RECORDED.test(path)) return null;
  return 'outside EXP 011\'s set, the shared files and the re-recorded witnesses';
}

export function check(base, { committed = false } = {}) {
  const range = committed ? [`${base}..HEAD`] : [base];
  const changes = git('diff', '--name-status', ...range).split('\n').filter(Boolean).map(l => l.split('\t'));
  if (!committed) for (const p of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) changes.push(['A', p]);
  const existingJournal = new Set(git('ls-tree', '-r', '--name-only', base, 'site/journal/').split('\n').filter(Boolean));
  const problems = [], reRecorded = [];
  for (const [status, ...paths] of changes) {
    for (const p of paths) {
      const why = classify(p, existingJournal);
      if (why) problems.push(`${status} ${p}: ${why}`);
      if (RE_RECORDED.test(p)) reRecorded.push(p);
    }
  }
  const changed = new Set(changes.flatMap(([, ...paths]) => paths));
  for (const f of LINE_INSERTION) {
    if (!changed.has(f)) continue;
    const removed = git('diff', '-U0', ...range, '--', f).split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
    if (removed.length) problems.push(`${f}: ${removed.length} removed line(s); only pure insertion is allowed`);
  }
  const next = committed ? git('show', `HEAD:${SITEMAP}`) : readFileSync(SITEMAP, 'utf8');
  if (changed.has(SITEMAP) && !sitemapIsInsertion(git('show', `${base}:${SITEMAP}`), next)) problems.push(`${SITEMAP}: not a pure <url> insertion`);
  return { base, head: git('rev-parse', 'HEAD').trim(), committed, changed: changed.size, reRecorded, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--base');
  const base = at > 0 ? process.argv[at + 1] : null;
  if (!base) { console.error('usage: node scripts/reviewer-keep-isolation.mjs --base <sha> [--committed]'); process.exit(2); }
  const r = check(base, { committed: process.argv.includes('--committed') });
  console.log(`base ${r.base}  head ${r.head}  ${r.committed ? 'committed' : 'working tree'}  paths changed ${r.changed}`);
  for (const p of r.reRecorded) console.log(`RE-RECORDED ${p} (scripts/build.mjs is a pinned witness input)`);
  for (const p of r.problems) console.log(`FAIL ${p}`);
  if (r.problems.length) process.exit(1);
  console.log('PASS: no file of EXP 005-009 changed; shared files changed by pure insertion only; witness receipts re-recorded.');
}
