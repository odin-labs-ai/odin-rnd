// Vendors the one line Lab 04's row carries on the Labs page about its frozen question set: the set of questions its
// agent-query experiment will ask both stores, and their gold answers, frozen in the agent space's private repository,
// into site/data/labs/company-store-questions/record.json (and its one-line sha256 pin). The record holds counts and
// sha256s only: no question, no answer. It also says the lab's pre-registration is not yet frozen, and the vendor
// refuses the moment the pre-registration no longer says so (the line would then have to change).
//
//   node scripts/vendor-question-set.mjs --clone <path> --main <sha> --checked <YYYY-MM-DD> --file <role>=<path> ... [--verify]
//
// Every file is read with `git -C <clone> show <main>:<path>`; the cited commit is checked to be part of <main> with
// `git merge-base --is-ancestor`. The clone and the paths are private, are given only on the command line, and are
// never committed or written to the record (roles: questions, gold, prereg).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/company-store-questions/record.json';
export const PIN_FILE = 'site/data/labs/company-store-questions/record.sha256';
export const FILES = {
  questions: 'the frozen question set',
  gold: 'the gold answers, frozen with it',
  prereg: 'the lab\'s pre-registration, still a draft (not published)',
};
export const CITES = [['e31fdc52', 'merged the frozen question set and its gold answers into main']];

export function build({ clone, main, checked, file }) {
  const git = (...a) => execFileSync('git', ['-C', clone, ...a], { maxBuffer: 1 << 28 });
  const head = git('rev-parse', `${main}^{commit}`).toString().trim();
  const paths = Object.fromEntries(file.map(spec => { const at = spec.indexOf('='); return [spec.slice(0, at), spec.slice(at + 1)]; }));
  const roles = Object.keys(FILES);
  if (file.length !== roles.length || roles.some(r => !paths[r])) throw new Error(`--file <role>=<path>, once for each of ${roles.join(', ')}`);
  const bytes = Object.fromEntries(roles.map(role => [role, git('show', `${head}:${paths[role]}`)]));
  const problems = [];
  const cites = CITES.map(([sha, what]) => {
    const commit = git('rev-parse', `${sha}^{commit}`).toString().trim();
    try { execFileSync('git', ['-C', clone, 'merge-base', '--is-ancestor', commit, head]); } catch { problems.push(`${sha} is not part of main ${head}`); }
    // The files must be the cited commit's own: unchanged on main since.
    for (const role of ['questions', 'gold']) if (sha256(git('show', `${commit}:${paths[role]}`)) !== sha256(bytes[role])) problems.push(`${role}: changed on main since ${sha}`);
    return { commit, what, at: new Date(git('show', '-s', '--format=%cI', commit).toString().trim()).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  });
  const q = JSON.parse(bytes.questions.toString('utf8')), g = JSON.parse(bytes.gold.toString('utf8'));
  const perCategory = {};
  for (const item of q.questions) perCategory[item.category] = (perCategory[item.category] ?? 0) + 1;
  if (q.questions.length !== q.n || JSON.stringify(Object.fromEntries(Object.entries(perCategory).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(q.per_category).sort()))) problems.push('the question set does not count to its own n and per-category counts');
  if (g.questions_sha256 !== q.sha256 || g.n !== q.n || Object.keys(g.gold).length !== q.n || q.questions.some(item => !(item.id in g.gold))) problems.push('the gold answers are not the question set\'s, one per question');
  const prereg = bytes.prereg.toString('utf8');
  if (!/\(pre-registration, draft v1\)/.test(prereg) || !/\*\*Not frozen:\*\*/.test(prereg)) problems.push('the pre-registration no longer says it is a draft, not frozen: this line would have to change');
  if (problems.length) throw new Error(problems.join('\n'));
  const record = {
    format: 'odin-lab-question-set',
    version: 1,
    vendored: {
      from: 'the agent space\'s private repository: the frozen question set of Lab 04\'s agent-query experiment, its gold answers and the lab\'s draft pre-registration, read at the main head',
      mainCheck: { main: head, how: 'git merge-base --is-ancestor of the cited commit against the private main head, in a clone of the private repository', checked, commits: cites.map(c => c.commit) },
      cites,
      files: roles.map(role => ({ role, what: FILES[role], sha256: sha256(bytes[role]) })),
    },
    lab: 'Lab 04',
    questions: q.n,
    categories: Object.keys(perCategory).length,
    perCategory: Object.fromEntries(Object.entries(perCategory).sort()),
    preregistration: 'not yet frozen',
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
