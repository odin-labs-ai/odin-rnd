import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { benchScreen, build, clearScreenCache, serialise, wilson, WORLD_TERMS } from './brain-bench-import.mjs';
import { fingerprint } from './lab-dispatch-publish.mjs';
import { figures, pageTextProblems, prose, readBench, renderBench } from './brain-bench.mjs';
import { renderLabs } from './labs.mjs';

// Lab 02 (mission rnd-labs-human-first-1024). The import runs on a committed fixture of made-up rows (the real sources
// are private); the page and the record are the real site's. A name from the private test game is never written in
// this repo, in any form: the screen tests add a made-up name's hash to the term list at run time instead.
const FIXTURE = 'scripts/fixtures/brain-bench';
const json = file => JSON.parse(readFileSync(join(FIXTURE, file), 'utf8'));
const fixture = () => ({ src: join(FIXTURE, 'src'), map: json('map.json'), notes: json('notes.json'), pack: json('pack.json') });
// Made-up names (not from the private game), added to the screen's term list for these tests only.
const WORLD_NAME = 'Quorlith Spire';
const CHARACTER_NAME = 'Vexmoran';
function withMadeUpTerms(fn) {
  const added = [WORLD_NAME, CHARACTER_NAME].map(fingerprint).filter(hash => !WORLD_TERMS.has(hash));
  for (const hash of added) WORLD_TERMS.add(hash);
  clearScreenCache();
  try { return fn(); } finally { for (const hash of added) WORLD_TERMS.delete(hash); clearScreenCache(); }
}

test('the import is deterministic: two runs on the fixture write the same bytes, and they are the committed expected output', () => {
  const first = build(fixture()), second = build(fixture());
  assert.deepEqual(first.problems, []);
  assert.equal(serialise(first.record), serialise(second.record));
  assert.equal(serialise(first.record), readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));
});

test('the import counts from the rows: skips are not counted, intervals are Wilson, the re-run swaps in for the rows it replaces', () => {
  const { record } = build(fixture());
  const [w91, w92] = record.experiments;
  assert.equal(w91.design.skippedRows, 1);
  for (const brain of w91.brains) assert.equal(brain.n, 8);
  assert.deepEqual(w91.brains.find(b => b.id === 'rules').ci, wilson(6, 8));
  // Cost is counted and checked against the pack, but no money figure reaches the record.
  for (const exp of record.experiments) {
    assert.ok(!('runSpendUsd' in exp), exp.id);
    for (const brain of exp.brains) for (const key of ['costPerTaskUsd', 'costBasis', 'totalCostUsd', 'listPriceEstimateUsd', 'costSource']) assert.ok(!(key in brain), `${exp.id}/${brain.id} ${key}`);
  }
  const cloud92 = w92.brains.find(b => b.id === 'demo-cloud');
  assert.deepEqual([cloud92.successes, cloud92.sensitivity.successes, cloud92.sensitivity.rerun, cloud92.sensitivity.emptyReplyEpisodes], [6, 8, 2, 2]);
});

test('the telemetry pack is a second source: each brain keeps its pack row, and any disagreement or unmatched row is refused', () => {
  const { record } = build(fixture());
  for (const exp of record.experiments) for (const brain of exp.brains) assert.match(brain.source.pack.pointer, /^\/benchmark\/\d+$/, `${exp.id}/${brain.id}`);
  const sens = record.experiments[1].brains.find(b => b.sensitivity).sensitivity;
  assert.equal(sens.registered, false);
  assert.match(sens.source.pack.pointer, /^\/benchmark\/\d+$/);
  const cases = [
    [input => { input.pack.benchmark[0].successes += 1; }, /the pack says/],
    [input => { input.pack.benchmark[0].source.sha256 = '0'.repeat(64); }, /results hash/],
    [input => { input.pack.benchmark.find(r => typeof r.usd_per_task === 'number' && r.usd_per_task > 0).usd_per_task += 0.01; }, /cost per task/],
    [input => { input.pack.benchmark.push({ ...input.pack.benchmark[0], experiment: 'EXP-W91', brain: 'an extra brain' }); }, /no neutral id for this pack brain|matches no brain/],
    [input => { input.pack = null; }, /none \(odin-telemetry v1\) was given/],
  ];
  for (const [change, expected] of cases) {
    const input = fixture();
    change(input);
    const { problems } = build(input);
    assert.ok(problems.some(p => expected.test(p)), problems.join('\n'));
  }
});

