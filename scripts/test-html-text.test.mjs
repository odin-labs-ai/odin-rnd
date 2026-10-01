import test from 'node:test';
import assert from 'node:assert/strict';
import { stripBlocks, stripTags, untilStable } from './test-html-text.mjs';

// The tests' page-text helper removes to a fixed point (CodeQL js/incomplete-multi-character-sanitization): nested and
// overlapping input leaves nothing tag-like behind, where a single regex pass would.
const tagLike = /<|>|script|style/i;

test('nested and overlapping script/style blocks leave no script or tag behind', () => {
  // A single pass of /<(script|style)[\s\S]*?<\/\1>/ over this leaves "<scr" + "x" … ; the fixed point does not.
  const nested = '<scr<script>ipt>x</script>alert(1)</script>after';
  assert.equal(nested.replace(/<(script|style)[\s\S]*?<\/\1>/g, ''), '<scralert(1)</script>after', 'what one pass leaves (the alert\'s case)');
  const out = stripTags(stripBlocks(nested, ['script', 'style'], ''), ' ');
  assert(!/[<>]/.test(out), out);
  assert.doesNotMatch(out, /<script/i);
  for (const input of ['<style>a{}</style><sty<style>x</style>le>b{}</style>', '<SCRIPT>x</SCRIPT >y', '<script\n type="m">x</script\n>z']) {
    const t = stripTags(stripBlocks(input, ['script', 'style'], ''), ' ');
    assert(!tagLike.test(t.replace(/\b(y|z|le)\b/g, '')), `${JSON.stringify(input)} -> ${JSON.stringify(t)}`);
  }
});

test('nested and overlapping tags, and a tag fragment that never closes, leave no "<" or ">"', () => {
  for (const input of ['<<b>p>', '<<<i>>>x', '<a href="x"><<b>i>text</b></a>', 'a < b and <unclosed', '<pre>keep?</pre><<pre>x</pre>pre>y</pre>']) {
    const t = stripTags(stripBlocks(input, ['pre'], ' '), ' ');
    assert(!/[<>]/.test(t), `${JSON.stringify(input)} -> ${JSON.stringify(t)}`);
  }
  assert.equal(stripTags('<p>one</p><p>two</p>', '\n'), '\none\n\ntwo\n', 'plain markup: the text, as one pass gives it');
  assert.equal(stripBlocks('<prefix>a</prefix><pre tabindex="0">b</pre>c', ['pre'], ' '), '<prefix>a</prefix> c', 'a block name matches whole');
});

test('untilStable stops at the fixed point', () => {
  assert.equal(untilStable('aaaa', /aa/g, 'a'), 'a');
  assert.equal(untilStable('none', /x/g, ''), 'none');
});
