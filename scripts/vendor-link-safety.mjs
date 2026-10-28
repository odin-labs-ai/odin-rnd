// Vendors Lab 07, "Can data trick a click?", into site/data/labs/link-safety/record.json (and its one-line sha256 pin),
// from two private repositories, each read at one commit on its main:
//   - the engine's web client: its link rule (the one function every click on a URL from data goes through) and its
//     link-safety test, which holds the poisoned URLs, the lookalikes, the good URLs and the opener audit's fixture
//     lines, and which this script runs;
//   - the agent space: the link-safety note, whose red/green table says what the old rule did against the new tests.
// Nothing on the page is typed by hand: the fixtures are read out of the pinned test file, each one is put through the
// pinned rule and the test's own audit here, and the counts are those lists' lengths. What we wrote is the one-line
// label each URL is shown by (a poisoned URL cannot be printed on a public page as it is: it is a link off this site,
// an address, a direction control), kept in scripts/fixtures/link-safety-labels.json and bound to its URL by sha256,
// so a changed fixture refuses the vendor until it is labelled again.
//
//   node scripts/vendor-link-safety.mjs --fetch <dir> --engine <clone> --engine-repo <owner/name> --engine-commit <sha> \
//        --engine-main <sha> --rule <path> --test <path> --space <git dir> --space-repo <owner/name> \
//        --space-commit <sha> --space-main <sha> --note <path>
//        (reads both files at the engine commit and the note at the space's main, runs the test in the clone with
//        Node's own test runner, and asks GitHub whether each commit is part of its main; the repositories, their paths
//        and <dir> are private, are given only on the command line, and are never committed)
//   node scripts/vendor-link-safety.mjs --from <dir>            (writes the record and its pin)
//   node scripts/vendor-link-safety.mjs --verify --from <dir>   (refuses unless the committed record is the same bytes)
//   node scripts/vendor-link-safety.mjs --list --from <dir>     (prints each fixture's sha256, to label a new one; local)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { LEAKS, screenHits } from './lab-kit.mjs';
import { fold } from './lab-dispatch-publish.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
// Each fetched file under <dir>/files, by role (the rule keeps its extension, so it imports as a module).
const FILE_NAMES = { rule: 'rule.mjs', test: 'test.mjs', note: 'note.md' };
export const OUT_FILE = 'site/data/labs/link-safety/record.json';
export const PIN_FILE = 'site/data/labs/link-safety/record.sha256';
export const LABELS_FILE = 'scripts/fixtures/link-safety-labels.json';
const ALLOWLIST = ['github.com'];

function fetch(dir, a) {
  mkdirSync(join(dir, 'files'), { recursive: true });
  const git = (gitDir, ...args) => execFileSync('git', ['-C', gitDir, ...args], { maxBuffer: 1 << 26 });
  const engineCommit = git(a.engine, 'rev-parse', `${a['engine-commit']}^{commit}`).toString().trim();
  if (git(a.engine, 'rev-parse', 'HEAD').toString().trim() !== engineCommit) throw new Error('--engine: the clone is not checked out at --engine-commit (the test runs from the clone)');
  for (const [role, path] of [['rule', a.rule], ['test', a.test]]) {
    const committed = git(a.engine, 'show', `${engineCommit}:${path}`);
    if (!committed.equals(readFileSync(join(a.engine, path)))) throw new Error(`--${role}: the clone's file is not the committed one`);
    writeFileSync(join(dir, 'files', FILE_NAMES[role]), committed);
  }
  const spaceCommit = git(a.space, 'rev-parse', `${a['space-commit']}^{commit}`).toString().trim();
  writeFileSync(join(dir, 'files', FILE_NAMES.note), git(a.space, 'show', `${a['space-main']}:${a.note}`));
  // The test, run as it is, with Node's own test runner and nothing installed.
  const started = new Date();
  let tap;
  try { tap = execFileSync(process.execPath, ['--test', '--test-reporter=tap', a.test], { cwd: a.engine, maxBuffer: 1 << 24 }).toString(); }
  catch (e) { tap = String(e.stdout ?? ''); }
  const count = key => Number((new RegExp(`^# ${key} (\\d+)$`, 'm').exec(tap) ?? [])[1]);
  const run = { at: started.toISOString().replace(/\.\d{3}Z$/, 'Z'), node: process.version, tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') } };
  if (Object.values(run.tests).some(n => !Number.isInteger(n))) throw new Error('the test run printed no TAP summary');
  const compare = (repo, sha, main) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/compare/${sha}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}']).toString());
  const source = {
    engine: { commit: engineCommit, date: git(a.engine, 'show', '-s', '--format=%cI', engineCommit).toString().trim(), main: a['engine-main'], check: compare(a['engine-repo'], engineCommit, a['engine-main']) },
    space: { commit: spaceCommit, date: git(a.space, 'show', '-s', '--format=%cI', spaceCommit).toString().trim(), main: a['space-main'], check: compare(a['space-repo'], spaceCommit, a['space-main']) },
    checked: started.toISOString().slice(0, 10),
    run,
  };
  writeFileSync(join(dir, 'source.json'), JSON.stringify(source, null, 1) + '\n');
}

