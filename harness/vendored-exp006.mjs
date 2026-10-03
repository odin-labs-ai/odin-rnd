// Byte-identical copies of the module-private EXP 006 symbols the parity witness needs (the EXP 006 vendored-exp005.mjs
// precedent). Never edited here: scripts/harness-parity.test.mjs slices each declaration out of the frozen source
// (experiments/nina-changes/run_reviewer6.mjs, bound by EXP 006's runners.sha256) and requires the bytes to be equal.
import { fingerprintItem } from '../experiments/nina-changes/fingerprints.mjs';
import { loadBaseLines } from '../experiments/nina-changes/base-lines.mjs';

function fingerprintsFor(items, corpus) {
  const baseSet = new Set(loadBaseLines().sha256s);
  return Object.fromEntries(items.map(i => [i.id, corpus.items[i.id] ?? (i.patch ? fingerprintItem(i.patch, baseSet) : null)]));
}

export { fingerprintsFor };
