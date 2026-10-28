// Vendors Lab 08, "Can an agent fix a red build?", into site/data/labs/red-build/record.json (and its one-line sha256
// pin), from the agent space's private repository at its main: the CI doctor's frozen held-out set of nine red runs,
// the two blind reviewer rounds' verdicts on it, the score those verdicts gave, the reviewers' rubric, and the earlier
// set's 27 unblinded judgments. It is a RECOUNT, not a re-score: the scorer's own inputs (the blinding key and the
// doctor's raw answers) stayed on the machine that ran it, by design, and are not in the repository; what is there is
// the verdicts and the score, so the record carries both and the build checks that the verdicts add up to the score.
//
// Nothing private reaches the record: no repository name, run id, branch, workflow name, file path or reviewer's note.
// A run is named by a keyed hash of its repository and run id, and the repository by a keyed hash of its name, under
// the same private salt as the delivery record's "Beyond this site" labels (never committed; without it the vendor
// refuses). Money figures (the scorer's spend columns) are left out.
//
//   node scripts/vendor-red-build.mjs --fetch <dir> --space <git dir> --repo <owner/name> --main <sha> \
//        --cite <sha>=<what it changed> ... --file <role>=<path> ...
//        (reads the main head from GitHub and refuses a --main that is not it, reads each file there with git show and
//        refuses one whose last change is not a --cite commit, labels the runs with the salt, and asks GitHub whether
//        each --cite commit is part of main; roles: heldout, verdicts-a, verdicts-b, score, earlier, rubric; the repository,
//        its paths and <dir> are private, are given only on the command line, and are never committed)
//   node scripts/vendor-red-build.mjs --from <dir>            (writes the record and its pin)
//   node scripts/vendor-red-build.mjs --verify --from <dir>   (refuses unless the committed record is the same bytes)
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recount } from './lab-red-build.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/red-build/record.json';
export const PIN_FILE = 'site/data/labs/red-build/record.sha256';
export const ROLES = ['heldout', 'verdicts-a', 'verdicts-b', 'score', 'earlier', 'rubric'];
export const ROLE_WORDS = {
  heldout: 'the held-out set: nine red runs, frozen before the doctor saw any of them',
  'verdicts-a': 'the first blind reviewer round\'s verdicts on the held-out set',
  'verdicts-b': 'the second blind reviewer round\'s verdicts on the held-out set',
  score: 'the score the two rounds gave the held-out set',
  earlier: 'the earlier set\'s unblinded judgments, three doctor runs over nine red runs',
  rubric: 'the rubric each reviewer judged one case by',
};

// The anonymous label: 8 letters from a 16-letter alphabet with no hex letter in it (one letter per hex digit of an
// HMAC under the private salt), so a label can never read as a commit or a hash on the page.
const LETTERS = 'ghjkmnpqrstvwxyz';
export const SALT_FILE = join(homedir(), '.config/odin/delivery-projection.salt');
export function anonymous(kind, value, salt) {
  if (typeof salt !== 'string' || salt.length < 32) throw new Error('refused: a label needs the private salt');
  const hex = createHmac('sha256', salt).update(`odin-lab-red-build/${kind}/v1\0${value}`).digest('hex').slice(0, 8);
  return `${kind}-${[...hex].map(c => LETTERS[parseInt(c, 16)]).join('')}`;
}

