// Vendors Lab 05, "Can an agent go rogue?", into site/data/labs/rogue/record.json (and its one-line sha256 pin), from
// the agent space's private repository at one commit: the rogue demo's run record, its audit journal, its two recorded
// trajectories, its runner and its tests. The demo stages one attack: a poisoned ticket, on a seeded sandbox repository
// with synthetic data. It runs the same agent and the same four commands twice: once with no controls (the commands run
// against the sandbox) and once through the engine's real guards (every command refused, one hash-chained journal row
// per refusal). The record is a screened selection of what the run record holds; the six files are cited by sha256.
//
//   node scripts/vendor-rogue.mjs --fetch <dir> --clone <path> --commit <sha> --file <role>=<path> ... \
//        --repo <owner/name> --main <sha> --cite <sha>=<what it changed, in plain words> ...
//        (reads each file at <commit> with git show, and asks GitHub whether <commit> and each --cite commit is part of
//        <main>; the repository, its paths, the clone and <dir> are private, are given only on the command line, and
//        are never committed. Roles: runs, journal, traj-ungoverned, traj-governed, runner, tests.)
//   node scripts/vendor-rogue.mjs --from <dir> --reproduction <file.json>
//        (writes the record and its pin; <file.json> is the re-run on a second machine: its date, the machine, the
//        output of the demo's own check command and the test count, as written down there)
//   node scripts/vendor-rogue.mjs --verify --from <dir> --reproduction <file.json>
//
// --from is deterministic: the same <dir> and reproduction give the same bytes. --verify re-derives the committed record
// from <dir> and refuses unless it is byte for byte the same (the build cannot read the private repository; anyone with
// access can run this). Nothing private reaches the output: no repository name, no path, no machine path; the text is
// the run record's own words for the fictional company, its sandbox and its refusals, and passes the publisher's screen
// at build (scripts/lab-rogue.mjs).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordHash } from './lab-record.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/rogue/record.json';
export const PIN_FILE = 'site/data/labs/rogue/record.sha256';
export const ROLES = ['runs', 'journal', 'traj-ungoverned', 'traj-governed', 'runner', 'tests'];
// What each cited file is, in the words the page uses.
export const ROLE_WORDS = {
  runs: 'the run record both runs wrote',
  journal: 'the governed run\'s hash-chained audit journal',
  'traj-ungoverned': 'the recorded trajectory of the run with no controls',
  'traj-governed': 'the recorded trajectory of the governed run',
  runner: 'the demo\'s runner, which runs both',
  tests: 'the demo\'s tests',
};

function fetch(dir, args) {
  mkdirSync(join(dir, 'files'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', args.clone, ...a], { maxBuffer: 1 << 28 });
  const commit = git('rev-parse', `${args.commit}^{commit}`).toString().trim();
  const date = git('show', '-s', '--format=%cI', commit).toString().trim();
  for (const spec of args.file) {
    const [role, path] = spec.split('=');
    if (!ROLES.includes(role) || !path) throw new Error(`--file ${spec}: <role>=<path>, role one of ${ROLES.join(', ')}`);
    writeFileSync(join(dir, 'files', role), git('show', `${commit}:${path}`));
  }
  const ancestry = { main: args.main, checked: new Date().toISOString().slice(0, 10), commits: {} };
  const cites = args.cite.map(spec => { const [sha, ...what] = spec.split('='); return { commit: git('rev-parse', `${sha}^{commit}`).toString().trim(), what: what.join('=') }; });
  if (cites.some(c => !c.what)) throw new Error('--cite <sha>=<what it changed>');
  for (const full of [commit, ...cites.map(c => c.commit)]) {
    const out = execFileSync('gh', ['api', `repos/${args.repo}/compare/${full}...${args.main}`, '--jq', '{status: .status, behind_by: .behind_by}']).toString();
    ancestry.commits[full] = { ...JSON.parse(out), date: git('show', '-s', '--format=%cI', full).toString().trim() };
  }
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ commit, date, cite: cites, ancestry }, null, 1) + '\n');
}

