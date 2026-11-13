// Launch drafts for every lab that landed or changed: the AI-driven cadence (mission rnd-nightshift-1112). It extends the
// Lab 01 drafts generator (scripts/lab-dispatch-drafts.mjs: its X counter, its text screen and its out-dir guard) from one
// lab's dispatches to every lab on the catalogue. For each lab it reads that lab's own built page and writes, into a dated
// folder, drafts for the founder to read, edit and post by hand:
//   <out>/<YYYY-MM-DD>/<slug>/linkedin.md            the page's headline, its lead, up to four of its numbered sentences,
//                                                    the first line of its "What this does not show" section, the link
//   <out>/<YYYY-MM-DD>/<slug>/x.md                   one post, at most 280 characters as X counts them (a link is 23)
//   <out>/<YYYY-MM-DD>/<slug>/github-discussion.md   a title and a body for the repository's Discussions
//   <out>/<YYYY-MM-DD>/<slug>/card.json              the page's own og:image (its share card) and where it sits in site/
//   <out>/<YYYY-MM-DD>/INDEX.md                      which labs were drafted, and why (changed since, or named)
//
//   node scripts/lab-launch-drafts.mjs --out <dir> (--labs <slug,slug> | --since <YYYY-MM-DD>) [--page-dir <dir>] [--date YYYY-MM-DD]
//
// Which labs: --labs names them by their catalogue slug (the tile's "experiment"); --since takes every lab whose page
// (site/labs/<slug>/index.html) or tile (its file in TILE_FILES) changed in a commit since that date, from git log. Data
// appends (a lab's daily run records) do not count, or the labs with a daily record would be drafted every week.
// Where the page comes from: --page-dir <dir> reads <dir>/labs/<slug>/index.html (a built dist/, or a test fixture);
// without it the page is fetched from the live site, its own address on the site's host and nothing else, which is a
// read of our own public page (the GitHub Actions workflow does this after the page has been published).
//
// Every sentence a draft carries is the page's own: the headline, the lead and the numbered sentences are lifted from
// the page's visible text (tables, the header and the "Related" links left out), and each one is then checked to occur
// in that visible text as one unbroken run, whitespace aside (a substring check: it guards against the extractor and
// the page drifting apart, it does not check where a sentence starts or ends). A draft adds only a few fixed words (the lab's label, "Read the page:", a heading).
// Nothing is abridged: an X post is built from whole sentences that fit, and when no sentence fits beside the headline
// and the link, the post is the headline and the link alone and says so in its header comment.
// It REFUSES (exit 1, every reason listed, nothing written, the out dir not even created) when a lab is not on the
// catalogue, when its page cannot be read or does not name itself at its own address (canonical link), when a quoted
// sentence is not on the page, when any draft fails the publisher's text screen (screenHits, after the page link and
// the card URL are taken out; each is checked as a URL on the site's host by urlProblems), when the X post is over 280,
// or when --out resolves under site/ or dist/ (drafts are never published; outProblems, from the Lab 01 generator).
// Nothing here posts, sends or calls anything but the page read: posting stays the founder's own act.
// Exit codes: 0 done (also when no lab changed: INDEX.md says so), 1 refused, 3 usage.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenHits, urlProblems } from './lab-dispatch-publish.mjs';
import { DIST_DIR, SITE_DIR, SITE_HOST, X_LIMIT, length, outProblems } from './lab-dispatch-drafts.mjs';
import { SITE_URL } from './labs.mjs';
import { TILE_FILES } from './lab-tiles.mjs';
import { visibleText } from './lab-week.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');
export const LAUNCH_FILES = ['linkedin.md', 'x.md', 'github-discussion.md', 'card.json'];
export const X_LINK_WEIGHT = 23;
export const NUMBERED_SHOWN = 4;
const BANNER = 'DRAFT — the founder posts. Nothing here is sent.';

/** The lab page's live address. */
export const labUrl = slug => `${SITE_URL}labs/${slug}/`;

