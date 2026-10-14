// Motion that tells the story: nothing moves on its own. Elements animate once when they scroll into view, and the
// four-step story follows the reader's scroll. Without JavaScript, with reduced motion, or without
// IntersectionObserver, nothing is hidden and every element shows its final state (motion.css styles the start state
// only under html.motion).

export function storyProgress(rect, viewportHeight) {
  // 0 when the story's top reaches 80% of the viewport, 1 when its bottom reaches 60%.
  const start = viewportHeight * 0.8, end = viewportHeight * 0.6;
  const travelled = start - rect.top, distance = rect.height + start - end;
  return Math.min(1, Math.max(0, distance > 0 ? travelled / distance : 1));
}

function init() {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion');

  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const list of document.querySelectorAll('.update-list, .offer-areas')) {
    [...list.children].forEach((child, index) => child.style.setProperty('--i', String(Math.min(index, 6))));
  }
  for (const element of document.querySelectorAll('[data-reveal], [data-mode]')) reveal.observe(element);

  for (const story of document.querySelectorAll('[data-story]')) {
    const steps = [...story.querySelectorAll('.story-step')];
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = storyProgress(story.getBoundingClientRect(), window.innerHeight);
      story.style.setProperty('--p', progress.toFixed(3));
      steps.forEach((step, index) => step.classList.toggle('is-active', progress >= index / steps.length + 0.02 || progress === 1));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    update();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