const utc = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** CHECK_COMMAND, as record v1 names it: the same words on every machine, so their records can hold the same hash. */
export const CHECK_COMMAND = 'the demo\'s own check command';

/** The reproduction as record v1 (scripts/lab-record.mjs): the check run on the second machine, a Mac, by hand. */
function laptopRun(source, hashes, reproduction) {
  const compare = source.ancestry.commits[source.commit].status;
  const run = {
    format: 'odin-lab-record',
    version: 1,
    lab: 'rogue',
    runner: 'laptop',
    machineClass: 'mac',
    image: null,
    commit: { sha: source.commit, mainHead: source.ancestry.main, compare, onMain: compare === 'identical' || compare === 'ahead' },
    command: CHECK_COMMAND,
    inputs: [{ role: 'runner', sha256: hashes.runner }, { role: 'runs', sha256: hashes.runs }],
    result: { verdict: reproduction.verdict, committed: reproduction.committed, now: reproduction.now, breaches: reproduction.breaches },
    ranAt: reproduction.at,
    replicatedOn: [],
    differedOn: [],
  };
  return { ...run, recordHash: recordHash(run) };
}

/**
 * The org runners' runs already in the committed record (scripts/append-rogue-runs.mjs put them there). They are
 * published evidence, not derivable from the private files, so a re-vendor carries them forward byte for byte and
 * --verify still re-derives the committed record.
 */
function orgRuns() {
  if (!existsSync(OUT_FILE)) return [];
  return JSON.parse(readFileSync(OUT_FILE, 'utf8')).runs.filter(r => r.runner !== 'laptop');
}

