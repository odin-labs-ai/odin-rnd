import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFlow } from './lab-flow.mjs';

const flow = extra => renderFlow({
  caption: 'How it works',
  source: [{ title: 'In', body: 'what goes in' }],
  lanes: [{ label: 'Run one', tone: 'bad', nodes: [{ title: 'A' }, { title: 'B', body: 'out', tone: 'bad' }] }],
  ...extra,
});

test('a diagram is a figure of real text: caption, source row, one lane per run, boxes in order', () => {
  const html = flow();
  assert.match(html, /^<figure class="lab-flow"><figcaption class="technical">How it works<\/figcaption>/);
  assert.match(html, /<ol class="lab-flow-row lab-flow-source" aria-label="What goes in"><li class="lab-flow-node lab-flow-neutral"><strong>In<\/strong><span>what goes in<\/span><\/li><\/ol>/);
  assert.match(html, /<div class="lab-flow-lane lab-flow-lane-bad"><p class="lab-flow-label">Run one<\/p><ol class="lab-flow-row"><li[^>]*><strong>A<\/strong><\/li><li class="lab-flow-node lab-flow-bad"><strong>B<\/strong><span>out<\/span><\/li><\/ol><\/div>/);
  assert.doesNotMatch(html, /<svg|<img/, 'no picture: the words stay text');
});

test('everything passed is escaped, never markup', () => {
  const html = flow({ caption: '<script>x</script>', lanes: [{ label: 'a & b', nodes: [{ title: '"q"', body: '<b>' }] }] });
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; b') && html.includes('&quot;q&quot;') && html.includes('&lt;b&gt;'));
  assert.ok(!html.includes('<script') && !html.includes('<b>'), 'no passed markup survives');
});

test('a diagram with no caption, no lane, an empty lane, an untitled box or an unknown tone is refused', () => {
  assert.throws(() => flow({ caption: '' }), /needs a caption/);
  assert.throws(() => flow({ lanes: [] }), /at least one lane/);
  assert.throws(() => flow({ lanes: [{ label: 'x', nodes: [] }] }), /a label and boxes/);
  assert.throws(() => flow({ lanes: [{ label: 'x', nodes: [{ body: 'no title' }] }] }), /needs a title/);
  assert.throws(() => flow({ lanes: [{ label: 'x', tone: 'red', nodes: [{ title: 't' }] }] }), /no tone red/);
});
