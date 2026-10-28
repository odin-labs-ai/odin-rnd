// Appends one day's org-runner records (record v1, docs/lab-record.md) to Lab 05's record, runs[], and re-pins it.
// The lab runner (private, on the org's machines) writes one record per machine class; its record PR (vision-plan
// vp-living-labs-off-the-laptop, WO-04) carries them here and runs this. Fail-closed: the day is refused, every reason
// listed, unless
//   - it is two or more records, each record v1 (scripts/lab-record.mjs) for lab "rogue" from an org runner (never a
//     laptop), all of one commit, all run on one UTC day (ranAt's date), one per machine class;
//   - each names exactly its same-day siblings: in replicatedOn the ones with its recordHash, in differedOn the ones
//     without (never a run of another day, never itself);
//   - no machine class already holds a run at the same ranAt (a run's anchor never moves);
//   - the whole runs[] then passes the reader's own check (scripts/lab-runs.mjs runsProblems).
// The Mac re-run stays runs[0]; scripts/vendor-rogue.mjs carries every later run forward, so --verify still re-derives.
//
//   node scripts/append-rogue-runs.mjs [--root site] <record.json> ...
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberSpellingProblems } from './lab-record.mjs';
import { runsProblems } from './lab-runs.mjs';
import { ROGUE_PIN, ROGUE_RECORD } from './lab-rogue.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Every reason `day` may not be appended to `runs` (empty when it may). */
export function dayProblems(runs, day, { now = new Date() } = {}) {
  const problems = [];
  if (!Array.isArray(day) || day.length < 2) return ['a day is two or more records, one per org machine class'];
  const classes = day.map(r => r?.machineClass);
  if (new Set(classes).size !== day.length) problems.push('two records of one machine class in one day');
  if (new Set(day.map(r => r?.commit?.sha)).size !== 1) problems.push('the records are not all of one commit');
  if (new Set(day.map(r => String(r?.ranAt).slice(0, 10))).size !== 1) problems.push('the records did not all run on one UTC day');
  day.forEach((r, i) => {
    if (r?.lab !== 'rogue') problems.push(`day[${i}]: lab ${JSON.stringify(r?.lab)} is not rogue`);
    if (r?.runner === 'laptop') problems.push(`day[${i}]: a laptop run is not an org runner's`);
    const siblings = day.filter(s => s !== r);
    const want = list => siblings.filter(s => (s.recordHash === r.recordHash) === (list === 'replicatedOn')).map(s => `${s.machineClass} ${s.recordHash}`).sort();
    for (const list of ['replicatedOn', 'differedOn']) {
      const got = (Array.isArray(r?.[list]) ? r[list] : []).map(x => `${x.machineClass} ${x.recordHash}`).sort();
      if (got.join('\n') !== want(list).join('\n')) problems.push(`day[${i}]/${list}: does not name exactly its same-day siblings`);
    }
    if (runs.some(p => p.machineClass === r?.machineClass && p.ranAt === r?.ranAt)) problems.push(`day[${i}]: ${r?.machineClass} already holds a run at ${r?.ranAt}`);
  });
  if (!problems.length) problems.push(...runsProblems([...runs, ...day], { lab: 'rogue', where: ROGUE_RECORD, now }));
  return problems;
}

/** The record with `day` appended, or a thrown error listing every reason. */
export function appendDay(record, day, options) {
  const problems = dayProblems(record.runs, day, options);
  if (problems.length) throw new Error(`the day is refused:\n  ${problems.join('\n  ')}`);
  return { ...record, runs: [...record.runs, ...day] };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args[0] === '--root' ? args.splice(0, 2)[1] : 'site';
  if (!args.length) { console.error('usage: node scripts/append-rogue-runs.mjs [--root site] <record.json> ...'); process.exit(2); }
  try {
    const texts = args.map(f => readFileSync(f, 'utf8'));
    const spelled = texts.flatMap((t, i) => numberSpellingProblems(t, args[i]));
    if (spelled.length) throw new Error(spelled.join('\n'));
    const record = appendDay(JSON.parse(readFileSync(join(root, ROGUE_RECORD), 'utf8')), texts.map(t => JSON.parse(t)));
    const bytes = `${JSON.stringify(record, null, 1)}\n`;
    writeFileSync(join(root, ROGUE_RECORD), bytes);
    writeFileSync(join(root, ROGUE_PIN), `${sha256(bytes)}  record.json\n`);
    console.log(`appended ${args.length} run(s) to ${ROGUE_RECORD} (sha256 ${sha256(bytes)}); runs: ${record.runs.length}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
