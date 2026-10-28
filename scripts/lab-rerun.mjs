// "Re-run this": check-it-yourself kits for the labs whose inputs are public (vision-plan
// vp-living-labs-off-the-laptop, bundle 4, WO-03). A kit is the exact commands a reader runs from the root of a clone of
// this repository, and what each one prints. One list, here, feeds both the lab page's "Re-run this" block and the CI
// job that runs it (.github/workflows/lab-kits.yml: `node scripts/lab-rerun.mjs review`), so the page cannot show a
// command CI does not run, or an output CI does not see.
//
// Only a lab whose inputs are all in this repository gets a kit. Today that is Lab 06 (review): EXP 017's frozen
// analysis and EXP 006's frozen scorer, each run in its check mode, recompute their committed results records, and the
// expected hashes are the ones Lab 06's record cites (site/data/labs/review/record.json, sources[].sha256), read from
// the record, never typed here. EXP 012 has no kit: its committed record holds counts only.
//
// What a step may be, fixed here and checked by kitProblems(): a program from a closed list (node, sha256sum), and
// arguments that are flags or regular files of this repository under experiments/ (no symlink, no directory, resolved
// inside experiments/), each plain (letters, digits, ".", "_", "-", "/"), so the command needs no quoting and is run as
// an argument list, never through a shell; a step passes only when it exits 0 and prints exactly its line and one line
// end. The lab kit's page screen (scripts/lab-kit.mjs pageLeaks) refuses any path shown on a page; maskKit() lets
// through exactly the block renderKit() rendered, once, and nothing else on the page, before the screen runs; the
// site's leak gate still reads every byte of the built page.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escape } from './lab-kit.mjs';
import { LAB_SHAPES, recordHash } from './lab-record.mjs';
// A cycle with lab-review.mjs (which renders the block): each uses the other only inside functions.
import { readReview } from './lab-review.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/odin-labs-ai/odin-rnd';
export const PROGRAMS = ['node', 'sha256sum'];

// Each step: the source it re-derives (a role in the lab record's sources), the command as an argument list, what it
// prints (from that source), and what it shows, in plain words.
export const KITS = {
  review: [
    {
      role: 'frontier',
      argv: ['node', 'experiments/review-frontier/analyse.mjs', '--check'],
      prints: () => 'EXP 017: results.json matches the frozen analysis',
      shows: "EXP 017's frozen analysis recomputes its results record from the committed runs and finds it unchanged.",
    },
    {
      role: 'frontier',
      argv: ['sha256sum', 'experiments/review-frontier/results.json'],
      prints: s => `${s.sha256}  experiments/review-frontier/results.json`,
      shows: 'That record is the one this page cites: the same sha256.',
    },
    {
      role: 'nina',
      argv: ['node', 'experiments/nina-changes/write-results6.mjs', '--check'],
      prints: s => `PASS experiments/nina-changes/results/results.json recomputes byte for byte (sha256 ${s.sha256})`,
      shows: "EXP 006's frozen scorer recomputes its results record byte for byte, and prints the sha256 this page cites.",
    },
  ],
};

// A regular file (not a symlink, not a directory) whose real path is inside the repository's experiments/, which is
// itself a real directory of the repository (not a symlink to somewhere else).
function regularFileUnder(root, file) {
  try {
    if (!lstatSync(join(root, file)).isFile()) return false;
    const experiments = realpathSync(join(root, 'experiments'));
    if (lstatSync(join(root, 'experiments')).isSymbolicLink() || experiments !== join(realpathSync(root), 'experiments')) return false;
    const inside = relative(experiments, realpathSync(join(root, file)));
    return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
  } catch { return false; }
}

