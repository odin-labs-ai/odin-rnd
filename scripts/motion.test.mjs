import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVEAL, inView, setupMotion } from '../site/assets/motion.mjs';

class Element {
  constructor(selectors = [], { top = 1000, bottom = 1200, dataset = {}, animate = true } = {}) {
    this.selectors = new Set(selectors);
    this.rect = { top, bottom };
    this.dataset = dataset;
    this.children = new Map();
    this.animations = [];
    if (!animate) this.animate = undefined;
  }
  matches(selector) { return this.selectors.has(selector); }
  querySelectorAll(selector) { return this.children.get(selector) ?? []; }
  getBoundingClientRect() { return this.rect; }
  contains(child) { return [...this.children.values()].some(elements => elements.includes(child)); }
  add(selector, count = 1) {
    const elements = Array.from({ length:count }, () => new Element());
    this.children.set(selector, elements);
    return elements;
  }
  animate(frames, options) {
    let finish, reject;
    const animation = {
      frames, options, canceled:false,
      finished:new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish() { finish(); },
      cancel() { this.canceled = true; reject(new Error('canceled')); }
    };
    this.animations.push(animation);
    return animation;
  }
}
const root = (kind, children = [], options) => {
  const element = new Element([kind], options);
  for (const [selector, count] of children) element.add(selector, count);
  return element;
};
function fixture(elements, { reduced = false, hidden = false, observer = true, viewport = 800, vertical = false } = {}) {
  const events = new Map(), preferenceEvents = new Map();
  const media = { matches:reduced, addEventListener:(name, fn) => preferenceEvents.set(name, fn) };
  const observations = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = new Set(); observations.push(this); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    enter(element) { this.callback([{ target:element, isIntersecting:true }]); }
    leave(element) { this.callback([{ target:element, isIntersecting:false }]); }
  }
  const document = {
    hidden,
    querySelectorAll:selector => selector === REVEAL ? elements : [],
    addEventListener:(name, fn) => events.set(name, fn)
  };
  const environment = {
    innerHeight:viewport,
    matchMedia:query => query.includes('reduced-motion') ? media : { matches:vertical },
    ...(observer ? { IntersectionObserver:Observer } : {})
  };
  const controller = setupMotion(document, environment);
  return { document, environment, controller, observations, media, events, preferenceEvents };
}
const animations = element => [
  ...element.animations,
  ...[...element.children.values()].flatMap(children => children.flatMap(animations))
];

test('inView distinguishes viewport overlap from its exact outside edges', () => {
  assert.equal(inView({ top:100, bottom:300 }, 800), true);
  assert.equal(inView({ top:-200, bottom:1 }, 800), true);
  assert.equal(inView({ top:800, bottom:900 }, 800), false);
  assert.equal(inView({ top:-300, bottom:0 }, 800), false);
});

test('initial viewport and restored/deep-linked content never flashes through a start state', () => {
  const visible = root('.section-heading', [['h2', 1]], { top:30, bottom:250 });
  const partlyVisible = root('[data-reveal]', [], { top:-50, bottom:1 });
  const f = fixture([visible, partlyVisible]);
  assert.equal(f.observations[0].observed.size, 0);
  f.observations[0].enter(visible);
  f.observations[0].enter(partlyVisible);
  assert.equal(animations(visible).length + animations(partlyVisible).length, 0);
});

test('newly encountered diagrams play once, finish to the static state and never replay', async () => {
  const step = root('.story-step', [['.sheet-line', 2], ['.sheet-rule', 1]], { dataset:{ step:'0' } });
  const f = fixture([step]);
  const observer = f.observations[0];
  observer.enter(step);
  const first = animations(step);
  assert.equal(first.length, 3);
  for (const animation of first) {
    assert.equal(animation.options.iterations, 1);
    assert.equal(animation.options.fill, 'backwards', 'staggered starts hold during their delay, then release to static HTML at completion');
    assert.ok(animation.options.duration + animation.options.delay <= 1200);
    animation.finish();
  }
  await Promise.resolve();
  assert.equal(observer.observed.size, 0, 'finished targets stop being observed');
  observer.leave(step); observer.enter(step); observer.enter(step);
  assert.equal(animations(step).length, first.length);
});

test('the four story mechanisms have distinct rule, workcell, gate and record choreography', () => {
  const steps = [
    root('.story-step', [['.sheet-line', 2], ['.sheet-rule', 1]], { dataset:{ step:'0' } }),
    root('.story-step', [['.part-a', 1], ['.part-b', 1]], { dataset:{ step:'1' } }),
    root('.story-step', [['.gate-post', 1], ['.chip-pass', 1], ['.chip-stop', 1]], { dataset:{ step:'2' } }),
    root('.story-step', [['.record-line', 3], ['.record-stamp', 1]], { dataset:{ step:'3' } })
  ];
  const f = fixture(steps);
  steps.forEach(step => f.observations[0].enter(step));
  assert.equal(animations(steps[0])[0].frames[0].transform, 'scaleX(0)');
  assert.match(animations(steps[1])[0].frames[0].transform, /-65px/);
  assert.equal(animations(steps[2])[0].frames[0].transform, 'scaleY(0)');
  assert.match(animations(steps[3]).at(-1).frames[0].transform, /rotate\(-12deg\)/);
  for (const animation of steps.flatMap(animations)) {
    assert.equal(animation.options.iterations, 1);
    assert.ok(animation.options.duration + animation.options.delay <= 1200);
  }
  f.controller.stop();
});

