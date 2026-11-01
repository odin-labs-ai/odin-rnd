// Record pages (mission rnd-site-ux-nav-1101, wave 4; audit 2026-11-01 finding 13). Two experiments on the home ledger
// have no field note yet, so their ledger row links the raw record: EXP 015 its JSON copy on this site, EXP 010 its
// JSON file on GitHub. Find and the related links used to send a visitor to the same raw file (or, for EXP 010, back
// to the home ledger). This module renders, into dist/records/<slug>/index.html, a readable page for every ledger entry
// whose link is a JSON record, and returns the map the site index uses to point those items at it.
//
// The page renders fields of the record as written; it never paraphrases a claim. Only an allowlist of plain-text
// fields is read (RECORD_FIELDS): no URL, file list or source list of a record is ever rendered, so a record that cites
// another repository (EXP 010 cites two upstream projects, which scripts/check.mjs refuses on a built page) adds no
// link here. The page links the record itself: on GitHub, and on this site when the site carries a byte-identical
// copy. The home ledger (site/index.html, frozen) keeps its own links.
//
// Every function is string in, string out except renderRecordPages, the only one that touches files. It fails closed:
// a record it cannot read, an id or title that differs from the ledger's, a slug that is not plain, or a page that
// already exists stops the build.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerEntries } from './experiment-ledger.mjs';
import { SITE_ORIGIN, canonicalHeader } from './site-header.mjs';
import { escapeHtml } from './site-chrome.mjs';

export const RECORDS_DIR = 'records';
const REPO_BLOB = 'https://github.com/odin-labs-ai/odin-rnd/blob/main/';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const escape = escapeHtml;

/**
 * The fields a record page shows, in order, each as [label, path into the record]. Plain text only; nothing else in a
 * record is read. A field the record lacks is left out, never filled in.
 */
export const RECORD_FIELDS = Object.freeze([
  ['Status in the record', ['experiment', 'statusText']],
  ['Written on', ['experiment', 'authoredOn']],
  ['Counting window opens (UTC)', ['window', 'from']],
  ['Counting window closes (UTC)', ['window', 'to']],
  ['Summary, as the record states it', ['experiment', 'summary']],
  ['Note, as the record states it', ['experiment', 'note']],
]);

/** Whether a ledger href names a JSON record (on this site, or a file of this repository on GitHub). */
export const isRecordHref = href => typeof href === 'string' && /\.json(?:#.*)?$/.test(href);

/**
 * Where a ledger entry's record lives: { repoPath?, sitePath? }. `data/<slug>/<file>.json` is the site's copy;
 * `https://github.com/odin-labs-ai/odin-rnd/blob/main/<path>.json` a file of this repository. Anything else throws.
 */
export function recordLocation(href) {
  if (!isRecordHref(href)) throw new Error(`Record pages: "${href}" is not a JSON record`);
  if (href.startsWith(REPO_BLOB)) {
    const repoPath = href.slice(REPO_BLOB.length);
    if (!/^experiments\/[a-z0-9-]+\/[a-z0-9./-]+\.json$/.test(repoPath) || repoPath.includes('..')) throw new Error(`Record pages: "${href}" is not an experiment record of this repository`);
    return { repoPath };
  }
  if (/^data\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(href)) return { sitePath: href };
  throw new Error(`Record pages: "${href}" is neither a record on this site nor one of this repository`);
}

/** The record page of a raw record link: 'records/<slug>/', the slug being the experiment folder the link names. */
export function recordPageHref(href) {
  const { repoPath, sitePath } = recordLocation(href);
  const slug = (sitePath ?? repoPath).split('/')[1];
  if (!SLUG.test(slug)) throw new Error(`Record pages: "${href}" names no plain experiment slug`);
  return `${RECORDS_DIR}/${slug}/`;
}

const at = (record, path) => path.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), record);

/** The [label, text] rows of RECORD_FIELDS the record has, as plain strings. */
export function recordRows(record) {
  return RECORD_FIELDS.map(([label, path]) => [label, at(record, path)]).filter(([, value]) => typeof value === 'string' && value.trim() !== '');
}

const footer = up => `<footer class="site-footer"><a class="footer-brand" href="${up}" aria-label="Odin Labs R&amp;D home"><img src="${up}assets/odin-logo.svg" width="29" height="32" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><div><a href="https://odin-labs.ai/contact/">Contact Odin</a><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a></div></footer>`;

/**
 * The record page for one ledger entry. `entry` is a ledgerEntries() row; `record` the parsed JSON; `bytes` its file;
 * `links` { github?, site? } (site relative to the site root). Two levels down: records/<slug>/index.html.
 */
