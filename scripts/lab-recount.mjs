// The org runners' recount of a lab whose evidence is private (vision-plan vp-living-labs-off-the-laptop, bundle 3,
// WO-03): the lab runner fetches that evidence at the private repository's main head, names each file by its role
// (never by its path), and runs this, in its pinned image with no network, to write one record v1 (docs/lab-record.md).
//
// A recount re-derives the rounds, score and earlier counts the lab's record states, from those files alone, with the
// lab's own vendor code (the same function its build() uses), and compares them with the counts the published record
// states. It reproduces the score group's stated totals; it does not re-derive them from the verdicts files (that
// cross-check, that the verdicts add up to the score, runs only at vendor time, via build()'s own recount()). It does
// not cover heldOut.runs or heldOut.repos, which are published evidence, not recounted here.
//   committed  sha256 of the canonical counts the published record states (read from this repository's main)
//   now        sha256 of the canonical counts the private files give at the private main head
//   breaches   how many of the record's count groups differ (0 when every one agrees)
// The record carries hashes and counts only: no file, path, label or name. The evidence is frozen, so a recount is flat
// by construction: it is the same every day unless that evidence, or the published record, changes.
//
//   node scripts/lab-recount.mjs <lab> --files <dir> --main-record <record.json> --record --runner R --machine-class C
//        --image I --ran-at T --commit SHA --main-head SHA       print the record v1 (exit 0 whatever its verdict;
//        2 on unreadable input, or on a record that fails its own schema/consistency check)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, LAB_SHAPES, recordHash, recordProblems } from './lab-record.mjs';
import { redBuildCounts, redBuildRecordCounts } from './vendor-red-build.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Each recount lab: the vendor's counts from the role files, and the same counts as a published record states them. */
export const RECOUNTS = {
  'red-build': { counts: redBuildCounts, recordCounts: redBuildRecordCounts },
};

/**
 * One recount as record v1. `read(role)` is the bytes of that role's file. `commit` is the commit of THIS repository
 * that ran the recount (not the private evidence repository's head — that identity carries no weight here, only its
 * files' bytes do, via `inputs`); `mainHead` is this repository's main head, supplied independently by the caller
 * (the runner's own checkout knows both) so `compare`/`onMain` are measured, never asserted by construction.
 */
export function recountRecord(lab, read, mainRecord, { runner, machineClass, image = null, ranAt, commit, mainHead }) {
  const r = RECOUNTS[lab], shape = LAB_SHAPES[lab];
  if (!r || !shape) throw new Error(`${lab}: not a recount lab (${Object.keys(RECOUNTS).join(', ')})`);
  const json = role => JSON.parse(read(role).toString('utf8'));
  const now = r.counts(json), stated = r.recordCounts(mainRecord);
  const groups = [...new Set([...Object.keys(now), ...Object.keys(stated)])];
  const compare = commit === mainHead ? 'identical' : 'diverged';
  const run = {
    format: 'odin-lab-record', version: 1, lab, runner, machineClass, image,
    commit: { sha: commit, mainHead, compare, onMain: compare === 'identical' },
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
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--record') continue;
    opt[flags[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = flags[++i];
  }
  let mainRecord;
  try {
    if (!RECOUNTS[lab] || !opt.files || !opt.mainRecord) throw new Error(`usage: node scripts/lab-recount.mjs <${Object.keys(RECOUNTS).join('|')}> --files <dir> --main-record <record.json> --record ...`);
    mainRecord = JSON.parse(readFileSync(opt.mainRecord, 'utf8'));
    const record = recountRecord(lab, role => readFileSync(join(opt.files, role)), mainRecord, opt);
    // Fail closed on the record itself, not just on the usage flags checked above: a missing --runner,
    // --machine-class, --ran-at, --commit or --main-head leaves `undefined` in the record, which JSON.stringify
    // silently drops, printing a record that fails the schema with exit 0. recordProblems() is the one check that
    // reads the whole record, so run it before anything is printed.
    const problems = recordProblems(record);
    if (problems.length) { console.error(problems.join('\n')); process.exit(2); }
    process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
    console.error(`recount ${lab}: ${record.result.verdict}, ${record.result.breaches} count group(s) differ`);
  } catch (e) {
    console.error(`lab-recount: ${e.message.split('\n')[0]}`);
    process.exit(2);
  }
}
