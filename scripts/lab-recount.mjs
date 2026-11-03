// The org runners' recount of a lab whose evidence is private (vision-plan vp-living-labs-off-the-laptop, bundle 3,
// WO-03): the lab runner fetches that evidence at the private repository's main head, names each file by its role
// (never by its path), and runs this, in its pinned image with no network, to write one record v1 (docs/lab-record.md).
//
// A recount re-derives the counts the lab's record states, from those files alone, with the lab's own vendor code (the
// function its build() uses), and compares them with the same counts read from the published record (for Lab 08: the
// two reviewer rounds, the score, the earlier set, the held-out runs' own tallies, and the run and repository counts):
//   committed  sha256 of the canonical counts the published record states (read from this repository's main)
//   now        sha256 of the canonical counts the private files give at the private main head
//   breaches   how many of the record's count groups differ (0 when every one agrees)
// The record carries hashes and counts only: no file, path, label or name. The evidence is frozen, so a recount is flat
// by construction: it is the same every day unless that evidence, or the published record, changes.
//
//   node scripts/lab-recount.mjs <lab> --files <dir> --main-record <record.json> --record --runner R --machine-class C
//        --image I --ran-at T --commit SHA --main-head SHA
//        print the record v1 (exit 0 whatever its verdict). Exit 2, and nothing on stdout, on unreadable input, a missing
//        or empty flag, a --commit that is not the --main-head the runner read (a recount reads the private repository
//        AT main), or a record the checker (scripts/lab-record.mjs) refuses.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, LAB_SHAPES, recordHash, recordProblems } from './lab-record.mjs';
import { redBuildRecordCounts } from './lab-red-build.mjs';
import { redBuildCounts } from './vendor-red-build.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Each recount lab: the vendor's counts from the role files, and the same counts as a published record states them. */
export const RECOUNTS = {
  'red-build': { counts: redBuildCounts, recordCounts: redBuildRecordCounts },
};

/** One recount as record v1. `read(role)` is the bytes of that role's file. */
export function recountRecord(lab, read, mainRecord, { runner, machineClass, image = null, ranAt, commit, mainHead = commit }) {
  const r = RECOUNTS[lab], shape = LAB_SHAPES[lab];
  if (!r || !shape) throw new Error(`${lab}: not a recount lab (${Object.keys(RECOUNTS).join(', ')})`);
  // The main check is the runner's own reading of the private main head: a recount reads the repository AT main, so a
  // commit that is not that head is refused here, never recorded as "identical".
  if (!/^[0-9a-f]{40}$/.test(commit ?? '') || mainHead !== commit) throw new Error(`--commit ${commit} is not the main head the runner read (${mainHead})`);
  const json = role => JSON.parse(read(role).toString('utf8'));
  const now = r.counts(json), stated = r.recordCounts(mainRecord);
  const groups = [...new Set([...Object.keys(now), ...Object.keys(stated)])];
  const run = {
    format: 'odin-lab-record', version: 1, lab, runner, machineClass, image,
    commit: { sha: commit, mainHead: commit, compare: 'identical', onMain: true },
    command: shape.command,
    inputs: shape.roles.map(role => ({ role, sha256: sha256(read(role)) })),
    result: {
      verdict: canonical(stated) === canonical(now) ? 'SAME' : 'DIFFERENT',
      committed: sha256(canonical(stated)),
      now: sha256(canonical(now)),
      breaches: groups.filter(g => canonical(stated[g] ?? null) !== canonical(now[g] ?? null)).length,
    },
    ranAt, replicatedOn: [], differedOn: [],
  };
  return { ...run, recordHash: recordHash(run) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [lab, ...flags] = process.argv.slice(2);
  const opt = {};
  const NEEDED = ['files', 'mainRecord', 'runner', 'machineClass', 'image', 'ranAt', 'commit', 'mainHead'];
  try {
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--record') continue;
      const key = flags[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = flags[++i];
      if (!flags[i - 1].startsWith('--') || !NEEDED.includes(key) || !value || value.startsWith('--')) throw new Error(`${flags[i - 1]}: not a flag with a value`);
      opt[key] = value;
    }
    const missing = NEEDED.filter(k => !opt[k]);
    if (!RECOUNTS[lab] || missing.length) throw new Error(`usage: node scripts/lab-recount.mjs <${Object.keys(RECOUNTS).join('|')}> --files <dir> --main-record <record.json> --record --runner R --machine-class C --image I --ran-at T --commit SHA --main-head SHA${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
    const mainRecord = JSON.parse(readFileSync(opt.mainRecord, 'utf8'));
    const record = recountRecord(lab, role => readFileSync(join(opt.files, role)), mainRecord, opt);
    const problems = recordProblems(record);
    if (problems.length) throw new Error(`the record is refused: ${problems.join('; ')}`);
    process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
    console.error(`recount ${lab}: ${record.result.verdict}, ${record.result.breaches} count group(s) differ`);
  } catch (e) {
    console.error(`lab-recount: ${e.message.split('\n')[0]}`);
    process.exit(2);
  }
}
