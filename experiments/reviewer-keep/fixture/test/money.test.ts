import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCents, formatCents, sum } from '../src/money.ts';

test('amounts are formatted with two decimals', () => {
  assert.equal(formatCents(123456, 'EUR'), 'EUR 1234.56');
  assert.equal(formatCents(5, 'EUR'), 'EUR 0.05');
});

test('only non-negative safe integers are amounts', () => {
  assert.equal(assertCents(0), 0);
  assert.throws(() => assertCents(-1));
  assert.throws(() => assertCents(1.5));
});

test('sum adds amounts', () => {
  assert.equal(sum([100, 250, 5]), 355);
  assert.equal(sum([]), 0);
});
