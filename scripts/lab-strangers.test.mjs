import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStrangers, renderStrangers, strangersProblems, STRANGERS_PIN, STRANGERS_RECORD, STRANGERS_TEMPLATE, STRANGERS_TILE, verdictOf } from './lab-strangers.mjs';
import { isolationOf, rowOf, sheetFigures } from './vendor-strangers.mjs';
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
  const s = { guests: 10, window_s: 45, tick_ms: { n: 3, p95: 1.234 }, step_ms: { p95: 2 }, crowd_ms: { p95: 0.5 }, loop_lag_ms: { p50: 1.26, p95: 3.04 }, states_per_s_per_guest: 1.99, rtt_ms: { move: { p95: 2.06 } }, host_cpu_pct: { mean: 5.55 }, host_cpu_ms_per_push: 2.356, host_rss_mb: { mean: 53.6 }, machine_cpu_pct: { mean: 61.16 }, guest_in_bytes_per_s: 15436 };
  assert.deepEqual(rowOf(s), { guests: 10, windowS: 45, ticks: 3, tickP95: 1.23, stepP95: 2, crowdP95: 0.5, lagP50: 1.3, lagP95: 3, pushesPerGuest: 1.99, moveP95: 2.1, hostCpu: 5.6, cpuPerPush: 2.36, rssMb: 54, machineCpu: 61.2, downPerGuest: 15436 });
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
