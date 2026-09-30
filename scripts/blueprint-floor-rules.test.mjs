import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXTRACTORS, extractPlugin, lineOf, mulberry32, parseJsString, parseRegexLiteral, rulesSha256, sampleIndices, sha256, SAMPLE } from '../experiments/blueprint-floor/extract.mjs';
import { loadRules, loadSelection, renderSelectionDoc, rulesPath, selectionDocPath, serialise } from './blueprint-floor-rules.mjs';

// EXP 007 WO-1-01: the vendored rule sets. CI has no network, so it checks the committed files' own shas, counts and
// ids, the seeded sample and the extractor on small inputs; `--verify` re-extracts from fresh clones at the pins.

const selection = loadSelection();
const records = Object.fromEntries(selection.plugins.map(p => [p.plugin, loadRules(p.plugin)]));
const PINS = { hunch: 'c2c680ed', 'jev-pref': '9d77ea60', abide: 'ea6d0976', limpet: '7a841b00', 'jev-belay': 'ef719db7', 'jev-engineering': '82655a6d', 'pi-verdict': '1b37e5f2', 'jev-axi': '044fae73' };
const KINDS = ['question', 'regex', 'prose', 'rubric'], INPUTS = ['diff', 'toolCall', 'stopTranscript', 'file'];

test('the eight plugins, at the pins the plan names, MIT, each with its copyright line', () => {
  assert.deepEqual(selection.plugins.map(p => p.plugin), Object.keys(PINS));
  for (const p of selection.plugins) {
    const r = records[p.plugin];
    assert(p.sha.startsWith(PINS[p.plugin]) && /^[a-f0-9]{40}$/.test(p.sha), p.plugin);
    assert.equal(r.plugin, p.plugin); assert.equal(r.repo, p.repo); assert.equal(r.sha, p.sha);
    assert.equal(r.license, 'MIT'); assert.match(r.copyright, /^Copyright \(c\) 2026 /);
    assert.equal(r.sources[0].path, 'LICENSE');
    for (const s of r.sources) assert.match(s.sha256, /^[a-f0-9]{64}$/, `${p.plugin} ${s.path}`);
  }
  assert.deepEqual(selection.outOfScope.map(o => o.plugin), ['DiffJury', 'Blink', 'jev-guard']);
});

test('each rule file re-checks: its counts, its own rules sha, unique ids across all files, the rule shape', () => {
  const all = new Set();
  for (const [plugin, r] of Object.entries(records)) {
    assert.equal(rulesSha256(r.rules), r.rulesSha256, `${plugin} rulesSha256`);
    assert.equal(r.counts.primary, r.rules.filter(x => x.stratum === 'primary').length);
    assert.equal(r.counts.secondary, r.rules.filter(x => x.stratum === 'secondary').length);
    assert.equal(r.counts.excluded, r.excluded.length);
    assert.equal(readFileSync(rulesPath(plugin), 'utf8'), serialise(r), `${plugin} is in its canonical serialisation`);
    for (const x of r.rules) {
      assert(!all.has(x.ruleId), `duplicate ruleId ${x.ruleId}`); all.add(x.ruleId);
      assert(x.ruleId.startsWith(`${plugin}/`), x.ruleId);
      assert(KINDS.includes(x.kind) && INPUTS.includes(x.inputKind) && ['primary', 'secondary'].includes(x.stratum), x.ruleId);
      assert(Number.isInteger(x.line) && x.line > 0 && x.sourcePath && r.sources.some(s => s.path === x.sourcePath), x.ruleId);
      assert(typeof x.text === 'string' && x.text.trim().length > 0, x.ruleId);
      assert.equal(x.kind === 'regex', typeof x.flags === 'string', `${x.ruleId}: flags recorded exactly for regex rules`);
      assert.deepEqual(Object.keys(x), ['ruleId', 'sourcePath', 'line', 'kind', 'text', 'flags', 'context', 'inputKind', 'stratum', 'withheld']);
    }
    for (const e of r.excluded) assert(e.id && e.sourcePath && Number.isInteger(e.line) && e.reason, `${plugin} exclusion ${e.id}`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(records).map(([p, r]) => [p, r.counts.primary])), { hunch: 8, 'jev-pref': 4, abide: 43, limpet: 10, 'jev-belay': 0, 'jev-engineering': 16, 'pi-verdict': 41, 'jev-axi': 23 });
});

