// The frozen-path census: every path some experiment binds by sha256, read from the four pin formats the tree uses.
//
//   1. sha256sum lists: experiments/**/*.sha256 (runners.sha256, corpus/inputs/amendment/preregistration digests).
//      A line is `<sha256>  <path>`; the path is repo-root-relative when its first segment is a top-level directory
//      (runners.sha256 names experiments/… and scripts/check.mjs), else relative to the list's own directory.
//   2. records: experiments/<exp>/preregistration.json#files and amendment-NN.json#files ({ repo path: sha256 }). An
//      amendment's `pins` ({ path: { from, to } }) re-pins a path its parent bound: the amendment's `to` is the
//      effective hash, and its `from` must equal what it supersedes.
//   3. vendor manifests: experiments/**/vendor.json#files ({ path relative to the manifest: sha256 }).
//   4. ROI witness records: site/data/witnesses/<project>.json#inputSha256 and manifest.json#generatorInputSha256 and
//      #records ({ repo path: sha256 }), which scripts/witness-records.mjs re-checks against the tree.
// census() reads the live tree and reports every bound path whose bytes differ from its effective hash. It never
// writes. `node harness/frozen-census.mjs --paths` prints the bound paths (for `git diff origin/main -- <paths>`);
// `--write` regenerates harness/frozen-census.json, the committed floor the census test holds the tree to.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CENSUS_FILE = 'harness/frozen-census.json';
const WITNESSES = 'site/data/witnesses';
const HEX = /^[0-9a-f]{64}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function walk(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const rel = posix.join(dir, e.name);
    return e.isDirectory() ? walk(root, rel) : [rel];
  }).sort();
}

/** Every pin, as { path, sha256, boundBy } rows, before supersession is applied. Throws on an unparseable pin file. */
export function readPins(root = REPO_ROOT) {
  const files = walk(root, 'experiments');
  const pins = [];
  for (const list of files.filter(f => f.endsWith('.sha256'))) {
    readFileSync(join(root, list), 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (!m) throw new Error(`${list}:${i + 1}: not a sha256sum line`);
      const top = m[2].split('/')[0];
      const rooted = m[2].includes('/') && existsSync(join(root, top)) && statSync(join(root, top)).isDirectory();
      pins.push({ path: rooted ? m[2] : posix.join(posix.dirname(list), m[2]), sha256: m[1], boundBy: `${list}:${i + 1}` });
    });
  }
  for (const manifest of files.filter(f => posix.basename(f) === 'vendor.json')) {
    const j = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    for (const [p, h] of Object.entries(j.files ?? {})) pins.push({ path: posix.join(posix.dirname(manifest), p), sha256: h, boundBy: `${manifest}#files` });
  }
  // 4. the published ROI witness records (scripts/witness-records.mjs re-hashes all of these against the tree): each
  //    record's #inputSha256 (demos/lib.mjs included), the manifest's #generatorInputSha256 and #records digests.
  for (const rec of walk(root, WITNESSES).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(root, rec), 'utf8'));
    if (posix.basename(rec) === 'manifest.json') {
      for (const [p, h] of Object.entries(j.generatorInputSha256 ?? {})) pins.push({ path: p, sha256: h, boundBy: `${rec}#generatorInputSha256` });
      for (const [project, r] of Object.entries(j.records ?? {})) pins.push({ path: posix.join(WITNESSES, `${project}.json`), sha256: r.sha256, boundBy: `${rec}#records` });
    } else for (const [p, h] of Object.entries(j.inputSha256 ?? {})) pins.push({ path: p, sha256: h, boundBy: `${rec}#inputSha256` });
  }
  return pins;
}

/** Records (preregistration first, then amendments by number) per experiment, with the supersession each applies. */
export function readRecords(root = REPO_ROOT) {
  const out = [];
  for (const exp of readdirSync(join(root, 'experiments'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const dir = `experiments/${exp}`;
    const names = readdirSync(join(root, dir)).filter(f => f === 'preregistration.json' || /^amendment-\d+\.json$/.test(f));
    names.sort((a, b) => (a === 'preregistration.json' ? -1 : b === 'preregistration.json' ? 1 : Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0])));
    for (const name of names) {
      const j = JSON.parse(readFileSync(join(root, dir, name), 'utf8'));
      const files = j.files && typeof j.files === 'object' ? j.files : {};
      const repins = {};
      for (const [p, v] of Object.entries(j.pins && typeof j.pins === 'object' ? j.pins : {})) {
        if (v && typeof v === 'object' && HEX.test(v.from ?? '') && HEX.test(v.to ?? '')) repins[p] = v;
      }
      out.push({ record: `${dir}/${name}`, files, repins });
    }
  }
  return out;
}

