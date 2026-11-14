import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStrangers, renderAbout, renderStrangers, strangersProblems, STRANGERS_PIN, STRANGERS_RECORD, STRANGERS_TEMPLATE, STRANGERS_TILE, verdictOf } from './lab-strangers.mjs';
import { build, isolationOf, PYC_CHECK, rowOf, sheetFigures, templatesFromCopy, treeCheck } from './vendor-strangers.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// Lab 12, "How many strangers can the space hold?" (scripts/lab-strangers.mjs). The capacity sheet's figures are an
// estimate for any machine but the one it was measured on, so they sit in the kit's estimate box; the fresh run sits in
// its own panel; and nothing of one is ever shown inside the other.
const raw = readFileSync(join('site', STRANGERS_RECORD), 'utf8');
const record = JSON.parse(raw);
const clone = () => JSON.parse(raw);
const pages = renderLabs();
const page = pages[STRANGERS_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const panel = (html, cls) => { const start = html.indexOf(`<div class="lab-panel ${cls}"`); assert.ok(start >= 0, cls); let depth = 0, i = start; do { const open = html.indexOf('<div', i + 1), close = html.indexOf('</div>', i + 1); if (open !== -1 && open < close) { depth++; i = open; } else { depth--; i = close; } } while (depth >= 0); return html.slice(start, i + 6); };
const temp = mkdtempSync(join(tmpdir(), 'lab-strangers-'));
after(() => rmSync(temp, { recursive: true, force: true }));

test('Lab 12 renders, sits on the Labs index after Lab 09 and before Lab 13, and is in the sitemap', () => {
  assert.ok(page, 'labs/strangers/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab09 = index.indexOf('aria-labelledby="lab-tile-talk-leak"'), lab12 = index.indexOf('aria-labelledby="lab-tile-strangers"'), lab13 = index.indexOf('aria-labelledby="lab-tile-measured-blind"');
  assert.ok(lab09 >= 0 && lab12 > lab09 && lab13 > lab12, 'Lab 12 sits between Lab 09 and Lab 13');
  assert.match(index, /<span class="technical">LAB 12<\/span><h2 id="lab-tile-strangers">How many strangers can the space hold\?<\/h2>/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/strangers/</loc>'));
});

test('the estimate and the measurement are boxed apart: the sheet in the estimate box, the run in its own panel', () => {
  const est = panel(main, 'strangers-estimate'), estRows = panel(main, 'strangers-estimate-rows');
  const run = panel(main, 'strangers-measured'), runRows = panel(main, 'strangers-measured-rows');
  for (const box of [est, estRows]) {
    assert.match(box, /<p class="technical">AN ESTIMATE, NOT A MEASUREMENT<\/p>/);
    assert.match(textOf(box), /shared Windows PC/);
    assert.doesNotMatch(textOf(box), /\bMac\b|A MEASUREMENT, RUN ON/, 'nothing of the fresh run inside the estimate box');
  }
  for (const box of [run, runRows]) {
    assert.match(box, /<p class="technical">A MEASUREMENT, RUN ON /);
    assert.doesNotMatch(textOf(box), /Windows|AN ESTIMATE|recommended public cap/i, 'nothing of the sheet inside the measurement');
  }
  // Each table holds its own rows: the sheet's steps in the estimate box, the run's in its panel, none of either outside.
  const cells = rows => rows.map(r => `<th scope="row">${r.guests.toLocaleString('en-GB')}</th><td>${r.tickP95.toFixed(2)} ms</td>`);
  for (const c of cells(record.estimate.rows)) { assert.ok(estRows.includes(c), c); assert.ok(!runRows.includes(c), c); }
  for (const c of cells(record.measurement.rows)) { assert.ok(runRows.includes(c), c); assert.ok(!estRows.includes(c), c); }
  assert.equal((main.match(/AN ESTIMATE, NOT A MEASUREMENT/g) ?? []).length, 2, 'two estimate boxes, no more');
  assert.match(textOf(est), new RegExp(`Recommended public cap: ${record.estimate.recommendedCap} guests`));
});

test('both verdicts are recomputed from their own rows, with the load tool\'s rules', () => {
  assert.deepEqual(verdictOf(record.estimate.rows), record.estimate.verdict);
  assert.deepEqual(verdictOf(record.measurement.rows), record.measurement.verdict);
  assert.deepEqual(record.estimate.verdict, { tickUnder50: 150, smooth: 100 }, 'the sheet\'s own figures');
  const r = clone();
  r.measurement.verdict.smooth = r.measurement.ramp[0];
  assert.ok(strangersProblems(r).some(p => /measurement\/verdict: not what its own rows give/.test(p)));
  const s = clone();
  s.estimate.rows[4].lagP95 = 500;
  assert.ok(strangersProblems(s).some(p => /estimate\/verdict: not what its own rows give/.test(p)));
  const t = clone();
  t.measurement.rows.reverse();
  assert.ok(strangersProblems(t).some(p => /its steps are not its ramp/.test(p)));
});

test('the run states its date, host, load and setup, and was made below the load gate', () => {
  const m = record.measurement;
  assert.ok(m.load1Start < 40);
  assert.equal(m.browsers, 0);
  assert.equal(m.resummarized, true);
  const text = textOf(main);
  assert.match(text, new RegExp(`its one-minute load was ${m.load1Start.toFixed(2)} when the run started and ${m.load1End.toFixed(2)} when it ended`));
  assert.ok(text.includes(m.host), 'the machine is named by its class');
  assert.ok(text.includes(`Python ${m.python}`) && text.includes(`WebSocket library ${m.websockets}`));
  for (const [field, value, want] of [['load1Start', 40, /load of 40; a run is made only below 40/], ['resummarized', false, /not given again/], ['endedAt', m.at, /ends before it starts/]]) {
    const r = clone(); r.measurement[field] = value;
    assert.ok(strangersProblems(r).some(p => want.test(p)), field);
  }
  const later = clone(); later.measurement.endedAt = '2099-01-01T00:00:00Z';
  assert.ok(strangersProblems(later).some(p => /after this build/.test(p)));
});

test('the isolation proof holds or the record is refused, and it ships as counts only', () => {
  const i = record.measurement.isolation;
  assert.ok(i.ownListenersDuring >= 1 && i.ownListenersLoopback === i.ownListenersDuring);
  assert.deepEqual([i.ownListenersBefore, i.ownListenersAfter, i.ownProcessesLeft], [0, 0, 0]);
  for (const [field, value] of [['ownListenersBefore', 1], ['ownListenersAfter', 1], ['ownProcessesLeft', 1], ['ownListenersLoopback', 0]]) {
    const r = clone(); r.measurement.isolation[field] = value;
    assert.ok(strangersProblems(r).some(p => /isolation/.test(p)), field);
  }
  // The vendor's reduction: own listeners are the run's process or its addresses, everyone else's changes are counted.
  const before = 'a 1 127.0.0.1:1111\nb 2 127.0.0.1:2222\n', during = 'Python 9 127.0.0.1:5555\nPython 9 127.0.0.1:5556\n', after = 'a 1 127.0.0.1:1111\nc 3 127.0.0.1:3333\n';
  assert.deepEqual(isolationOf({ before, during, after, left: 0 }), { ownListenersDuring: 2, ownListenersLoopback: 2, ownListenersBefore: 0, ownListenersAfter: 0, ownProcessesLeft: 0, listenersBefore: 2, listenersAfter: 2, keptByOthers: 1, changedByOthers: 2 });
  assert.equal(isolationOf({ before, during, after: `${after}Python 9 127.0.0.1:5555\n`, left: 0 }).ownListenersAfter, 1);
  assert.equal(isolationOf({ before, during: 'Python 9 0.0.0.0:5555\n', after, left: 0 }).ownListenersLoopback, 0);
  assert.doesNotMatch(raw, /127\.0\.0\.1|:\d{4,5}\b|Python \d+ /, 'no address, port or process in the record');
});

test('every abuse probe held at every step, and the quota held; one that did not is refused', () => {
  const m = record.measurement;
  assert.equal(m.probes.steps, m.ramp.length);
  for (const [k, v] of Object.entries(m.probes.held)) assert.equal(v, m.probes.steps, k);
  assert.ok(m.quota.held && m.quota.mostInTenMinutes <= m.quota.limit);
  const r = clone(); r.measurement.probes.held.flood -= 1;
  assert.ok(strangersProblems(r).some(p => /probes\/held\/flood/.test(p)));
  const q = clone(); q.measurement.quota.mostInTenMinutes = 4;
  assert.ok(strangersProblems(q).some(p => /quota/.test(p)));
});

test('the vendor reads the sheet\'s figures from its own sentences and its rows from the tool\'s summary', () => {
  const sheet = '| **Tick p95 under 50 ms** (x) | **150** (y) | z |\n| **Smooth** (x) | **100** | z |\n| **Breaks** (x) | **150** | z |\n| **Unusable** | **250** | z |\n| **Recommended public cap** | **keep 40** (the default), at most **80** on a dedicated core | z |\nabout **1-3 KiB/s per guest**.';
  assert.deepEqual(sheetFigures(sheet), { tick: 150, smooth: 100, breaks: 150, unusable: 250, cap: 40, dedicated: 80, low: 1, high: 3 });
  assert.throws(() => sheetFigures(sheet.replace('keep 40', 'keep about 40')), /recommended cap/);
  const e = record.estimate;
  assert.deepEqual([e.recommendedCap, e.dedicatedCoreCap, e.breaksAt, e.unusableAt, e.wireKiBPerGuest.low, e.wireKiBPerGuest.high], [40, 80, 150, 250, 1, 3]);
  const s = { guests: 10, window_s: 45, tick_ms: { n: 3, p95: 1.234 }, step_ms: { n: 2, p95: 2 }, crowd_ms: { n: 4, p95: 0.5 }, loop_lag_ms: { n: 3, p50: 1.26, p95: 3.04 }, states_per_s_per_guest: 1.99, rtt_ms: { move: { n: 9, p95: 2.06 } }, host_cpu_pct: { n: 5, mean: 5.55 }, host_cpu_ms_per_push: 2.356, host_rss_mb: { mean: 53.6 }, machine_cpu_pct: { mean: 61.16 }, guest_in_bytes_per_s: 15436 };
  assert.deepEqual(rowOf(s), { guests: 10, windowS: 45, ticks: 3, samples: { tick: 3, step: 2, crowd: 4, lag: 3, move: 9, cpu: 5 }, tickP95: 1.23, stepP95: 2, crowdP95: 0.5, lagP50: 1.3, lagP95: 3, pushesPerGuest: 1.99, moveP95: 2.1, hostCpu: 5.6, cpuPerPush: 2.36, rssMb: 54, machineCpu: 61.2, downPerGuest: 15436 });
});

test('the private commits are cited the way Lab 01 cites them, and the files by sha256', () => {
  const mc = record.vendored.mainCheck;
  for (const c of [record.vendored, ...record.vendored.cites]) assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
  assert.deepEqual(record.vendored.files.map(f => f.role), ['sheet', 'tool', 'perf', 'estimate-run', 'run']);
  const r = clone(); r.vendored.files[4].role = 'sheet';
  assert.ok(strangersProblems(r).some(p => /not exactly the five source files/.test(p)));
});

test('the record is pinned: a changed byte, or a pin of other bytes, refuses the build', () => {
  const sha = createHash('sha256').update(raw).digest('hex');
  assert.equal(readFileSync(join('site', STRANGERS_PIN), 'utf8'), `${sha}  record.json\n`);
  const root = join(temp, 'site');
  cpSync('site', root, { recursive: true });
  writeFileSync(join(root, STRANGERS_RECORD), raw.replace('"browsers": 0', '"browsers": 0 '));
  assert.throws(() => readStrangers(root), /does not pin the sha256/);
  writeFileSync(join(root, STRANGERS_RECORD), raw);
  writeFileSync(join(root, STRANGERS_PIN), `${'0'.repeat(64)}  record.json\n`);
  assert.throws(() => readStrangers(root), /does not pin the sha256/);
});

// Shapes that never belong on the page, the record or the tile: each class with a planted value the screen must catch.
test('the leak screen: nothing private on the page, the record or the tile, and a planted value of each class is caught', () => {
  const known = recordHashes(record);
  const v = record.vendored;
  const onMain = [v.commit, v.mainCheck.main, ...v.mainCheck.commits];
  assert.deepEqual(pageLeaks(page, known, { onMain }), []);
  for (const text of [raw, readFileSync(join('site', STRANGERS_TILE), 'utf8'), main]) {
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\b[A-Z]:\\|localhost|127\.0\.0\.1|odin-labs-ai\/(?!odin-rnd)|ghp_|sk-[A-Za-z0-9]/);
  }
  const plants = {
    'a machine path': '/Users/someone/run',
    'a windows path': 'C:\\Python313\\python.exe',
    'a local host, address or port': 'ws://127.0.0.1:59626',
    'another repository': 'odin-labs-ai/agent-space-private',
    'a credential': 'ghp_' + 'x'.repeat(36),
    'a hash the record does not hold': 'be1aa24f0c0ffee1',
    'a money figure': 'it cost $1,200 to run',
    'a private repository': `${SYN_REPO}`,
    'the client theme': `${SYN_THEME}`,
  };
  for (const [what, plant] of Object.entries(plants)) {
    const planted = page.replace('<p class="lab-source">The two are not the same experiment twice', `<p>${plant}</p><p class="lab-source">The two are not the same experiment twice`);
    assert.notEqual(planted, page, what);
    assert.ok(pageLeaks(planted, known, { onMain }).length > 0, `${what} is caught`);
  }
  // And through the record: a planted path in any string refuses it.
  const r = clone(); r.measurement.host = 'a Mac at /Users/someone';
  assert.ok(strangersProblems(r).some(p => /machine path/.test(p)));
  const port = clone(); port.estimate.machine = 'a PC on port :59626';
  assert.ok(strangersProblems(port).some(p => /port/.test(p)));
});

test('the page states its limits and does not claim a break point it did not find', () => {
  const text = textOf(main);
  assert.match(text, /Loopback only: no network between the guests and the space/);
  assert.match(text, /No browser drew the space in this run/);
  assert.match(text, /this run counted the bytes of the messages, not the compressed bytes on the wire/);
  const m = record.measurement;
  if (m.verdict.smooth === m.ramp.at(-1) && m.verdict.tickUnder50 === m.ramp.at(-1)) assert.match(text, /It did not break within the steps tried, so this run does not say where it would\./);
  else assert.doesNotMatch(text, /It did not break within the steps tried/);
  assert.doesNotMatch(text, /proves|guarantee|always holds/i);
});

test('review 1: an empty measured window, or a percentile with no samples behind it, earns nothing and is refused', () => {
  for (const [field, value] of [['windowS', 0], ['ticks', 0]]) {
    const r = clone(); const row = r.measurement.rows[0];
    row[field] = value; if (field === 'ticks') row.samples.tick = 0;
    assert.ok(strangersProblems(r).some(p => /the 10-guest step has an empty measured window/.test(p)), field);
  }
  for (const k of ['tick', 'step', 'crowd', 'lag', 'move', 'cpu']) {
    const r = clone(); r.measurement.rows.at(-1).samples[k] = 0;
    assert.ok(strangersProblems(r).some(p => /no samples behind it/.test(p)), k);
  }
  // A step with zero percentiles and no samples does not count towards either verdict.
  const rows = clone().measurement.rows;
  const last = rows.at(-1);
  Object.assign(last, { tickP95: 0, stepP95: 0, crowdP95: 0, lagP95: 0, pushesPerGuest: 2, samples: { ...last.samples, tick: 0, step: 0, crowd: 0, lag: 0 } });
  assert.notEqual(verdictOf(rows).smooth, last.guests);
  assert.notEqual(verdictOf(rows).tickUnder50, last.guests);
});

test('review 1: probe rounds are counted per step of the ramp, by that step\'s name; a missing or misnamed round counts for nothing', () => {
  const dir = join(temp, 'vendor');
  mkdirSync(join(dir, 'files'), { recursive: true });
  const step = { flood: { held: true }, oversized_line: { held: true }, forged_evidence: { held: true }, operator_ops: { held: true }, oversized_frame: { held: true } };
  const sheet = '| **Tick p95 under 50 ms** (x) | **150** (y) | z |\n| **Smooth** (x) | **100** | z |\n| **Breaks** (x) | **150** | z |\n| **Unusable** | **250** | z |\n| **Recommended public cap** | **keep 40** (d), at most **80** on a dedicated core | z |\nabout **1-3 KiB/s per guest**.';
  const summary = g => ({ guests: g, window_s: 40, tick_ms: { n: 9, p95: 1 }, step_ms: { n: 9, p95: 1 }, crowd_ms: { n: 9, p95: 1 }, loop_lag_ms: { n: 9, p50: 1, p95: 2 }, states_per_s_per_guest: 2, rtt_ms: { move: { n: 9, p95: 1 } }, host_cpu_pct: { n: 9, mean: 1 }, host_cpu_ms_per_push: 1, host_rss_mb: { mean: 50 }, machine_cpu_pct: { mean: 10 }, guest_in_bytes_per_s: 100 });
  const run = probes => ({ ramp: [10, 20], phase_s: 60, settle_s: 15, agents: 200, duty_pct: 25, browsers: 0, machine: { baseline: { machine_cpu_pct_mean: 10 } }, summary: [summary(10), summary(20)], verdict: { max_guests_tick_p95_under_50ms: 20, max_guests_smooth: 20 }, probes, quota: { checks: 1, most_in_10_min: 1, held: true } });
  writeFileSync(join(dir, 'files', 'sheet'), sheet);
  writeFileSync(join(dir, 'files', 'estimate-run'), JSON.stringify({ ...run({}), machine: { cpus: 12, baseline: { machine_cpu_pct_mean: 68 } } }));
  for (const f of ['tool', 'perf']) writeFileSync(join(dir, 'files', f), f);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ main: 'a'.repeat(40), committed: '2026-11-11T00:00:00Z', checked: '2026-11-12', cites: [{ commit: 'a'.repeat(40), what: 'x', at: '2026-11-11T00:00:00Z', check: { behind_by: 0 } }], run: { start: '2026-11-12T00:00:00Z', end: '2026-11-12T00:10:00Z', load1Start: 1, load1End: 1, exit: 0, left: 0, chip: 'Apple M5 Max', cores: 18, memGb: 128, os: '26.6.1', python: '3.12.13', websockets: '17.4' }, resummarized: true, code: { files: 1, digest: 'b'.repeat(64), compiled: 0, templatesFromCopy: true }, isolation: {} }));
  const probesOf = p => { writeFileSync(join(dir, 'files', 'run'), JSON.stringify(run(p))); return build(dir).measurement.probes; };
  assert.deepEqual(probesOf({ '10 guests': step, '20 guests': step }), { steps: 2, held: { flood: 2, oversized_line: 2, forged_evidence: 2, operator_ops: 2, oversized_frame: 2 } });
  // The 20-guest round is absent; two rounds under other names do not stand in for it.
  assert.equal(probesOf({ '10 guests': step, '30 guests': step, '40 guests': step }).steps, 1);
  // A round missing one probe counts for none of it.
  const { flood, ...noFlood } = step;
  assert.equal(probesOf({ '10 guests': step, '20 guests': noFlood }).steps, 1);
  assert.equal(probesOf({ '10 guests': step, '20 guests': { error: 'ConnectionRefused' } }).steps, 1);
});

