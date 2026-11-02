// The shaped home folds most sections (scripts/home-shape.mjs). A link into folded content, such as the experiment list
// (…/#all-experiments, linked by Find and the experiments page), opens every fold around its target, then jumps to it
// at once (no smooth scroll). Without JavaScript the folds stay closed and the section heading above them is shown.

/** Opens every <details> around the element whose id is `id`; returns that element, or null when there is none. */
export function openAround(document, id) {
  if (!id) return null;
  const target = document.getElementById(id);
  if (!target) return null;
  for (let fold = target.closest('details'); fold; fold = fold.parentElement?.closest('details')) fold.open = true;
  return target;
}

/** The id a location hash names ('' when none, or when it cannot be decoded). */
export function idOf(hash) {
  try { return decodeURIComponent(String(hash).replace(/^#/, '')); } catch { return ''; }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const follow = () => {
    const target = openAround(document, idOf(location.hash));
    if (target?.closest('details')) target.scrollIntoView({ block: 'start' });
  };
  follow();
  addEventListener('hashchange', follow);
}