test('the hunch secondary stratum is the seeded sample of 30 from the recorded population (seed 7007)', () => {
  const h = records.hunch;
  assert.deepEqual([h.secondaryPopulation.seed, h.secondaryPopulation.sampleSize, h.secondaryPopulation.size], [7007, 30, 1011]);
  assert.equal(h.secondaryPopulation.ruleIds.length, 1011);
  const chosen = sampleIndices(h.secondaryPopulation.size, SAMPLE.size, SAMPLE.seed).map(i => h.secondaryPopulation.ruleIds[i]);
  assert.deepEqual(h.rules.filter(r => r.stratum === 'secondary').map(r => r.ruleId), chosen);
  // The PRNG is fixed: the same seed gives the same stream on every platform.
  const r = mulberry32(7007);
  assert.deepEqual([r(), r(), r()].map(v => Math.floor(v * 1e9)), (() => { const q = mulberry32(7007); return [q(), q(), q()].map(v => Math.floor(v * 1e9)); })());
  assert.deepEqual(sampleIndices(10, 3, 1), sampleIndices(10, 3, 1));
  assert.notDeepEqual(sampleIndices(1011, 30, 7007), sampleIndices(1011, 30, 7008));
});

test('abide: text is the rule text; check.type, scope and when are withheld; every rule is a diff (edit, turn and null)', () => {
  const a = records.abide.rules;
  for (const r of a) {
    assert(r.withheld.check && ['model', 'lint', 'unenforceable', 'deferred'].includes(r.withheld.check.type), r.ruleId);
    assert.equal(r.inputKind, 'diff', `${r.ruleId}: edit, turn and null all check a diff`);
    assert(!r.text.includes(r.withheld.check.type === 'model' ? r.withheld.check.question.instructions : '\u0000'), `${r.ruleId}: the text is not the model question`);
  }
  assert.equal(a.filter(r => r.withheld.when === null).length, 18);
  assert.match(readFileSync(selectionDocPath, 'utf8'), /Rules with when = null, assigned diff: 18 of 43/);
});

test('exclusions follow the pinned inclusion test and are listed with reasons', () => {
  assert.deepEqual(records['jev-belay'].excluded.map(e => e.id), ['jev-belay/claims_done', 'jev-belay/claims_verified', 'jev-belay/verification_applies', 'jev-belay/outcome']);
  const je = records['jev-engineering'];
  assert.equal(je.excluded.filter(e => e.id.includes('/fast-path/')).length, 8);
  assert.equal(je.excluded.filter(e => e.id.includes('/pack/shell/')).length, 2);
  assert.deepEqual(je.rules.filter(r => r.ruleId.includes('/pack/')).map(r => r.ruleId), ['data', 'message', 'money', 'publish'].map(p => `jev-engineering/pack/${p}/verdict`));
  assert.equal(je.rules.filter(r => r.kind === 'regex').length, 10);
  assert.equal(records['pi-verdict'].excluded.length, 4);
  assert(records['pi-verdict'].excluded.every(e => e.id.startsWith('pi-verdict/path/S2-')));
  const axi = records['jev-axi'];
  assert(axi.excluded.some(e => e.id === 'jev-axi/DIFF_PER_FILE/secrets' && /\$\{id\}/.test(e.reason)));
  assert(axi.rules.every(r => !r.text.includes('${')), 'no templated question is a rule');
});

test('regex flags are recorded (pi-verdict /i), and jev-engineering\'s Python patterns carry no flags', () => {
  const pv = records['pi-verdict'].rules.filter(r => r.kind === 'regex');
  assert.equal(pv.length, 40);
  assert.equal(pv.filter(r => r.flags === 'i').length, 39);
  assert.equal(pv.find(r => r.ruleId === 'pi-verdict/bash/fork-bomb').flags, '');
  assert(records['jev-engineering'].rules.filter(r => r.kind === 'regex').every(r => r.flags === ''));
});

