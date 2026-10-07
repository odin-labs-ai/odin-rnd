// EXP 009 pre-refute lint: the checklist every prereg or results change passes before its first review, exactly:
//   1. not-before over ALL attempts
//   2. every bound file hash-checked
//   3. analysis inside the record
//   4. no outcome-selected sources
//   5. wording follows the record
// Each check prints PASS or FAIL with its reason; any FAIL exits 1. A TO-FREEZE field anywhere fails check 2, so the
// lint fails for as long as the draft has an open placeholder.
//
//   node scripts/composable-prereg-lint.mjs
//       [--not-before-at <ISO time>]   the recorded not-before (merge + 24 h), once the record is published
//       [--window-log <window.jsonl>]  mac-memory-window events; every counted attempt must open after the not-before
//       [--attempt-label <prefix>]     label prefix of counted attempts (default exp009-counted)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertP2Disclosure, buildRecord, corpusIdentity, KERNEL_WORDING, OUTCOME_PATHS, recordPath, sha256, toFreezePaths, TO_FREEZE } from './composable-prereg.mjs';
import { assertSiteCurrent, notePath, pageResultWords } from './composable-site.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

export async function lint({ root = '.', notBeforeAt, windowLog, attemptLabel = 'exp009-counted' } = {}) {
  const results = [];
  const check = async (id, fn) => {
    try { const detail = await fn(); results.push({ id, ok: true, detail }); } catch (error) { results.push({ id, ok: false, detail: error.message }); }
  };
  const fail = message => { throw new Error(message); };
  const record = JSON.parse(readFileSync(`${root}/${recordPath}`, 'utf8'));

  // 1. The not-before is a rule over every attempt; once a time is recorded, every counted attempt must open after it.
  await check('1 not-before over all attempts', () => {
    if (!/every attempt/.test(record.notBefore)) fail('the not-before rule does not cover every attempt');
    if (/\b20\d\d-\d\d-\d\d/.test(record.notBefore)) fail('the not-before names a time; the record states the rule, the time is recorded after publication');
    if (!windowLog) return 'rule covers every attempt; no attempts yet (no --window-log)';
    if (!notBeforeAt) fail('--window-log given without --not-before-at');
    const limit = Date.parse(notBeforeAt);
    if (Number.isNaN(limit)) fail(`--not-before-at is not a time: ${notBeforeAt}`);
    const attempts = readFileSync(windowLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(e => e.event === 'open' && String(e.label).startsWith(attemptLabel));
    const early = attempts.filter(e => Date.parse(e.ts) < limit);
    if (early.length) fail(`${early.length} of ${attempts.length} attempts opened before ${notBeforeAt}: ${early.map(e => `${e.label}@${e.ts}`).join(', ')}`);
    return `${attempts.length} attempts, all at or after ${notBeforeAt}`;
  });

  // 2. Every bound file hashes to its pin, and nothing is left TO-FREEZE.
  await check('2 every bound file hash-checked', () => {
    const open = toFreezePaths(record).filter(p => !p.startsWith('freeze.'));
    if (open.length) fail(`${open.length} TO-FREEZE field(s) still open: ${open.join(', ')}`);
    const bad = Object.entries(record.files).filter(([f, d]) => !existsSync(`${root}/${f}`) || sha256(readFileSync(`${root}/${f}`)) !== d).map(([f]) => f);
    if (bad.length) fail(`${bad.length} bound file(s) differ from their pins: ${bad.join(', ')}`);
    return `${Object.keys(record.files).length} files hash-verified`;
  });

  // 3. The confirmatory analysis is a pinned file with its tests, defined in the record; no later script is promised.
  await check('3 analysis inside the record', () => {
    const a = record.analysis;
    if (!a?.file || !a?.tests) fail('the record names no analysis file and tests');
    for (const f of [a.file, a.tests]) if (!record.files[f] || record.files[f] === TO_FREEZE) fail(`${f} is not pinned in the file map`);
    if (!Array.isArray(a.definitions) || a.definitions.length < 4) fail('the analysis definitions are missing');
    if (/written after this record|added by a dated amendment/i.test(a.rule)) fail('the analysis is promised for later, not inside the record');
    return `${a.file} and ${a.tests} pinned; ${a.definitions.length} definitions`;
  });

  // 4. Nothing the record cites was chosen after looking at outcomes.
  await check('4 no outcome-selected sources', async () => {
    // An outcome that was seen before registration must be disclosed, not hidden (P2 is seedless and was computed once).
    assertP2Disclosure(record);
    const outcome = Object.keys(record.files).filter(f => OUTCOME_PATHS.test(f));
    if (outcome.length) fail(`outcome paths are pinned: ${outcome.join(', ')}`);
    const corpus = await corpusIdentity(root);
    if (record.corpus.n !== 200 || corpus.n !== 200 || record.corpus.sha256 !== corpus.sha256) fail('the corpus is not the full 200 items asserted by the adapter');
    const freeze = JSON.parse(readFileSync(`${root}/experiments/composable-harness/FREEZE.json`, 'utf8'));
    if (record.primary.P2.corpus.tree.sha256 !== freeze.corpus.sha256 || record.primary.P2.corpus.configs !== 120) fail('the P2 corpus is not the whole frozen 120-config tree');
    const summary = JSON.parse(readFileSync(`${root}/experiments/composable-harness/baseline/summary.json`, 'utf8'));
    const atFreeze = record.primary.P2.baseline.atFreeze;
    if (atFreeze.faultySignalled !== summary.faultySignalled || atFreeze.cleanSignalled !== summary.cleanSignalled || atFreeze.agreesWithSpecEnabledAtBoot !== summary.filterAgreesWithSpecEnabledAtBoot) fail('the baseline figures differ from the committed summary');
    const rebuilt = await buildRecord(root);
    if (JSON.stringify([rebuilt.files, rebuilt.pendingFiles]) !== JSON.stringify([record.files, record.pendingFiles])) fail('the file map is not the full computed map (a hand-picked subset?)');
    return 'P2 pre-registration computation disclosed; no outcome paths; full corpus (200), full P2 tree (120), baseline figures from the committed summary, computed file map';
  });

  // 5. The page says only what the record says, in the record's words.
  await check('5 wording follows the record', async () => {
    await assertSiteCurrent(root);
    const page = readFileSync(`${root}/${notePath}`, 'utf8');
    if (!record.framing.includes(KERNEL_WORDING) || !page.includes(KERNEL_WORDING)) fail(`"${KERNEL_WORDING}" is missing from the record or the page`);
    const text = page.replace(/<[^>]+>/g, ' ');
    if (pageResultWords.test(text)) fail('the page states a result');
    if (!text.includes(record.p2Disclosure.statement) || !text.includes(record.p2Disclosure.predictive)) fail('the page does not carry the P2 disclosure in the record\'s words');
    if (/P2[^.]{0,80}predict/i.test(text)) fail('the page calls P2 a prediction');
    if (record.freeze.status === 'frozen' && /DRAFT/.test(page)) fail('a frozen record renders a draft page');
    return 'page, data copy, home row and sitemap re-render from the record; kernel wording present; no result wording';
  });

  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await lint({ notBeforeAt: arg('--not-before-at'), windowLog: arg('--window-log'), attemptLabel: arg('--attempt-label', 'exp009-counted') });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `pre-refute lint: ${failed} of ${results.length} checks FAIL` : `pre-refute lint: all ${results.length} checks PASS`);
  process.exit(failed ? 1 : 0);
}