// The test file's own fixture lists and audit, evaluated from its pinned text in a fresh context that can reach
// nothing (no require, no import, no process): only the array literals and the audit function, sliced out by name.
function slice(src, start, end = '\n];') {
  const at = src.indexOf(start);
  if (at < 0) throw new Error(`the test file has no ${JSON.stringify(start)}`);
  const stop = src.indexOf(end, at);
  if (stop < 0) throw new Error(`the test file's ${JSON.stringify(start)} is not closed`);
  return src.slice(at, stop + end.length);
}
export function fixturesOf(testSource) {
  const extra = /for \(const line of (\[[^\n]*\])\) \{\n\s*assert\.equal\(auditText\('fixture', line\)\.length, 1/.exec(testSource);
  if (!extra) throw new Error('the test file has no second list of unsafe opener lines');
  const code = [
    slice(testSource, 'const GOOD = [', '];'), slice(testSource, 'const POISON = ['), slice(testSource, 'const LOOKALIKES = [', '];'),
    slice(testSource, 'const OPENER_SINKS = ['), slice(testSource, 'function auditText(label, text) {', '\n}\n'),
    slice(testSource, 'const UNSAFE = [', '];'), `const EXTRA = ${extra[1]};`, slice(testSource, 'const SAFE = [', '];'),
    'out = { GOOD, POISON, LOOKALIKES, UNSAFE: [...UNSAFE, ...EXTRA], SAFE, auditText };',
  ].join('\n');
  const box = vm.createContext({ out: null });
  vm.runInContext(code, box, { timeout: 2000 });
  return box.out;
}

// A line of code is shown as it is when it passes the publisher's screen and the kit's LEAKS; otherwise by its label.
const clean = text => !screenHits(text).length && !LEAKS.some(([re]) => re.test(text) || re.test(fold(text)));

export async function build(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const bytes = role => readFileSync(join(dir, 'files', FILE_NAMES[role]));
  const f = fixturesOf(bytes('test').toString());
  const { safeUrl, URL_MAX } = await import(pathToFileURL(resolve(join(dir, 'files', FILE_NAMES.rule))).href + '#' + sha256(bytes('rule')));
  const labels = JSON.parse(readFileSync(LABELS_FILE, 'utf8'));
  const used = new Set();
  const label = (kind, value) => {
    const h = sha256(value);
    const l = labels[kind]?.[h];
    if (typeof l !== 'string' || !l.trim()) throw new Error(`${LABELS_FILE}: no ${kind} label for the fixture with sha256 ${h} (run --list)`);
    used.add(`${kind}:${h}`);
    return { label: l, sha256: h };
  };
  const verdict = u => (safeUrl(u) === null ? 'refused' : safeUrl(u) === u ? 'kept' : 'changed');
  const verdictListed = u => (safeUrl(u, { hosts: ALLOWLIST }) === null ? 'refused' : safeUrl(u, { hosts: ALLOWLIST }) === u ? 'kept' : 'changed');
  const urls = (kind, list) => list.map(u => ({ ...label('urls', u), length: [...u].length, open: verdict(u), allowlisted: verdictListed(u) }));
  const lines = list => list.map(line => {
    const shown = clean(line) ? line : null;
    return { ...(shown === null ? label('sinks', line) : { sha256: sha256(line) }), shown, caught: f.auditText('fixture', line).length };
  });
  const lists = { poison: urls('poison', f.POISON), lookalikes: urls('lookalikes', f.LOOKALIKES), good: urls('good', f.GOOD), unsafeLines: lines(f.UNSAFE), safeLines: lines(f.SAFE) };
  for (const kind of ['urls', 'sinks']) for (const h of Object.keys(labels[kind] ?? {})) if (!used.has(`${kind}:${h}`)) throw new Error(`${LABELS_FILE}: ${kind} label ${h} names no fixture (a stale label)`);

  // The note's red/green row for the engine's own link-safety tests: how many, and what the old code did against them.
  const note = bytes('note').toString();
  const row = /^\| `[^`]+` \((\d+)\)[^|]*\| (\d+) failed, (\d+) passed[^|]*\| (\d+) passed \|$/m.exec(note);
  if (!row) throw new Error('the note has no red/green row of the form "(N) ... | F failed, P passed ... | M passed |"');
  const [tests, failed, passed, after] = row.slice(1).map(Number);

  for (const side of ['engine', 'space']) if (source[side].check.behind_by !== 0) throw new Error(`the ${side} commit is not part of its main`);
  const at = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const how = 'GitHub compare of the cited commit against the private main head; behind by 0 means the commit is part of main';
  return {
    format: 'odin-lab-link-safety',
    version: 1,
    vendored: {
      from: 'the web client of the engine\'s private repository: its link rule and its link-safety test, read and run at one commit',
      commit: source.engine.commit,
      committed: at(source.engine.date),
      mainCheck: { main: source.engine.main, how, checked: source.checked, commits: [source.engine.commit] },
      cites: [{ commit: source.engine.commit, what: 'the web client draws a URL from data as text unless it is a link, with the test that holds the fixtures', at: at(source.engine.date) }],
      files: [
        { role: 'rule', what: 'the link rule, the one function a click on a URL from data goes through', sha256: sha256(bytes('rule')) },
        { role: 'test', what: 'the link-safety test: the poisoned, lookalike and good URLs, and the opener audit with its fixture lines', sha256: sha256(bytes('test')) },
      ],
    },
    note: {
      from: 'the link-safety note in the agent space\'s private repository, read at its main',
      mainCheck: { main: source.space.main, how, checked: source.checked, commits: [source.space.commit] },
      cites: [{ commit: source.space.commit, what: 'the note\'s red/green table: the new tests run against the old code', at: at(source.space.date) }],
      files: [{ role: 'note', what: 'the link-safety note', sha256: sha256(bytes('note')) }],
      oldCode: { tests, failed, passed },
      newCode: { tests, passed: after },
    },
    run: { at: source.run.at, on: source.run.at.slice(0, 10), host: 'a Mac', how: 'Node\'s own test runner, with nothing installed', node: source.run.node, tests: source.run.tests },
    allowlist: ALLOWLIST,
    maxLength: URL_MAX,
    ...lists,
  };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

async function main(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['verify', 'list'].includes(k)) a.flags.add(k); else a[k] = argv[++i];
  }
  if (a.fetch) return fetch(a.fetch, a);
  if (!a.from) throw new Error('usage: --fetch <dir> ... | --from <dir> [--verify | --list]');
  if (a.flags.has('list')) {
    const f = fixturesOf(readFileSync(join(a.from, 'files', FILE_NAMES.test), 'utf8'));
    for (const [kind, list] of [['urls', [...f.POISON, ...f.LOOKALIKES, ...f.GOOD]], ['sinks', [...f.UNSAFE, ...f.SAFE].filter(l => !clean(l))]]) for (const v of list) console.log(kind, sha256(v), JSON.stringify(v.length > 80 ? `${v.slice(0, 40)}...(${v.length})` : v));
    return;
  }
  const text = serialise(await build(a.from));
  if (a.flags.has('verify')) {
    if (readFileSync(OUT_FILE, 'utf8') !== text) throw new Error(`${OUT_FILE} is not what --from ${a.from} gives`);
    console.log('verified: the committed record is the same bytes');
    return;
  }
  mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
  writeFileSync(OUT_FILE, text);
  writeFileSync(PIN_FILE, `${sha256(text)}  record.json\n`);
  console.log(`wrote ${OUT_FILE} and ${PIN_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