test('mobile story rail uses the vertical axis without scroll or resize replay', () => {
  const rail = root('.story-rail', [['.story-fill', 1]]);
  const f = fixture([rail], { vertical:true });
  f.observations[0].enter(rail);
  assert.equal(animations(rail)[0].frames[0].transform, 'scaleY(0)');
  assert.equal(f.events.has('resize'), false);
  assert.equal(f.events.has('scroll'), false);
  f.controller.stop();
});

test('open and private work show different door outcomes; records never count up', () => {
  const open = root('[data-mode]', [['.door-panel', 1], ['.door-light', 1], ['.door-items li', 3]], { dataset:{ mode:'open' } });
  const closed = root('[data-mode]', [['.door-panel', 1], ['.door-lock', 1], ['.door-items li', 3]], { dataset:{ mode:'closed' } });
  const proof = root('.proof-strip > li', [['.lab-source', 1]]);
  const number = new Element();
  Object.defineProperty(number, 'textContent', { get:() => '29', set:() => assert.fail('A measured number must never be rewritten for animation') });
  proof.children.set('.lab-num', [number]);
  const f = fixture([open, closed, proof]);
  [open, closed, proof].forEach(element => f.observations[0].enter(element));
  assert.equal(animations(open)[0].frames.at(-1).transform, 'rotateY(-68deg)');
  assert.equal(animations(closed)[0].frames.at(-1).transform, 'rotateY(0deg)');
  assert.equal(number.animations.length, 0);
  assert.equal(number.textContent, '29');
  assert.equal(animations(proof).length, 1, 'only the source line reveals');
  f.controller.stop();
});

test('missing animation APIs, IntersectionObserver or reduced motion leave static content alone', () => {
  const item = root('[data-reveal]'); item.animate = undefined;
  const f = fixture([item]);
  f.observations[0].enter(item);
  assert.equal(f.observations[0].observed.size, 0);
  assert.equal(animations(item).length, 0);
  for (const options of [{ reduced:true }, { observer:false }, { hidden:true }]) {
    const content = root('[data-reveal]');
    const other = fixture([content], options);
    assert.equal(animations(content).length, 0);
    assert.equal(other.observations.length, 0);
  }
  // CSS never defines a JavaScript-dependent hidden state.
  const css = readFileSync('site/assets/motion.css', 'utf8');
  assert.doesNotMatch(css, /\.motion|:not\(\.is-in\)|motion-setup/);
  assert.doesNotMatch(css, /animation[^;}]*infinite/);
});

test('turning on reduced motion cancels every in-flight reveal and retires future motion', () => {
  const first = root('[data-reveal]'), later = root('[data-reveal]');
  const f = fixture([first, later]);
  const observer = f.observations[0];
  observer.enter(first);
  assert.equal(first.animations.length, 1);
  f.media.matches = true;
  f.preferenceEvents.get('change')();
  assert(first.animations.every(animation => animation.canceled));
  assert.equal(observer.disconnected, true);
  observer.enter(later);
  assert.equal(later.animations.length, 0);
  f.media.matches = false; f.preferenceEvents.get('change')();
  observer.enter(later);
  assert.equal(later.animations.length, 0, 'toggling preferences cannot replay an entrance');
});

test('a hidden tab settles played motion but preserves the first entrance of unseen diagrams after return', async () => {
  const step = root('.story-step', [['.record-line', 3], ['.record-stamp', 1]]);
  const later = root('.story-step', [['.sheet-line', 2], ['.sheet-rule', 1]]);
  const f = fixture([step, later]);
  const observer = f.observations[0];
  observer.enter(step);
  const first = animations(step);
  f.document.hidden = true; f.events.get('visibilitychange')();
  assert(first.length > 0 && first.every(animation => animation.canceled));
  assert.equal(observer.observed.has(step), false, 'the settled entrance remains played');
  assert.equal(observer.observed.has(later), true, 'an unseen diagram remains eligible for its first entrance');
  assert.notEqual(observer.disconnected, true);
  observer.enter(later);
  assert.equal(animations(later).length, 0, 'observer delivery while hidden must not consume the entrance');
  f.document.hidden = false; f.events.get('visibilitychange')();
  observer.enter(step);
  assert.equal(animations(step).length, first.length);
  observer.enter(later);
  const entrance = animations(later);
  assert.equal(entrance.length, 3);
  for (const animation of entrance) {
    assert.equal(animation.options.iterations, 1);
    animation.finish();
  }
  await Promise.resolve();
  assert.equal(observer.observed.has(later), false);
  f.document.hidden = true; f.events.get('visibilitychange')();
  f.document.hidden = false; f.events.get('visibilitychange')();
  observer.enter(step); observer.enter(later);
  assert.equal(animations(step).length, first.length);
  assert.equal(animations(later).length, entrance.length, 'returning to the tab never replays a completed entrance');
});

test('leaving the viewport or focusing an animated record cancels only that finite sequence', () => {
  const offscreen = root('[data-reveal]'), focused = root('.track-cards > li', [['.track-go', 1]]);
  const f = fixture([offscreen, focused]);
  const observer = f.observations[0];
  observer.enter(offscreen); observer.enter(focused);
  observer.leave(offscreen);
  assert(offscreen.animations[0].canceled);
  assert(!animations(focused)[0].canceled);
  f.events.get('focusin')({ target:focused.children.get('.track-go')[0] });
  assert(animations(focused)[0].canceled);
  observer.enter(offscreen); observer.enter(focused);
  assert.equal(offscreen.animations.length, 1);
  assert.equal(animations(focused).length, 1);
});

test('an animation property unsupported by the browser fails open to readable content', () => {
  const item = root('[data-reveal]');
  item.animate = () => { throw new Error('Unsupported effect'); };
  const f = fixture([item]);
  assert.doesNotThrow(() => f.observations[0].enter(item));
  assert.equal(f.observations[0].observed.size, 0);
});
