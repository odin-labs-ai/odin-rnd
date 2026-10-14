// Motion that tells the story, and only when the reader scrolls. Elements animate once when scrolling brings them into
// view, and the four-step story follows the scroll. Whatever is in view when the page opens, or comes into view by any
// other means (a resize, a restored position, a jump link), takes its final state at once, with no transition.
// Without JavaScript, with reduced motion, or without IntersectionObserver, nothing is hidden and every element shows
// its final state (motion.css styles start states only under html.motion).

export function storyProgress(rect, viewportHeight) {
  // 0 when the story's top reaches 80% of the viewport, 1 when its bottom reaches 60%.
  const start = viewportHeight * 0.8, end = viewportHeight * 0.6;
  const travelled = start - rect.top, distance = rect.height + start - end;
  return Math.min(1, Math.max(0, distance > 0 ? travelled / distance : 1));
}

/** True while the reader is scrolling: set by a scroll event, cleared shortly after the last one. */
export function scrollTracker(win, quietMs = 250) {
  let until = 0;
  win.addEventListener('scroll', () => { until = Date.now() + quietMs; }, { passive: true });
  return () => Date.now() < until;
}

/** Applies `change` with every transition switched off, then restores transitions after the next paint. */
function instantly(change) {
  const body = document.body;
  body.classList.add('motion-instant');
  change();
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('motion-instant')));
}

function init() {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;
  const scrolling = scrollTracker(window);
  const revealed = [...document.querySelectorAll('[data-reveal], [data-mode]')];
  for (const list of document.querySelectorAll('.update-list, .offer-areas')) {
    [...list.children].forEach((child, index) => child.style.setProperty('--i', String(Math.min(index, 6))));
  }
  const inView = element => { const r = element.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
  const stories = [...document.querySelectorAll('[data-story]')].map(story => ({ story, steps: [...story.querySelectorAll('.story-step')] }));
  const updateStory = ({ story, steps }) => {
    const progress = storyProgress(story.getBoundingClientRect(), window.innerHeight);
    story.style.setProperty('--p', progress.toFixed(3));
    steps.forEach((step, index) => step.classList.toggle('is-active', progress >= index / steps.length + 0.02 || progress === 1));
  };

  // Opening state: start states apply only to what is out of view, and nothing visible moves.
  instantly(() => {
    document.documentElement.classList.add('motion');
    for (const element of revealed) if (inView(element)) element.classList.add('is-in');
    stories.forEach(updateStory);
  });

  const reveal = new IntersectionObserver(entries => {
    const shown = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
    if (!shown.length) return;
    const show = () => shown.forEach(element => { element.classList.add('is-in'); reveal.unobserve(element); });
    if (scrolling()) show(); else instantly(show);
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const element of revealed) if (!element.classList.contains('is-in')) reveal.observe(element);

  let frame = 0;
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; stories.forEach(updateStory); }); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => instantly(() => stories.forEach(updateStory)), { passive: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