function fetch(dir, a) {
  mkdirSync(join(dir, 'files'), { recursive: true });
  const salt = (process.env.DELIVERY_PROJECTION_SALT ?? (existsSync(SALT_FILE) ? readFileSync(SALT_FILE, 'utf8') : '')).trim();
  const git = (...args) => execFileSync('git', ['-C', a.space, ...args], { maxBuffer: 1 << 26 });
  // The main head is read from GitHub, never taken from the caller: a --main that is not it is refused.
  const main = execFileSync('gh', ['api', `repos/${a.repo}/commits/main`, '--jq', '.sha']).toString().trim();
  if (a.main && a.main !== main) throw new Error(`--main ${a.main} is not the main head of ${a.repo} (${main})`);
  const paths = {};
  for (const spec of a.file) {
    const [role, path] = spec.split('=');
    if (!ROLES.includes(role) || !path) throw new Error(`--file ${spec}: <role>=<path>, role one of ${ROLES.join(', ')}`);
    writeFileSync(join(dir, 'files', role), git('show', `${main}:${path}`));
    paths[role] = path;
  }
  const heldout = JSON.parse(readFileSync(join(dir, 'files', 'heldout'), 'utf8'));
  const repos = [...new Set(heldout.runs.map(r => r.repo))];
  const labels = { repos: Object.fromEntries(repos.map(r => [r, anonymous('repo', r, salt)])), runs: Object.fromEntries(heldout.runs.map(r => [String(r.run), anonymous('run', `${r.repo}\0${r.run}`, salt)])) };
  const cites = a.cite.map(spec => { const [sha, ...what] = spec.split('='); return { commit: git('rev-parse', `${sha}^{commit}`).toString().trim(), what: what.join('=') }; });
  if (cites.some(c => !c.what)) throw new Error('--cite <sha>=<what it changed>');
  // Each file's bytes are its bytes at main, so the commit that last changed it there must be one of the cites.
  for (const [role, path] of Object.entries(paths)) {
    const last = git('log', '-1', '--format=%H', main, '--', path).toString().trim();
    if (!cites.some(c => c.commit === last)) throw new Error(`--file ${role}: last changed at main by ${last.slice(0, 8)}, which is not cited`);
  }
  for (const c of cites) {
    c.at = git('show', '-s', '--format=%cI', c.commit).toString().trim();
    c.check = JSON.parse(execFileSync('gh', ['api', `repos/${a.repo}/compare/${c.commit}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}']).toString());
  }
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ main, committed: git('show', '-s', '--format=%cI', main).toString().trim(), checked: new Date().toISOString().slice(0, 10), cites, labels }, null, 1) + '\n');
}

const at = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tally = (values, keys) => Object.fromEntries(keys.map(k => [k, values.filter(v => v === k).length]));
export const DIAGNOSES = ['right', 'partly', 'wrong'];
export const PATCHES = ['fixes', 'partial', 'wrong', 'none-right', 'none-missed'];
export const CLASSES = ['code_bug', 'test_is_wrong', 'config_env', 'flake', 'red_by_design'];

export function build(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const bytes = role => readFileSync(join(dir, 'files', role));
  const json = role => JSON.parse(bytes(role));
  const heldout = json('heldout'), score = json('score'), earlier = json('earlier');
  const label = run => { const l = source.labels.runs[String(run)]; if (!l) throw new Error(`no label for a held-out run (re-run --fetch)`); return l; };
  const byRun = new Map(heldout.runs.map(r => [r.run, r]));
  if (score.rows.length !== heldout.runs.length || score.rows.some(r => !byRun.has(r.run))) throw new Error('the score\'s rows are not the held-out runs');
  const repoLabels = Object.values(source.labels.repos);
  const runs = [...score.rows].sort((x, y) => label(x.run).localeCompare(label(y.run))).map(r => ({
    label: label(r.run),
    repo: source.labels.repos[byRun.get(r.run).repo],
    event: byRun.get(r.run).event,
    state: r.state,
    how: r.how,
    doctorClass: r.doctor_class,
    ruleClass: r.rule_class,
    cls: r.cls,
    split: r.split,
    reproduced: r.reproduced,
    passes: r.passes,
    judgedFix: r.judged_fix,
    judgedNot: r.judged_not,
    reviewers: { diagnosis: r.reviewers.diagnosis, patch: r.reviewers.patch, causeClass: r.reviewers.cause_class },
  }));
  // Each round's own verdicts, counted from its own file (their case ids are blind, and are not kept).
  const round = role => { const v = Object.values(json(role)); return { cases: v.length, diagnosis: tally(v.map(x => x.diagnosis), DIAGNOSES), patch: tally(v.map(x => x.patch), PATCHES) }; };
  const t = score.total;
  const arms = Object.entries(earlier.by_arm).sort(([a], [b]) => a.localeCompare(b));
  const rows = earlier.rows;
  const record = {
    format: 'odin-lab-red-build',
    version: 1,
    vendored: {
      from: 'the CI doctor\'s evidence in the agent space\'s private repository: the held-out set, both reviewer rounds, their score, the rubric and the earlier set\'s judgments, read at its main',
      commit: source.main,
      committed: at(source.committed),
      mainCheck: { main: source.main, how: 'GitHub compare of each cited commit against the private main head; behind by 0 means the commit is part of main', checked: source.checked, commits: source.cites.map(c => c.commit) },
      cites: source.cites.map(c => { if (c.check.behind_by !== 0) throw new Error(`${c.commit.slice(0, 8)} is not part of main`); return { commit: c.commit, what: c.what, at: at(c.at) }; }),
      files: ROLES.map(role => ({ role, what: ROLE_WORDS[role], sha256: sha256(bytes(role)) })),
    },
    heldOut: {
      frozen: heldout.frozen,
      since: heldout.rule.since,
      until: heldout.rule.until,
      repos: repoLabels.length,
      runs,
      rounds: { a: round('verdicts-a'), b: round('verdicts-b') },
      score: {
        cases: t.cases, ruled: t.ruled, reproduced: t.reproduced, passes: t.passes, judgedFix: t.judged_fix, judgedNot: t.judged_not, missed: t.missed,
        diagnosis: Object.fromEntries(DIAGNOSES.map(k => [k, score.diagnosis[k] ?? 0])),
        patch: Object.fromEntries(PATCHES.map(k => [k, score.patch_verdicts[k] ?? 0])),
        byClass: Object.fromEntries(CLASSES.map(c => [c, score.by_class.find(b => b.cls === c)?.cases ?? 0])),
      },
    },
    earlier: {
      judgments: rows.length,
      builds: new Set(rows.map(r => r.run)).size,
      runsOfTheDoctor: arms.length,
      diagnosis: tally(rows.map(r => r.diagnosis), DIAGNOSES),
      patch: tally(rows.map(r => r.patch), PATCHES),
      byRun: arms.map(([, v], i) => ({ run: i + 1, diagnosis: Object.fromEntries(DIAGNOSES.map(k => [k, v.diagnosis[k] ?? 0])), patch: Object.fromEntries(PATCHES.map(k => [k, v.patch[k] ?? 0])) })),
    },
  };
  const problems = recount(record);
  if (problems.length) throw new Error(`the committed verdicts do not give the committed score:\n  ${problems.join('\n  ')}`);
  return record;
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

function main(argv) {
  const a = { file: [], cite: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'verify') a.flags.add(k); else if (k === 'file' || k === 'cite') a[k].push(argv[++i]); else a[k] = argv[++i];
  }
  if (a.fetch) return fetch(a.fetch, a);
  if (!a.from) throw new Error('usage: --fetch <dir> ... | --from <dir> [--verify]');
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
