// Vendors Lab 13, "Does an agent company get better, measured blind?", into site/data/labs/measured-blind/record.json
// (and its one-line sha256 pin), from the agent space's private repository at its main head: the blind before / after
// evaluation of the company's on-duty agents. Three sets of nine work items, each item answered twice by the agents as
// they were before the fixes and twice after, every answer judged blind by a separate AI reviewer (useful, partly,
// wrong; stuck when the system itself marked the session stuck). What was committed there is the verdict labels,
// already unblinded, per set and item, the counts and a summary; the blind key and the raw answers stayed local by
// design (the reviewer's reasons quote private repositories), so this lab does not unblind anything: it recounts the
// committed labels, and refuses when they do not give the committed counts.
//
//   node scripts/vendor-measured-blind.mjs --clone <path> --main <sha> --checked <YYYY-MM-DD> --file <role>=<path> ... [--verify]
//
// Every file is read with `git -C <clone> show <main>:<path>`; every cited commit is checked to be part of <main> with
// `git merge-base --is-ancestor`. The clone and the paths are private, are given only on the command line, and are
// never committed or written to the record (roles: the keys of FILES below, each once). --verify re-derives the
// committed record and refuses unless it is byte for byte the same (the build cannot read the private repository;
// anyone with access can run this).
//
// What is left out: every work item's key (they name private repositories and CI run ids; each item is shown by an
// anonymous label and its kind only), the manifests (cited by sha256 only: they name the repositories and items), the
// reviewer's reasons and anything else of the raw work.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/measured-blind/record.json';
export const PIN_FILE = 'site/data/labs/measured-blind/record.sha256';
// role: what the file is, in the page's words. Each file's private path is given on the command line (--file).
export const FILES = {
  summary: 'the evaluation\'s summary: the counts per set, before and after',
  'tuning-verdicts': 'the tuning set\'s verdict labels, per item and run',
  'heldout1-verdicts': 'held-out set one\'s verdict labels, per item and run',
  'heldout2-verdicts': 'held-out set two\'s verdict labels, per item and run',
  'tuning-manifest': 'the tuning set\'s item list (not published: it names private repositories)',
  'heldout1-manifest': 'held-out set one\'s item list and the rule that picked it (not published)',
  'heldout2-manifest': 'held-out set two\'s item list and the rule that picked it (not published)',
  'write-up': 'the write-up of the measurement, and of the live run after it',
  runner: 'the evaluation\'s runner: pick, run, review sheet, unblind',
};
// The commits the record stands on, in plain words; each must be part of the private main.
export const CITES = [
  ['7c446f09', 'froze the tuning set and held-out set one, before any fix'],
  ['79b0b315', 'froze held-out set two, to judge v3'],
  ['c01782c4', 'added the verdict labels of all three sets, the counts and the summary'],
  ['4b1bf2df', 'added the write-up of the live run'],
  ['8863df79', 'last changed the write-up'],
  ['cd29253e', 'last changed the runner'],
];
// The three sets, in the summary's order: the summary's name, the verdict file's role, the page's words.
export const SETS = [
  { id: 'tuning', summary: 'tuning', verdicts: 'tuning-verdicts', manifest: 'tuning-manifest', prefix: 'T', name: 'The tuning set', after: 'v2',
    about: 'The nine items of an earlier live run. The fixes were made by studying these answers.' },
  { id: 'heldout1', summary: 'held-out 1', verdicts: 'heldout1-verdicts', manifest: 'heldout1-manifest', prefix: 'A', name: 'Held-out set one', after: 'v2',
    about: 'Nine items picked by a fixed rule and frozen before any fix. Its review then showed new failure shapes, which the next version (v3) fixed.' },
  { id: 'heldout2', summary: 'held-out 2', verdicts: 'heldout2-verdicts', manifest: 'heldout2-manifest', prefix: 'B', name: 'Held-out set two', after: 'v3',
    about: 'Nine fresh items picked by the same rule after v3, leaving out both earlier sets. It judges v3.' },
];
export const LABELS = ['useful', 'partly', 'wrong', 'stuck'];
const KIND_WORDS = { ci_run: 'a failed CI run to diagnose', workflow: 'a failed workflow run to diagnose', pr: 'a pull request to review', issue: 'an issue to triage', proposal: 'a finance proposal to draft' };
const KIND_ORDER = Object.keys(KIND_WORDS);