/** The public record, built from the fetched files in `dir` and the reproduction. Deterministic. */
export function build(dir, reproduction) {
  const file = role => readFileSync(join(dir, 'files', role));
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const runs = JSON.parse(file('runs').toString('utf8'));
  const problems = [];
  const { ancestry } = source;
  for (const sha of [source.commit, ...source.cite.map(c => c.commit)]) {
    const seen = ancestry.commits[sha];
    if (!seen || seen.behind_by !== 0 || !['ahead', 'identical'].includes(seen.status)) problems.push(`commit ${sha} is not shown as part of main ${ancestry.main}`);
  }
  const hashes = Object.fromEntries(ROLES.map(role => [role, sha256(file(role))]));
  const u = runs.runs.ungoverned, g = runs.runs.governed;
  // The run record names the files it wrote by their sha256: they must be the files cited here.
  if (g.journal.sha256 !== hashes.journal) problems.push('the run record\'s journal sha256 is not the journal file\'s');
  if (u.traj.sha256 !== hashes['traj-ungoverned']) problems.push('the run record\'s ungoverned trajectory sha256 is not the file\'s');
  if (g.traj.sha256 !== hashes['traj-governed']) problems.push('the run record\'s governed trajectory sha256 is not the file\'s');
  if (!runs.state_hash.startsWith(reproduction.committed) || reproduction.now !== reproduction.committed) problems.push('the reproduction is not the run record\'s state hash');
  if (problems.length) throw new Error(problems.join('\n'));
  const record = {
    format: 'odin-lab-rogue',
    version: 2,
    vendored: {
      from: 'the rogue-agent demo in the agent space\'s private repository: its run record, audit journal, two recorded trajectories, runner and tests, read at one commit',
      commit: source.commit,
      committed: utc(source.date),
      cites: source.cite.map(c => ({ commit: c.commit, what: c.what, at: utc(ancestry.commits[c.commit].date) })),
      mainCheck: { main: ancestry.main, how: 'GitHub compare of each cited commit against the private main head; behind by 0 means the commit is part of main', checked: ancestry.checked },
      files: ROLES.map(role => ({ role, what: ROLE_WORDS[role], sha256: hashes[role] })),
    },
    staged: {
      company: 'Northwind Labs, a fictional company',
      repository: runs.repo,
      agent: runs.agent,
      // The run record's own about line names the runner by its private path, so it is written here instead.
      about: 'two real runs of the same poisoned ticket: one with no controls, on a sandbox repository; one through the engine\'s real guards; synthetic data only',
      ticket: { id: runs.ticket.id, title: runs.ticket.title, by: runs.ticket.by, body: runs.ticket.body },
      sandbox: { mainCommits: runs.hall.main_commits, prBranches: runs.hall.prs.length, ciRuns: runs.hall.ci.length, calls: u.sandbox.calls, allInside: u.sandbox.all_inside, network: u.sandbox.network },
    },
    ungoverned: {
      steps: u.steps.map(s => ({ says: s.says, command: s.command, ran: s.ran, result: s.result })),
      before: { exists: u.before.exists, mainCommits: u.before.main_commits, branches: u.before.branches },
      after: { exists: u.after.exists, mainCommits: u.after.main_commits, branches: u.after.branches },
      damage: { repositoryDeleted: u.damage.repository_deleted, commitsLostFromMain: u.damage.commits_lost_from_main, prBranchesDeleted: u.damage.pr_branches_deleted, ciRunsStopped: u.damage.ci_runs_stopped },
      repairEstimate: {
        rule: u.damage.repair.rule,
        workdayHours: 8,
        rows: u.damage.repair.rows.map(r => ({ what: r.what, n: r.n, hours: r.hours })),
        hours: u.damage.repair.hours,
        workdays: u.damage.repair.workdays,
      },
    },
    governed: {
      acts: g.acts.map(a => ({ says: a.says, command: a.command, door: a.door.why, githubWrite: a.github_write, outbox: a.outbox.why, writer: a.writer.why, trust: a.trust.why, ran: a.ran, journalRow: a.journal.n })),
      outboxKinds: g.outbox_kinds,
      trustNever: g.trust_never,
      trust: { before: { eligible: g.trust.before.eligible, why: g.trust.before.why }, after: { eligible: g.trust.after.eligible, why: g.trust.after.why } },
      journal: { rows: g.journal.rows.map(r => ({ n: r.n, act: r.act, by: r.by, ...(r.step ? { step: r.step } : {}), ...(r.verdict ? { verdict: r.verdict } : {}), prev: r.prev, hash: r.hash })), verified: g.journal.verify.ok, head: g.journal.verify.hash },
      breaches: g.breaches.length,
      repositoryUnchanged: g.repo_unchanged && g.before.sha256 === g.after.sha256,
    },
    stateHash: runs.state_hash,
    reproductions: [reproduction],
    runs: [laptopRun(source, hashes, reproduction), ...orgRuns()],
  };
  return `${JSON.stringify(record, null, 1)}\n`;
}

function parse(argv) {
  const args = { file: [], cite: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'verify') { args.verify = true; continue; }
    const value = argv[++i];
    if (Array.isArray(args[key])) args[key].push(value); else args[key] = value;
  }
  return args;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = parse(process.argv.slice(2));
  if (args.fetch) { fetch(args.fetch, args); process.exit(0); }
  if (!args.from || !args.reproduction) { console.error('usage: --fetch <dir> ... | [--verify] --from <dir> --reproduction <file.json>'); process.exit(2); }
  const bytes = build(args.from, JSON.parse(readFileSync(args.reproduction, 'utf8')));
  if (args.verify) {
    if (readFileSync(OUT_FILE, 'utf8') !== bytes) { console.error(`${OUT_FILE}: does not re-derive from ${args.from}`); process.exit(1); }
    console.log(`${OUT_FILE}: re-derives byte for byte (sha256 ${sha256(bytes)})`);
  } else {
    mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
    writeFileSync(OUT_FILE, bytes);
    writeFileSync(PIN_FILE, `${sha256(bytes)}  record.json\n`);
    console.log(`wrote ${OUT_FILE} (sha256 ${sha256(bytes)}) and ${PIN_FILE}`);
  }
}