test('the import refuses unequal episode counts, an experiment with nothing to check against, and keeps counting after one fails', () => {
  {
    const input = fixture();
    // Drop one result row of one brain: that experiment's brains no longer have equal counts.
    input.src = mkdtempSync(join(tmpdir(), 'bench-unequal-'));
    try {
      cpSync(join(FIXTURE, 'src'), input.src, { recursive: true });
      const file = join(input.src, 'EXP-W92-fixture-rerun/results/results.jsonl');
      writeFileSync(file, readFileSync(file, 'utf8').split('\n').slice(1).join('\n'));
      const { problems } = build(input);
      assert.ok(problems.some(p => /EXP-W92: brains have unequal episode counts/.test(p)), problems.join('\n'));
    } finally { rmSync(input.src, { recursive: true, force: true }); }
  }
  {
    const input = fixture();
    delete input.map.pack;
    input.pack = null;
    const { problems } = build(input);
    assert.ok(problems.some(p => /EXP-W92: no leaderboard and no telemetry pack/.test(p)), problems.join('\n'));
  }
  {
    // A problem in the first experiment does not stop the second from being counted and checked.
    const input = fixture();
    delete input.map.worlds['alpha-vale'];
    input.map.experiments[1].leaderboard = 'results/missing.json';
    const { problems } = build(input);
    assert.ok(problems.some(p => /EXP-W91 results line/.test(p)), problems.join('\n'));
    assert.ok(problems.some(p => /EXP-W92 leaderboard/.test(p)), 'the second experiment was still read');
  }
});