test('review 1: the copy the run started from is checked against main file for file, by git blob hash', () => {
  const blob = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
  const files = { 'engine/a.py': 'print(1)\n', 'tools/scale/b.py': 'x = 2\n' };
  const ls = Object.entries(files).map(([p, t]) => `100644 blob ${blob(t)}\t${p}`).join('\n') + '\n160000 commit ' + 'c'.repeat(40) + '\ttools/sub\n';
  const pyc = 'engine/__pycache__/a.cpython-312.pyc';
  const check = (have, extra = [], compiled = new Set()) => treeCheck('/nowhere', ls, p => Buffer.from(have[p]), () => [...Object.keys(have), ...extra], compiled);
  const ok = check(files, [pyc], new Set([pyc]));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.files, 2);
  assert.equal(ok.compiled, 1);
  // Review 1 recheck: a bytecode file that is not its own source compiled again is refused, as Python would run it.
  assert.ok(check(files, [pyc]).problems.some(p => /a\.cpython-312\.pyc: not in main, and not its own source compiled again/.test(p)));
  assert.match(PYC_CHECK, /marshal\.dumps\(code\) == data\[16:\]/, 'compared with its source compiled again, after the header');
  assert.match(PYC_CHECK, /tree, good = sys\.argv\[1\]/, 'the tree reaches Python as an argument, never in the source');
  assert.match(ok.digest, /^[0-9a-f]{64}$/);
  assert.ok(check({ ...files, 'engine/a.py': 'print(2)\n' }).problems.some(p => /engine\/a\.py: not main's bytes/.test(p)), 'a modified engine file');
  assert.ok(check({ 'engine/a.py': files['engine/a.py'] }).problems.some(p => /tools\/scale\/b\.py: missing/.test(p)), 'a missing file');
  assert.ok(check(files, ['engine/evil.py']).problems.some(p => /engine\/evil\.py: not in main/.test(p)), 'an added file');
  assert.equal(record.measurement.code.matchesMain, true);
  assert.ok(main.includes(`all ${record.measurement.code.files.toLocaleString('en-GB')} files of that copy were checked against main`));
  const r = clone(); r.measurement.code.matchesMain = false;
  assert.ok(strangersProblems(r).length > 0);
  const b = clone(); b.measurement.code.templatesFromCopy = false;
  assert.ok(strangersProblems(b).some(p => /templatesFromCopy|do not name the checked copy/.test(p)), 'a run whose records do not name the copy');
  assert.ok(record.measurement.code.templatesFromCopy && record.measurement.code.compiledCaches > 0);
  assert.match(textOf(main), /each was checked to be exactly its own source compiled again\. The run's own records name this copy/);
  assert.match(textOf(main), /nothing here watched which code its processes executed/, 'the claim is no stronger than the check');
  // The binding itself, on real folders: the run's tenant root must name this copy's templates, by real path.
  const tree = join(temp, 'tree'), other = join(temp, 'other'), run = join(temp, 'run');
  for (const d of [join(tree, 'games/agent_space/templates'), join(other, 'games/agent_space/templates'), join(run, 'root')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(run, 'root/templates.dir'), `${join(tree, 'games/agent_space/templates')}\n`);
  assert.equal(templatesFromCopy(run, tree), true);
  assert.equal(templatesFromCopy(run, other), false, 'templates read from another tree');
  writeFileSync(join(run, 'root/templates.dir'), join(temp, 'nowhere'));
  assert.equal(templatesFromCopy(run, tree), false, 'a path that does not exist');
  assert.equal(templatesFromCopy(join(temp, 'no-run'), tree), false, 'no tenant root at all');
});

test('"What it is." opens the page as on Lab 01: plain words, then how it works, every count from the record, the sheet and the run in lanes of their own', () => {
  const about = main.match(/<section[^>]*id="about"[\s\S]*?<\/section>/)?.[0];
  assert.ok(about, 'the page has a What it is section');
  assert.ok(main.indexOf('</section>') < main.indexOf('id="about"') && main.indexOf('id="about"') < main.indexOf('id="side-by-side"'), 'right after the hero, before the side by side');
  assert.match(about, /<figure class="lab-flow">/);
  const e = record.estimate, m = record.measurement, text = textOf(about);
  const probes = Object.keys(m.probes.held);
  for (const s of [
    `public cap of ${e.recommendedCap} guests`, `Recommended public cap: ${e.recommendedCap} guests`, `smooth up to ${e.verdict.smooth} on that machine`,
    `stepping guests in from ${m.ramp[0]} to ${m.ramp.at(-1)}`, `${e.ramp.length} steps, ${e.ramp[0]} to ${e.ramp.at(-1)} guests`, `${m.ramp.length} steps, ${m.ramp[0]} to ${m.ramp.at(-1)} guests`,
    `Smooth up to ${m.verdict.smooth} guests`, `${m.crowdAgents} resident crowd agents`, `${probes.length} abuse probes`, `at each of the ${m.probes.steps} steps`,
    `more than ${m.quota.mostInTenMinutes} of Odin's checks in ten minutes, ${m.quota.mostInTenMinutes < m.quota.limit ? 'under' : 'at'} the limit of ${m.quota.limit}`,
  ]) assert.ok(text.includes(s), s);
  // Like for like in the plain words: the sheet's cap AND the sheet's own smooth point, then the run's smooth point.
  const prose = textOf(about.split('<figure')[0]);
  const reachOf = t => (t.verdict.smooth === t.ramp.at(-1) ? `${t.verdict.smooth} guests, the last step tried` : `${t.verdict.smooth} guests`);
  assert.ok(prose.includes(`The sheet recommends a public cap of ${e.recommendedCap} guests; on its own machine it stayed smooth up to ${reachOf(e)}. The fresh run on the Mac stayed smooth up to ${reachOf(m)}.`), 'the sheet\'s smooth point stands beside its cap in the prose');
  const next = m.rows.find(r => r.guests > m.verdict.smooth);
  if (next) assert.ok(text.includes(`at ${next.guests} it fell behind`));
  // Review 3: the verdict sentence in the prose, exactly, recomputed from the run's rows: smooth up to its smooth point, then the first step past it.
  const tail = 'The machines and the code differ, so read these as an estimate and a measurement, not as a before and after.';
  if (next) assert.ok(prose.includes(`The fresh run on the Mac stayed smooth up to ${reachOf(m)}. At ${next.guests} guests it fell behind. ${tail}`), 'the prose names the first step past the smooth point');
  // When nothing broke within the steps tried, the prose says so and names no break point.
  const heldRun = clone(); heldRun.measurement.verdict.smooth = heldRun.measurement.verdict.tickUnder50 = heldRun.measurement.ramp.at(-1);
  const heldProse = textOf(renderAbout(heldRun).split('<figure')[0]);
  assert.ok(heldProse.includes(`The fresh run on the Mac stayed smooth up to ${heldRun.measurement.ramp.at(-1)} guests, the last step tried. It did not break within the steps tried, so this run does not say where it would. ${tail}`), 'the held-all sentence');
  assert.doesNotMatch(heldProse, /fell behind/, 'no break point when none was found');
  // The sheet and the run are never mixed: nothing of the run in the sheet's lane, nothing of the sheet in the run's.
  const lanes = about.match(/<div class="lab-flow-lane[\s\S]*?<\/ol><\/div>/g).map(textOf);
  assert.equal(lanes.length, 3);
  // Review 3: how long each step was held, in each lane from its own record.
  assert.ok(lanes[0].includes(`${e.ramp.length} steps, ${e.ramp[0]} to ${e.ramp.at(-1)} guests ${e.phaseS} seconds a step`), 'the sheet\'s step length');
  assert.ok(lanes[1].includes(`${m.ramp.length} steps, ${m.ramp[0]} to ${m.ramp.at(-1)} guests ${m.phaseS} seconds a step, no browsers`), 'the run\'s step length');
  assert.equal(m.browsers, 0, 'no browsers is what the record says');
  assert.doesNotMatch(lanes[0], /\bMac\b|measurement|no browsers|\b300\b/, 'nothing of the fresh run in the sheet\'s lane');
  for (const l of lanes.slice(1)) assert.doesNotMatch(l, /estimate|Windows|recommended|cap/i, 'nothing of the sheet in the run\'s lanes');
  if (!(m.verdict.smooth === m.ramp.at(-1) && m.verdict.tickUnder50 === m.ramp.at(-1))) assert.doesNotMatch(text, /did not break/, 'no break point claimed it did not find, and none denied it did');
  assert.doesNotMatch(text, /measured cap|proves|guarantee/i);
});

test('review 2: the How it works tones follow the record and fail closed, and the quota is worded from the comparison', () => {
  const nodes = html => [...html.matchAll(/<li class="lab-flow-node lab-flow-(\w+)"><strong>([^<]*)<\/strong>(?:<span>([^<]*)<\/span>)?/g)].map(([, tone, title, body]) => ({ tone, title, body: body ?? '' }));
  const outcomeOf = r => nodes(renderAbout(r)).find(x => /^Smooth (up to|at none)/.test(x.title));
  const probesOf = r => nodes(renderAbout(r)).find(x => /held at every step$/.test(x.title));
  const m = record.measurement;
  // The record as published: the run fell behind past its smooth point, so its outcome is neutral, never good.
  const next = m.rows.find(r => r.guests > m.verdict.smooth);
  const live = outcomeOf(record);
  assert.equal(live.title, `Smooth up to ${m.verdict.smooth} guests`);
  if (next) { assert.equal(live.tone, 'neutral', 'fell behind: neutral'); assert.equal(live.body, `at ${next.guests} it fell behind`); }
  // Nothing broke within the steps tried: good.
  const held = clone(); held.measurement.verdict.smooth = held.measurement.verdict.tickUnder50 = held.measurement.ramp.at(-1);
  assert.equal(outcomeOf(held).tone, 'good');
  assert.equal(outcomeOf(held).body, 'it did not break within the steps tried');
  // Smooth at none of the steps: bad.
  const none = clone(); none.measurement.verdict.smooth = null;
  assert.equal(outcomeOf(none).tone, 'bad');
  assert.equal(outcomeOf(none).title, 'Smooth at none of the steps');
  // Probes: good only when every probe held at every step and the quota held.
  const probes = Object.keys(m.probes.held);
  assert.equal(probesOf(record).tone, 'good');
  assert.equal(probesOf(record).title, `All ${probes.length} held at every step`);
  const miss = clone(); miss.measurement.probes.held.flood -= 1;
  assert.equal(probesOf(miss).tone, 'bad');
  assert.equal(probesOf(miss).title, `${probes.length - 1} of ${probes.length} held at every step`);
  const quota = clone(); quota.measurement.quota.held = false;
  assert.equal(probesOf(quota).tone, 'bad');
  const unknown = clone(); delete unknown.measurement.quota.held;
  assert.equal(probesOf(unknown).tone, 'neutral', 'an unknown quota is never good');
  // The quota is worded from the comparison: under it, or at it, never "under" a limit it equals.
  const at = clone(); at.measurement.quota.mostInTenMinutes = at.measurement.quota.limit;
  assert.ok(probesOf(at).body.endsWith(`at the limit of ${m.quota.limit}`));
  assert.doesNotMatch(probesOf(at).body, /under the limit/);
  assert.ok(probesOf(record).body.endsWith(`${m.quota.mostInTenMinutes < m.quota.limit ? 'under' : 'at'} the limit of ${m.quota.limit}`));
  assert.ok(textOf(main).includes(`no guest got more than ${m.quota.mostInTenMinutes} in ten minutes, ${m.quota.mostInTenMinutes < m.quota.limit ? 'under' : 'at'} the limit of ${m.quota.limit}.`), 'the probes section words it the same way');
  // Diagram numbers are formatted as the prose formats them.
  const big = clone(); big.measurement.ramp = big.measurement.ramp.map(g => g * 10); big.measurement.verdict.smooth *= 10;
  assert.ok(nodes(renderAbout(big)).some(x => x.title === `Smooth up to ${(m.verdict.smooth * 10).toLocaleString('en-GB')} guests`), 'thousands separator in the diagram');
});
