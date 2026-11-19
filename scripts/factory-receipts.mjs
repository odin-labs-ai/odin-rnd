import assert from 'node:assert/strict';
import { parseEvidence } from '../demos/test-witness/run.mjs';
import { escapeHtml } from './site-chrome.mjs';
import { validateReport } from './witness-records.mjs';

const suites = [
  { key: 'ordinary', suite: 'weak', label: 'Ordinary case' },
  { key: 'boundary', suite: 'strong', label: 'Boundary checks' },
  { key: 'always', suite: 'always-pass', label: 'Always pass' },
];

function readSuite(report, config) {
  const id = `rounding-${config.suite}`;
  const observation = report.observations.find(row => row.id === id);
  const command = report.commands.find(row => row.id === observation.commandIds.at(-1));
  assert.equal(observation.caseId, 'rounding');
  assert.equal(command.executable, 'java');
  assert.deepEqual(command.args.slice(-3), ['Witness', 'rounding', config.suite]);
  const ids = config.key === 'ordinary' ? ['ordinary'] : ['ordinary', 'rounding', 'below-threshold', 'threshold', 'validation'];
  const { valid, complete, markers, failures } = parseEvidence(command, ids);
  assert(valid && complete, `Invalid recorded assertions for ${id}`);
  assert.deepEqual(failures, config.key === 'boundary' ? ['rounding'] : []);
  const assertions = markers.map(([, id, status, actual, expected]) => ({ id, status, actual, expected }));
  assert.deepEqual(observation.actual, { assertionCount: assertions.length, assertions, exitCode: command.exitCode });
  return { ...config, observation, assertions, failures };
}

/** Server-rendered from the same Test Witness observations linked on the full study. */
export function renderFactoryReceipts(report) {
  validateReport(report);
  assert.equal(report.project, 'test-witness');
  const rows = suites.map(suite => readSuite(report, suite));
  const boundary = rows.find(row => row.key === 'boundary');
  const rounding = boundary.assertions.find(a => a.id === 'rounding');
  const date = new Date(report.completedAt).toISOString().slice(0, 10);
  const receipt = row => `<p class="factory-receipt-links"><a href="projects/test-witness/#observation-${row.observation.id}">Recorded test</a> <a href="data/witnesses/test-witness.json">Raw data</a> <time datetime="${date}">${date}</time></p>`;
  const description = {
    ordinary: 'This suite checked an ordinary total. It skipped the rounding case.',
    boundary: 'This suite checked the rounding boundary and caught the defect.',
    always: 'This control returned the expected answers without calling the invoice code.',
  };

  const buttons = rows.map((row, i) =>
    `<button type="button" data-studio-suite="${row.key}" aria-pressed="${i === 0}">${row.label}</button>`).join('');
  const tests = rows.map((row, i) => {
    const count = row.assertions.length;
    const passed = count - row.failures.length;
    return `<div data-studio-observation="${row.key}"${i ? ' hidden' : ''}><p class="factory-reading"><strong>${passed} of ${count} checks passed.</strong> ${description[row.key]}</p>${receipt(row)}</div>`;
  }).join('');
  const decisions = rows.map((row, i) =>
    `<div data-studio-decision="${row.key}"${i ? ' hidden' : ''}><p class="factory-reading"><strong>Test evidence ${escapeHtml(row.observation.verdict)}.</strong> ${row.label}. ${description[row.key]}</p>${receipt(row)}</div>`).join('');

  return `<div class="factory-receipts">
    <article class="factory-receipt" data-studio-result="invoice"><h3 class="factory-receipt-title">Invoice total</h3>
      <dl class="factory-readouts">
        <div><dt>Returned</dt> <dd>${escapeHtml(rounding.actual)}</dd></div>
        <div><dt>Expected</dt> <dd>${escapeHtml(rounding.expected)}</dd></div>
      </dl>${receipt(boundary)}</article>
    <article class="factory-receipt" data-studio-result="test" hidden><h3 class="factory-receipt-title">Which test catches it?</h3>
      <div class="factory-suite-options" role="group" aria-label="Recorded test suites">${buttons}</div>${tests}</article>
    <article class="factory-receipt" data-studio-result="gate" hidden><h3 class="factory-receipt-title">Can we trust the test?</h3>${decisions}</article>
    <p class="sr-only" role="status" aria-live="polite" data-studio-status></p>
  </div>`;
}
