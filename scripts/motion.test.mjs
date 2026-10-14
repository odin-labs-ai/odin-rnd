import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVEAL, inView } from '../site/assets/motion.mjs';

test('inView is true for any overlap with the viewport and false outside it', () => {
  assert.equal(inView({ top: 100, bottom: 300 }, 800), true);
  assert.equal(inView({ top: -200, bottom: 1 }, 800), true);
  assert.equal(inView({ top: 800, bottom: 900 }, 800), false);
  assert.equal(inView({ top: -300, bottom: 0 }, 800), false);
});

test('motion is one-shot reveals only: nothing listens to scroll, keys, pointers or resizes, and nothing replays', () => {
  const js = readFileSync('site/assets/motion.mjs', 'utf8');
  assert.doesNotMatch(js, /addEventListener\('(scroll|wheel|touch\w*|pointer\w*|keydown|resize|hashchange|click)'/, 'no input or scroll handling to misfire (refute pr39: same class, replaced not patched)');
  assert.doesNotMatch(js, /--p|classList\.toggle/, 'no scroll-linked progress');
  assert.deepEqual([...js.matchAll(/classList\.remove\('([^']+)'\)/g)].map(m => m[1]), ['motion-setup'], 'the only class ever removed is the one-time setup switch; is-in is never taken back');
  assert.match(js, /reveal\.unobserve\(entry\.target\)/, 'each element is revealed once');
  assert.match(js, /if \(inView\(element\.getBoundingClientRect\(\), window\.innerHeight\)\) element\.classList\.add\('is-in'\);\s*document\.body\.classList\.add\('motion-setup'\);\s*document\.documentElement\.classList\.add\('motion'\);/,
    'what is in view at load gets its final state before any start state applies');
  const css = readFileSync('site/assets/motion.css', 'utf8');
  assert.match(css, /\.motion body\.motion-setup \*[^{]*\{transition:none!important\}/, 'start states are applied without a transition');
  assert.equal(REVEAL, '[data-reveal], [data-mode], .story-step, .story-rail');
});

test('every start state and transition sits behind html.motion and a no-preference reduced-motion query', () => {
  const css = readFileSync('site/assets/motion.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media(prefers-reduced-motion:no-preference){');
  assert.ok(at > 0, 'the guarded block exists');
  const unguarded = css.slice(0, at), guarded = css.slice(at);
  assert.doesNotMatch(unguarded, /transition|animation/, 'outside the guard nothing moves');
  for (const rule of guarded.split('\n').filter(line => /^\s+\./.test(line))) assert.match(rule, /^\s+\.motion /, `guarded rule is scoped to html.motion: ${rule.trim().slice(0, 60)}`);
  assert.doesNotMatch(css, /infinite|animation|@keyframes|var\(--p\b/, 'no keyframes, no idle animation, no scroll-linked value');
  for (const [, seconds] of css.matchAll(/(?:transition|animation):[^;}]*?\s(\d*\.?\d+)s/g)) assert.ok(Number(seconds) <= 0.5, `duration ${seconds}s is at most 500 ms`);
});