test('a figure must cite its rows: a pointer alone, or malformed line ranges, is refused at build', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-rows-'));
  try {
    mkdirSync(join(root, 'data/labs/brain-bench'), { recursive: true });
    cpSync('site/data/labs/brain-bench.json', join(root, 'data/labs/brain-bench.json'));
    for (const change of [s => { s.lines = undefined; s.pointer = '/brains/0'; }, s => { s.lines = [[0, 3]]; }, s => { s.lines = [[5, 'x']]; }]) {
      const tampered = structuredClone(record);
      change(tampered.experiments[0].brains[0].source);
      const raw = JSON.stringify(tampered);
      writeFileSync(join(root, 'data/labs/brain-bench/results.json'), raw);
      writeFileSync(join(root, 'data/labs/brain-bench/results.sha256'), `${createHash('sha256').update(raw).digest('hex')}  results.json\n`);
      assert.throws(() => readBench(root), /the source names no rows/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the import refuses a row whose world, task, kind or brain the map does not label', () => {
  const input = fixture();
  delete input.map.worlds['beta-dock'];
  const { problems } = build(input);
  assert.ok(problems.some(p => /the map has no neutral label for this world/.test(p)), problems.join('\n'));
});

test('the screen refuses a name from the private test game, however it is written, wherever it sits', () => {
  assert.deepEqual(benchScreen(WORLD_NAME), [], 'a made-up name passes until its hash is listed');
  withMadeUpTerms(() => {
    for (const text of [WORLD_NAME, WORLD_NAME.toLowerCase().replace(' ', '-'), WORLD_NAME.toUpperCase().replace(' ', ''), `the ${WORLD_NAME.replace(' ', '.')} world`, `a ${CHARACTER_NAME} sighting`]) {
      assert.ok(benchScreen(text).includes('a name from the private test game (a world, a character or an item)'), text);
      assert.ok(benchScreen(text, { source: true }).length > 0, `${text} (in a source field)`);
    }
    // In the public words, in a neutral label and in a brain's label: each is refused, and nothing is written.
    const cases = [
      input => { input.notes.experiments[0].caveats.push(`It ran in ${WORLD_NAME}.`); },
      input => { input.notes.labels.worlds.a = WORLD_NAME; },
      input => { input.notes.brains['demo-local'].label = `${CHARACTER_NAME} model`; },
    ];
    for (const change of cases) {
      const input = fixture();
      change(input);
      const { problems } = build(input);
      assert.ok(problems.some(p => /a name from the private test game/.test(p)), problems.join('\n'));
    }
  });
});

test('the screen also refuses a price in prose and a file path, but lets a source hold a file name', () => {
  // The publisher's own restricted names are tested in lab-dispatch-publish.test.mjs; benchScreen runs that screen first.
  assert.ok(benchScreen('it cost $0.33').includes('a price or currency amount'));
  assert.ok(benchScreen('see results/leaderboard.json').includes('a file path or file name'));
  assert.deepEqual(benchScreen('results/leaderboard.json', { source: true }), []);
  assert.deepEqual(benchScreen('Following a person\'s instruction, the cloud models are clearly better.'), []);
});

const record = JSON.parse(readFileSync('site/data/labs/brain-bench/results.json', 'utf8'));
const notes = JSON.parse(readFileSync('site/data/labs/brain-bench.json', 'utf8'));

test('every public number has a source: each figure names its experiment, file, rows and the private commit, and adds up', () => {
  assert.match(record.source.commit, /^[0-9a-f]{40}$/);
  assert.doesNotThrow(() => readBench());
  const all = figures(record);
  assert.ok(all.length > 100, `${all.length} figures`);
  for (const [at, figure] of all) {
    assert.equal(figure.source.commit, record.source.commit, at);
    assert.match(figure.source.experiment, /^EXP-W\d{2}$/, at);
    assert.ok(figure.source.file && figure.source.lines.length, at);
    assert.deepEqual(figure.ci, wilson(figure.successes, figure.n), at);
  }
  // Every number in the record sits in a figure or in a design block with its own source; there is no money figure.
  const stray = [];
  for (const exp of record.experiments) {
    assert.ok(exp.design.source.lines.length, `${exp.id} design`);
    const { brains, design, ...rest } = exp;
    (function walk(v, at) { if (typeof v === 'number') stray.push(at); else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, `${at}/${k}`); })(rest, exp.id);
  }
  assert.deepEqual(stray, [], 'numbers outside a sourced figure');
});

test('a figure that does not add up, or has lost its source, is refused at build', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-tamper-'));
  try {
    for (const [change, expected] of [[r => { r.experiments[0].brains[0].successes += 1; }, /not the Wilson 95 % interval/], [r => { delete r.experiments[1].brains[2].source; }, /no source/]]) {
      mkdirSync(join(root, 'data/labs/brain-bench'), { recursive: true });
      cpSync('site/data/labs/brain-bench.json', join(root, 'data/labs/brain-bench.json'));
      const tampered = structuredClone(record);
      change(tampered);
      writeFileSync(join(root, 'data/labs/brain-bench/results.json'), JSON.stringify(tampered));
      assert.throws(() => readBench(root), expected);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the record is pinned by its sha256, and a record that does not match its pin is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-pin-'));
  try {
    mkdirSync(join(root, 'data/labs/brain-bench'), { recursive: true });
    cpSync('site/data/labs/brain-bench.json', join(root, 'data/labs/brain-bench.json'));
    cpSync('site/data/labs/brain-bench/results.sha256', join(root, 'data/labs/brain-bench/results.sha256'));
    writeFileSync(join(root, 'data/labs/brain-bench/results.json'), `${readFileSync('site/data/labs/brain-bench/results.json', 'utf8')} `);
    assert.throws(() => readBench(root), /does not pin the sha256/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prose states no number of its own: digits appear only in placeholders, registered predictions and names', () => {
  // Model names, harness and brain versions, experiment and prediction ids, and the fixed method terms carry digits.
  const names = /\{[^}]+\}|EXP-W\d{2}|\bP\d\b|\bh[45]\b|v3\.[12]|95 %|1 GB|Qwen2\.5 1\.5B|Llama 3\.[23] (?:3B|70B)|GPT-4o|Haiku 4\.5|Gemini 2\.5|Mistral Small 3\.2/g;
  const registered = new Set(notes.experiments.flatMap(e => e.predictions.map(p => p.text)));
  for (const text of prose(notes)) {
    if (registered.has(text)) continue;
    assert.doesNotMatch(text.replace(names, ''), /\d/, text);
  }
});

const { pages } = renderBench();
const page = pages['labs/brain-bench/index.html'];

test('the page renders every brain of every experiment, in its chart and its table, with every placeholder resolved', () => {
  assert.doesNotMatch(page, /\{EXP-|<!--BENCH_/);
  const sections = [['task-set', ['EXP-W01', 'EXP-W02']], ['instructions-h4', ['EXP-W03']], ['instructions-h5', ['EXP-W04']]];
  for (const [id, exps] of sections) {
    const section = page.slice(page.indexOf(`<section class="company-section company-width bench-section" id="${id}"`)).split('</section>')[0];
    const brains = record.experiments.filter(e => exps.includes(e.id)).flatMap(e => e.brains.map(b => [e.id, b]));
    assert.equal((section.match(/<g class="bench-row /g) ?? []).length, brains.length, `${id} chart rows`);
    assert.equal((section.match(/<table class="bench-table">[\s\S]*?<\/table>/)[0].match(/<tr class="bench-/g) ?? []).length, brains.length, `${id} table rows`);
    for (const [, b] of brains) assert.ok(section.includes(`${b.successes} / ${b.n}`), `${id} ${b.id}`);
    for (const e of exps) for (const p of record.experiments.find(x => x.id === e).predictions) assert.ok(section.includes(`<strong>${p.id}.</strong>`), `${e} ${p.id}`);
  }
  assert.equal((page.match(/<li><span class="bench-verdict/g) ?? []).length, record.experiments.reduce((t, e) => t + e.predictions.length, 0));
});

test('the page carries the caveats: the bench bug, the cost bug, the declined prediction, and no broker beside a number', () => {
  assert.match(page, /charged for the whole stack/);
  assert.match(page, /cost column read zero for every cloud model/);
  assert.match(page, /this site does not publish money figures/);
  assert.ok(!/Mistral Small 3\.2[^<]*<\/th><td>Cloud<\/td><td>199 \/ 200/.test(page), 'the sensitivity result is never a table row');
  assert.match(page, /holds as registered, not claimed/);
  assert.match(page, /We do not claim this prediction\./);
  assert.match(page, /never compared with/);
  assert.doesNotMatch(page, /open\s?router|double\s?word/i);
});

test('the rendered page shows no money: its visible text passes the publisher screen, and a price in the words fails the build', () => {
  assert.deepEqual(pageTextProblems(page), []);
  assert.doesNotMatch(page.replace(/<[^>]+>/g, ' '), /[$€£¥¢]|\b(?:usd|eur|gbp)\b|\bdollars?\b|\bcents?\b/i);
  // The build-time screen sees what a placeholder renders, not only the data strings.
  assert.ok(pageTextProblems('<p>it cost $0.05 per task</p>').includes('a price or currency amount: "it cost $0.05 per task"'));
  const root = mkdtempSync(join(tmpdir(), 'bench-money-'));
  try {
    for (const file of ['data/labs/brain-bench/results.json', 'data/labs/brain-bench/results.sha256', 'labs/brain-bench/index.html']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      cpSync(join('site', file), join(root, file));
    }
    cpSync('site/data/labs/brain-bench.json', join(root, 'data/labs/brain-bench.json'));
    assert.doesNotThrow(() => renderBench(root));
    writeFileSync(join(root, 'labs/brain-bench/index.html'), readFileSync('site/labs/brain-bench/index.html', 'utf8').replace('<!--BENCH_METHOD-->', '<!--BENCH_METHOD--><p>about $5</p>'));
    assert.throws(() => renderBench(root), /a price or currency amount/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('on the published site Lab 02 is required: its words missing refuse the Labs build, never a page without the lab', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-required-'));
  try {
    for (const file of ['labs/index.html', 'labs/agent-space/index.html', 'data/labs/agent-space.json', 'data/labs/delivery/odin-rnd.json']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      cpSync(join('site', file), join(root, file));
    }
    assert.throws(() => renderLabs(root, { requireBench: true }), /^Error: Lab 02 is required on the published site: data\/labs\/brain-bench\.json is missing$/m);
    // The same root without the requirement renders, with no Lab 02 page: the gate is the requirement, not a missing file.
    assert.ok(!('labs/brain-bench/index.html' in renderLabs(root, { requireBench: false })));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Lab 02 is in the sitemap; its Labs tile comes in its own change, through the lab-tiles gate', () => {
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/brain-bench/</loc>'));
  assert.ok(renderLabs()['labs/brain-bench/index.html'].includes('<h1 id="lab-title">Every brain on the same tasks.</h1>'));
});