/**
 * The census: { entries: [{ path, sha256, boundBy[] }], violations: [{ path, reason }] }. One entry per bound path,
 * holding its EFFECTIVE hash: a record's binding, re-pinned by any later amendment's pins; a sha256sum or vendor pin
 * binds as written. A path bound by two sources to different effective hashes is a violation in its own right.
 */
export function census(root = REPO_ROOT) {
  const bindings = new Map(); // path -> [{ sha256, by }]
  const bind = (path, sha, by) => {
    if (!bindings.has(path)) bindings.set(path, []);
    bindings.get(path).push({ sha256: sha, by });
  };
  const violations = [];
  for (const p of readPins(root)) bind(p.path, p.sha256, p.boundBy);
  const effective = new Map(); // record-bound path -> { sha256, by[] }
  for (const { record, files, repins } of readRecords(root)) {
    for (const [p, h] of Object.entries(files)) {
      if (typeof h !== 'string' || !HEX.test(h)) { violations.push({ path: p, reason: `${record}#files: not a sha256` }); continue; }
      effective.set(p, { sha256: h, by: [`${record}#files`] });
    }
    for (const [p, { from, to }] of Object.entries(repins)) {
      const cur = effective.get(p);
      if (!cur) { violations.push({ path: p, reason: `${record}#pins re-pins a path no earlier record binds` }); continue; }
      if (cur.sha256 !== from) violations.push({ path: p, reason: `${record}#pins: from ${from.slice(0, 12)} != the bound ${cur.sha256.slice(0, 12)}` });
      effective.set(p, { sha256: to, by: [...cur.by, `${record}#pins`] });
    }
  }
  for (const [p, { sha256: h, by }] of effective) bind(p, h, by.join(' -> '));
  const entries = [];
  for (const [path, bs] of [...bindings].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const hashes = [...new Set(bs.map(b => b.sha256))];
    entries.push({ path, sha256: hashes[0], boundBy: bs.map(b => b.by) });
    if (hashes.length > 1) violations.push({ path, reason: `bound to ${hashes.length} different hashes by ${bs.map(b => `${b.by}=${b.sha256.slice(0, 12)}`).join(', ')}` });
    const abs = join(root, path);
    if (!existsSync(abs)) { violations.push({ path, reason: 'bound but missing' }); continue; }
    const got = sha256(readFileSync(abs));
    for (const h of hashes) if (got !== h) violations.push({ path, reason: `bytes hash to ${got.slice(0, 12)}, bound ${h.slice(0, 12)} by ${bs.filter(b => b.sha256 === h).map(b => b.by).join(', ')}` });
  }
  return { entries, violations };
}

/** The pin files census() reads (for a scratch copy). */
export const pinSources = (root = REPO_ROOT) => [...walk(root, 'experiments').filter(f => f.endsWith('.sha256') || posix.basename(f) === 'vendor.json' || /\/(preregistration|amendment-\d+)\.json$/.test(f)), ...walk(root, WITNESSES).filter(f => f.endsWith('.json'))];

export const renderCensus = entries => `${JSON.stringify({
  schema: 'odin-rnd.frozen-census.v1',
  note: 'Every path an experiment binds by sha256 (sha256sum lists, preregistration/amendment #files with #pins re-pins, vendor.json, the ROI witness records). This is a floor: the census test fails if any listed path stops being bound or any bound path\'s bytes differ from its effective hash. Regenerate with node harness/frozen-census.mjs --write.',
  paths: entries.map(e => e.path),
}, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entries, violations } = census();
  if (process.argv.includes('--paths')) process.stdout.write(entries.map(e => `${e.path}\n`).join(''));
  else if (process.argv.includes('--write')) writeFileSync(join(REPO_ROOT, CENSUS_FILE), renderCensus(entries));
  else process.stdout.write(`${entries.length} bound paths, ${violations.length} violation(s)\n${violations.map(v => `  ${v.path}: ${v.reason}\n`).join('')}`);
  process.exit(violations.length ? 1 : 0);
}
