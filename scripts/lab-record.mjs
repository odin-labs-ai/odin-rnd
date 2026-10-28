// Record v1: one run of a lab's check command on one machine class (scripts/schemas/odin-lab-record.schema.json).
// The lab runner (private, off the laptop) writes one per leg; a lab's record file embeds them. This checker is
// fail-closed: a record that misses the schema, or whose fields do not say what its hashes and commits say, is refused
// with every reason listed.
//
//   recordHash  sha256 (hex) of the canonical JSON of { format, version, lab, commit: commit.sha, command, inputs,
//               result }: keys sorted at every depth, no whitespace, UTF-8. What ran, on what, and what it printed;
//               never where or when (runner, machineClass, image, ranAt and the main check are left out), so two
//               machines that computed the same thing from the same commit hold the same recordHash.
//   replicatedOn  other machine classes whose run held this recordHash; differedOn: ones whose run did not. A
//               mismatch is recorded as such, never folded into replicatedOn.
//   commit      the commit that ran, the main head it was checked against, and `compare`: the status of a GitHub
//               compare with the commit as base and the main head as head (identical, ahead = main is ahead of it,
//               behind, diverged). This checker cannot read the private repository, so it checks that the
//               record's claims agree with each other, not the ancestry itself: onMain is true only when the
//               record's main check says the commit is part of main (identical or ahead), and identical only when
//               sha is mainHead. The org runners read oac AT main, so their records must say identical; only a
//               laptop record (checked by hand against GitHub's compare, as Lab 05's vendor step does) may say ahead.
//
//   node scripts/lab-record.mjs <record.json> ...   exit 1 and every reason when any record is refused
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const RECORD_SCHEMA = join(here, 'schemas/odin-lab-record.schema.json');
const schema = JSON.parse(readFileSync(RECORD_SCHEMA, 'utf8'));
/** The one machine class each runner has (a class label, never a runner or host name). */
/** The largest breach count a record may hold, so its JSON reads the same in every language. */
export const MAX_BREACHES = 1000000;
export const CLASS_OF = { 'github-hosted': 'ubuntu-latest', 'org-hosted': 'org-ci-heavy', laptop: 'mac' };

/** JSON with keys sorted at every depth and no whitespace (the same bytes as Python's sort_keys, compact separators). */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The recordHash a record must hold. */
export function recordHash(record) {
  const { format, version, lab, commit, command, inputs, result } = record;
  return createHash('sha256').update(canonical({ format, version, lab, commit: commit.sha, command, inputs, result }), 'utf8').digest('hex');
}

function instant(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s ? date : null;
}

/** Every way `record` is not an honest record v1, as "<where>#<json pointer>: <reason>" lines; [] when it is one. */
export function recordProblems(record, where = 'record', now = new Date()) {
  const shape = validate(schema, record).map(p => `${where}#${p}`);
  if (shape.length) return shape;
  const problems = [];
  const at = (pointer, reason) => problems.push(`${where}#${pointer}: ${reason}`);
  const want = recordHash(record);
  if (record.recordHash !== want) at('/recordHash', `not the hash of what the record says ran (${want})`);

  const c = record.commit;
  if ((c.sha === c.mainHead) !== (c.compare === 'identical')) at('/commit/compare', 'does not agree with the commit and the main head');
  if (c.onMain !== (c.compare === 'identical' || c.compare === 'ahead')) at('/commit/onMain', `a commit whose main check says "${c.compare}" is ${c.onMain ? '' : 'not '}marked as on main`);
  if (record.runner !== 'laptop' && c.compare !== 'identical') at('/commit/compare', `the ${record.runner} runner reads main, so its commit must be the main head`);

  const r = record.result;
  // Integers past 2^53 serialise differently in JavaScript (1e+21) and Python, so recordHash would differ.
  if (!Number.isSafeInteger(r.breaches) || r.breaches > MAX_BREACHES) at('/result/breaches', `more than ${MAX_BREACHES}`);
  if (r.committed.length !== r.now.length) at('/result', 'committed and now are not the same length, so they cannot be compared');
  if (r.verdict !== (r.committed === r.now ? 'SAME' : 'DIFFERENT')) at('/result/verdict', 'not what its two hashes say');

  const roles = record.inputs.map(i => i.role);
  if (roles.join('\n') !== [...new Set(roles)].sort().join('\n')) at('/inputs', 'roles are not unique and in sorted order');

  const ran = instant(record.ranAt);
  if (!ran) at('/ranAt', 'not a real date and time');
  else if (ran > now) at('/ranAt', 'after the check');

  if (CLASS_OF[record.runner] !== record.machineClass) at('/machineClass', `not the machine class of the ${record.runner} runner`);

  const seen = new Set([record.machineClass]);
  for (const [list, same] of [['replicatedOn', true], ['differedOn', false]]) {
    record[list].forEach((x, i) => {
      if (seen.has(x.machineClass)) at(`/${list}/${i}/machineClass`, 'this record or another replica already names this machine class');
      seen.add(x.machineClass);
      if ((x.recordHash === record.recordHash) !== same) at(`/${list}/${i}/recordHash`, same ? 'a replica with a different recordHash is not a replication' : 'a run with the same recordHash did not differ');
    });
  }
  return problems;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/lab-record.mjs <record.json> ...'); process.exit(2); }
  const problems = files.flatMap(file => {
    try { return recordProblems(JSON.parse(readFileSync(file, 'utf8')), file); } catch (e) { return [`${file}: ${e.message}`]; }
  });
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`${files.length} record(s): record v1, valid`);
}
