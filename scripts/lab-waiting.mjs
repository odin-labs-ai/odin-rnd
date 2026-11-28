#!/usr/bin/env node
// scripts/lab-waiting.mjs — the registry of every lane-cited commit still open across the public labs.
//
// vp-living-labs-off-the-laptop-one-org-owned-1793146306, bundle 4, WO-01. A public lab record may cite a private
// commit that is only on a pushed lane, through the lab kit's laneCite (`onMain: false`, the lane, the main it is
// built on, and the date it was checked -- lab-kit.mjs). This is the registry odin-labs' lab-waiting.yml reads once
// a day: every such cite, found by walking the committed records under site/data/labs/, never typed by hand.
//
//   node scripts/lab-waiting.mjs list [--json]
//       Every laneCite the lab kit's own contract accepts (laneCiteProblems: []), reported as one item per cite:
//       { lab, file, at, commit, lane, baseMain, checkedAt } (odin-lab-waiting v1). `at` is the JSON pointer within
//       the record the cite was found at (e.g. "/source"). A record this script cannot parse cites nothing -- it is
//       never read as a crash, since an unrelated malformed file must not stop the registry.
//   node scripts/lab-waiting.mjs flip --commit <sha> --main <sha> --checked <date> --compare <word>
//       WO-01's re-cite writer: once lane_watch.py (odin-labs) shows a cited commit is now part of the private main,
//       this re-cites it in every record that laneCite'd it, as a cite() instead. NOT YET BUILT -- refusing loudly is
//       the safe outcome here: odin-labs' lane-flip-pr.sh treats any non-zero exit as "flip refused; no PR opened,
//       the records are unchanged" (its own REFUSED path), never a silent no-op and never a corrupted record. Build
//       this before the first real flip is due (today: the one live cite, agent-space/outage.json's lane commit, is
//       still `diverged` from the private main, checked 2026-11-28).
//
// Runs wherever the records are checked out (locally, or in odin-labs' hosted lab-waiting.yml); it never touches a
// private repository or a credential.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneCiteProblems } from './lab-kit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const LABS_DIR = join(ROOT, 'data', 'labs');

/** `real` (an already-resolved, symlink-free path) is `root` itself or strictly inside it. */
function withinRoot(root, real) {
  const rel = relative(root, real);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

// A symlink under site/data/labs/ is attacker-controlled on this public repo (anyone can open a PR adding one). A
// dangling symlink is skipped (nothing to walk); one whose real target escapes `root` is never followed or read --
// this registry must not become a way to read an arbitrary path elsewhere on the checkout or the filesystem. A
// symlink whose real target stays inside the lab tree is followed like any other entry.
function* walkJson(dir, root = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let real;
      try { real = realpathSync(path); } catch { continue; }
      if (!withinRoot(root, real)) continue;
      const info = statSync(real);
      if (info.isDirectory()) { yield* walkJson(path, root); continue; }
      if (info.isFile() && entry.name.endsWith('.json')) yield path;
      continue;
    }
    if (entry.isDirectory()) { yield* walkJson(path, root); continue; }
    if (entry.name.endsWith('.json')) yield path;
  }
}

/** A JSON Pointer reference token (RFC 6901 §3): '~' and '/' are not legal inside one unescaped, so a record whose
 * own object key contains either (unusual, but syntactically valid JSON) must not be allowed to corrupt the
 * pointers this registry reports. Order matters: escape '~' to '~0' before '/' to '~1', or a literal '/' would be
 * mis-escaped as '~01' instead of '~1'. */
const escapeToken = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/** Every laneCite-shaped object in a record's tree (onMain === false, accepted by the kit's own laneCiteProblems),
 * with the JSON pointer it was found at. A near-miss (onMain false but malformed) is not a cite: it is the
 * record's own publish-time validation that must catch it, never this registry. */
export function laneCites(value, at = '') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...laneCites(v, `${at}/${i}`)));
    return out;
  }
  if (value && typeof value === 'object') {
    if (value.onMain === false && laneCiteProblems(value).length === 0) out.push({ at, cite: value });
    for (const [k, v] of Object.entries(value)) out.push(...laneCites(v, `${at}/${escapeToken(k)}`));
  }
  return out;
}

/** The registry (odin-lab-waiting v1): every laneCite under site/data/labs/, sorted for a stable diff.
 * `labsDir` defaults to this repository's own site/data/labs, overridable for a test by LAB_WAITING_LABS_DIR (the
 * CLI's own env, so a subprocess test can run the real binary against a fixture instead of the live records) or by
 * calling list() directly with a path (the "site" root is then two levels up, so `file` still comes out as
 * "data/labs/<lab>/..."). */
export function list(labsDir = process.env.LAB_WAITING_LABS_DIR || LABS_DIR) {
  const siteRoot = dirname(dirname(labsDir));
  const items = [];
  for (const path of walkJson(labsDir)) {
    const file = relative(siteRoot, path).split('\\').join('/');
    const lab = file.split('/')[2];
    // A record present in the tree but unreadable (permissions, I/O, vanished mid-walk) is a real problem with this
    // registry's own completeness, not a malformed record -- it must never read as "nothing is waiting for main".
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`lab-waiting: could not check ${file}: ${error.message}`);
    }
    // Not JSON: cites nothing, never a crash for the whole registry. The record's own publish-time validation is
    // what must catch a malformed record -- never this registry, and never loudly (unlike an unreadable file above).
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      continue;
    }
    for (const { at, cite } of laneCites(record)) {
      items.push({ lab, file, at, commit: cite.commit, lane: cite.lane, baseMain: cite.baseMain, checkedAt: cite.checkedAt });
    }
  }
  items.sort((a, b) => (a.file === b.file ? a.at.localeCompare(b.at) : a.file.localeCompare(b.file)));
  return { format: 'odin-lab-waiting', version: 1, items };
}

function flip() {
  console.error('lab-waiting.mjs flip: not yet implemented (WO-01 follow-on); no record changed');
  return 1;
}

export function main(argv) {
  const [cmd] = argv;
  const arg = (n, f) => { const i = argv.indexOf(`--${n}`); return i > 0 ? argv[i + 1] : f; };
  if (cmd === 'list') {
    const registry = list();
    if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(registry)}\n`);
    } else {
      for (const item of registry.items) console.log(`${item.commit.slice(0, 12)} ${item.lab} ${item.file}${item.at} (cited ${item.checkedAt}, lane ${item.lane})`);
      if (!registry.items.length) console.log('nothing is waiting for main');
    }
    return 0;
  }
  if (cmd === 'flip') {
    for (const name of ['commit', 'main', 'checked', 'compare']) {
      if (!arg(name)) { console.error(`lab-waiting.mjs flip: --${name} is required`); return 2; }
    }
    return flip();
  }
  console.error('usage: lab-waiting.mjs list [--json] | flip --commit <sha> --main <sha> --checked <date> --compare <word>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