/** Every reason a lab's kit may not be shown or run (empty when it may). */
export function kitProblems(lab, record, { root = REPO_ROOT } = {}) {
  const steps = KITS[lab];
  if (!steps) return [`${lab}: no kit (only a lab whose inputs are all in this repository has one)`];
  const problems = [];
  const roles = new Set((record?.sources ?? []).map(s => s.role));
  for (const [i, step] of steps.entries()) {
    const at = `${lab} kit step ${i + 1}`;
    if (!roles.has(step.role)) problems.push(`${at}: the record has no source ${step.role}`);
    const [program, ...args] = step.argv;
    if (!PROGRAMS.includes(program)) problems.push(`${at}: ${program} is not one of ${PROGRAMS.join(', ')}`);
    for (const a of args) {
      if (!/^[A-Za-z0-9._/-]+$/.test(a)) problems.push(`${at}: ${JSON.stringify(a)} is not a plain argument`);
      else if (a.startsWith('-')) { if (!/^--?[a-z][a-z0-9-]*$/.test(a)) problems.push(`${at}: ${a} is not a plain flag`); }
      else if (!a.startsWith('experiments/') || a.includes('..') || !regularFileUnder(root, a)) problems.push(`${at}: ${a} is not a regular file of this repository under experiments/`);
    }
  }
  return problems;
}

/** The steps as shown and run: command text, argument list, expected output, words. Throws on any kit problem. */
export function kitSteps(lab, record, options) {
  const problems = kitProblems(lab, record, options);
  if (problems.length) throw new Error(`the ${lab} kit is refused:\n  ${problems.join('\n  ')}`);
  return KITS[lab].map(step => {
    const source = record.sources.find(s => s.role === step.role);
    return { argv: step.argv, command: step.argv.join(' '), prints: step.prints(source), shows: step.shows };
  });
}

/** The "Re-run this" block: clone, then each command and the line it prints. */
export function renderKit(lab, record, options) {
  const steps = kitSteps(lab, record, options);
  return kitBlock(steps, s => escape(s.command), s => escape(s.prints));
}

// The block, with how a command and its line are written (as shown, or masked for the page screen).
const kitBlock = (steps, command, prints) => {
  const items = steps.map(s => `<li><pre class="lab-rerun-command"><code>${command(s)}</code></pre><p>prints</p><pre class="lab-rerun-output"><samp>${prints(s)}</samp></pre><p>${escape(s.shows)}</p></li>`).join('');
  return `<div class="lab-rerun-kit"><p>Clone <a href="${REPO}">this site's repository</a>, use Node 22, and from its root run these commands. Each one needs nothing installed and nothing from the network, and prints exactly the line under it. On macOS, <code>shasum -a 256</code> in place of <code>sha256sum</code> prints the same line.</p><ol class="lab-rerun">${items}</ol><p class="lab-source">These are the commands and the lines a CI job of this repository runs and checks, word for word, on every change and every day (the lab kits workflow). The expected hashes are the ones this page's record cites; when an experiment record changes, its new hash comes from the record, not from this text.</p></div>`;
};

/**
 * The page with the kit's block, exactly as renderKit() rendered it and exactly once, written with plain words in place
 * of its commands and lines, for the page screen. Nothing outside that block is touched: the same command anywhere else
 * on the page is screened as it is. A page without the block, or with it twice, is refused.
 */
export function maskKit(html, lab, record, options) {
  const steps = kitSteps(lab, record, options);
  const block = kitBlock(steps, s => escape(s.command), s => escape(s.prints));
  const at = html.indexOf(block);
  if (at < 0) throw new Error(`maskKit: the ${lab} kit's block is not on the page as rendered`);
  if (html.indexOf(block, at + 1) >= 0) throw new Error(`maskKit: the ${lab} kit's block is on the page twice`);
  return html.slice(0, at) + kitBlock(steps, () => 'a re-run command', () => 'its output') + html.slice(at + block.length);
}

