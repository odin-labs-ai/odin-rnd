// Records that join the experiment ledger without their own generator (vp-grow-odin-r-d bundle-1 WO-02). The ledger
// (scripts/experiment-ledger.mjs) lists an experiment once site/data/<slug>/preregistration.json exists; EXP 010 and
// EXP 012 were frozen in experiments/<slug>/ but never copied, so the ledger skipped them.
//   EXP 012 joins by a byte-for-byte site copy: this module names each copy, checks it against the record and the
//     record against its committed .sha256, and refuses the build on any difference.
//   EXP 010 cannot be copied: its record cites two upstream GitHub repositories, and scripts/check.mjs (pinned by
//     EXP 006 and EXP 007, so not edited) refuses any GitHub link outside its list on a built page. It joins by a
//     ledger entry that links the record in this repository and states its sha256, checked here against the pin.
// Plus the two studies published without a pre-registration (#42, #43), numbered so they can be cited.
//
//   node scripts/ledger-publish.mjs --write   copy every record to its site path (then commit the copies)
//   node scripts/ledger-publish.mjs           check only (what the build runs)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Each copy: the frozen record, its committed .sha256 (null when the record has none), and the site path. */
export const copies = [
  { id: 'EXP 012', record: 'experiments/self-verify/preregistration.json', pin: 'experiments/self-verify/preregistration.sha256', site: 'site/data/self-verify/preregistration.json' },
  { id: 'EXP 012', record: 'experiments/self-verify/amendment-01/amendment.json', pin: 'experiments/self-verify/amendment-01/amendment.sha256', site: 'site/data/self-verify/amendment-01.json' },
  { id: 'EXP 012', record: 'experiments/self-verify/results.json', pin: null, site: 'site/data/self-verify/results.json' },
  { id: 'EXP 015', record: 'experiments/telemetry-truth/preregistration.json', pin: 'experiments/telemetry-truth/preregistration.sha256', site: 'site/data/telemetry-truth/preregistration.json' },
  { id: 'EXP 016', record: 'experiments/broker-same-model/preregistration.json', pin: 'experiments/broker-same-model/preregistration.sha256', site: 'site/data/broker-same-model/preregistration.json' },
  { id: 'EXP 017', record: 'experiments/review-frontier/preregistration.json', pin: 'experiments/review-frontier/preregistration.sha256', site: 'site/data/review-frontier/preregistration.json' },
  { id: 'EXP 017', record: 'experiments/review-frontier/results.json', pin: null, site: 'site/data/review-frontier/results.json' },
];

/** The first token of a `sha256sum`-style pin file. */
export const pinned = text => String(text).trim().split(/\s+/)[0];

/** Checks one copy; returns its sha256. Throws on a record that differs from its pin or a site copy that differs from the record. */
export function checkCopy({ id, record, pin, site }, read = readFileSync, exists = existsSync) {
  if (typeof site !== 'string' || !site.startsWith('site/data/')) throw new Error(`${id}: site copy ${site} must live under site/data/`);
  const bytes = read(record);
  const sum = sha256(bytes);
  if (pin && pinned(read(pin, 'utf8')) !== sum) throw new Error(`${id}: ${record} no longer matches its frozen ${pin}`);
  if (!exists(site)) throw new Error(`${id}: ${site} is missing; run node scripts/ledger-publish.mjs --write and commit the copy`);
  if (sha256(read(site)) !== sum) throw new Error(`${id}: ${site} differs from ${record}; run node scripts/ledger-publish.mjs --write`);
  return sum;
}

export const checkCopies = (list = copies) => list.map(c => ({ ...c, sha256: checkCopy(c) }));

/** After `dist` is built from `site`, every published copy must still be the record's bytes. */
export function checkDist(checked, dist = 'dist') {
  for (const c of checked) if (!c.site.startsWith('site/data/')) throw new Error(`${c.id}: site copy ${c.site} must live under site/data/`);
  for (const c of checked) if (sha256(readFileSync(`${dist}/${c.site.slice('site/'.length)}`)) !== c.sha256) throw new Error(`${c.id}: published ${c.site} differs from ${c.record}`);
}

// Studies published WITHOUT a pre-registration (odin-rnd #42, #43). They get an experiment number so they can be
// cited, and the ledger says in its stage that they were not pre-registered: their method and data are published,
// but no question, metric or decision rule was frozen before they ran. Decision of record 2026-10-23
// (vp-grow-odin-r-d bundle-1 WO-02): numbered in merge order, after EXP 012. Each entry lives in
// site/data/<slug>/ledger-entry.json; the ledger refuses one that sits beside a pre-registration.
export const repoBlob = path => `https://github.com/odin-labs-ai/odin-rnd/blob/main/${path}`;

export function checkLedgerEntry(entry, where, read = readFileSync) {
  const e = entry?.experiment;
  if (!e || !/^EXP \d{3}$/.test(e.id ?? '') || typeof e.title !== 'string' || !e.title) throw new Error(`${where}: experiment.id (EXP 000) and experiment.title are required`);
  if (entry.preregistered === true) {
    // A pre-registration listed from the repository: the record must still match its pin and the sha256 the entry states.
    if (typeof entry.record !== 'string' || typeof entry.pin !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) throw new Error(`${where}: a repository-record entry needs record, pin and sha256`);
    const sum = sha256(read(entry.record));
    if (pinned(read(entry.pin, 'utf8')) !== sum || entry.sha256 !== sum) throw new Error(`${where}: ${entry.record} does not match its pin and the sha256 this entry states`);
    if (JSON.parse(read(entry.record, 'utf8')).experiment?.id !== e.id) throw new Error(`${where}: ${entry.record} is not ${e.id}`);
    return entry;
  }
  if (entry.preregistered !== false) throw new Error(`${where}: preregistered must be true (a record listed from the repository) or false (a study with no pre-registration)`);
  if (typeof entry.numberedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.numberedOn)) throw new Error(`${where}: numberedOn (YYYY-MM-DD) is required`);
  if (typeof entry.source !== 'string' || !entry.source) throw new Error(`${where}: source (the PR that published the study) is required`);
  return entry;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) {
    for (const c of copies) { mkdirSync(dirname(c.site), { recursive: true }); writeFileSync(c.site, readFileSync(c.record)); }
  }
  for (const c of checkCopies()) console.log(`${c.id} ${c.site} ${c.sha256}`);
}
