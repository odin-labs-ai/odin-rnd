// Vendors Lab 14, "Can an AI jury judge how a room looks?", into site/data/labs/ai-jury/record.json (and its one-line
// sha256 pin), from the agent space's private repository at its main head: the design jury's two committed rounds.
// Each round, a jury of AI models scored pictures of the rooms of a 3D presentation space on one rubric, blind (each
// picture re-encoded under a random name, in a shuffled order), with a calibration pair mixed in: a known-good
// reference picture and the same picture deliberately ruined. A model that does not score the good one at least
// min_margin above the bad one is out of that round's jury.
//
// DATA ONLY. The record holds numbers: per round, each juror's calibration and, for the eleven rooms that were not
// reworked between the rounds, each juror's overall score and the jury's median. It holds no picture (every committed
// picture is a room of a client-themed talk), no juror's reasons, no rubric wording (one criterion names the client's
// trade), no room name, no spend, no seed, no blind key. Rounds that exist only on a lane are not read at all.
//
//   node scripts/vendor-ai-jury.mjs --clone <path> --main <sha> --checked <YYYY-MM-DD> --file <role>=<path> ... [--verify]
//
// Every file is read with `git -C <clone> show <main>:<path>`; every cited commit is checked to be part of <main> with
// `git merge-base --is-ancestor`. The clone and the paths are private, are given only on the command line, and are
// never committed or written to the record (roles: the keys of FILES below, each once). --verify re-derives the
// committed record and refuses unless it is byte for byte the same.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/ai-jury/record.json';
export const PIN_FILE = 'site/data/labs/ai-jury/record.sha256';
export const FILES = {
  'round-1': 'round one\'s scores: every juror, every picture, the calibration',
  'round-2': 'round two\'s scores, the same',
  'round-1-report': 'round one\'s own report, which says what each juror saw',
  'round-2-report': 'round two\'s own report, the same',
  table: 'the comparison table of both rounds',
  report: 'the jury\'s report of both rounds',
  rubric: 'the jury\'s one rubric, with the calibration rule',
  calibration: 'the calibration pair, pinned by sha256',
  aggregate: 'the code that turns scores into medians and the calibration verdict',
};
export const CITES = [
  ['f2b53edf', 'last changed the rubric and the aggregation'],
  ['9a79a6bc', 'last changed the calibration pair'],
  ['60dfae05', 'committed both rounds\' scores'],
  ['201fd650', 'committed the report and the comparison table'],
];
// The rubric's criteria, in neutral words (the rubric's own name for the last one names the client's trade).
export const CRITERIA = {
  composition: 'composition',
  typography: 'typography',
  lighting: 'lighting',
  materials: 'materials and texture',
  style_consistency: 'style consistency',
  projector_readability: 'readability on a projector from 10 m',
  boardroom_credibility: 'whether a board would take it seriously as a product presentation',
};
// The models by display name; a model not named here refuses the vendor.
export const MODELS = {
  'anthropic/claude-haiku-5.5': 'Claude Haiku 5.5 (Anthropic)',
  'openai/gpt-6-luna': 'GPT-6 Luna (OpenAI)',
  'google/gemini-3.8-flash': 'Gemini 3.8 Flash (Google)',
  'qwen/qwen3.8-flash': 'Qwen3.8 Flash (Qwen)',
  'gemma3:4b': 'Gemma 3 4B, run locally',
};
// The rooms shown: the ones not reworked between the rounds, by their shot ids; on the page, room 1 to room 11.
const ROOM = /^talk-s(\d{2})$/;

