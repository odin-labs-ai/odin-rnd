// Vendors Lab 07, "Can data trick a click?", into site/data/labs/link-safety/record.json (and its one-line sha256 pin),
// from two private repositories, each read at one commit on its main:
//   - the engine's web client: its link rule (the one function every click on a URL from data goes through) and its
//     link-safety test, which holds the poisoned URLs, the lookalikes, the good URLs and the opener audit's fixture
//     lines, and which this script runs;
//   - the agent space: the link-safety note, whose red/green table says what the old rule did against the new tests.
// Nothing on the page is typed by hand: the fixtures are parsed out of the pinned test file as literals (no code of it
// is evaluated here), each URL is put through the pinned rule, the opener lines carry the verdict the test asserts for
// them (the run must pass that test), and the counts are those lists' lengths. What we wrote is the one-line
// label each URL is shown by (a poisoned URL cannot be printed on a public page as it is: it is a link off this site,
// an address, a direction control), kept in scripts/fixtures/link-safety-labels.json and bound to its URL by sha256,
// so a changed fixture refuses the vendor until it is labelled again.
//
//   node scripts/vendor-link-safety.mjs --fetch <dir> --engine <clone> --engine-repo <owner/name> --engine-commit <sha> \
//        --engine-main <sha> --rule <path> --test <path> --space <git dir> --space-repo <owner/name> \
//        --space-commit <sha> [--space-main <sha>] --note <path> --snapshot <path> ...  ([--engine-main <sha>] too)
//        (reads both files at the engine commit and the note at the space's main, runs the test with Node's own test
//        runner in a clean snapshot of the commit (git archive of the client and the engine sources the test reads),
//        reads each main head from GitHub and refuses a --*-main that is not it, refuses a --space-commit that is not
//        the last commit to change the note, and asks GitHub whether each commit is part of its main; the
//        repositories, their paths and <dir> are private, are given only on the command line, and are never committed)
//   node scripts/vendor-link-safety.mjs --from <dir>            (writes the record and its pin)
//   node scripts/vendor-link-safety.mjs --verify --from <dir>   (refuses unless the committed record is the same bytes)
//   node scripts/vendor-link-safety.mjs --list --from <dir>     (prints each fixture's sha256, to label a new one; local)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const gh = (...args) => execFileSync('gh', ['api', ...args]).toString().trim();
  const engineCommit = git(a.engine, 'rev-parse', `${a['engine-commit']}^{commit}`).toString().trim();
  // Each main head is read from GitHub, never taken from the caller: a --*-main that is not it is refused.
  const mainOf = (repo, given) => { const head = gh(`repos/${repo}/commits/main`, '--jq', '.sha'); if (given && given !== head) throw new Error(`--main for ${repo}: ${given} is not its main head (${head})`); return head; };
  const engineMain = mainOf(a['engine-repo'], a['engine-main']), spaceMain = mainOf(a['space-repo'], a['space-main']);
  for (const [role, path] of [['rule', a.rule], ['test', a.test]]) writeFileSync(join(dir, 'files', FILE_NAMES[role]), git(a.engine, 'show', `${engineCommit}:${path}`));
  // The note is read at the space's main, and the commit cited for it must be the last one to change it there.
  const spaceCommit = git(a.space, 'rev-parse', `${a['space-commit']}^{commit}`).toString().trim();
  const lastNote = git(a.space, 'log', '-1', '--format=%H', spaceMain, '--', a.note).toString().trim();
  if (lastNote !== spaceCommit) throw new Error(`--space-commit ${spaceCommit.slice(0, 8)} is not the last commit to change the note at main (${lastNote.slice(0, 8)})`);
  writeFileSync(join(dir, 'files', FILE_NAMES.note), git(a.space, 'show', `${spaceMain}:${a.note}`));
  // The test, run as it is, with Node's own test runner and nothing installed, in a clean snapshot of the commit.
  const snapshot = join(dir, 'snapshot');
  rmSync(snapshot, { recursive: true, force: true });
  mkdirSync(snapshot, { recursive: true });
  // --snapshot: each folder of the commit the test reads (the web client, and the engine sources it compares the rule to).
  if (!a.snapshot.length) throw new Error('--snapshot <path>: at least one folder the test reads');
  execFileSync('tar', ['-x', '-C', snapshot], { input: git(a.engine, 'archive', '--format=tar', engineCommit, ...a.snapshot), maxBuffer: 1 << 28 });
  const started = new Date();
  let tap;
  try { tap = execFileSync(process.execPath, ['--test', '--test-reporter=tap', a.test], { cwd: snapshot, maxBuffer: 1 << 24 }).toString(); }
  catch (e) { tap = String(e.stdout ?? ''); }
  const count = key => Number((new RegExp(`^# ${key} (\\d+)$`, 'm').exec(tap) ?? [])[1]);
  const passed = [...tap.matchAll(/^ok \d+ - (.+)$/gm)].map(m => m[1].trim());
  const run = { at: started.toISOString().replace(/\.\d{3}Z$/, 'Z'), node: process.version, tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') }, passedNames: passed };
  if (Object.values(run.tests).some(n => !Number.isInteger(n))) throw new Error('the test run printed no TAP summary');
  const compare = (repo, sha, main) => JSON.parse(gh(`repos/${repo}/compare/${sha}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}'));
  const source = {
    engine: { commit: engineCommit, date: git(a.engine, 'show', '-s', '--format=%cI', engineCommit).toString().trim(), main: engineMain, check: compare(a['engine-repo'], engineCommit, engineMain) },
    space: { commit: spaceCommit, date: git(a.space, 'show', '-s', '--format=%cI', spaceCommit).toString().trim(), main: spaceMain, check: compare(a['space-repo'], spaceCommit, spaceMain) },
    checked: started.toISOString().slice(0, 10),
    run,
  };
  writeFileSync(join(dir, 'source.json'), JSON.stringify(source, null, 1) + '\n');
}

// The test file's fixture lists, parsed as literals: no code of the test is evaluated here. A list may hold only
// string literals ('…' or "…", with the escapes \\ \' \" \n \t \r \uXXXX \u{…}), joined by `+`, and a string's
// `.repeat(<integer>)`; anything else refuses.
export function parseList(text) {
  let i = 0;
  const ws = () => { for (;;) { while (/\s/.test(text[i] ?? '')) i++; if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; } else break; } };
  const fail = what => { throw new Error(`a fixture list holds ${what} at ${JSON.stringify(text.slice(i, i + 30))}: only string literals are read`); };
  const string = () => {
    const q = text[i];
    if (q !== "'" && q !== '"') fail('something that is not a string');
    let out = '';
    for (i++; text[i] !== q; i++) {
      if (i >= text.length || text[i] === '\n') fail('an unclosed string');
      if (text[i] !== '\\') { out += text[i]; continue; }
      const c = text[++i];
      if (c === 'u' && text[i + 1] === '{') { const end = text.indexOf('}', i); out += String.fromCodePoint(parseInt(text.slice(i + 2, end), 16)); i = end; }
      else if (c === 'u') { out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)); i += 4; }
      else if (c in { n: 1, t: 1, r: 1 }) out += { n: '\n', t: '\t', r: '\r' }[c];
      else if ('\\\'"'.includes(c)) out += c;
      else fail(`an escape \\${c} this parser does not read`);
    }
    i++;
    ws();
    const rep = /^\.repeat\((\d+)\)/.exec(text.slice(i));
    if (rep) { i += rep[0].length; return out.repeat(Number(rep[1])); }
    return out;
  };
  const value = () => { let v = string(); ws(); while (text[i] === '+') { i++; ws(); v += string(); ws(); } return v; };
  ws();
  if (text[i] !== '[') fail('no list');
  i++;
  const out = [];
  for (;;) {
    ws();
    if (text[i] === ']') { i++; break; }
    out.push(value());
    ws();
    if (text[i] === ',') { i++; continue; }
    if (text[i] === ']') { i++; break; }
    fail('a token between entries');
  }
  ws();
  if (i < text.length && text.slice(i).trim() !== ';') fail('text after the list');
  return out;
}

function listAfter(src, start) {
  const at = src.indexOf(start);
  if (at < 0) throw new Error(`the test file has no ${JSON.stringify(start)}`);
  const from = at + start.length - 1;
  // The list ends at the first "]" outside a string, which the parser finds; slice generously and let it refuse.
  let depth = 0, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') q = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return parseList(src.slice(from, i + 1));
  }
  throw new Error(`the test file's ${JSON.stringify(start)} is not closed`);
}

export function fixturesOf(testSource) {
  const extra = /for \(const line of (\[[^\n]*\])\) \{\n\s*assert\.equal\(auditText\('fixture', line\)\.length, 1/.exec(testSource);
  if (!extra) throw new Error('the test file has no second list of unsafe opener lines');
  return {
    GOOD: listAfter(testSource, 'const GOOD = ['), POISON: listAfter(testSource, 'const POISON = ['), LOOKALIKES: listAfter(testSource, 'const LOOKALIKES = ['),
    UNSAFE: [...listAfter(testSource, 'const UNSAFE = ['), ...parseList(extra[1])], SAFE: listAfter(testSource, 'const SAFE = ['),
  };
}

// The tests whose assertions the opener lines' verdicts are: each unsafe line caught once, each safe line not at all.
export const AUDIT_TEST = 'the audit catches every unsafe opener shape (fixtures)';
export const RULE_TEST = 'the rule refuses every poisoned URL, with or without the github.com allowlist';

// A line of code is shown as it is when it passes the publisher's screen and the kit's LEAKS; otherwise by its label.
const clean = text => !screenHits(text).length && !LEAKS.some(([re]) => re.test(text) || re.test(fold(text)));

export async function build(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const bytes = role => readFileSync(join(dir, 'files', FILE_NAMES[role]));
  const f = fixturesOf(bytes('test').toString());
  const { safeUrl, hostOf, URL_MAX } = await import(pathToFileURL(resolve(join(dir, 'files', FILE_NAMES.rule))).href + '#' + sha256(bytes('rule')));
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
  for (const name of [AUDIT_TEST, RULE_TEST]) if (!source.run.passedNames.includes(name)) throw new Error(`the run did not pass "${name}"; its assertions are the verdicts this record shows`);
  const urls = (kind, list) => list.map(u => ({ ...label('urls', u), length: [...u].length, host: safeUrl(u) && ALLOWLIST.includes(hostOf(u)) ? 'allowlisted' : safeUrl(u) ? 'other' : 'none', open: verdict(u), allowlisted: verdictListed(u) }));
  // The test asserts each unsafe line is caught exactly once and each safe line not at all, and the run passed it.
  const lines = (list, caught) => list.map(line => {
    const shown = clean(line) ? line : null;
    return { ...(shown === null ? label('sinks', line) : { sha256: sha256(line) }), shown, caught };
  });
  const lists = { poison: urls('poison', f.POISON), lookalikes: urls('lookalikes', f.LOOKALIKES), good: urls('good', f.GOOD), unsafeLines: lines(f.UNSAFE, 1), safeLines: lines(f.SAFE, 0) };
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
    run: { at: source.run.at, on: source.run.at.slice(0, 10), host: 'a Mac', how: 'Node\'s own test runner, with nothing installed, in a clean snapshot of the commit', node: source.run.node, tests: source.run.tests },
    allowlist: ALLOWLIST,
    maxLength: URL_MAX,
    ...lists,
  };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

async function main(argv) {
  const a = { flags: new Set(), snapshot: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['verify', 'list'].includes(k)) a.flags.add(k); else if (k === 'snapshot') a.snapshot.push(argv[++i]); else a[k] = argv[++i];
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
