import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { storyProgress } from '../site/assets/motion.mjs';

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
  assert.doesNotMatch(css, /infinite/, 'no idle animation');
  for (const [, seconds] of css.matchAll(/(?:transition|animation):[^;}]*?\s(\d*\.?\d+)s/g)) assert.ok(Number(seconds) <= 0.5, `duration ${seconds}s is at most 500 ms`);
});
