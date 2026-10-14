// Motion that tells the story, in its simplest robust form: each marked element plays a one-shot entrance (a CSS
// transition of at most 500 ms) the first time it enters the viewport, and never again. Nothing is tied to the scroll
// position, so a jump link, a restored position or a resize cannot replay or scrub anything. Whatever is already in
// view when the page opens starts in its final state. Without JavaScript, with reduced motion, or without
// IntersectionObserver, nothing is hidden and every element shows its final state (motion.css styles start states only
// under html.motion).

export const REVEAL = '[data-reveal], [data-mode], .story-step, .story-rail';

/** True when any part of `rect` is inside a viewport `height` pixels tall. */
export const inView = (rect, height) => rect.bottom > 0 && rect.top < height;

function init() {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;
  const elements = [...document.querySelectorAll(REVEAL)];
  for (const list of document.querySelectorAll('.update-list, .offer-areas, .story-steps')) {
    [...list.children].forEach((child, index) => child.style.setProperty('--i', String(Math.min(index, 6))));
  }
  // Final state first for what the reader already sees, then the start states for the rest, applied with transitions
  // switched off (motion-setup) so nothing plays on the way into its start state.
  for (const element of elements) if (inView(element.getBoundingClientRect(), window.innerHeight)) element.classList.add('is-in');
  document.body.classList.add('motion-setup');
  document.documentElement.classList.add('motion');
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('motion-setup')));
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const element of elements) if (!element.classList.contains('is-in')) reveal.observe(element);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