const utc = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const counts = labels => Object.fromEntries(LABELS.map(l => [l, labels.filter(x => x === l).length]));
const same = (a, b) => LABELS.every(l => (a[l] ?? 0) === (b[l] ?? 0)) && Object.keys(a).every(k => LABELS.includes(k));

/** The public record from the private repository at <main>. Deterministic for the same main and checked date. */
export function build({ clone, main, checked, file }) {
  const git = (...a) => execFileSync('git', ['-C', clone, ...a], { maxBuffer: 1 << 28 });
  const head = git('rev-parse', `${main}^{commit}`).toString().trim();
  const paths = Object.fromEntries(file.map(spec => { const at = spec.indexOf('='); return [spec.slice(0, at), spec.slice(at + 1)]; }));
  const roles = Object.keys(FILES);
  if (file.length !== roles.length || roles.some(r => !paths[r])) throw new Error(`--file <role>=<path>, once for each of ${roles.join(', ')}`);
  const bytes = Object.fromEntries(roles.map(role => [role, git('show', `${head}:${paths[role]}`)]));
  const json = role => JSON.parse(bytes[role].toString('utf8'));
  const problems = [];
  const cites = CITES.map(([sha, what]) => {
    const commit = git('rev-parse', `${sha}^{commit}`).toString().trim();
    try { execFileSync('git', ['-C', clone, 'merge-base', '--is-ancestor', commit, head]); } catch { problems.push(`${sha} is not part of main ${head}`); }
    return { commit, what, at: utc(git('show', '-s', '--format=%cI', commit).toString().trim()) };
  });
  const summary = json('summary');
  const sets = SETS.map(set => {
    const v = json(set.verdicts), items = json(set.manifest).items;
    const s = summary.sets.find(x => x.name === set.summary);
    if (!s) { problems.push(`the summary has no set ${set.summary}`); return null; }
    const keys = Object.keys(v.verdicts).sort();
    const kinds = Object.fromEntries(items.map(i => [i.item, i.kind]));
    if (keys.length !== 9 || items.length !== 9 || keys.some(k => !kinds[k])) problems.push(`${set.id}: not the nine items of its manifest`);
    for (const k of keys) if (!KIND_WORDS[kinds[k]]) problems.push(`${set.id}: an item of a kind this page has no words for (${kinds[k]})`);
    // An anonymous label per item: the set's letter and a number, in the order of kind, then key. The key itself
    // (it names a private repository or a CI run) is never written.
    const ordered = [...keys].sort((a, b) => KIND_ORDER.indexOf(kinds[a]) - KIND_ORDER.indexOf(kinds[b]) || (a < b ? -1 : 1));
    const rows = ordered.map((k, i) => ({ label: `${set.prefix}${i + 1}`, kind: kinds[k], before: [v.verdicts[k].before, v.verdicts[k]['before-r2']], after: [v.verdicts[k].after, v.verdicts[k]['after-r2']] }));
    for (const r of rows) for (const l of [...r.before, ...r.after]) if (!LABELS.includes(l)) problems.push(`${set.id} ${r.label}: ${l} is not a verdict label`);
    const recount = { before: counts(rows.flatMap(r => r.before)), after: counts(rows.flatMap(r => r.after)) };
    // The recount must be the verdict file's own counts and the summary's, both arms.
    for (const arm of ['before', 'after']) {
      if (!same(v.counts[arm], recount[arm])) problems.push(`${set.id} ${arm}: the labels recount to ${JSON.stringify(recount[arm])}, the verdict file says ${JSON.stringify(v.counts[arm])}`);
      if (!same(s[arm], recount[arm])) problems.push(`${set.id} ${arm}: the labels recount to ${JSON.stringify(recount[arm])}, the summary says ${JSON.stringify(s[arm])}`);
    }
    return { id: set.id, name: set.name, about: set.about, afterVersion: set.after, items: rows, counts: recount };
  });
  // The live run after the measurement, as the write-up states it (its answers are not committed): refused unless the
  // write-up says it in this exact line.
  const doc = bytes['write-up'].toString('utf8');
  const live = /^\| all (\d+) \| \*\*useful (\d+) · partly (\d+) · wrong (\d+)\*\* \|$/m.exec(doc);
  if (!live) problems.push('the write-up has no line with the live run\'s verdicts');
  if (!/a separate Claude session judged every answer/.test(doc) || !/the blinding is partial/.test(doc)) problems.push('the write-up no longer says who judged, or that the blinding is partial');
  if (!/Held-out 2's last batch\s+\(after r2\) ran on the new Ollama/.test(doc)) problems.push('the write-up no longer says which run came after the restart');
  if (problems.length) throw new Error(problems.join('\n'));
  const record = {
    format: 'odin-lab-measured-blind',
    version: 1,
    vendored: {
      from: 'the agent space\'s private repository: the blind before and after evaluation of the company\'s on-duty agents, its committed verdict labels, counts and summary, read at the main head',
      mainCheck: { main: head, how: 'git merge-base --is-ancestor of each cited commit against the private main head, in a clone of the private repository', checked, commits: cites.map(c => c.commit) },
      cites,
      files: Object.entries(FILES).map(([role, what]) => ({ role, what, sha256: sha256(bytes[role]) })),
    },
    setup: {
      model: 'qwen2.5:7b',
      sessions: 'real agent sessions on a small local model with read-only tools, the same model, budget and agent per department in both arms',
      before: 'the engine and recipes on the main branch before the fixes',
      after: 'the engine and recipes after the fixes: v2 for the tuning set and held-out set one, v3 for held-out set two',
      runs: 2,
      judge: 'a separate Claude session, which judged every answer against its own source',
      blinding: 'each item\'s four answers in a random order, with the key kept apart; the blinding is partial, because the shape of a tool\'s reply can show which arm wrote it',
      stuck: 'a session the system itself marked stuck counts as stuck, whatever the reviewer said of its partial answer',
      restart: 'the machine restarted during held-out set two, and its local model runtime updated itself; the after arm\'s second run of that set ran on the updated runtime',
    },
    sets,
    live: { answers: Number(live[1]), useful: Number(live[2]), partly: Number(live[3]), wrong: Number(live[4]) },
  };
  return `${JSON.stringify(record, null, 1)}\n`;
}

function parse(argv) {
  const args = { file: [] };
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
  if (!args.clone || !args.main || !/^\d{4}-\d{2}-\d{2}$/.test(args.checked ?? '')) { console.error('usage: --clone <path> --main <sha> --checked <YYYY-MM-DD> --file <role>=<path> ... [--verify]'); process.exit(2); }
  const bytes = build(args);
  if (args.verify) {
    if (readFileSync(OUT_FILE, 'utf8') !== bytes) { console.error(`${OUT_FILE}: does not re-derive from main ${args.main}`); process.exit(1); }
    console.log(`${OUT_FILE}: re-derives byte for byte (sha256 ${sha256(bytes)})`);
  } else {
    mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
    writeFileSync(OUT_FILE, bytes);
    writeFileSync(PIN_FILE, `${sha256(bytes)}  record.json\n`);
    console.log(`wrote ${OUT_FILE} (sha256 ${sha256(bytes)}) and ${PIN_FILE}`);
  }
}
