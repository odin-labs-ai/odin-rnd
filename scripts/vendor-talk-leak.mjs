// Vendors Lab 09, "Can a talk leak data?", into site/data/labs/talk-leak/record.json (and its one-line sha256 pin),
// from the agent space's private repository at its main, and from one run on this machine:
//   - the leak scan's METHOD and TESTS: the scanner, its test, the planted leaks it is tested with, the hashed deny-list
//     and the talk-safety note, cited by commit and sha256. The deny-list is published as COUNTS only: its terms, its
//     labels and its numbers are never copied (its labels and the scanner's own word lists name what it protects);
//   - the scanner's own tests, run here at that main;
//   - a FRESH run, here, of that main's own build gate over the talk's sealed build: the one form in which the talk
//     leaves the machine it is built on, a zip whose sha256 is first checked against its parts manifest. The gate
//     checks every file against the build's manifest and scans it; its findings are published as counts, never text.
// Then --self-scan runs the same scanner over what this lab publishes (the rendered page, the record, the tile and the
// template) and writes site/data/labs/talk-leak/self-scan.json: the sha256 of each file it read and its findings by
// kind, after this site's own public names (the org, the brand, this repository, the public docs) are set aside and
// counted. The build checks that every file it names is still the bytes it scanned.
//
//   node scripts/vendor-talk-leak.mjs --fetch <dir> --space <git dir> --clone <clone at main> --repo <owner/name> \
//        --cite <sha>=<what it changed> ... --file <role>=<path> ... --bundle <dir holding the zip and its parts manifest>
//        (roles: scanner, gate, tests, plants, denylist, note; reads the main head from GitHub and refuses a --main that is
//        not it, refuses a clone not at main or with a changed tracked file, refuses a file whose last change is not a
//        --cite commit; the repository, its paths, the bundle and <dir> are private and never committed)
//   node scripts/vendor-talk-leak.mjs --from <dir>                       (writes the record and its pin)
//   node scripts/vendor-talk-leak.mjs --verify --from <dir>              (refuses unless the record is the same bytes)
//   node scripts/vendor-talk-leak.mjs --self-scan --from <dir> --clone <clone> --package <folder> --scanner <path> --denylist <path>
//        (writes self-scan.json: takes <folder> fresh from the record's main with git archive, refuses a scanner or
//        deny-list there that is not the one the record cites by sha256, and runs Python isolated from that folder)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTalkLeak, TALK_TEMPLATE } from './lab-talk-leak.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/talk-leak/record.json';
export const PIN_FILE = 'site/data/labs/talk-leak/record.sha256';
export const SELF_SCAN_FILE = 'site/data/labs/talk-leak/self-scan.json';
export const ROLES = ['scanner', 'gate', 'tests', 'plants', 'denylist', 'note'];
export const ROLE_WORDS = {
  scanner: 'the leak scan',
  gate: 'the build gate, which makes the sealed build and verifies it',
  tests: 'the leak scan\'s test',
  plants: 'the planted leaks the test is run with',
  denylist: 'the hashed deny-list',
  note: 'the talk-safety note',
};
// This site's own public names, which every page carries in its header and footer: set aside by the self-scan and
// counted, never hidden. Matched whole, case folded.
export const PUBLIC_NAMES = ['odin-labs-ai', 'odin-labs.ai', 'odin labs', 'odin-labs', 'odin-rnd', 'open-docs', 'open docs'];

