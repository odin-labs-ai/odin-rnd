// "Talk to us about this result": one link to the odin-labs.ai contact form at the end of a result record's body, added
// to the BUILT page only. The committed record stays byte-for-byte as published (EXP 021's page is pinned in
// experiments/failover/results/final-document-hashes.sha256), so this is a build pass like the site chrome.
//
// Why (vp-all-lanes-1118 WO-6, measured in ~website-leads): the R&D floor drew 254 views in the week 2026-11-11..17, the
// largest audience of any Odin surface, and the newest result record (journal/failover-results.html) had no way to the
// contact form; the week brought 1 contact send.
//
// The link is attributable on the lead itself: the odin-labs.ai contact form keeps only the landing PATH and the utm_
// tags of an arrival, and prints them on the lead's Source line, e.g.
// "campaign: odin-labs-ai.github.io, landed on /contact/, utm_source=odin-rnd, utm_medium=result-record,
// utm_content=failover-results". Any other query key (a `from=`, say) is dropped before the lead is written, so the tag
// is utm_ only. `topic=lab` preselects the R&D topic; `#contact-form` scrolls to the form. data-contact-opened makes
// site/assets/activity.mjs count the click as contact_opened.

const CONTACT = 'https://odin-labs.ai/contact/';
export const RESULT_CONTACT_SOURCE = 'odin-rnd';
export const RESULT_CONTACT_MEDIUM = 'result-record';

// Built page (relative to dist/) -> utm_content, the tag that names the record on the lead's Source line.
export const RESULT_CONTACT_PAGES = new Map([
  ['journal/failover-results.html', 'failover-results'],
]);

export function resultContactHref(content) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(content)) throw new Error(`Bad result-contact tag: ${content}`);
  const url = new URL(CONTACT);
  url.searchParams.set('topic', 'lab');
  url.searchParams.set('utm_source', RESULT_CONTACT_SOURCE);
  url.searchParams.set('utm_medium', RESULT_CONTACT_MEDIUM);
  url.searchParams.set('utm_content', content);
  url.hash = 'contact-form';
  return url.toString();
}

const MARKER = 'class="article-note result-contact"';

// Inserts the link as the last paragraph of the page's one <article>. Fails closed on a page without exactly one
// </article>; idempotent.
export function addResultContact(html, content, label = 'page') {
  if (html.includes(MARKER)) return html;
  const closes = html.match(/<\/article>/g) || [];
  if (closes.length !== 1) throw new Error(`Expected exactly one </article> in ${label}, found ${closes.length}`);
  const href = resultContactHref(content).replace(/&/g, '&amp;');
  const link = `<p ${MARKER}><a href="${href}" data-contact-opened>Talk to us about this result <span aria-hidden="true">↗</span></a></p>\n`;
  const at = html.indexOf('</article>');
  return html.slice(0, at) + link + html.slice(at);
}

// Every listed page must exist in the build: a renamed record fails the build instead of silently losing its link.
export async function addResultContactsToDist({ distDir }) {
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  for (const [page, content] of RESULT_CONTACT_PAGES) {
    const file = `${distDir}/${page}`;
    if (!existsSync(file)) throw new Error(`Result-contact page missing from the build: ${page}`);
    writeFileSync(file, addResultContact(readFileSync(file, 'utf8'), content, page));
  }
}
