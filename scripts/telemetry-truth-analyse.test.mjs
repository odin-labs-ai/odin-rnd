import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { acrossDays, analyse, brokerVerdict, counted, median } from '../experiments/telemetry-truth/analyse.mjs';

const prereg = JSON.parse(readFileSync('experiments/telemetry-truth/preregistration.json', 'utf8'));
const rule = prereg.decision.rule;
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('EXP 015 is frozen: the record matches its pin and pins the analysis script it ships with', () => {
  assert.equal(readFileSync('experiments/telemetry-truth/preregistration.sha256', 'utf8').trim().split(/\s+/)[0], sha('experiments/telemetry-truth/preregistration.json'));
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script));
  assert.equal(prereg.experiment.id, 'EXP 015');
  assert.equal(Date.parse(prereg.window.to) - Date.parse(prereg.window.from), 7 * 86400e3, 'seven whole UTC days');
});

test('median and the across-days interval', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  const { mean, ci95 } = acrossDays([0.1, 0.1, 0.1]);
  assert.ok(Math.abs(mean - 0.1) < 1e-12);
  assert.deepEqual(ci95.map(x => Math.round(x * 1e9) / 1e9), [0.1, 0.1]);
  assert.equal(acrossDays([0.2]).ci95, null, 'one day gives no interval');
});

test('the pre-registered verdicts', () => {
  assert.equal(brokerVerdict(49, 0, [0, 0], rule), 'not enough calls');
  assert.equal(brokerVerdict(50, 0.01, [-0.01, 0.03], rule), 'estimate holds');
  assert.equal(brokerVerdict(50, 0.1, [0.099, 0.101], rule), 'estimate off by a stable factor');
  assert.equal(brokerVerdict(50, 0.04, [-0.02, 0.08], rule), 'estimate unreliable');
  assert.equal(brokerVerdict(50, 0.0, null, rule), 'estimate unreliable', 'no interval (one day) never holds');
});

test('a counted call is inside the window, ok, and carries both costs; failures are counted, never imputed', () => {
  const from = Date.parse(prereg.window.from), to = Date.parse(prereg.window.to);
  const base = { ts: '2026-10-29T03:41:00Z', ok: true, actualCostUsd: 0.00004, estimatedCostUsd: 0.00004 };
  assert.ok(counted(base, from, to));
  assert.ok(!counted({ ...base, ts: '2026-11-04T00:00:00Z' }, from, to), 'the window is half-open');
  assert.ok(!counted({ ...base, ok: false }, from, to));
  assert.ok(!counted({ ...base, actualCostUsd: null }, from, to));
  assert.ok(!counted({ _header: true, ...base }, from, to));
});

test('end to end on synthetic rows: a +10% broker is a stable factor, an exact one holds, a sparse one has too few calls', () => {
  const rows = [];
  for (let d = 28; d < 35; d++) for (let h = 0; h < 24; h += 3) for (const m of ['a', 'b']) {
    const day = d <= 31 ? `2026-10-${d}` : `2026-11-0${d - 31}`;
    const ts = `${day}T${String(h).padStart(2, '0')}:41:00Z`;
    rows.push({ ts, broker: 'openrouter', ok: true, usageCostPresent: true, actualCostUsd: 0.00004, usageCostUsd: 0.00004, generationCostUsd: 0.00004, estimatedCostUsd: 0.00004, servedModel: m });
    rows.push({ ts, broker: 'eurouter', ok: true, usageCostPresent: true, actualCostUsd: 0.000044, estimatedCostUsd: 0.00004, servedModel: m });
    if (d === 28) rows.push({ ts, broker: 'requesty', ok: true, usageCostPresent: true, actualCostUsd: 0.00004, estimatedCostUsd: 0.00004, servedModel: m });
  }
  rows.push({ ts: '2026-10-29T00:00:00Z', broker: 'requesty', ok: false, httpStatus: 400 });
  const r = analyse(rows, { rowsInWindow: 100, rowsZeroEstimate: 96, rowsJoined: 0, estimatedToBilledRatio: 0.013, daysCovered: 7 }, prereg);
  assert.equal(r.perBroker.openrouter.n, 112);
  assert.equal(r.perBroker.openrouter.verdict, 'estimate holds');
  assert.equal(r.perBroker.eurouter.verdict, 'estimate off by a stable factor');
  assert.equal(r.perBroker.eurouter.factor, 1.1);
  assert.equal(r.perBroker.requesty.verdict, 'not enough calls');
  assert.equal(r.perBroker.requesty.callsFailed, 1);
  assert.deepEqual(r.openrouterInBandVsGenerationRecord, { n: 112, agreeWithin1Pct: 112 });
  assert.equal(r.fleet.verdict, 'fleet estimates do not support a savings claim');
  assert.equal(analyse(rows, null, prereg).fleet.verdict, 'not measurable');
});
