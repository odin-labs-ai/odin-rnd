// EXP 006: scrub the local account name out of the committed counted run record after the run (results refute N1).
// The runner's write-time scrub (scrub6.mjs, pinned and unchanged) collapses home paths, but an `ls -la` output keeps the
// file owner as a bare word: c050 run 3 printed the local account name in its owner column. odin-rnd is public, so the
// committed record is re-scrubbed here, on EXP 005's pattern (experiments/jev-gate/rescrub-records.mjs), and a side
// record discloses the original sha256 next to the new one, the rule, and every field that changed. The name is read
// at run time and is never written to any file.
//
//   node experiments/nina-changes/rescrub-records6.mjs --write   once: scrub results/reviewer.json, write scrubbed-records.json
//   node experiments/nina-changes/rescrub-records6.mjs --check   the record is its recorded scrubbed bytes and holds no name
//
// The rule works on the parsed record's string values and re-serialises it exactly as the runner writes it (two-space
// JSON and a newline; --write refuses unless that round trip is byte-identical first), so only the name changes. A
// runner digest of a changed string (a tool output's outputSha256) no longer reproduces from the published text; the
// side record lists each one, and the note says so.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../jev-gate/runner-guard.mjs';

export const RECORD = 'experiments/nina-changes/results/reviewer.json';
export const MANIFEST = 'experiments/nina-changes/results/scrubbed-records.json';
export const TOKEN = '<user>';
export const RULE = `the local account name (read at run time from the operating system's user record and $USER, never written down), as a whole word (not inside a longer run of letters, digits, '_' or '-', and not followed by a '.' that continues a name, as in a file name), in any string value of the record -> ${TOKEN}`;
/** Generic account names a CI host runs as: no private name to find, so the scan says so and checks nothing. */
export const GENERIC_ACCOUNTS = ['runner', 'root', 'ubuntu', 'ci', 'build', 'node', 'docker', 'github', 'vsts'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The local account names to scrub: the OS user record and $USER, de-duplicated; generic CI names are not private. */
export function localNames(env = process.env) {
  let os = null;
  try { os = userInfo().username; } catch { /* no user record (some containers) */ }
  return [...new Set([os, env.USER].filter(n => typeof n === 'string' && n.length >= 2))].filter(n => !GENERIC_ACCOUNTS.includes(n.toLowerCase()));
}
const wordRe = names => new RegExp(`(?<![A-Za-z0-9_-])(?:${names.map(escapeRe).join('|')})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g');

/** The record with every name replaced; returns {record, replacements, fields} (fields: JSON paths, never values). */
export function scrubNames(record, names) {
  const re = wordRe(names);
  let replacements = 0;
  const fields = [];
  const walk = (v, path) => {
    if (typeof v === 'string') {
      const n = (v.match(re) ?? []).length;
      if (!n) return v;
      replacements += n; fields.push({ path: path.join('.'), replacements: n });
      return v.replace(re, TOKEN);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k])]));
    return v;
  };
  return { record: walk(record, []), replacements, fields };
}
const render = record => `${JSON.stringify(record, null, 2)}\n`;

/** Scrubs the committed record once and writes the side record. Refuses if there is nothing to scrub. */
export function write(root = REPO_ROOT, names = localNames()) {
  if (!names.length) throw new Error('rescrub-records6: no private account name to scrub on this host');
  const bytes = readFileSync(join(root, RECORD));
  if (render(JSON.parse(bytes)) !== bytes.toString('utf8')) throw new Error(`rescrub-records6: ${RECORD} does not round-trip byte for byte; refusing to re-serialise it`);
  const { record, replacements, fields } = scrubNames(JSON.parse(bytes), names);
  if (!replacements) throw new Error(`rescrub-records6: ${RECORD} holds no local account name`);
  const out = Buffer.from(render(record));
  // The runner digests of changed strings: a tool output's outputSha256 was the sha256 of its scrubbed output.
  const digests = fields.map(f => /^calls\.(\d+)\.toolCalls\.(\d+)\.output$/.exec(f.path)).filter(Boolean).map(([, c, t]) => {
    const call = record.calls[Number(c)];
    return { path: `calls.${c}.toolCalls.${t}.outputSha256`, call: `${call.id} run ${call.run}`, reproduces: sha256(call.toolCalls[Number(t)].output) === call.toolCalls[Number(t)].outputSha256 };
  });
  writeFileSync(join(root, RECORD), out);
  const manifest = {
    schemaVersion: 1, kind: 'scrubbed-records',
    note: 'The committed EXP 006 counted run record, re-scrubbed after the run (results refute N1): an ls -la output printed the local account name as its file owner, which the runner\'s write-time scrub (scrub6.mjs) does not collapse (it collapses paths). Only that name changed. originalSha256 is the record as the runner wrote it, the bytes the measured run produced; sha256 is the published record. The scorer reads the published record and every figure is unchanged.',
    rule: RULE,
    files: [{ path: RECORD, originalSha256: sha256(bytes), sha256: sha256(out), replacements, fields, digestsNoLongerReproduced: digests.filter(d => !d.reproduces).map(({ path, call }) => ({ path, call })) }],
  };
  writeFileSync(join(root, MANIFEST), render(manifest));
  return manifest;
}

/** The record is its recorded scrubbed bytes, and (on a host with a private name) holds no local account name. */
export function check(root = REPO_ROOT, names = localNames()) {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  for (const f of manifest.files) {
    const bytes = readFileSync(join(root, f.path));
    if (sha256(bytes) !== f.sha256) throw new Error(`${f.path} is not its recorded scrubbed bytes`);
    if (names.length && scrubNames(JSON.parse(bytes), names).replacements) throw new Error(`${f.path} still holds the local account name`);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  try {
    if (cmd === '--write') { const m = write(); console.log(`scrubbed ${RECORD}: ${m.files[0].replacements} replacements in ${m.files[0].fields.length} field(s); ${m.files[0].originalSha256} -> ${m.files[0].sha256}; wrote ${MANIFEST}`); }
    else if (cmd === '--check') { check(); console.log(`PASS ${RECORD} is its scrubbed bytes${localNames().length ? ' and holds no local account name' : ' (generic CI account: no private name to look for)'}`); }
    else { console.error('usage: rescrub-records6.mjs --write | --check'); process.exit(2); }
  } catch (error) { console.error(error.message); process.exit(1); }
}
