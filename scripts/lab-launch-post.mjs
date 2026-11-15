// Post the launch drafts' GitHub Discussions (mission social-ai-driven-1114): the AI-driven half of the weekly launch
// cadence. scripts/lab-launch-drafts.mjs writes <out>/<YYYY-MM-DD>/<slug>/github-discussion.md for every lab that landed
// or changed; this script posts each one to this repository's Discussions, in the category named by --category ("Show
// and tell"), with the title and body exactly as generated. It is the only thing in the repository that posts.
//
//   node scripts/lab-launch-post.mjs --dir <out>/<YYYY-MM-DD> --repo <owner/name> --category <name> --audit <file> [--dry-run]
//
// What it posts: the title is the line under "## Title"; the body is every byte after the "## Body" line (it starts
// with the blank line that follows the heading, as the hand-posted Lab 11 and Lab 12 discussions do, so a body's sha256
// matches theirs for the same draft). Before anything is posted every draft is checked again, against the page as it is
// live now (fetchPage: its own address, no redirect, status exactly 200):
//   - the title is "<Lab N>: <the page's headline>";
//   - every line of the body is the page's own text: the fixed words the generator adds ("### In numbers", "### What
//     this does not show", a "- " list mark, "Read the page: <the page link>") aside, each line occurs in the page's
//     visible text (readPage, the generator's own reader);
//   - the title and the body pass the publisher's text screen (screenHits, after the page link is taken out), and the
//     page link passes urlProblems on the site's host: the generator's own screen, reused, not a second one.
// All or nothing: when any draft fails any check the run REFUSES (exit 1) and posts nothing, as the generator writes
// nothing when any lab fails. A refusal names the draft and the check, and the line by its number and sha256, never by
// its text, so the Actions log carries no draft text.
// Idempotent: the repository's discussions are listed first (GraphQL, every page, every category); a draft whose title
// is already a discussion's title is SKIPPED, with that discussion's address. Skips are not failures.
// --dry-run lists and checks exactly as a real run does and posts nothing: its would-post rows are reported as such.
// Every GraphQL query is a constant in this file; titles, bodies, owner, name and cursors travel only as GraphQL
// variables, never inside the query text. The token is GITHUB_TOKEN from the environment (the workflow's own job token,
// permissions: discussions: write), and it is never printed.
// Audit: --audit <file> gets one JSON document: { date, repo, category, dryRun, posted, wouldPost, skipped, refused },
// where each row carries slug, title, url and the body's sha256, and never the body.
// Exit codes: 0 done (also when nothing was drafted, or all were skipped), 1 refused or failed, 3 usage.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenHits, urlProblems } from './lab-dispatch-publish.mjs';
import { SITE_HOST } from './lab-dispatch-drafts.mjs';
import { labUrl, readPage } from './lab-launch-drafts.mjs';

export const DRAFT_FILE = 'github-discussion.md';
export const GRAPHQL_URL = 'https://api.github.com/graphql';
const FIXED_LINES = new Set(['### In numbers', '### What this does not show']);

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export const REPO_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id discussionCategories(first: 50) { nodes { id name } } }
}`;
export const DISCUSSIONS_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { number title url } }
  }
}`;
export const CREATE_MUTATION = `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
    discussion { number url }
  }
}`;

/** A draft file's { title, body }, or null when it is not in the generator's shape. */
export function parseDiscussionDraft(text) {
  const title = /\n## Title\n\n([^\n]+)\n\n## Body\n/.exec(text);
  if (!title) return null;
  const at = text.indexOf('\n## Body\n') + '\n## Body\n'.length;
  return { title: title[1], body: text.slice(at) };
}

/** Why one draft may not be posted, checked against the lab's live page html: [reason] (empty when it may). */
export function postProblems({ slug, title, body, html }) {
  const url = labUrl(slug);
  const problems = urlProblems(url, [SITE_HOST]).map(r => `the page link: ${r}`);
  const page = readPage(html);
  if (page.canonical !== url) problems.push('the page does not name itself at its own address');
  if (!page.headline || !/^Lab \d+: /.test(title) || title.slice(title.indexOf(': ') + 2) !== page.headline) problems.push('the title is not "Lab N: <the page headline>"');
  let linked = false;
  body.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || FIXED_LINES.has(line)) return;
    if (line.startsWith('Read the page: ')) { if (line === `Read the page: ${url}`) linked = true; else problems.push(`body line ${i + 1} (sha256 ${sha256(line).slice(0, 12)}): a page link other than ${url}`); return; }
    const quote = line.startsWith('- ') ? line.slice(2) : line;
    if (!page.text.includes(quote)) problems.push(`body line ${i + 1} (sha256 ${sha256(line).slice(0, 12)}): not on the page`);
  });
  if (!linked) problems.push('the body does not link the lab page');
  for (const hit of screenHits(title)) problems.push(`title: ${hit.reason}`);
  for (const hit of screenHits(body.replaceAll(url, ' '))) problems.push(`body: ${hit.reason}`);
  return problems;
}

/** Read a lab page: its own address, no redirect, status exactly 200; anything else throws. */
export async function fetchPage(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (response.status !== 200) throw new Error(`answered ${response.status}`);
  return response.text();
}

/** A GraphQL caller on the job token: (query, variables) -> data; errors throw without echoing the variables. */
export function tokenGraphql(token, endpoint = GRAPHQL_URL) {
  return async (query, variables) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'odin-rnd-lab-launch-post' }, body: JSON.stringify({ query, variables }) });
    const json = await response.json().catch(() => ({}));
    if (response.status !== 200 || json.errors?.length) throw new Error(`GraphQL answered ${response.status}: ${(json.errors ?? []).map(e => e.type ?? e.message).join('; ') || 'no data'}`);
    return json.data;
  };
}