const at = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A checkout Python may import from: no untracked file at all, and no ignored path but a bytecode cache, so nothing
// beside the tracked tree can stand in for a module (a package folder outranks the module file of the same name).
export function pristineProblems(statusLines) {
  return statusLines.filter(l => l && !(l.startsWith('!! ') && /(^|\/)__pycache__\/(?:[^/]+\.pyc)?$/.test(l.slice(3)))).map(l => `not a tracked, unchanged file: ${l.slice(0, 3)}…`);
}
// Python run isolated: no environment search path, no user site, no current folder on the path, and bytecode read and
// written only under a fresh cache folder of this run, never a cache already in the tree.
const python = (dir, args, opts = {}) => execFileSync('python3', ['-I', '-B', ...args], { ...opts, env: { ...process.env, PYTHONPYCACHEPREFIX: join(dir, 'pycache'), PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 1 << 26 });
const counts = (list, key) => list.reduce((o, x) => ({ ...o, [x[key]]: (o[x[key]] ?? 0) + 1 }), {});
const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function fetch(into, a) {
  const dir = resolve(into);
  mkdirSync(join(dir, 'files'), { recursive: true });
  const git = (gitDir, ...args) => execFileSync('git', ['-C', gitDir, ...args], { maxBuffer: 1 << 26 });
  const main = execFileSync('gh', ['api', `repos/${a.repo}/commits/main`, '--jq', '.sha']).toString().trim();
  if (a.main && a.main !== main) throw new Error(`--main ${a.main} is not the main head of ${a.repo} (${main})`);
  if (git(a.clone, 'rev-parse', 'HEAD').toString().trim() !== main) throw new Error('--clone is not checked out at the main head');
  try { git(a.clone, 'diff', '--quiet', 'HEAD'); } catch { throw new Error('--clone has a changed tracked file'); }
  const dirty = pristineProblems(git(a.clone, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored').toString().split('\n'));
  if (dirty.length) throw new Error(`--clone is not pristine (${dirty.length} paths): ${dirty.slice(0, 3).join('; ')}`);
  const cites = a.cite.map(spec => { const [sha, ...what] = spec.split('='); return { commit: git(a.space, 'rev-parse', `${sha}^{commit}`).toString().trim(), what: what.join('=') }; });
  if (cites.some(c => !c.what)) throw new Error('--cite <sha>=<what it changed>');
  const paths = {};
  for (const spec of a.file) {
    const [role, path] = spec.split('=');
    if (!ROLES.includes(role) || !path) throw new Error(`--file ${spec}: <role>=<path>, role one of ${ROLES.join(', ')}`);
    const bytes = git(a.space, 'show', `${main}:${path}`);
    if (!bytes.equals(readFileSync(join(a.clone, path)))) throw new Error(`--file ${role}: the clone's file is not the committed one`);
    const last = git(a.space, 'log', '-1', '--format=%H', main, '--', path).toString().trim();
    if (!cites.some(c => c.commit === last)) throw new Error(`--file ${role}: last changed at main by ${last.slice(0, 8)}, which is not cited`);
    writeFileSync(join(dir, 'files', role), bytes);
    paths[role] = path;
  }
  for (const c of cites) {
    c.at = git(a.space, 'show', '-s', '--format=%cI', c.commit).toString().trim();
    c.check = JSON.parse(execFileSync('gh', ['api', `repos/${a.repo}/compare/${c.commit}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}']).toString());
  }
  // The scanner's own tests, run at main with pytest, isolated (no cache read from or written into the clone).
  const testsAt = new Date();
  // A run that exits non-zero is refused whatever its summary line says.
  let out;
  try { out = python(dir, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', paths.tests], { cwd: a.clone }).toString(); }
  catch (e) { throw new Error(`the scanner's tests exited ${e.status}; nothing is recorded:\n${String(e.stdout ?? '').split('\n').slice(-5).join('\n')}`); }
  const n = word => Number((new RegExp(`(\\d+) ${word}`).exec(out.split('\n').filter(l => /passed|failed|error/.test(l)).at(-1) ?? '') ?? [])[1] ?? 0);
  const tests = { at: at(testsAt), passed: n('passed'), failed: n('failed'), errors: n('error'), python: execFileSync('python3', ['--version']).toString().trim().replace(/^Python /, '') };
  // The planted leaks, by name only: the module is the test's, read for the list of its kinds.
  const plants = JSON.parse(python(dir, ['-c', 'import json,sys\nsys.path.insert(0, ".")\nfrom tools.talk.plants import PLANTS\nprint(json.dumps(sorted(PLANTS)))'], { cwd: a.clone }).toString());
  // The sealed build: its zip checked against its parts manifest (its bytes, each part, and the parts joined).
  const parts = JSON.parse(readFileSync(join(a.bundle, readdirSync(a.bundle).find(f => f === 'PARTS.json')), 'utf8'));
  const zip = readFileSync(join(a.bundle, parts.zip));
  if (sha256(zip) !== parts.sha256 || zip.length !== parts.bytes) throw new Error('the zip is not the one its parts manifest names');
  for (const p of parts.parts) if (sha256(readFileSync(join(a.bundle, p.file))) !== p.sha256) throw new Error(`a part is not the one its manifest names (${p.file})`);
  if (sha256(Buffer.concat(parts.parts.map(p => readFileSync(join(a.bundle, p.file))))) !== parts.sha256) throw new Error('the parts do not join into the zip');
  // The scan is the build gate's own: its verify step checks every file of the zip against the build's manifest by
  // sha256, then scans every file but the manifest with the scanner and the full deny-list. The counts are read from
  // that very scan (the gate's scan function, wrapped to keep its report), never from a second implementation.
  const scanAt = new Date();
  const GATE = 'import json, sys\nsys.path.insert(0, ".")\nfrom tools.talk import bundle as B\nkept = {}\nscan = B.scan_bundle\ndef keep(root, deny):\n    rep = scan(root, deny)\n    kept.update(rep)\n    return rep\nB.scan_bundle = keep\nproblems = B.verify(sys.argv[1])\nkinds = {}\nfor x in kept.get("errors", []):\n    kinds[x["kind"]] = kinds.get(x["kind"], 0) + 1\nprint(json.dumps({"problems": len(problems), "files": kept.get("files"), "binary": kept.get("binary"), "errors": len(kept.get("errors", [])), "warns": kept.get("warns"), "allowed": kept.get("allowed"), "errorsByKind": kinds}))';
  const rep = JSON.parse(python(dir, ['-c', GATE, join(a.bundle, parts.zip)], { cwd: a.clone }).toString());
  const names = execFileSync('unzip', ['-Z1', join(a.bundle, parts.zip)], { maxBuffer: 1 << 24 }).toString().split('\n').filter(l => l && !l.endsWith('/'));
  const scan = { at: at(scanAt), zipSha256: parts.sha256, zipBytes: parts.bytes, parts: parts.parts.length, entries: names.length, manifests: names.filter(n => /(^|\/)BUNDLE\.json$/.test(n)).length, verifyProblems: rep.problems, files: rep.files, binary: rep.binary, errors: rep.errors, warns: rep.warns, jsDollarDigit: rep.allowed, errorsByKind: sorted(rep.errorsByKind) };
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ main, committed: git(a.space, 'show', '-s', '--format=%cI', main).toString().trim(), checked: scanAt.toISOString().slice(0, 10), cites, tests, plants, scan }, null, 1) + '\n');
}

export function build(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const bytes = role => readFileSync(join(dir, 'files', role));
  const deny = JSON.parse(bytes('denylist'));
  const terms = deny.terms;
  for (const c of source.cites) if (c.check.behind_by !== 0) throw new Error(`${c.commit.slice(0, 8)} is not part of main`);
  return {
    format: 'odin-lab-talk-leak',
    version: 1,
    vendored: {
      from: 'the leak scan of the agent space\'s private repository: the scanner, its test and planted leaks, the hashed deny-list and the talk-safety note, read at its main',
      commit: source.main,
      committed: at(source.committed),
      mainCheck: { main: source.main, how: 'GitHub compare of each cited commit against the private main head; behind by 0 means the commit is part of main', checked: source.checked, commits: source.cites.map(c => c.commit) },
      cites: source.cites.map(c => ({ commit: c.commit, what: c.what, at: at(c.at) })),
      files: ROLES.map(role => ({ role, what: ROLE_WORDS[role], sha256: sha256(bytes(role)) })),
    },
    denylist: { terms: terms.length, labels: new Set(terms.map(t => t.label)).size, errors: terms.filter(t => t.level === 'error').length, warns: terms.filter(t => t.level === 'warn').length, hashedAs: 'sha256 of a salt and the term, cut to 24 hex' },
    tests: { at: source.tests.at, on: source.tests.at.slice(0, 10), host: 'a Mac', how: 'pytest, in a fresh copy of the private repository at its main', python: source.tests.python, passed: source.tests.passed, failed: source.tests.failed, errors: source.tests.errors, plants: source.plants },
    scan: { ...source.scan, on: source.scan.at.slice(0, 10), host: 'a Mac', how: 'the build gate\'s own verify step at that main, run over the sealed build\'s zip' },
  };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

/** What the self-scan reads, in order: the rendered page, the record, the tile and the template. */
export const SELF_SCAN_FILES = [['page', 'the rendered page'], ['record', 'the record'], ['tile', 'the Labs tile'], ['template', 'the page template']];

async function selfScan(from, a) {
  const dir = resolve(from);
  // The scanner that runs must be the one the record cites: its folder taken fresh from the record's main with git
  // archive into an empty folder (nothing untracked can stand in for it), its scanner and deny-list the very bytes
  // the record holds by sha256, and Python run isolated, importing only from that folder.
  const record = JSON.parse(readFileSync(OUT_FILE));
  const snapshot = join(dir, 'self-scan-scanner');
  if (existsSync(snapshot)) throw new Error(`${snapshot} exists: self-scan from a fresh <dir>`);
  mkdirSync(snapshot, { recursive: true });
  execFileSync('tar', ['-x', '-C', snapshot], { input: execFileSync('git', ['-C', a.clone, 'archive', '--format=tar', record.vendored.commit, a.package], { maxBuffer: 1 << 30 }), maxBuffer: 1 << 30 });
  const pinned = Object.fromEntries(record.vendored.files.map(f => [f.role, f.sha256]));
  const loaded = { scanner: sha256(readFileSync(join(snapshot, a.scanner))), denylist: sha256(readFileSync(join(snapshot, a.denylist))) };
  for (const role of ['scanner', 'denylist']) if (loaded[role] !== pinned[role]) throw new Error(`--${role} at the record's main is not the ${role} the record cites`);
  const page = renderTalkLeak('site', { selfScan: false }).pages[TALK_TEMPLATE];
  const scratch = join(dir, 'self-scan');
  mkdirSync(scratch, { recursive: true });
  const files = { page: Buffer.from(page), record: readFileSync(OUT_FILE), tile: readFileSync('site/data/labs/talk-leak-tile.json'), template: readFileSync(join('site', TALK_TEMPLATE)) };
  for (const [k] of SELF_SCAN_FILES) writeFileSync(join(scratch, `${k}.txt`), files[k]);
  const SCAN = 'import sys\nsys.path.insert(0, sys.argv[1])\nfrom tools.talk import leak_scan\nsys.exit(leak_scan.main(sys.argv[2:]))';
  let report;
  try { report = python(dir, ['-c', SCAN, snapshot, ...SELF_SCAN_FILES.map(([k]) => join(scratch, `${k}.txt`)), '--json', '--show'], { cwd: snapshot }).toString(); }
  // Exit 1 is the scanner's own RED (this site's public names count as hits) only when it printed its report.
  catch (e) { report = String(e.stdout ?? ''); if (e.status !== 1 || !report.trim().startsWith('{')) throw new Error(`the self-scan exited ${e.status} with no report: ${String(e.stderr ?? '').split('\n').slice(-3).join(' ')}`); }
  const rep = JSON.parse(report);
  const isPublic = f => PUBLIC_NAMES.includes(String(f.text).toLowerCase());
  const kept = rep.findings.filter(f => !isPublic(f));
  const out = {
    format: 'odin-lab-talk-leak-self-scan', version: 1,
    scanner: record.vendored.commit,
    scannerSha256: loaded.scanner,
    denylistSha256: loaded.denylist,
    at: at(new Date()),
    files: SELF_SCAN_FILES.map(([k, what]) => ({ what, sha256: sha256(files[k]) })),
    publicNames: rep.findings.length - kept.length,
    findings: sorted(counts(kept, 'kind')),
  };
  writeFileSync(SELF_SCAN_FILE, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${SELF_SCAN_FILE}: ${kept.length} findings beyond this site's own public names (${out.publicNames} set aside)`);
}

async function main(argv) {
  const a = { file: [], cite: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['verify', 'self-scan'].includes(k)) a.flags.add(k); else if (k === 'file' || k === 'cite') a[k].push(argv[++i]); else a[k] = argv[++i];
  }
  if (a.fetch) return fetch(a.fetch, a);
  if (!a.from) throw new Error('usage: --fetch <dir> ... | --from <dir> [--verify | --self-scan --clone <clone>]');
  if (a.flags.has('self-scan')) return selfScan(a.from, a);
  const text = serialise(build(a.from));
  if (a.flags.has('verify')) {
    if (readFileSync(OUT_FILE, 'utf8') !== text) throw new Error(`${OUT_FILE} is not what --from ${a.from} gives`);
    return console.log('verified: the committed record is the same bytes');
  }
  mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
  writeFileSync(OUT_FILE, text);
  writeFileSync(PIN_FILE, `${sha256(text)}  record.json\n`);
  console.log(`wrote ${OUT_FILE} and ${PIN_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