// Inline tags join the words around them ("<strong>40 guests</strong>, at most" reads "40 guests, at most"); every other
// tag is a break between words.
const INLINE = /<\/?(a|abbr|b|bdi|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b[^>]*>/gi;

// An inline tag becomes a private-use mark before visibleText runs (so a removed tag can never join the text around it
// into new markup), and the mark is dropped from the visible text after.
const JOIN = '\uE000';

/** One line of text as a reader sees it: tags out, entities decoded, every run of whitespace one space. */
export const flat = html => visibleText(html.replaceAll(JOIN, ' ').replace(INLINE, JOIN)).replaceAll(JOIN, '').replace(/\s+/g, ' ').trim();

/** X's count of a post: the Lab 01 generator's weighted count, with every link counted as X counts it, 23. */
export const xLength = text => length(text.replace(/https?:\/\/\S+/g, 'x'.repeat(X_LINK_WEIGHT)));

/** Sentences of a passage, split after . ! or ? before a capital or an opening quote, so "1.54 pushes" stays whole. */
export const sentences = text => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/u).map(s => s.trim()).filter(Boolean);

// An attribute's value, double- or single-quoted.
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3]) : null; };
const metaContent = (html, key) => {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]).find(t => attr(t, 'property') === key || attr(t, 'name') === key);
  return tag ? flat(attr(tag, 'content') ?? '') : null;
};

/**
 * What a lab page says, lifted from its markup: { canonical, ogImage, headline, lead, numbered, boundary, text } where
 * text is the whole visible text every quote is checked against. Pure: no file or network access.
 */