/** Every discussion of the repository, all pages: [{ number, title, url }]. */
export async function listDiscussions(graphql, owner, name) {
  const all = [];
  let after = null;
  for (let page = 0; page < 1000; page++) {
    const data = await graphql(DISCUSSIONS_QUERY, { owner, name, after });
    const d = data?.repository?.discussions;
    if (!d) throw new Error('the repository answered no discussions list');
    all.push(...d.nodes);
    if (!d.pageInfo.hasNextPage) return all;
    after = d.pageInfo.endCursor;
  }
  throw new Error('more than 1000 pages of discussions');
}

/** The drafts in a dated folder: [{ slug, file, title, body }] (folders without a discussion draft are left out). */
export function draftsIn(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  return readdirSync(dir).sort().filter(slug => existsSync(join(dir, slug, DRAFT_FILE))).map(slug => {
    const file = join(dir, slug, DRAFT_FILE);
    return { slug, file, ...(parseDiscussionDraft(readFileSync(file, 'utf8')) ?? { title: null, body: null }) };
  });
}

/**
 * Check every draft, list the discussions, then post (or, dry, report) each one whose title is new.
 * Returns { posted, wouldPost, skipped, refused }, filled into `out` as it goes (so a failure part way keeps the rows
 * already posted); nothing is posted when refused is not empty.
 */
export async function postLaunchDiscussions({ drafts, repo, category, dryRun, graphql, fetchPage: read = fetchPage, out = { posted: [], wouldPost: [], skipped: [], refused: [] } }) {
  const [owner, name] = repo.split('/');
  const ready = [];
  for (const d of drafts) {
    if (d.title === null) { out.refused.push({ slug: d.slug, reasons: [`${DRAFT_FILE} is not in the generator's shape (## Title, ## Body)`] }); continue; }
    const row = { slug: d.slug, title: d.title, page: labUrl(d.slug), bodySha256: sha256(d.body) };
    let html;
    try { html = await read(labUrl(d.slug)); } catch (error) { out.refused.push({ ...row, reasons: [`the page ${labUrl(d.slug)} ${error.message}`] }); continue; }
    const reasons = postProblems({ slug: d.slug, title: d.title, body: d.body, html });
    if (reasons.length) out.refused.push({ ...row, reasons });
    else ready.push({ ...row, body: d.body });
  }
  if (out.refused.length || !ready.length) return out;
  const repository = (await graphql(REPO_QUERY, { owner, name }))?.repository;
  const cat = repository?.discussionCategories?.nodes?.find(c => c.name === category);
  if (!repository?.id || !cat) throw new Error(`${repo} has no discussion category named ${JSON.stringify(category)}`);
  const existing = new Map((await listDiscussions(graphql, owner, name)).map(d => [d.title, d]));
  for (const { body, ...row } of ready) {
    const seen = existing.get(row.title);
    if (seen) { out.skipped.push({ ...row, url: seen.url, reason: `a discussion with this title exists (#${seen.number})` }); continue; }
    if (dryRun) { out.wouldPost.push(row); continue; }
    const made = (await graphql(CREATE_MUTATION, { repositoryId: repository.id, categoryId: cat.id, title: row.title, body }))?.createDiscussion?.discussion;
    if (!made?.url) throw new Error(`${row.slug}: createDiscussion answered no discussion`);
    out.posted.push({ ...row, url: made.url, number: made.number });
    existing.set(row.title, made);
  }
  return out;
}

function args(argv) {
  const o = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') o.dryRun = true;
    else if (['--dir', '--repo', '--category', '--audit'].includes(flag) && argv[i + 1] !== undefined) o[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  for (const need of ['dir', 'repo', 'category', 'audit']) if (!o[need]) throw new Error(`--${need} is required`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new Error('--repo is owner/name');
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-launch-post.mjs --dir <out>/<YYYY-MM-DD> --repo <owner/name> --category <name> --audit <file> [--dry-run]\n${error.message}`);
    process.exit(3);
  }
  const token = process.env.GITHUB_TOKEN;
  const audit = { date: basename(resolve(o.dir)), repo: o.repo, category: o.category, dryRun: o.dryRun, posted: [], wouldPost: [], skipped: [], refused: [] };
  let code = 0;
  try {
    if (!token) throw new Error('GITHUB_TOKEN is not set');
    await postLaunchDiscussions({ drafts: draftsIn(resolve(o.dir)), repo: o.repo, category: o.category, dryRun: o.dryRun, graphql: tokenGraphql(token), out: audit });
    if (audit.refused.length) code = 1;
  } catch (error) { audit.error = error.message; code = 1; }
  writeFileSync(resolve(o.audit), `${JSON.stringify(audit, null, 1)}\n`);
  for (const r of audit.posted) console.log(`POSTED ${r.slug}: ${r.title} -> ${r.url} (body sha256 ${r.bodySha256})`);
  for (const r of audit.wouldPost) console.log(`DRY-RUN would post ${r.slug}: ${r.title} (body sha256 ${r.bodySha256})`);
  for (const r of audit.skipped) console.log(`SKIP ${r.slug}: ${r.title} -> ${r.url} (${r.reason})`);
  for (const r of audit.refused) { console.error(`REFUSED ${r.slug}: nothing was posted`); for (const reason of r.reasons) console.error(`  - ${reason}`); }
  if (audit.error) console.error(`FAILED: ${audit.error}`);
  if (!code && !audit.posted.length && !audit.wouldPost.length && !audit.skipped.length) console.log('Nothing to post: no discussion draft in this folder.');
  process.exit(code);
}