export function renderRecordPage({ entry, slug, record, bytes, links }) {
  if (!SLUG.test(slug ?? '')) throw new Error(`Record pages: "${slug}" is not a plain slug`);
  if (record?.experiment?.id !== entry.id) throw new Error(`Record pages: the record for ${entry.id} names ${record?.experiment?.id}`);
  if (record.experiment.title !== entry.title) throw new Error(`Record pages: the record for ${entry.id} is titled "${record.experiment.title}", the ledger "${entry.title}"`);
  if (!links.github && !links.site) throw new Error(`Record pages: ${entry.id} has no link to its record`);
  const up = '../../';
  const canonical = `${SITE_ORIGIN}${RECORDS_DIR}/${slug}/`;
  const title = `${entry.id}: ${entry.title}`;
  const description = `The published record of ${entry.id} (${entry.title}): its fields as written, and the file itself.`;
  const rows = [['Experiment', entry.id], ['On the experiment ledger', entry.stage], ['Ledger status', entry.status], ...recordRows(record)];
  const list = rows.map(([label, value]) => `<div class="record-field"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const fileLinks = [
    links.github ? `<li><a href="${escape(links.github)}">The record on GitHub <span aria-hidden="true">↗</span></a></li>` : '',
    links.site ? `<li><a href="${up}${escape(links.site)}">The same file on this site (JSON)</a></li>` : '',
  ].join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#102b22">
  <title>${escape(title)} — Odin R&amp;D</title>
  <meta name="description" content="${escape(description)}">
  <meta property="og:title" content="${escape(title)} — Odin R&amp;D">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="${up}assets/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${up}assets/style.css">
  <link rel="stylesheet" href="${up}assets/company.css">
</head>
<body class="company-page">
  <a class="skip" href="#main">Skip to content</a>
  ${canonicalHeader(up, 'experiments')}
  <main id="main"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${up}">Home</a></li><li><a href="${up}experiments/">Experiments</a></li><li aria-current="page">${escape(entry.id)} record</li></ol></nav>
    <section class="company-hero company-width record-hero" aria-labelledby="record-title">
      <div>
        <span class="technical">${escape(entry.id)} · PUBLISHED RECORD</span>
        <h1 id="record-title">${escape(entry.title)}</h1>
        <p class="company-lead">This experiment has no field note yet. Below are fields of its published record, as the record writes them. The record itself is the file linked at the end of this page.</p>
      </div>
    </section>
    <section class="company-section company-width record-body" aria-labelledby="record-fields-title">
      <h2 id="record-fields-title">The record</h2>
      <dl class="record-fields">${list}</dl>
      <h2 id="record-file-title">The file</h2>
      <ul class="record-links">${fileLinks}</ul>
      <p class="record-sha">sha256 of the file: <code>${sha}</code></p>
    </section>
  </main>
  ${footer(up)}
</body>
</html>
`;
}

/**
 * Writes a record page for every ledger entry of the built home whose link is a JSON record and returns the map
 * { ledger href → 'records/<slug>/' } that scripts/site-index.mjs applies to experiment and update items. `root` holds
 * the repository (experiments/), `distDir` the built site.
 */
export function renderRecordPages({ root = '.', distDir = 'dist' } = {}) {
  const ledger = ledgerEntries(readFileSync(join(distDir, 'index.html'), 'utf8'), JSON.parse(readFileSync(join(distDir, 'data/experiments.json'), 'utf8')), distDir);
  const map = new Map();
  const slugs = new Set();
  for (const entry of ledger.filter(e => isRecordHref(e.href))) {
    const { repoPath, sitePath } = recordLocation(entry.href);
    const sourceFile = sitePath ? join(distDir, sitePath) : join(root, repoPath);
    if (!existsSync(sourceFile)) throw new Error(`Record pages: ${entry.id}'s record ${sitePath ?? repoPath} is not there`);
    const bytes = readFileSync(sourceFile);
    const record = JSON.parse(bytes.toString('utf8'));
    // The site's copy is linked on GitHub too only where the repository's file at the experiment's path is the same bytes.
    const slug = recordPageHref(entry.href).split('/')[1];
    if (record.experiment?.slug !== undefined && record.experiment.slug !== slug) throw new Error(`Record pages: ${entry.id}'s record calls itself "${record.experiment.slug}", its link "${slug}"`);
    const twin = sitePath ? `experiments/${slug}/${sitePath.split('/').at(-1)}` : null;
    const github = repoPath ? `${REPO_BLOB}${repoPath}` : twin && existsSync(join(root, twin)) && readFileSync(join(root, twin)).equals(bytes) ? `${REPO_BLOB}${twin}` : null;
    if (slugs.has(slug)) throw new Error(`Record pages: two records have the slug "${slug}"`);
    slugs.add(slug);
    const page = join(distDir, RECORDS_DIR, slug, 'index.html');
    if (existsSync(page)) throw new Error(`Record pages: ${RECORDS_DIR}/${slug}/index.html already exists in ${distDir}; it is rendered here, not committed`);
    const html = renderRecordPage({ entry, slug, record, bytes, links: { github, site: sitePath ?? null } });
    mkdirSync(join(distDir, RECORDS_DIR, slug), { recursive: true });
    writeFileSync(page, html);
    map.set(entry.href, recordPageHref(entry.href));
  }
  return map;
}
