// The lab record pins, recomputed and shown: for every committed site/data/labs/<lab>/record.json, the sha256 of its
// bytes beside the one its record.sha256 pins, one line each:
//
//   PIN <path> <computed sha256> <committed sha256> MATCH|MISMATCH
//
// readPinned (scripts/lab-kit.mjs) already refuses a mismatched pin on every build; this prints the check, so a review
// of a record-only change can cite a run's own recomputed digest instead of recomputing it from a diff. Fail-closed: a
// record without a pin, a pin that is not one sha256sum line naming record.json, or no record at all exits 1.
//
//   node scripts/lab-pin-report.mjs [root]      root defaults to site
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** One { path, computed, committed, ok } per lab record under `root`, sorted by path. */
export function pinReport(root = 'site') {
  const labs = join(root, 'data', 'labs');
  const dirs = existsSync(labs) ? readdirSync(labs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
  return dirs.filter(d => existsSync(join(labs, d, 'record.json'))).map(d => {
    const path = join(labs, d, 'record.json');
    const computed = sha256(readFileSync(path));
    const pinPath = join(labs, d, 'record.sha256');
    const line = existsSync(pinPath) ? /^([0-9a-f]{64}) {2}record\.json\n$/.exec(readFileSync(pinPath, 'utf8')) : null;
    const committed = line ? line[1] : 'none';
    return { path, computed, committed, ok: committed === computed };
  });
}

export function pinLines(rows, root = '.') {
  return rows.map(r => `PIN ${relative(root, r.path)} ${r.computed} ${r.committed} ${r.ok ? 'MATCH' : 'MISMATCH'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = pinReport(process.argv[2] ?? 'site');
  for (const l of pinLines(rows)) console.log(l);
  if (!rows.length) { console.log('PIN none: no lab record found'); process.exit(1); }
  process.exit(rows.every(r => r.ok) ? 0 : 1);
}
