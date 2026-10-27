// Vendors Lab 06, "Which model should review your code?", into site/data/labs/review/record.json and its sha256 pin,
// from public sources only: three experiment results records in this repository, each at the commit that last wrote it,
// and the descriptions of this site's merged pull requests that carry review receipts (read with gh).
//
//   node scripts/vendor-review.mjs            write the record and its pin
//   node scripts/vendor-review.mjs --verify   re-derive it (reading every pull request again) and refuse unless it is
//                                             byte for byte the committed record
//
// It refuses (nothing written) when a source file's bytes are not the ones at its cited commit, the commit is not part
// of origin/main, a pull request is not merged, or a quoted receipt is not word for word in that pull request's
// description. The receipts are chosen here, by hand, as the shortest passage that records the FIX-NEEDED verdict and,
// where the description says it, what was fixed; a pull request whose description only names the review step in its
// landing plan is listed as such (planOnly), never shown as a catch.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_ONLY, RECEIPTS, RECEIPT_PRS, SOURCES, deriveFrontier, deriveNina, deriveSelfVerify } from './lab-review.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/review/record.json';
export const PIN_FILE = 'site/data/labs/review/record.sha256';
// The commit that last wrote each source (its results PR's merge).
export const SOURCE_COMMITS = { frontier: '9c379579e150113e61221cd07ec3cb901cd2efdf', nina: 'a4c01980201b7c6363566a79f33cbcca43c8377e', 'self-verify': '3d870da3537e1528e175227c45a66182ae6dd349' };
const gitCli = (...args) => execFileSync('git', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const pr = n => JSON.parse(execFileSync('gh', ['pr', 'view', String(n), '--repo', 'odin-labs-ai/odin-rnd', '--json', 'number,title,body,state,mergeCommit'], { encoding: 'utf8' }));
const DERIVE = { frontier: deriveFrontier, nina: deriveNina, 'self-verify': deriveSelfVerify };

// `git` and `readPr` are injectable so a test can run the vendor without history or network (CI checks out one commit).
export function build({ readPr = pr, git = gitCli } = {}) {
  const problems = [];
  const sources = Object.entries(SOURCES).map(([role, { file }]) => {
    const commit = SOURCE_COMMITS[role];
    const atCommit = git('show', `${commit}:${file}`), now = readFileSync(file);
    if (!atCommit.equals(now)) problems.push(`${file}: not the bytes at ${commit.slice(0, 8)}`);
    try { git('merge-base', '--is-ancestor', commit, 'origin/main'); } catch { problems.push(`${commit.slice(0, 8)} is not part of origin/main`); }
    return { role, file, commit, sha256: sha256(now), data: JSON.parse(now) };
  });
  const gallery = [];
  for (const n of RECEIPT_PRS) {
    const p = readPr(n);
    if (p.state !== 'MERGED') problems.push(`#${n}: not merged`);
    // A plan-only description mentions FIX-NEEDED only in its landing plan line.
    if (PLAN_ONLY.includes(n)) { if (/FIX-NEEDED/.test(p.body.split('\n').filter(l => !l.startsWith('Landing-Plan:')).join('\n'))) problems.push(`#${n}: listed as plan only, but its description records a FIX-NEEDED`); continue; }
    const receipt = RECEIPTS[n];
    if (!receipt || !receipt.every(part => p.body.includes(part))) { problems.push(`#${n}: its receipt is not word for word in its description`); continue; }
    gallery.push({ pr: n, title: p.title, mergeCommit: p.mergeCommit.oid, receipt });
  }
  if (problems.length) throw new Error(`vendor-review refused:\n  ${problems.join('\n  ')}`);
  const by = Object.fromEntries(sources.map(s => [s.role, s]));
  return {
    format: 'odin-lab-review', version: 1,
    sources: sources.map(({ role, file, commit, sha256: h }) => ({ role, file, commit, sha256: h })),
    frontier: DERIVE.frontier(by.frontier.data),
    nina: DERIVE.nina(by.nina.data),
    selfVerify: DERIVE['self-verify'](by['self-verify'].data),
    gallery,
    planOnly: PLAN_ONLY,
  };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;
export const pinLine = bytes => `${sha256(bytes)}  record.json\n`;

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const out = serialise(build());
  if (process.argv.includes('--verify')) {
    const same = out === readFileSync(OUT_FILE, 'utf8') && pinLine(out) === readFileSync(PIN_FILE, 'utf8');
    console.log(same ? 'vendor-review --verify: SAME' : 'vendor-review --verify: DIFFERENT');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT_FILE, out);
  writeFileSync(PIN_FILE, pinLine(out));
  console.log(`vendor-review: wrote ${OUT_FILE} and its pin`);
}
