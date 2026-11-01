import test from 'node:test';
import assert from 'node:assert/strict';
import { corrections, clarifyPublication } from './publication-corrections.mjs';
test('dated clarifications preserve the entire historical article', () => {
  const original = '<html><main><article class="article-body"><h1>Original result</h1><p>Original wording and limitations.</p></article></main></html>';
  for (const [page, note] of Object.entries(corrections)) {
    const rendered = clarifyPublication(original, page);
    assert.equal(rendered.replace('\n'+note+'\n', ''), original);
    assert.match(note, /datetime="2026-11-01"/);
    assert.match(note, /methods\/#publication-standard/);
  }
  assert.equal(clarifyPublication(original, 'unrelated.html'), original);
  assert.throws(() => clarifyPublication('<p>No article</p>', Object.keys(corrections)[0]), /unique article/);
});
