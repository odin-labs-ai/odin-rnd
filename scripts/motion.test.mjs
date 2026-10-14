import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrollTracker, storyProgress } from '../site/assets/motion.mjs';

test('story progress runs from 0 to 1 as the section scrolls through the viewport and is clamped', () => {
  assert.equal(storyProgress({ top: 900, height: 600 }, 1000), 0);
  assert.equal(storyProgress({ top: -2000, height: 600 }, 1000), 1);
  const mid = storyProgress({ top: 400, height: 600 }, 1000);
  assert.ok(mid > 0 && mid < 1);
});

test('every start state and transition sits behind html.motion and a no-preference reduced-motion query', () => {
  const css = readFileSync('site/assets/motion.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media(prefers-reduced-motion:no-preference){');
  assert.ok(at > 0, 'the guarded block exists');
  const unguarded = css.slice(0, at), guarded = css.slice(at);
  assert.doesNotMatch(unguarded, /transition|animation/, 'outside the guard nothing moves');
  for (const rule of guarded.split('\n').filter(line => /^\s+\./.test(line))) assert.match(rule, /^\s+\.motion /, `guarded rule is scoped to html.motion: ${rule.trim().slice(0, 60)}`);
  assert.doesNotMatch(css, /infinite|animation|@keyframes/, 'no keyframe animation: a transition never replays when a class is removed');
  assert.match(guarded, /\.motion body\.motion-instant \*[^{]*\{transition:none!important\}/, 'state changes not caused by scrolling are instant');
  for (const [, seconds] of css.matchAll(/(?:transition|animation):[^;}]*?\s(\d*\.?\d+)s/g)) assert.ok(Number(seconds) <= 0.5, `duration ${seconds}s is at most 500 ms`);
});

test('only reader input opens the motion window; a bare scroll event never does (refute pr39 r1 #3, recheck)', () => {
  const listeners = {};
  let clock = 1000;
  const win = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const scrolling = scrollTracker(win, { inputMs: 700, momentumMs: 250, now: () => clock });
  assert.equal(scrolling(), false, 'nothing has happened when the page opens');
  listeners.scroll();
  assert.equal(scrolling(), false, 'a restored position, jump link or script scroll is not the reader');
  listeners.keydown({ key: 'a' });
  assert.equal(scrolling(), false, 'typing is not scrolling');
  listeners.wheel();
  assert.equal(scrolling(), true, 'a wheel turn is the reader');
  clock += 650; listeners.scroll(); clock += 200;
  assert.equal(scrolling(), true, 'momentum scroll inside the window keeps it open');
  clock += 300;
  assert.equal(scrolling(), false, 'the window closes once input and momentum stop');
  listeners.keydown({ key: 'PageDown' });
  assert.equal(scrolling(), true, 'a scroll key is the reader');
  clock += 2000; listeners.scroll();
  assert.equal(scrolling(), false, 'a later automatic scroll does not reopen it');
  for (const type of ['touchstart', 'touchmove', 'pointerdown']) assert.equal(typeof listeners[type], 'function', `${type} counts as reader input`);
});

test('motion.mjs reveals what is in view at load without a transition and gates observer reveals on scrolling', () => {
  const js = readFileSync('site/assets/motion.mjs', 'utf8');
  assert.match(js, /instantly\(\(\) => \{\s*document\.documentElement\.classList\.add\('motion'\);/, 'the motion class is set inside an instant change');
  assert.match(js, /if \(scrolling\(\)\) show\(\); else instantly\(show\);/);
  assert.match(js, /addEventListener\('resize', \(\) => instantly\(/, 'a resize never animates');
  assert.match(js, /if \(scrolling\(\)\) update\(\); else instantly\(update\);/, 'story steps follow an automatic scroll without a transition');
});
