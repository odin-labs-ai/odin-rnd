import { relative, sep } from 'node:path';
// Dated editorial clarifications are added to rendered pages; frozen protocols and raw records stay unchanged.
export const corrections = {
  "journal/jev-as-a-fast-gate.html": "<p class=\"article-correction\"><strong>Scope clarification · <time datetime=\"2026-11-01\">1 November 2026</time>.</strong> The historical protocol’s phrase “isolation is proven” refers to its named canary and pre-flight checks. Passing those checks supports the tested isolation cases; it does not establish that every possible escape or data exposure was ruled out. The original account remains below. <a href=\"../methods/#publication-standard\">Publication standard</a>.</p>",
  "journal/router-arm-results.html": "<p class=\"article-correction\"><strong>Scope clarification · <time datetime=\"2026-11-01\">1 November 2026</time>.</strong> The phrase “cheapest proven model” below refers only to the model’s observed results on this experiment’s tasks and scoring rule. It does not establish general reliability, deployment readiness or the cheapest choice on other work. The original account remains below. <a href=\"../methods/#publication-standard\">Publication standard</a>.</p>",
  "journal/router-arm-fresh-results.html": "<p class=\"article-correction\"><strong>Scope clarification · <time datetime=\"2026-11-01\">1 November 2026</time>.</strong> The phrases “for this kind of work” and “cheapest proven model” below should be read narrowly: these results cover the named eight tasks, fixed comparison runs and pre-registered rule. They do not establish a general routing policy or savings reproduced by an outside party. The original account remains below. <a href=\"../methods/#publication-standard\">Publication standard</a>.</p>"
};
/** A built page's key in `corrections`: its path under distDir with '/' separators on every OS (Windows gives '\'). */
export const publicationPage = (distDir, file) => relative(distDir, file).split(sep).join('/');
/** The correction keys no built page matched: a renamed or removed page, or a key that a path change made miss. */
export const unmatchedCorrections = pages => {
  const seen = new Set(pages);
  return Object.keys(corrections).filter(page => !seen.has(page));
};
export function clarifyPublication(html, page) {
  if (page.includes('\\')) throw new Error('Publication page key must use "/" separators: '+page);
  const note = corrections[page];
  if (!note) return html;
  const anchor = '<article class="article-body">';
  if (html.split(anchor).length !== 2) throw new Error('Missing unique article body for clarification: '+page);
  return html.replace(anchor, anchor + '\n' + note + '\n');
}
