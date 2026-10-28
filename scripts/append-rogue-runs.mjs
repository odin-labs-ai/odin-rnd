// Appends org-runner records (record v1, docs/lab-record.md) to Lab 05's record, runs[], and re-pins it: one day, or a
// backlog of days (a record PR that waited lands every day it missed at once, each day kept separate). The lab
// runner (private, on the org's machines) writes one record per machine class per day; its record PR (vision-plan
// vp-living-labs-off-the-laptop, WO-04 + bundle 3) carries them here and runs this. Records are grouped by their UTC
// day (ranAt's date) and appended day by day, oldest first. Fail-closed: a day is refused, every reason listed, unless
//   - it is one or more records, each record v1 (scripts/lab-record.mjs) for lab "rogue" from an org runner (never a
//     laptop), all of one commit, one per machine class. One record is a single-machine day (the other leg did not
//     run or wrote no record); a record whose check printed DIFFERENT, or two legs that disagree, is a
//     different-hash day. Both are published as what they are, never dropped and never forced to agree;
//   - each names exactly its same-day siblings: in replicatedOn the ones with its recordHash, in differedOn the ones
//     without (never a run of another day, never itself);
//   - the record holds no org run of that day yet (one per lab per day), and no machine class already holds a run at
//     the same ranAt (a run's anchor never moves);
//   - the whole runs[] then passes the reader's own check (scripts/lab-runs.mjs runsProblems).
// The Mac re-run stays runs[0]; scripts/vendor-rogue.mjs carries every later run forward, so --verify still re-derives.
//
// The same rules hold for every results lab whose record carries runs (LABS): Lab 05 (rogue) and Lab 06 (review).
//
//   node scripts/append-rogue-runs.mjs [--root site] [--lab rogue|review] <record.json> ...
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberSpellingProblems } from './lab-record.mjs';
import { runsProblems } from './lab-runs.mjs';
import { ROGUE_PIN, ROGUE_RECORD } from './lab-rogue.mjs';
import { REVIEW_PIN, REVIEW_RECORD } from './lab-review.mjs';

/** Each lab whose record takes org-runner days: its record and pin. */
export const LABS = { rogue: { record: ROGUE_RECORD, pin: ROGUE_PIN }, review: { record: REVIEW_RECORD, pin: REVIEW_PIN } };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Every reason `day` may not be appended to `runs` (empty when it may). */
export function dayProblems(runs, day, { now = new Date(), lab = 'rogue' } = {}) {
  const problems = [];
  if (!Array.isArray(day) || day.length < 1) return ['a day is one or more records, one per org machine class'];
  const classes = day.map(r => r?.machineClass);
  if (new Set(classes).size !== day.length) problems.push('two records of one machine class in one day');
  if (new Set(day.map(r => r?.commit?.sha)).size !== 1) problems.push('the records are not all of one commit');
  const dates = new Set(day.map(r => String(r?.ranAt).slice(0, 10)));
  if (dates.size !== 1) problems.push('the records did not all run on one UTC day');
  else if (runs.some(p => p.runner !== 'laptop' && String(p.ranAt).slice(0, 10) === [...dates][0])) problems.push(`the record already holds org runs of ${[...dates][0]}; one day of a lab is published once`);
  day.forEach((r, i) => {
    if (r?.lab !== lab) problems.push(`day[${i}]: lab ${JSON.stringify(r?.lab)} is not ${lab}`);
    if (r?.runner === 'laptop') problems.push(`day[${i}]: a laptop run is not an org runner's`);
    const siblings = day.filter(s => s !== r);
    const want = list => siblings.filter(s => (s.recordHash === r.recordHash) === (list === 'replicatedOn')).map(s => `${s.machineClass} ${s.recordHash}`).sort();
    for (const list of ['replicatedOn', 'differedOn']) {
      const got = (Array.isArray(r?.[list]) ? r[list] : []).map(x => `${x.machineClass} ${x.recordHash}`).sort();
      if (got.join('\n') !== want(list).join('\n')) problems.push(`day[${i}]/${list}: does not name exactly its same-day siblings`);
    }
    if (runs.some(p => p.machineClass === r?.machineClass && p.ranAt === r?.ranAt)) problems.push(`day[${i}]: ${r?.machineClass} already holds a run at ${r?.ranAt}`);
  });
  if (!problems.length) problems.push(...runsProblems([...runs, ...day], { lab, where: LABS[lab].record, now }));
  return problems;
}

/** The records grouped by UTC day (ranAt's date), oldest day first. */
export function byDay(records) {
  const days = new Map();
  for (const r of records) { const d = String(r?.ranAt).slice(0, 10); days.set(d, [...(days.get(d) ?? []), r]); }
  return [...days.keys()].sort().map(d => days.get(d));
}

/** The record with every day of `records` appended, day by day (oldest first), or a thrown error with every reason. */
export function appendDays(record, records, options) {
  const prior = Array.isArray(record.runs) ? record.runs : [];
  record = { ...record, runs: prior };
  const problems = [];
  let out = record;
  for (const day of byDay(records)) {
    const found = dayProblems(out.runs, day, options);
    if (found.length) { problems.push(...found.map(p => `${String(day[0]?.ranAt).slice(0, 10)}: ${p}`)); continue; }
    out = { ...out, runs: [...out.runs, ...day] };
  }
  if (!records.length) problems.push('no record to append');
  if (problems.length) throw new Error(`the days are refused:\n  ${problems.join('\n  ')}`);
  return out;
}

/** The record with `day` appended, or a thrown error listing every reason. */
export function appendDay(record, day, options) {
  const problems = dayProblems(record.runs, day, options);
  if (problems.length) throw new Error(`the day is refused:\n  ${problems.join('\n  ')}`);
  return { ...record, runs: [...record.runs, ...day] };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = 'site', lab = 'rogue';
  while (args[0] === '--root' || args[0] === '--lab') { const [flag, value] = args.splice(0, 2); if (flag === '--root') root = value; else lab = value; }
  if (!LABS[lab] || !args.length) { console.error(`usage: node scripts/append-rogue-runs.mjs [--root site] [--lab ${Object.keys(LABS).join('|')}] <record.json> ...`); process.exit(2); }
  const { record: file, pin } = LABS[lab];
  try {
    const texts = args.map(f => readFileSync(f, 'utf8'));
    const spelled = texts.flatMap((t, i) => numberSpellingProblems(t, args[i]));
    if (spelled.length) throw new Error(spelled.join('\n'));
    const record = appendDays(JSON.parse(readFileSync(join(root, file), 'utf8')), texts.map(t => JSON.parse(t)), { lab });
    const bytes = `${JSON.stringify(record, null, 1)}\n`;
    writeFileSync(join(root, file), bytes);
    writeFileSync(join(root, pin), `${sha256(bytes)}  record.json\n`);
    console.log(`appended ${args.length} run(s) on ${byDay(texts.map(t => JSON.parse(t))).length} day(s) to ${file} (sha256 ${sha256(bytes)}); runs: ${record.runs.length}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