test('stored-text scan: no local path in any rule, except the narrow list of plugins\' own patterns that name one', () => {
  // A plugin's own deny pattern may itself match home directories; that text is the plugin's, verbatim, and is listed here.
  const EXCEPTIONS = ['jev-engineering/hard-deny/09'];
  const flagged = Object.values(records).flatMap(r => r.rules).filter(r => /\/(?:Users|home|private)\//.test(r.text)).map(r => r.ruleId);
  assert.deepEqual(flagged, EXCEPTIONS);
  for (const p of Object.keys(records)) assert(!/\/(?:Users|private\/tmp|private\/var)\/[a-z]/i.test(JSON.stringify({ ...records[p], rules: records[p].rules.filter(r => !EXCEPTIONS.includes(r.ruleId)) })), p);
});

test('SELECTION.md is exactly the render of selection.json and the rule files', () => {
  assert.equal(readFileSync(selectionDocPath, 'utf8'), renderSelectionDoc(selection, records));
});

test('each plugin\'s MIT license is committed verbatim, byte-identical to the LICENSE the extractor hashed at the pin (refute r1 B1)', () => {
  for (const r of Object.values(records)) {
    const text = readFileSync(`experiments/blueprint-floor/rules/licenses/${r.plugin}.LICENSE`, 'utf8');
    assert.equal(sha256(text), r.sources.find(x => x.path === 'LICENSE').sha256, r.plugin);
    assert.match(text, /^MIT License/); assert(text.includes(r.copyright), r.plugin);
    assert(text.includes('The above copyright notice and this permission notice shall be included'), `${r.plugin}: the permission notice`);
  }
  assert.match(readFileSync('NOTICE', 'utf8'), /experiments\/blueprint-floor\/rules\/licenses\//);
});

test('NOTICE carries one attribution line per plugin', () => {
  const notice = readFileSync('NOTICE', 'utf8');
  for (const r of Object.values(records)) assert(notice.includes(`${r.plugin} (${r.repo}): ${r.copyright.replace(/\.$/, '')}. MIT License.`), r.plugin);
});

test('extractor parsers: JS strings, regex literals with classes and escapes, line numbers', () => {
  assert.deepEqual(parseJsString('x = "a\\"b\\nc";', 4), { value: 'a"b\nc', end: 13 });
  assert.throws(() => parseJsString('`a ${b}`', 0), /template placeholder/);
  assert.deepEqual(parseRegexLiteral('p: /a[/]b\\/c/gi, x', 3), { source: 'a[/]b\\/c', flags: 'gi', end: 15 });
  assert.equal(lineOf('a\nb\nc', 4), 3);
});

test('extractor: an item that is neither a rule nor excluded stops the extraction', () => {
  const belay = selection.plugins.find(p => p.plugin === 'jev-belay');
  const src = 'export const QUESTIONS = {\n  claims_done: {\n  },\n  claims_verified: {\n  },\n  verification_applies: {\n  },\n  outcome: {\n  },\n  surprise: {\n  },\n};\n';
  assert.throws(() => EXTRACTORS['jev-belay'](() => src, belay), /surprise is neither a rule nor excluded/);
  const limpet = selection.plugins.find(p => p.plugin === 'limpet');
  const read = f => ({ LICENSE: 'MIT License\n\nCopyright (c) 2026 someone\n', 'rules.md': '# rules\n\n- Rule one\n- Rule two\nnot a rule\n' }[f]);
  const r = extractPlugin(limpet, read);
  assert.deepEqual(r.rules.map(x => [x.ruleId, x.line, x.text]), [['limpet/r0', 3, 'Rule one'], ['limpet/r1', 4, 'Rule two']]);
  assert.equal(r.sources.find(s => s.path === 'rules.md').sha256, sha256(read('rules.md')));
  assert.throws(() => extractPlugin(limpet, f => (f === 'LICENSE' ? 'Apache License\n' : read(f))), /not MIT/);
});
