import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { BEST_BASELINE_VERBATIM, CAP_STATUS, CEILING_VERBATIM, CHURN_VERBATIM, D, EXP006_REUSED, FLOORS_VERBATIM, NOT_PINNED, PINNED, PROMPT_VERBATIM, REUSE_COMMIT, TO_BE_PINNED, checkBaselines, checkRecord, derive, fixtureManifest, manifestPath, notClassRules, pinPath, publishedPath, recordPath, required, validateRecord, vendoredRules } from './reviewer-keep-prereg.mjs';
import { articlePath, noteNumber, pageInputs, pageResultWords, renderJournalRow, renderNote, resultWords, sitemapUrl, slug, withHome, withSitemap } from './reviewer-keep-note.mjs';
import { stripTags } from './test-html-text.mjs';

// EXP 011 (reviewer-keep): the pre-registration, its validator and its public page. No item exists; no call is made.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { record, sha256: digest } = checkRecord();
const copy = () => structuredClone(record);
const unset = (r, path) => { const keys = path.split('.'); const last = keys.pop(); delete keys.reduce((o, k) => o[k], r)[last]; return r; };
const set = (r, path, value) => { const keys = path.split('.'); keys.slice(0, -1).reduce((o, k) => o[k], r)[keys.at(-1)] = value; return r; };
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

test('the record is pinned, and every file fact in it is what the files on disk give', () => {
  assert.equal(readFileSync(pinPath, 'utf8').split(/\s+/)[0], sha256(readFileSync(recordPath)));
  assert.deepEqual(record, derive(record));
  assert.deepEqual(Object.keys(record.files), PINNED);
  for (const [file, want] of Object.entries(record.files)) assert.equal(sha256(readFileSync(file)), want, file);
  for (const f of NOT_PINNED) assert(!(f in record.files), f);
  assert(PINNED.includes('scripts/reviewer-keep-stats.mjs'), 'the frozen scorer is pinned');
});

test('every required field is required: deleting any one is refused', () => {
  for (const path of Object.keys(required)) assert.throws(() => validateRecord(unset(copy(), path)), new RegExp(escapeRe(path)), path);
});

test('the design wording is verbatim: prompt, churn, best baseline, floors, ceiling trip, cap status', () => {
  assert.equal(readFileSync(`${D}/prompt.md`, 'utf8'), `${PROMPT_VERBATIM}\n`);
  assert.equal(record.arms.reviewer.promptText, PROMPT_VERBATIM);
  assert.equal(record.arms.baselines.churn, CHURN_VERBATIM);
  assert.deepEqual(record.scoring.bestBaseline, BEST_BASELINE_VERBATIM);
  assert.deepEqual(record.floors, FLOORS_VERBATIM);
  assert.equal(record.spend.ceilingTrip, CEILING_VERBATIM);
  for (const [path, value] of [['arms.reviewer.promptText', PROMPT_VERBATIM.replace('ACCEPT or REJECT', 'REJECT or ACCEPT')], ['arms.baselines.churn', CHURN_VERBATIM.replace('40', '50')], ['floors', FLOORS_VERBATIM.map(f => f.replace('30', '25'))], ['spend.ceilingTrip', CEILING_VERBATIM.replace('$30', '$40')], ['spend.capStatus', '$80 signed']]) {
    assert.throws(() => validateRecord(set(copy(), path, value)), new RegExp(escapeRe(path)), path);
  }
  assert.equal(record.spend.capStatus, CAP_STATUS);
  assert.equal(record.arms.reviewer.promptComparable, false);
});

test('eligibility: 18 of 50, the per-code and per-plugin counts, and the 50 are exactly EXP 007\'s not-class primary rules', () => {
  const e = record.eligibility;
  assert.deepEqual([e.rules, e.eligible, e.excluded, e.uncertain], [50, 18, 32, 5]);
  assert(!json(`${D}/eligibility.json`).some(d => d.eligible && d.uncertain), 'no eligible rule is an uncertain call');
  assert.deepEqual(e.perCode, { ELIGIBLE: 18, 'X-PROCESS': 8, 'X-TRANSCRIPT': 8, 'X-TOOLCALL': 6, 'X-COMMIT': 4, 'X-WITHHELD': 1, 'X-RUST': 2, 'X-META': 3 });
  assert.deepEqual(e.perPlugin, { hunch: 5, abide: 12, 'jev-axi': 1 });
  assert.deepEqual(record.parents.exp007.primaryClasses, { expressible: 1, partial: 86, not: 50, error: 8 });
  assert.deepEqual(notClassRules().sort(), json(`${D}/eligibility.json`).map(d => d.ruleId).sort());
  assert.throws(() => validateRecord(set(copy(), 'eligibility.eligible', 17)), /eligibility\.eligible/);
  const skew = copy(); skew.limits = skew.limits.filter(l => !l.includes('abide 12/18'));
  assert.throws(() => validateRecord(skew), /abide skew/);
});

