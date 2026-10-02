// A measured experiment's field note keeps its committed body (the pre-registration's render, which a test re-renders
// from the record), but its <head> must not say it was published before any run once results exist. The results
// renderers use this to replace the page's <title> and meta description at build time, from the results data.
// og:/twitter: tags are replaced too if a page carries them (none does today). Head only: the body is never touched.
import assert from 'node:assert/strict';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const SITE_SUFFIX = ' — Odin R&amp;D';

/** The page with its <title> set to `title` (plus the site suffix) and its description tags set to `description`. */
export function replaceHead(html, { title, description }) {
  const headEnd = html.indexOf('</head>');
  assert(headEnd > 0, 'the page has a <head>');
  let head = html.slice(0, headEnd);
  const titleRe = /<title>[^<]*<\/title>/, descRe = /<meta name="description" content="[^"]*">/;
  assert.equal(head.match(new RegExp(titleRe.source, 'g'))?.length, 1, 'the page has exactly one <title>');
  assert.equal(head.match(new RegExp(descRe.source, 'g'))?.length, 1, 'the page has exactly one meta description');
  head = head.replace(titleRe, `<title>${escape(title)}${SITE_SUFFIX}</title>`).replace(descRe, `<meta name="description" content="${escape(description)}">`);
  for (const [attr, key, value] of [['property', 'og:title', title], ['property', 'og:description', description], ['name', 'twitter:title', title], ['name', 'twitter:description', description]]) {
    head = head.replace(new RegExp(`<meta ${attr}="${key}" content="[^"]*">`, 'g'), `<meta ${attr}="${key}" content="${escape(value)}">`);
  }
  return head + html.slice(headEnd);
}

/** The <title> text and the description of a page (unescaped is not needed: the tests compare escaped strings). */
export function readHead(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  return { title: /<title>([^<]*)<\/title>/.exec(head)?.[1] ?? null, description: /<meta name="description" content="([^"]*)">/.exec(head)?.[1] ?? null };
}