export function readPage(html) {
  const canonical = attr((/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html) ?? [''])[0], 'href');
  const main = (/<main\b[\s\S]*?<\/main\s*>/i.exec(html) ?? [''])[0];
  const text = flat(main);
  const headline = flat((/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(main) ?? ['', ''])[1]);
  const hero = (/<section\b[^>]*class\s*=\s*["'][^"']*\blab-hero\b[^"']*["'][^>]*>[\s\S]*?<\/section\s*>/i.exec(main) ?? [''])[0];
  const leadTag = /<p\b[^>]*class\s*=\s*["'][^"']*\bcompany-lead\b[^"']*["'][^>]*>([\s\S]*?)<\/p\s*>/i.exec(hero) ?? /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(hero);
  const lead = leadTag ? flat(leadTag[1]) : '';
  // The page's sections after the hero, each with its heading: the boundary is the one headed "does not show", and the
  // numbered sentences come from the others, never from a table, the boundary itself or the "Related" links.
  const sections = [...main.matchAll(/<section\b[\s\S]*?<\/section\s*>/gi)].map(m => m[0]).filter(s => s !== hero)
    .map(s => ({ html: s, heading: flat((/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i.exec(s) ?? ['', ''])[1]) }));
  const isBoundary = s => /does not show/i.test(s.heading);
  const blocks = s => [...s.html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, ' ').matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(m => flat(m[2])).filter(Boolean);
  const boundarySection = sections.find(isBoundary);
  const boundary = boundarySection ? (blocks(boundarySection)[0] ?? null) : null;
  const numbered = [...new Set(sections.filter(s => !isBoundary(s) && !/^related$/i.test(s.heading))
    .flatMap(blocks).flatMap(sentences).filter(s => /\p{Nd}/u.test(s)))];
  return { canonical, ogImage: metaContent(html, 'og:image'), headline, lead, numbered, boundary, text };
}

/** The repository path of a card URL on this site (site/<path>), or null when it is not under the site's address. */
export const cardPath = url => typeof url === 'string' && url.startsWith(SITE_URL) ? `site/${url.slice(SITE_URL.length)}` : null;

/**
 * The X post: the label and headline, the lead's opening sentences in order (at most two) as long as they fit, then the
 * first of the numbered sentences the other drafts show that still fits, on its own line, and the link. When nothing of the page fits,
 * the post is the headline and the link alone. A sentence is never cut to fit.
 */
export function xPost(label, page, url) {
  const head = `${label}: ${page.headline}`;
  const post = (lead, number) => [head, ...(lead.length ? [lead.join(' ')] : []), ...(number ? [number] : []), url].join('\n\n');
  const lead = [];
  for (const s of sentences(page.lead).slice(0, 2)) { if (xLength(post([...lead, s])) > X_LIMIT) break; lead.push(s); }
  const number = page.numbered.slice(0, NUMBERED_SHOWN).find(s => xLength(post(lead, s)) <= X_LIMIT) ?? null;
  const chosen = [...lead, ...(number ? [number] : [])];
  return { text: post(lead, number), bare: !chosen.length, chosen };
}

/** Every quoted string a lab's drafts carry: the headline, the lead's sentences, the numbered ones shown, the boundary. */
const quotes = (page, xSentences) => [page.headline, ...sentences(page.lead), ...page.numbered.slice(0, NUMBERED_SHOWN), ...(page.boundary ? [page.boundary] : []), ...xSentences];

/**
 * A lab's drafts in memory: { problems, files }. `tile` is its catalogue entry (label, experiment), `html` its built page.
 * Nothing is returned to be written unless every check passes.
 */
export function labDrafts(tile, html) {
  const slug = tile.experiment, label = tile.label, url = labUrl(slug);
  const page = readPage(html);
  const problems = [];
  if (page.canonical !== url) problems.push(`${slug}: the page names itself ${JSON.stringify(page.canonical)}, not ${url}`);
  if (!page.headline) problems.push(`${slug}: the page has no headline (h1)`);
  if (!page.lead) problems.push(`${slug}: the page has no lead paragraph`);
  problems.push(...urlProblems(url, [SITE_HOST]).map(r => `${slug}: the page link ${url}: ${r}`));
  if (page.ogImage) problems.push(...urlProblems(page.ogImage, [SITE_HOST]).map(r => `${slug}: the card ${page.ogImage}: ${r}`));
  else problems.push(`${slug}: the page carries no og:image card`);
  if (problems.length) return { problems, files: {} };

  const x = xPost(label, page, url);
  for (const q of quotes(page, x.chosen)) if (!page.text.includes(q)) problems.push(`${slug}: ${JSON.stringify(q)} is not on the page`);

  const numbered = page.numbered.slice(0, NUMBERED_SHOWN);
  const linkedin = [`<!-- ${BANNER} Attach the share card named beside this draft. Every sentence below is quoted from the lab page. -->`, '',
    `${label}: ${page.headline}`, '', page.lead, '',
    ...(numbered.length ? [...numbered.map(s => `- ${s}`), ''] : []),
    ...(page.boundary ? [`What this does not show: ${page.boundary}`, ''] : []),
    `Read the page: ${url}`, ''].join('\n');
  const xFile = [`<!-- ${BANNER} One post, ${xLength(x.text)} of ${X_LIMIT} characters as X counts them (the link counts ${X_LINK_WEIGHT}).${x.bare ? ' No sentence of the page fits beside the headline and the link, so it is those two alone.' : ''} -->`, '', x.text, ''].join('\n');
  const discussion = [`<!-- ${BANNER} For the repository's Discussions, in the category for show and tell. -->`, '',
    '## Title', '', `${label}: ${page.headline}`, '', '## Body', '', page.lead, '',
    ...(page.numbered.length ? ['### In numbers', '', ...numbered.map(s => `- ${s}`), ''] : []),
    ...(page.boundary ? ['### What this does not show', '', page.boundary, ''] : []),
    `Read the page: ${url}`, ''].join('\n');
  const card = { lab: label, slug, page: url, card: page.ogImage, repoPath: cardPath(page.ogImage), siteDefault: page.ogImage === `${SITE_URL}assets/og/odin-rnd-og-image.png` };
  const texts = { 'linkedin.md': linkedin, 'x.md': xFile, 'github-discussion.md': discussion };
  for (const [file, text] of Object.entries(texts)) {
    for (const hit of screenHits(text.replaceAll(url, ' ').replaceAll(page.ogImage, ' '))) problems.push(`${slug}/${file}: ${hit.reason}`);
    if (!text.includes(url)) problems.push(`${slug}/${file}: does not link the lab page`);
  }
  if (xLength(x.text) > X_LIMIT) problems.push(`${slug}/x.md: ${xLength(x.text)} characters, over ${X_LIMIT}`);
  if (problems.length) return { problems, files: {} };
  return { problems: [], files: { ...texts, 'card.json': `${JSON.stringify(card, null, 1)}\n` }, x: { length: xLength(x.text), bare: x.bare }, card };
}

/** The catalogue: every tile in TILE_FILES, by slug, with the file it is read from. */
export function catalogue(site = SITE_DIR) {
  return new Map(TILE_FILES.filter(file => existsSync(join(site, file))).map(file => {
    const tile = JSON.parse(readFileSync(join(site, file), 'utf8'));
    return [tile.experiment, { ...tile, file: `site/${file}` }];
  }));
}

/** The slugs whose page or tile changed in a commit since `since` (YYYY-MM-DD), from git log, in catalogue order. */
export function changedSince(since, { cat = catalogue(), repo = REPO, log } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since ${since} is not YYYY-MM-DD`);
  const paths = new Set((log ?? execFileSync('git', ['-C', repo, 'log', `--since=${since}T00:00:00Z`, '--name-only', '--format=', '--', 'site/labs', 'site/data/labs'], { encoding: 'utf8' }))
    .split('\n').map(s => s.trim()).filter(Boolean));
  return [...cat.values()].filter(t => paths.has(`site/labs/${t.experiment}/index.html`) || paths.has(t.file)).map(t => t.experiment);
}

/** Read a lab's built page: from `pageDir` when given, else the live page at its own address. */
export async function pageOf(slug, pageDir) {
  if (pageDir) return readFileSync(join(pageDir, 'labs', slug, 'index.html'), 'utf8');
  const response = await fetch(labUrl(slug), { redirect: 'error' });
  if (!response.ok) throw new Error(`${labUrl(slug)} answered ${response.status}`);
  return response.text();
}

/**
 * Draft every named lab into <out>/<date>/: all are built and checked first; nothing is written unless all pass.
 * `pages` maps a slug to its page HTML.
 */
export function writeLaunchDrafts({ out, date, slugs, pages, cat = catalogue(), reason, roots = [SITE_DIR, DIST_DIR] }) {
  const problems = outProblems(out, roots);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`--date ${date} is not YYYY-MM-DD`);
  const results = [];
  for (const slug of slugs) {
    const tile = cat.get(slug);
    if (!tile) { problems.push(`${slug}: not on the lab catalogue (TILE_FILES)`); continue; }
    if (typeof pages[slug] !== 'string') { problems.push(`${slug}: ${pages[slug]?.message ?? 'its page could not be read'}`); continue; }
    const result = labDrafts(tile, pages[slug]);
    problems.push(...result.problems);
    results.push({ slug, tile, ...result });
  }
  if (problems.length) return { problems, results: [] };
  const dir = join(out, date);
  const index = [`# Launch drafts, ${date}`, '', `${BANNER}`, '', reason, '',
    ...(results.length ? results.map(r => `- ${r.tile.label}, ${r.tile.title}: \`${r.slug}/\` (X post ${r.x.length} of ${X_LIMIT}; card ${r.card.siteDefault ? 'the site default, no card of its own yet' : 'its own'})`) : ['No lab page or tile changed in this window, so there is nothing to draft.']), ''].join('\n');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'INDEX.md'), index);
  for (const r of results) {
    mkdirSync(join(dir, r.slug), { recursive: true });
    for (const [file, text] of Object.entries(r.files)) writeFileSync(join(dir, r.slug, file), text);
  }
  return { problems: [], results, dir };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--out', '--labs', '--since', '--page-dir', '--date'].includes(flag) && argv[i + 1] !== undefined) o[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!o.out) throw new Error('--out <dir> is required');
  if (!o.labs === !o.since) throw new Error('give exactly one of --labs <slug,slug> or --since <YYYY-MM-DD>');
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-launch-drafts.mjs --out <dir> (--labs <slug,slug> | --since <YYYY-MM-DD>) [--page-dir <dir>] [--date YYYY-MM-DD]\n${error.message}`);
    process.exit(3);
  }
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  let slugs, reason;
  try {
    slugs = o.labs ? o.labs.split(',').map(s => s.trim()).filter(Boolean) : changedSince(o.since);
    reason = o.labs ? `Named: ${slugs.join(', ')}.` : `Every lab whose page or tile changed in a commit since ${o.since}.`;
  } catch (error) { console.error(`REFUSED: ${error.message}`); process.exit(1); }
  const pages = {};
  for (const slug of slugs) { try { pages[slug] = await pageOf(slug, o['page-dir'] && resolve(o['page-dir'])); } catch (error) { pages[slug] = error; } }
  const result = writeLaunchDrafts({ out: resolve(o.out), date, slugs, pages, reason });
  if (result.problems.length) {
    console.error(`REFUSED: ${result.problems.length} reason${result.problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`DRAFTED ${result.results.length} lab${result.results.length === 1 ? '' : 's'} -> ${result.dir}; the founder posts.`);
  for (const r of result.results) console.log(`  ${r.tile.label} ${r.slug}: x ${r.x.length}/${X_LIMIT}${r.x.bare ? ' (headline and link only)' : ''}, card ${r.card.repoPath}`);
}