test('the vendored rules are EXP 007\'s records verbatim, licences referenced (not copied), every record hashed', () => {
  const vendored = vendoredRules();
  assert.deepEqual(Object.keys(vendored), [`${D}/rules/hunch.json`, `${D}/rules/abide.json`, `${D}/rules/jev-axi.json`]);
  let n = 0;
  for (const [file, body] of Object.entries(vendored)) {
    assert.equal(readFileSync(file, 'utf8'), body);
    const v = JSON.parse(body), src = json(v.source.file);
    assert.equal(sha256(readFileSync(v.source.file)), v.source.sha256);
    assert.equal(sha256(readFileSync(v.licenseFile.file)), v.licenseFile.sha256);
    for (const r of v.rules) { assert.deepEqual(r, src.rules.find(x => x.ruleId === r.ruleId)); assert.equal(v.recordSha256[r.ruleId], sha256(JSON.stringify(r))); n++; }
  }
  assert.equal(n, 18);
  assert(!readdirSync(`${D}/rules`).some(f => /licen[cs]e/i.test(f)), 'no licence file is duplicated');
});

test('the baseline mapping covers exactly the 18 rules, with exact tool versions; a gap or an unknown tool is refused', () => {
  const b = json(`${D}/baselines.json`);
  const eligible = json(`${D}/eligibility.json`).filter(d => d.eligible).map(d => d.ruleId);
  checkBaselines(b, eligible);
  assert.throws(() => checkBaselines({ ...b, rules: b.rules.slice(1) }, eligible), /exactly the 18/);
  assert.throws(() => checkBaselines({ ...b, rules: b.rules.map((r, i) => (i ? r : { ...r, tools: ['jev'] })) }, eligible), /mapping/);
  assert.throws(() => checkBaselines({ ...b, tools: b.tools.map((t, i) => (i ? t : { ...t, packages: { typescript: '^5.9.3' } })) }, eligible), /exact versions/);
  assert.throws(() => checkBaselines({ ...b, churnHeuristic: CHURN_VERBATIM.replace('40', '30') }, eligible), /churn/);
  assert.deepEqual(record.arms.baselines.rulesWithoutTool.length, 7);
});

test('items, spend and runs add up; Jev is off; model ids are left to a dated amendment', () => {
  assert.deepEqual([record.items.red, record.items.green, record.items.total, record.items.controls.items, record.spend.countedRuns], [36, 36, 72, 6, 234]);
  assert.equal(record.labels.author.model, TO_BE_PINNED);
  assert.equal(record.labels.labeller.model, TO_BE_PINNED);
  assert.match(record.arms.jev, /^OFF\./);
  assert.deepEqual([record.spend.capUsd, record.spend.preCountedCeilingUsd], [80, 30]);
  assert.throws(() => validateRecord(set(copy(), 'spend.countedRuns', 240)), /Counted runs/);
  assert.equal(record.notBefore, "the merge time of this pre-registration's odin-rnd PR");
  assert.equal(record.status, 'Pre-registered, not yet run');
  assert.equal(record.publication, 'every outcome published');
});

test('the reused EXP 006 reviewer files are the ones on odin-rnd main at the pinned commit', t => {
  assert.deepEqual(Object.keys(record.arms.reviewer.reusedFromExp006.files), EXP006_REUSED);
  const nina = json('experiments/nina-changes/preregistration.json').reused.nina;
  assert.deepEqual(record.arms.reviewer.nina, { release: nina.release, commit: nina.commit, integrity: nina.integrity });
  // A shallow CI checkout (publish.yml fetches depth 2) lacks the pinned commit. The disk sha256s are still
  // bound by derive() in every run; only the history comparison needs the commit, so it is skipped, with the reason.
  try { execFileSync('git', ['cat-file', '-e', `${REUSE_COMMIT}^{commit}`], { stdio: 'ignore' }); } catch { t.skip(`commit ${REUSE_COMMIT.slice(0, 12)} is not in this (shallow) checkout`); return; }
  for (const [file, want] of Object.entries(record.arms.reviewer.reusedFromExp006.files)) {
    const blob = execFileSync('git', ['show', `${REUSE_COMMIT}:${file}`], { maxBuffer: 1 << 26 });
    assert.equal(sha256(blob), want, file);
  }
  assert.equal(nina.commit.slice(0, 8), 'be546e32');
});

