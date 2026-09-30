import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DISCRIMINATING_NEGATIVES_VERBATIM, KAPPA_DISCLOSURE, KILL_CRITERIA_VERBATIM, NOT_PINNED, PINNED, WORDING_R2_7, checkRecord, derive, pinPath, publishedPath, recordPath, required, validateRecord } from './blueprint-floor-prereg.mjs';
import { addJournalRow, articlePath, assertNoteCurrent, exp006RowAnchor, renderJournalRow, renderNote, resultWords, slug } from './blueprint-floor-note.mjs';
import { addJournalRow as addExp006Row } from './nina-changes-note.mjs';
import { checkRecord as checkExp006 } from './nina-changes-prereg.mjs';
import { builtCopy } from './test-build.mjs';

// EXP 007 WO-1-04 and WO-1-05: the stage-1 pre-registration, its validator, and its public pages.
const LONG = { timeout: 600_000 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { record, sha256: digest } = await checkRecord();
const copy = () => structuredClone(record);
const unset = (r, path) => { const keys = path.split('.'); const last = keys.pop(); delete keys.reduce((o, k) => o[k], r)[last]; return r; };

test('the record is pinned, and every file fact in it is exactly what the files on disk give', LONG, async () => {
  assert.equal(readFileSync(pinPath, 'utf8').split(/\s+/)[0], sha256(readFileSync(recordPath)));
  assert.deepEqual(record, await derive(record));
  assert.deepEqual(Object.keys(record.files), PINNED);
  for (const [file, want] of Object.entries(record.files)) assert.equal(sha256(readFileSync(file)), want, file);
  for (const f of NOT_PINNED) assert(!(f in record.files), f);
});

test('every required field is required: deleting any one is refused', () => {
  for (const path of Object.keys(required)) assert.throws(() => validateRecord(unset(copy(), path)), new RegExp(path.replace(/\./g, '\\.')), path);
});

test('the kill criteria and the discriminating negatives are the council\'s words verbatim; the R2-7 wording too', () => {
  assert.equal(record.killCriteria.verbatim, KILL_CRITERIA_VERBATIM);
  assert.equal(record.killCriteria.discriminatingNegativesVerbatim, DISCRIMINATING_NEGATIVES_VERBATIM);
  assert.match(KILL_CRITERIA_VERBATIM, /median expressible share < 25% → premise refuted, census is the result;\n {2}cascade adds false rejects > 2 pts over plugin-alone, or avoids < 20% of Jev calls → refuted\.$/);
  for (const [path, value] of [['killCriteria.verbatim', KILL_CRITERIA_VERBATIM.replace('25%', '20%')], ['killCriteria.discriminatingNegativesVerbatim', DISCRIMINATING_NEGATIVES_VERBATIM.replace('95%', '90%')], ['spend.wording', WORDING_R2_7.replace('$100', '$200')]]) {
    const bad = copy(); const keys = path.split('.'); keys.slice(0, -1).reduce((o, k) => o[k], bad)[keys.at(-1)] = value;
    assert.throws(() => validateRecord(bad), new RegExp(path.replace(/\./g, '\\.')));
  }
});

test('the plan\'s pins: stage, models, effort, the pinned command, the spend cap and census ceiling, $0 in bundle 1', () => {
  assert.equal(record.stage, '1 of 2 (census); stage 2 pre-registered by amendment before any paid Jev call');
  assert.deepEqual([record.calls.translatorModel, record.calls.adjudicatorModel, record.calls.effort, record.calls.attempts], ['claude-opus-5-5', 'claude-sonnet-5', 'high', 1]);
  for (const flag of ['--model <pin>', '--effort high', '--tools ""', '--strict-mcp-config', '--setting-sources project', '--no-session-persistence', '--system-prompt-file', '--output-format json']) assert(record.calls.command.includes(flag), flag);
  assert(!record.calls.command.includes('--fallback-model'));
  const bad = copy(); bad.calls.command += ' --fallback-model x';
  assert.throws(() => validateRecord(bad), /pinned command/);
  assert.deepEqual([record.spend.capUsd, record.spend.censusCeilingUsd], [100, 40]);
  assert.match(record.spend.bundle1, /\$0\.0000000/);
  assert(!existsSync('experiments/blueprint-floor/spend-ledger.jsonl'), 'bundle 1 writes no ledger line');
  assert.match(record.calls.billing, /API-equivalent/);
  assert.match(record.notBefore, /mergedAt/);
});

test('the census counts and the plugin table come from the rule files; jev-belay\'s empty stratum is stated as a limit', () => {
  assert.deepEqual(record.plugins.map(p => [p.plugin, p.primary]), [['hunch', 8], ['jev-pref', 4], ['abide', 43], ['limpet', 10], ['jev-belay', 0], ['jev-engineering', 16], ['pi-verdict', 41], ['jev-axi', 23]]);
  assert.deepEqual([record.census.primaryRules, record.census.secondaryRules, record.census.controls, record.census.rules, record.census.calls, record.census.pluginsInMedian], [145, 30, 13, 188, 376, 7]);
  assert.deepEqual(record.census.pluginsWithoutRules, ['jev-belay']);
  assert(record.limits.some(l => l.includes('jev-belay has no rule that decides by itself')));
  assert.deepEqual(record.engine.pluginVocabulary, ['forbiddenDependency', 'forbiddenFile', 'forbiddenPattern', 'forbiddenEgress']);
  assert.deepEqual(record.excludedPlugins.map(p => p.plugin), ['DiffJury', 'Blink', 'jev-guard']);
  const bad = copy(); bad.census.calls += 1;
  assert.throws(() => validateRecord(bad), /Two counted calls/);
});

test('the limits the plan requires are stated', () => {
  const text = record.limits.join('\n');
  for (const phrase of ['bce-engine 0.3.1', 'a choice we made', 'A partial floor still needs a model', 'The translator is itself a model', 'self-consistency', 'biases the census toward the kill criterion', 'jev-pref has 4', 'not independent', 'parses every read file as TypeScript']) assert(text.includes(phrase), phrase);
});

test('no local path, no result words, and the site copy is the record byte for byte', () => {
  assert(!/(?<![\w\\])\/(?:Users|home|private)\//.test(readFileSync(recordPath, 'utf8')));
  assert.equal(readFileSync(publishedPath, 'utf8'), readFileSync(recordPath, 'utf8'));
  const bad = copy(); bad.limits = [...bad.limits, `see ${'/'}Users/someone/x`];
  assert.throws(() => validateRecord(bad), /Private local paths/);
});

test('the field note is exactly the render of the record and states no result', LONG, async () => {
  await assert.doesNotReject(assertNoteCurrent());
  const note = readFileSync(articlePath, 'utf8');
  assert.equal(note, renderNote(record, digest));
  assert(note.includes(digest));
  assert.match(note, /EXPERIMENT NOTE \/ 004 · EXP 007 · PRE-REGISTERED 30 SEP 2026 · NOT YET RUN/);
  assert.match(note, /<title>EXP 007 — Which of your gate&#39;s rules need a model at all\? Pre-registered, not yet run — Odin R&amp;D<\/title>/);
  assert(note.includes('<pre tabindex="0">Kill criteria (pre-registered, published either way)'));
  assert(readFileSync('site/sitemap.xml', 'utf8').includes(`journal/${slug}.html`));
  assert(!/(?<!\w)\/(?:Users|private\/tmp)\//.test(note));
  assert(!/https:\/\/github\.com\/(?!odin-labs-ai\/odin-rnd|v-modal\/awesome-jev-tools|blueprint-conformance\/bce)/.test(note), 'only allowlisted public repositories are linked');
});

test('the home row goes directly above EXP 006\'s, is rendered from the record, and states no result; EXP 006\'s order holds', () => {
  const home = readFileSync('site/index.html', 'utf8');
  assert.throws(() => addJournalRow(home, record), /EXP 006 field-note row exactly once/, 'EXP 006\'s row is added first');
  const built = addJournalRow(addExp006Row(home, checkExp006().record), record);
  const at = name => built.indexOf(`<a class="journal-row" href="journal/${name}.html">`);
  assert(at(slug) > 0 && at(slug) < at('nina-reviews-the-change') && at('nina-reviews-the-change') < at('jev-as-a-fast-gate'));
  assert(built.includes(renderJournalRow(record)));
  assert(!resultWords.test(renderJournalRow(record)));
  assert.throws(() => addJournalRow(built, record), /already there/);
  assert.equal(built.split(exp006RowAnchor).length, 2);
});

test('the built site publishes the record byte for byte and carries the row and the note (fresh build copy)', LONG, () => {
  const dist = join(builtCopy(), 'dist');
  assert.equal(sha256(readFileSync(join(dist, 'data/blueprint-floor/preregistration.json'))), digest);
  assert(readFileSync(join(dist, 'index.html'), 'utf8').includes(renderJournalRow(record)));
  assert(existsSync(join(dist, `journal/${slug}.html`)));
});

test('the note cannot scroll sideways at 375px or 320px (long tokens wrap)', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  assert(wraps, '.article-body wraps long tokens');
});

test('refute r1: the kappa disclosure, the opaque-id inputs, the controls-contract limit, and the plain gloss before the plan wording', () => {
  assert(record.adjudicator.agreement.includes(KAPPA_DISCLOSURE));
  assert(record.metrics.find(m => m.id === 'agreement').definition.includes(KAPPA_DISCLOSURE));
  const bad = copy(); bad.adjudicator.agreement = 'kappa';
  assert.throws(() => validateRecord(bad), /kappa disclosure/);
  for (const f of ['opaque id', 'verbatim text', 'input kind', 'regex flags', 'contract', 'whitelist']) assert(record.translator.input.includes(f), f);
  for (const f of ['opaque id', 'translator\'s answer verbatim', 'mechanical summary']) assert(record.adjudicator.input.includes(f), f);
  assert(record.limits.some(l => l.startsWith('The positive controls are shown the module-graph contract')));
  assert.match(record.spend.plain, /^Stage 1 calls no Jev model\./);
  const note = readFileSync(articlePath, 'utf8');
  const outside = note.replace(/<blockquote>[\s\S]*?<\/blockquote>/g, '');
  assert(!/STEER|COUNCIL-VERDICT/.test(outside), 'no internal jargon outside the quoted wording');
  assert(note.indexOf(record.spend.plain) < note.indexOf('<blockquote>'), 'the plain gloss comes first');
});
