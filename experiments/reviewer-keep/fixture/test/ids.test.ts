import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newId, parseId } from '../src/ids.ts';

test('a new id has the prefix and twelve base-36 characters', () => {
  const id = newId('ord', () => 0.5);
  assert.equal(id, 'ord_iiiiiiiiiiii');
  assert.equal(parseId('ord', id), id);
});

test('an id with the wrong prefix or length is refused', () => {
  assert.throws(() => parseId('ord', 'cus_iiiiiiiiiiii'));
  assert.throws(() => parseId('ord', 'ord_iii'));
  assert.throws(() => parseId('ord', 'ord_IIIIIIIIIIII'));
});