const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => Math.round(x * 1000) / 1000;

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
    return { commit, what, at: new Date(git('show', '-s', '--format=%cI', commit).toString().trim()).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  });
  const rubric = json('rubric');
  if (rubric.criteria.map(c => c.id).join() !== Object.keys(CRITERIA).join()) problems.push('the rubric\'s criteria are not the seven this page names');
  const table = json('table');
  // The rework touched only the new rooms: none of the rooms shown here is among them.
  const reworked = table.compare.flatMap(c => c.rooms.map(r => r.shot));
  if (reworked.some(s => ROOM.test(s))) problems.push('a room shown here is among the reworked ones');
  const rounds = ['round-1', 'round-2'].map((role, i) => {
    const d = json(role);
    if (d.format !== 'art-review-round' || d.version !== 1) problems.push(`${role}: not an art-review-round v1`);
    const cal = d.calibration;
    const reviewers = Object.entries(d.reviewers).map(([id, r]) => {
      if (!MODELS[r.model]) problems.push(`${role}: a model this page has no name for (${r.model})`);
      const c = cal.reviewers[id];
      // A reviewer with no score for a calibration picture: every one of its replies on it was unreadable.
      const unscored = ['good', 'bad'].filter(k => c[k] === null);
      for (const k of unscored) if (!(d.errors?.[id]?.[`calibration-${k}`] ?? []).length) problems.push(`${role} ${id}: no ${k} score and no recorded error`);
      return { id, model: MODELS[r.model], kind: r.kind, good: c.good, bad: c.bad, margin: c.margin, passes: c.passes, unreadable: unscored.map(k => ({ picture: k, replies: d.errors[id][`calibration-${k}`].length })) };
    });
    const rooms = Object.keys(d.shots).filter(s => ROOM.test(s)).sort().map((s, k) => {
      const o = d.shots[s].overall;
      return { label: `room ${k + 1}`, median: o.median, n: o.n, by: Object.fromEntries(Object.entries(o.by).sort()) };
    });
    const m = r3(median(rooms.map(r => r.median)));
    const said = table.compare[i].existing_median;
    if (m !== said) problems.push(`${role}: the rooms' median is ${m}, the table says ${said}`);
    if (d.by_surface?.['talk estate']?.median !== m) problems.push(`${role}: the rooms' median is not the round's own`);
    // A room scored by fewer jurors than the jury: each missing juror's replies on it were unreadable.
    for (const s of Object.keys(d.shots).filter(x => ROOM.test(x))) for (const id of cal.jury.filter(j => !(j in d.shots[s].overall.by))) if (!(d.errors?.[id]?.[s] ?? []).length) problems.push(`${role} ${s}: ${id} has no score and no recorded error`);
    // Each round's own report says what a juror saw; the page says it in its words, bound here.
    const rep = bytes[`${role}-report`].toString('utf8').replace(/\s+/g, ' ');
    if (!/no build, lane, version, round or shot name; the pictures re-encoded under random names, in a different order per reviewer, with the calibration pair mixed in/.test(rep)) problems.push(`${role}: its report no longer says what each juror saw`);
    return { round: i + 1, on: d.t.slice(0, 10), valid: cal.valid, jury: cal.jury, juryGood: cal.jury_good, juryBad: cal.jury_bad, juryMargin: cal.jury_margin, reviewers, rooms, median: m };
  });
  const report = bytes.report.toString('utf8');
  if (!/Rounds: 2; valid: \[True, True\]/.test(report)) problems.push('the report no longer says two valid rounds');
  if (!/the talk's eleven existing rooms/.test(report)) problems.push('the report no longer names the eleven existing rooms');
  // Photographed again: each round has its own capture.
  const [c1, c2] = ['round-1', 'round-2'].map(role => json(role).capture?.t);
  if (!c1 || !c2 || c1 === c2) problems.push('the two rounds do not have captures of their own');
  // The pair is ours: a render we made and the same picture ruined, in the calibration file's own words.
  const pair = json('calibration');
  if (!/a known-good reference render and the same picture deliberately ruined/.test(pair._doc ?? '') || !/reference_scene\.py/.test(pair.made_by?.good ?? '') || !/degrade/.test(pair.made_by?.bad ?? '')) problems.push('the calibration file no longer says the pair is a render we made and the same picture ruined');
  // The score, as the aggregation computes it: a juror's overall is the mean of its criterion scores, a picture's the
  // median of the jurors' overalls.
  const agg = bytes.aggregate.toString('utf8');
  if (!/return round\(sum\(vals\) \/ len\(vals\), 3\)/.test(agg) || !/rec\["overall"\] = \{"median": median\(ov\)/.test(agg)) problems.push('the aggregation no longer computes the overall as the page says');
  // The lane-only rounds: no file of them on the private main.
  const juryDir = paths['round-1'].split('/').slice(0, -2).join('/');
  for (const name of ['round-2b', 'round-2c']) { try { execFileSync('git', ['-C', clone, 'cat-file', '-e', `${head}:${juryDir}/${name}`], { stdio: 'ignore' }); problems.push(`${name} is on the private main; it would have to be shown`); } catch { /* absent, as the page says */ } }
  if (problems.length) throw new Error(problems.join('\n'));
  const record = {
    format: 'odin-lab-ai-jury',
    version: 1,
    vendored: {
      from: 'the agent space\'s private repository: the design jury\'s two committed rounds, their scores and calibration, the rubric\'s rule and the aggregation code, read at the main head',
      mainCheck: { main: head, how: 'git merge-base --is-ancestor of each cited commit against the private main head, in a clone of the private repository', checked, commits: cites.map(c => c.commit) },
      cites,
      files: roles.map(role => ({ role, what: FILES[role], sha256: sha256(bytes[role]) })),
    },
    rubric: {
      criteria: Object.values(CRITERIA),
      scale: `${rubric.scale.min} to ${rubric.scale.max}`,
      overall: 'a juror\'s overall score for a picture is the mean of its seven criterion scores; a picture\'s score is the median of the jurors\' overall scores',
      minMargin: rubric.calibration.min_margin,
      minJury: rubric.calibration.min_jury,
    },
    rooms: 'eleven rooms of a 3D presentation space, each staging one slide of a talk; none was reworked between the rounds, but each was photographed again for round two',
    blinding: 'each juror saw one picture at a time with the rubric alone: no build, version, round or room name; the pictures were re-encoded under random names, in a different order for each juror, with the calibration pair mixed in',
    calibrationPair: 'a known-good reference picture we rendered, and the same picture deliberately ruined',
    rounds,
    excluded: [
      { round: '2b', why: 'run on a lane only, never on the private main' },
      { round: '2c', why: 'run on a lane only, never on the private main' },
    ],
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