test('the fixture: manifest current, tens of files, neutral, no live TASK.md or RULE.md, no local path or token-shaped string', () => {
  assert.equal(readFileSync(manifestPath, 'utf8'), fixtureManifest());
  const files = walk(`${D}/fixture`);
  assert(files.length >= 20 && files.length < 100, `${files.length} files`);
  for (const f of files) {
    const rel = f.slice(`${D}/fixture/`.length), body = readFileSync(f, 'utf8');
    assert(!/(?:^|\/)(?:TASK|RULE)\.md$/.test(rel), rel);
    assert(!/violat|\bred\b|\bgreen\b|exp ?0|reviewer|nina|abide|hunch|jev/i.test(rel + '\n' + body), `${rel}: names the experiment or an intent`);
    assert(!/(?<![\w\\])\/(?:Users|home|private)\//.test(body), `${rel}: a local path`);
  }
});

test('no committed EXP 011 file carries a local path or a token-shaped string', () => {
  const files = [...walk(D), ...readdirSync('scripts').filter(f => f.startsWith('reviewer-keep-')).map(f => `scripts/${f}`), articlePath, publishedPath];
  // Token prefixes are assembled at run time so this test file carries none itself.
  const prefixes = [['gh', 'p_'], ['github', '_pat_'], ['s', 'k-'], ['AK', 'IA'], ['xox', 'b-']].map(p => p.join(''));
  const tokenish = new RegExp(`(?:${prefixes.map(escapeRe).join('|')})[A-Za-z0-9_-]{12,}`);
  for (const f of files) {
    const body = readFileSync(f, 'utf8');
    assert(!/(?<![\w\\])\/(?:Users|home|private)\/[a-z]/.test(body) || f.endsWith('.test.mjs'), `${f}: a local path`);
    assert(!tokenish.test(body), `${f}: a token-shaped string`);
  }
});

test('no result words and no local path in the record; the data copy is the record byte for byte', () => {
  assert.equal(readFileSync(publishedPath, 'utf8'), readFileSync(recordPath, 'utf8'));
  assert.throws(() => validateRecord(set(copy(), 'experiment.note', 'The results show it.')), /states no result/);
  assert.throws(() => validateRecord(set(copy(), 'limits', [...record.limits, `see ${'/'}Users/someone/x`])), /Private local paths/);
});

test('the note is exactly the render of the record, states no result and links only allowlisted repositories', () => {
  const note = readFileSync(articlePath, 'utf8');
  assert.equal(note, renderNote(record, digest, pageInputs()));
  assert(note.includes(digest));
  assert.match(note, new RegExp(`EXPERIMENT NOTE / ${noteNumber} · EXP 011 · PRE-REGISTERED 10 OCT 2026 · NOT YET RUN`));
  assert(!pageResultWords.test(stripTags(note)), 'the page states a result');
  assert(!/https:\/\/github\.com\/(?!odin-labs-ai\/odin-rnd)/.test(note), 'only the odin-rnd repository is linked');
  for (const d of json(`${D}/eligibility.json`)) assert(note.includes(d.ruleId), `${d.ruleId} is listed with its decision`);
  const others = readdirSync('site/journal').filter(f => f !== `${slug}.html`).map(f => readFileSync(`site/journal/${f}`, 'utf8'));
  assert(!others.some(h => h.includes(`EXPERIMENT NOTE / ${noteNumber} `)), `note number ${noteNumber} is free`);
});

test('the home row sits directly above EXP 009\'s results row exactly once, from the record, with no result; the sitemap entry precedes EXP 009\'s results entry', () => {
  const home = readFileSync('site/index.html', 'utf8');
  const row = renderJournalRow(record);
  assert(!resultWords.test(row));
  assert.equal(home.split(row).length, 2, 'exactly once');
  assert.match(home, new RegExp(`${escapeRe(row)}\\n {6}<a class="journal-row" href="journal/composable-harness-results\\.html">`));
  assert.equal(withHome(home, record), home, 'idempotent');
  assert.throws(() => withHome('<main>no EXP 009 results row</main>', record), /exactly once/);
  const amended = home.replace('href="journal/composable-harness-results.html">', 'href="journal/composable-harness-results.html#amendment-01">');
  assert(withHome(amended, record).indexOf(row) < withHome(amended, record).indexOf('composable-harness-results.html#amendment-01'), 'anchors on the structure, not the text');
  const xml = readFileSync('site/sitemap.xml', 'utf8');
  assert.equal(xml.split(sitemapUrl).length, 2);
  assert(xml.indexOf(sitemapUrl) < xml.indexOf('journal/composable-harness-results.html'));
  assert.equal(withSitemap(xml), xml, 'idempotent');
});

test('refute r1: matched budget on both sides, preconditions before the first paid call, the comparator name, the frozen spot-check, the disclosures', () => {
  assert.match(record.scoring.primary.matchedBudget, /reviewer's item-level false-reject rate on GREEN items <= 15%/);
  assert.equal(record.scoring.primary.reviewerFrBudget, 0.15);
  assert.match(record.preconditions[0], /FIRST paid call/);
  assert.throws(() => validateRecord(set(copy(), 'preconditions', ['Before any item is scored, the base is clean.'])), /preconditions/);
  assert.match(json(`${D}/baselines.json`).precondition, /FIRST paid call/);
  assert.equal(record.comparatorName, 'the frozen rule-filtered off-the-shelf tools');
  assert.deepEqual([record.labels.humanSpotCheck.n, record.labels.humanSpotCheck.red, record.labels.humanSpotCheck.green, record.labels.humanSpotCheck.seed], [16, 8, 8, 10011]);
  assert(record.scoring.secondary.some(m => m.id === 'mapped-unmapped'));
  const bad = copy(); bad.limits = bad.limits.filter(l => !/unreachable/.test(l));
  assert.throws(() => validateRecord(bad), /unreachable no-baseline branch/);
  assert.match(record.spend.fallback, /changes only the schedule/);
});
