// A finite demonstration of the evidence story, played as its diagrams enter view.
// The document is always the final, readable state. WAAPI temporarily draws over that
// state; cancellation, unsupported APIs, and reduced motion all reveal the same HTML.
export const REVEAL = '[data-reveal], [data-mode], .story-step, .story-rail, .section-heading, .proof-strip > li, .track-cards > li';

/** True when any part of `rect` is inside a viewport `height` pixels tall. */
export const inView = (rect, height) => rect.bottom > 0 && rect.top < height;

const ease = 'cubic-bezier(.16,1,.3,1)';
const draw = [{ transform:'scaleX(0)' }, { transform:'scaleX(1)' }];
const uncover = [{ opacity:.35, clipPath:'inset(0 8% 0 0)' }, { opacity:1, clipPath:'inset(0)' }];

export function setupMotion(document, environment = globalThis) {
  const reduced = environment.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = new Map();
  const played = new WeakSet();
  let observer;
  let stopped = false;

  const settle = target => {
    const targets = target ? [target] : [...active.keys()];
    for (const root of targets) {
      const animations = active.get(root);
      active.delete(root);
      animations?.forEach(animation => animation.cancel());
      if (played.has(root)) observer?.unobserve(root);
    }
  };
  const stop = () => {
    stopped = true;
    settle();
    observer?.disconnect();
  };
  const controller = { settle, stop };
  // No styles are applied until an animation can actually play.
  if (reduced?.matches || document.hidden || !environment.IntersectionObserver) return controller;

  const play = (root, element, frames, duration = 560, delay = 0) => {
    if (!element?.animate || stopped || reduced?.matches || document.hidden) return;
    let animation;
    try { animation = element.animate(frames, { duration, delay, easing:ease, fill:'backwards', iterations:1 }); }
    catch { return; } // Unsupported keyframe properties leave the readable default alone.
    if (!active.has(root)) active.set(root, new Set());
    active.get(root).add(animation);
    const complete = () => {
      const group = active.get(root);
      group?.delete(animation);
      if (group && !group.size) {
        active.delete(root);
        observer?.unobserve(root);
      }
    };
    animation.finished?.then(complete, complete);
  };
  const select = (root, selector, frames, duration, delay = 0) => {
    [...root.querySelectorAll(selector)].forEach((element, index) => play(root, element, frames, duration, delay + Math.min(index, 3) * 55));
  };
  const enter = root => {
    if (played.has(root)) return;
    played.add(root);
    if (root.matches('.story-step')) {
      // Each diagram explains a different action. The text beside it never moves.
      const lag = Math.min(Number(root.dataset.step) || 0, 3) * 55;
      select(root, '.sheet-line', draw, 580, lag);
      select(root, '.sheet-rule', uncover, 460, lag + 160);
      select(root, '.part-a', [{ transform:'translate(-65px,-50%)', opacity:.3 }, { transform:'translate(0,-50%)', opacity:1 }], 650, lag);
      select(root, '.part-b', [{ transform:'translate(65px,-50%)', opacity:.3 }, { transform:'translate(0,-50%)', opacity:1 }], 650, lag + 70);
      select(root, '.gate-post', [{ transform:'scaleY(0)' }, { transform:'scaleY(1)' }], 380, lag);
      select(root, '.chip-pass', [{ transform:'translateX(-85px)', opacity:.3 }, { transform:'translateX(0)', opacity:1 }], 650, lag + 100);
      select(root, '.chip-stop', [
        { transform:'translateX(45px)', opacity:.3 },
        { transform:'translateX(3px)', opacity:1, offset:.65 },
        { transform:'translateX(0)', opacity:1 }
      ], 520, lag + 150);
      select(root, '.record-line', draw, 420, lag);
      select(root, '.record-stamp', [
        { opacity:0, transform:'translateY(-18px) rotate(-12deg) scale(1.18)' },
        { opacity:1, transform:'translateY(0) rotate(-6deg) scale(1)' }
      ], 430, lag + 230);
    } else if (root.matches('.story-rail')) {
      const vertical = environment.matchMedia?.('(max-width: 560px)').matches;
      select(root, '.story-fill', [{ transform:vertical ? 'scaleY(0)' : 'scaleX(0)' }, { transform:vertical ? 'scaleY(1)' : 'scaleX(1)' }], 780);
    } else if (root.matches('[data-mode]')) {
      const open = root.dataset.mode === 'open';
      select(root, '.door-panel', [{ transform:open ? 'rotateY(0deg)' : 'rotateY(-68deg)' }, { transform:open ? 'rotateY(-68deg)' : 'rotateY(0deg)' }], 680);
      if (open) select(root, '.door-light', [{ opacity:0 }, { opacity:.9 }], 600, 80);
      else select(root, '.door-lock', [{ opacity:0, transform:'translateY(-12px)' }, { opacity:1, transform:'translateY(0)' }], 320, 360);
      select(root, '.door-items li', [{ opacity:.2, clipPath:'inset(0 100% 0 0)' }, { opacity:1, clipPath:'inset(0)' }], 460, 220);
    } else if (root.matches('.section-heading')) {
      // A short horizontal wipe echoes the drawing being read, without moving paragraphs.
      select(root, 'h2', uncover, 620);
    } else if (root.matches('.proof-strip > li')) {
      // The measured values stay literal and static; reveal their source line, never count them up.
      select(root, '.lab-source', uncover, 520);
    } else if (root.matches('.track-cards > li')) {
      select(root, '.track-go', [{ opacity:.35, transform:'translateX(-12px)' }, { opacity:1, transform:'translateX(0)' }], 560);
    } else {
      play(root, root, [{ opacity:.45 }, { opacity:1 }], 420);
    }
    if (!active.has(root)) observer?.unobserve(root);
  };

  const elements = [...document.querySelectorAll(REVEAL)];
  try {
    observer = new environment.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) { if (active.has(entry.target)) settle(entry.target); continue; }
        if (stopped || reduced?.matches || document.hidden) continue;
        enter(entry.target);
      }
    }, { rootMargin:'0px 0px -6% 0px', threshold:0 });
  } catch { return controller; }
  for (const element of elements) {
    // Never hide or reintroduce content at a restored position or an initial deep link.
    if (inView(element.getBoundingClientRect(), environment.innerHeight)) played.add(element);
    else observer.observe(element);
  }
  const onReduced = () => { if (reduced?.matches) stop(); };
  const onVisibility = () => {
    if (document.hidden) { settle(); return; }
    if (stopped || reduced?.matches) return;
    // A hidden delivery may have consumed the last threshold notification.
    // Reobserve unseen targets for a fresh initial notification, even if geometry is unchanged.
    for (const element of elements) if (!played.has(element)) {
      observer.unobserve(element);
      observer.observe(element);
    }
  };
  reduced?.addEventListener?.('change', onReduced);
  document.addEventListener('visibilitychange', onVisibility);
  // Keyboard navigation should never arrive halfway through a decorative reveal.
  document.addEventListener('focusin', event => {
    for (const root of active.keys()) if (root === event.target || root.contains?.(event.target)) settle(root);
  });
  return controller;
}

if (typeof document !== 'undefined') {
  const init = () => setupMotion(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
}
