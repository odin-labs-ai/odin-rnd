import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asState, assertP2Disclosure, buildRecord, checkRecord, recordPath, render, validateRecord, wilsonUpper, TO_FREEZE } from './composable-prereg.mjs';
import { lint } from './composable-prereg-lint.mjs';

// EXP 009 bundle 4 WO-01: the pre-registration builder, its site page and the pre-refute lint. While the draft has
// open TO-FREEZE fields, the lint must FAIL (checks 2 and 3) and the record must refuse to freeze.

const tmp = mkdtempSync(join(tmpdir(), 'exp009-prereg-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

test('the committed record is exactly the build, and the build is stable', async () => {
  const { record } = await checkRecord();
  // The build is a draft; the committed record may be the frozen state of that same build (asState).
  const built = async () => render(validateRecord(asState(await buildRecord(), record.freeze.status)));
  const a = await built(), b = await built();
  assert.equal(a, b, 'two builds are byte-identical');
  assert.equal(readFileSync(recordPath, 'utf8'), a);
  assert.equal(record.corpus.n, 200);
});

test('the P1 numbers are the Wilson arithmetic', () => {
  assert.ok(wilsonUpper(0, 400) < 0.01 && wilsonUpper(0, 381) <= 0.01 && wilsonUpper(0, 380) > 0.01);
});

test('a draft with open fields cannot be frozen', async () => {
  const record = await buildRecord();
  if (record.freeze.toFreeze.length) assert.throws(() => asState(record, 'frozen'), /cannot be frozen/);
  for (const p of record.freeze.toFreeze) assert.ok(p.startsWith('schedule.') || p.startsWith('memoryWindow.') || p.startsWith('pendingFiles.'), `${p} is a practice value or a pending file`);
});

test('the lint fails exactly on the open placeholders and passes the rest', async () => {
  const results = Object.fromEntries((await lint()).map(r => [r.id.split(' ')[0], r]));
  const open = (await buildRecord()).freeze.toFreeze.length > 0;
  assert.equal(results['2'].ok, !open, results['2'].detail);
  for (const id of ['1', '4', '5']) assert.ok(results[id].ok, `${id}: ${results[id].detail}`);
});

test('lint check 1 refuses a counted attempt that opened before the not-before, over every attempt', async () => {
  const log = join(tmp, 'window.jsonl');
  const row = (label, ts) => JSON.stringify({ ts, event: 'open', label });
  writeFileSync(log, [row('exp009-counted-b01', '2026-10-10T12:00:00Z'), row('exp009-practice', '2026-10-01T00:00:00Z'), row('exp009-counted-b02', '2026-10-08T23:59:59Z')].join('\n'));
  const r1 = (await lint({ notBeforeAt: '2026-10-09T00:00:00Z', windowLog: log })).find(r => r.id.startsWith('1'));
  assert.equal(r1.ok, false);
  assert.match(r1.detail, /1 of 2 attempts/);
  const r2 = (await lint({ notBeforeAt: '2026-10-08T00:00:00Z', windowLog: log })).find(r => r.id.startsWith('1'));
  assert.equal(r2.ok, true, r2.detail);
});

test('TO-FREEZE is the only placeholder token in the record', () => {
  const text = readFileSync(recordPath, 'utf8');
  assert.ok(!/\b(TODO|TBD|XXX|FIXME)\b/.test(text));
  assert.ok(text.includes(TO_FREEZE));
});

test('the P2 disclosure is mandatory: missing, weakened or "prediction" wording is refused', async () => {
  const record = await buildRecord();
  assertP2Disclosure(record);
  const without = { ...record }; delete without.p2Disclosure;
  assert.throws(() => assertP2Disclosure(without), /computed before registration/);
  const predicted = { ...record, primary: { ...record.primary, P2: { ...record.primary.P2, claim: `${record.primary.P2.claim} We predict this.` } } };
  assert.throws(() => assertP2Disclosure(predicted), /never called a prediction/);
  const noLimit = { ...record, limits: record.limits.filter(l => !/computed once before registration/.test(l)) };
  assert.throws(() => assertP2Disclosure(noLimit), /limits carry/);
  const page = readFileSync('site/journal/composable-harness-pre-registration.html', 'utf8');
  assert.ok(page.includes('P2 was computed before registration'));
});
