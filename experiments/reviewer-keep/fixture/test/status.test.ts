import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMove, isFinal } from '../src/status.ts';

test('a draft can be paid or cancelled, not shipped', () => {
  assert.equal(canMove('draft', 'paid'), true);
  assert.equal(canMove('draft', 'cancelled'), true);
  assert.equal(canMove('draft', 'shipped'), false);
});

test('shipped and cancelled are final', () => {
  assert.equal(isFinal('shipped'), true);
  assert.equal(isFinal('cancelled'), true);
  assert.equal(isFinal('paid'), false);
});