/** Run a lab's kit, every command as an argument list (no shell), from `cwd`. Returns one result per step. */
export function runKit(lab, record, { cwd = REPO_ROOT, spawn = spawnSync, ...options } = {}) {
  return kitSteps(lab, record, { root: cwd, ...options }).map(s => {
    const r = spawn(s.argv[0] === 'node' ? process.execPath : s.argv[0], s.argv.slice(1), { cwd, encoding: 'utf8' });
    // Exactly the line and one line end: no extra space, blank line or second line.
    const out = String(r.stdout ?? '');
    const got = out.replace(/\n$/, '');
    const ok = r.status === 0 && out === `${s.prints}\n`;
    return { command: s.command, prints: s.prints, got, status: r.status, ok, stderr: String(r.stderr ?? '') };
  });
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

/**
 * One run of a lab's kit as record v1 (docs/lab-record.md), for the org runners (vision-plan bundle 3, WO-03). The kit
 * decides the result: `committed` is the sha256 of every line it must print, `now` the sha256 of every line it did
 * print (in step order, one line end each; a step that failed carries its exit status), so SAME means every step exited 0
 * and printed exactly its line; `breaches` counts the
 * steps that did not exit 0 or printed anything else. `inputs` are the sha256 of the source files the kit re-derives,
 * as read at the run. Where and when (runner, class, image, time, commit) come from the caller.
 */
export function kitRecord(lab, results, { root = REPO_ROOT, record, runner, machineClass, image = null, ranAt, commit }) {
  const shape = LAB_SHAPES[lab];
  if (!shape) throw new Error(`${lab}: no record shape for this lab`);
  const lines = rs => sha256(rs.map(r => `${r}\n`).join(''));
  // A step that failed counts as printing something else even if its text matched: its exit status joins its line.
  const committed = lines(results.map(r => r.prints)), now = lines(results.map(r => (r.ok ? r.got : `${r.got} [exit ${r.status}]`)));
  const inputs = shape.roles.map(role => ({ role, sha256: sha256(readFileSync(join(root, record.sources.find(s => s.role === role).file))) }));
  const run = {
    format: 'odin-lab-record', version: 1, lab, runner, machineClass, image,
    commit: { sha: commit, mainHead: commit, compare: 'identical', onMain: true },
    command: shape.command, inputs,
    result: { verdict: committed === now ? 'SAME' : 'DIFFERENT', committed, now, breaches: results.filter(r => !r.ok).length },
    ranAt, replicatedOn: [], differedOn: [],
  };
  return { ...run, recordHash: recordHash(run) };
}

// node scripts/lab-rerun.mjs <lab> --record --runner R --machine-class C --image I --ran-at T --commit SHA: run the kit and
// print its record v1 (the steps' own output goes to stderr); exit 0 when a record was printed, whatever its verdict.
// node scripts/lab-rerun.mjs <lab>: run its kit, print each command and what it printed, exit 1 unless every step
// exited 0 and printed exactly the expected line.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = process.argv[2];
  const readers = { review: () => readReview('site') };
  if (!readers[lab]) { console.error(`usage: node scripts/lab-rerun.mjs <${Object.keys(readers).join('|')}>`); process.exit(2); }
  const record = readers[lab]();
  const results = runKit(lab, record);
  const flags = process.argv.slice(3);
  if (flags[0] === '--record') {
    const opt = {};
    for (let i = 1; i < flags.length; i += 2) opt[flags[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = flags[i + 1];
    for (const r of results) console.error(`$ ${r.command}: ${r.ok ? 'OK' : `FAIL exit ${r.status}`}`);
    process.stdout.write(`${JSON.stringify(kitRecord(lab, results, { record, ...opt }), null, 1)}\n`);
    process.exit(0);
  }
  for (const r of results) {
    console.log(`$ ${r.command}\n${r.got}\n${r.ok ? 'OK  printed the expected line' : `FAIL exit ${r.status}; expected:\n${r.prints}${r.stderr ? `\n${r.stderr.trimEnd()}` : ''}`}`);
  }
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? `${bad} of ${results.length} steps of the ${lab} kit failed` : `the ${lab} kit: ${results.length} of ${results.length} steps printed the expected line`);
  process.exit(bad ? 1 : 0);
}
