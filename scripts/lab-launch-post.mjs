// Post the launch drafts' GitHub Discussions (mission social-ai-driven-1114): the AI-driven half of the weekly launch
// cadence. scripts/lab-launch-drafts.mjs writes <out>/<YYYY-MM-DD>/<slug>/github-discussion.md for every lab that landed
// or changed; this script posts each one to this repository's Discussions, in the category named by --category ("Show
// and tell"), with the title and body exactly as generated. It is the only thing in the repository that posts.
//
//   node scripts/lab-launch-post.mjs --dir <out>/<YYYY-MM-DD> --repo <owner/name> --category <name> --audit <file> [--dry-run]
//
// What it posts: the title is the line under "## Title"; the body is every byte after the "## Body" line (it starts
// with the blank line that follows the heading, the shape the hand-posted Lab 11 and Lab 12 discussions were given).
// Before anything is posted every draft is checked again, against the page as it is live now (the page link first
// passes urlProblems; then fetchPage: its own address, no redirect, status exactly 200):
//   - the title is "<the lab's catalogue label>: <the page's headline>";
//   - every line of the body is one of the passages the generator lifts from the page (readPage, the generator's own
//     reader): the lead, a numbered sentence after a "- " list mark, or the "does not show" line, exactly and whole,
//     besides the fixed words the generator adds ("### In numbers", "### What this does not show", "Read the page:
//     <the page link>");
//   - the title and the body pass the publisher's text screen (screenHits, after the page link is taken out), and the
//     page link passes urlProblems on the site's host: the generator's own screen, reused, not a second one.
// All or nothing: when any draft fails any check the run REFUSES (exit 1) and posts nothing, as the generator writes
// nothing when any lab fails. A refusal names the draft and the check, and the title and lines by their sha256, never by
// their text, so neither the Actions log nor the audit carries the text of a draft that was refused.
// Idempotent: the repository's discussions are listed first (GraphQL, every page); a draft is SKIPPED, with that
// discussion's address, when a discussion in the target category already has its title and was opened by a trusted
// author (an OWNER, MEMBER or COLLABORATOR of the repository, or this workflow's own github-actions bot). A same-titled
// discussion in that category by any other author is ambiguous and REFUSES the run (nothing posted): a stranger cannot
// make it skip a lab silently, and a hidden association cannot make it post a duplicate. One in another category is noted.
// The key is the title: a lab whose headline changes is a new title and is posted again. Skips are not failures.
// The workflow's concurrency group serialises runs, so a manual run and the schedule never list-then-post at once.
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
import { catalogue, labUrl, readPage } from './lab-launch-drafts.mjs';

export const DRAFT_FILE = 'github-discussion.md';
export const GRAPHQL_URL = 'https://api.github.com/graphql';
const FIXED_LINES = new Set(['### In numbers', '### What this does not show']);

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export const REPO_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id discussionCategories(first: 50) { nodes { id name } } }
}`;
export const DISCUSSIONS_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { number title url authorAssociation category { name } author { __typename login } } }
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
export function postProblems({ slug, label, title, body, html }) {
  const url = labUrl(slug);
  const problems = urlProblems(url, [SITE_HOST]).map(r => `the page link: ${r}`);
  const page = readPage(html);
  if (page.canonical !== url) problems.push('the page does not name itself at its own address');
  if (!label || !page.headline || title !== `${label}: ${page.headline}`) problems.push('the title is not "<the lab\'s catalogue label>: <the page headline>"');
  // The passages the generator lifts, whole: a body line must be exactly one of them, never a fragment of one.
  const passages = new Set([page.lead, ...(page.boundary ? [page.boundary] : [])].filter(Boolean));
  const numbered = new Set(page.numbered);
  let linked = false;
  body.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || FIXED_LINES.has(line)) return;
    if (line.startsWith('Read the page: ')) { if (line === `Read the page: ${url}`) linked = true; else problems.push(`body line ${i + 1} (sha256 ${sha256(line).slice(0, 12)}): a page link other than ${url}`); return; }
    const ok = line.startsWith('- ') ? numbered.has(line.slice(2)) : passages.has(line);
    if (!ok) problems.push(`body line ${i + 1} (sha256 ${sha256(line).slice(0, 12)}): not a passage of the page, whole`);
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

/** Every discussion of the repository, all pages: [{ number, title, url, authorAssociation, category, author }]. */
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

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
/** A discussion this workflow may treat as the lab's own: opened by the repository's people or by this workflow's bot. */
export const trustedAuthor = d => TRUSTED.has(d.authorAssociation) || (d.author?.__typename === 'Bot' && d.author?.login === 'github-actions');

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
export async function postLaunchDiscussions({ drafts, repo, category, dryRun, graphql, fetchPage: read = fetchPage, cat = catalogue(), out = { posted: [], wouldPost: [], skipped: [], refused: [] } }) {
  const [owner, name] = repo.split('/');
  const ready = [];
  for (const d of drafts) {
    if (d.title === null) { out.refused.push({ slug: d.slug, reasons: [`${DRAFT_FILE} is not in the generator's shape (## Title, ## Body)`] }); continue; }
    const row = { slug: d.slug, title: d.title, page: labUrl(d.slug), bodySha256: sha256(d.body) };
    // A refused row names the draft by hashes only: its title may be the very text that failed the screen.
    const refuse = reasons => out.refused.push({ slug: d.slug, page: row.page, titleSha256: sha256(d.title), bodySha256: row.bodySha256, reasons });
    const label = cat.get(d.slug)?.label;
    if (!label) { refuse(['not on the lab catalogue (TILE_FILES)']); continue; }
    const linkProblems = urlProblems(row.page, [SITE_HOST]);
    if (linkProblems.length) { refuse(linkProblems.map(r => `the page link: ${r}`)); continue; }
    let html;
    try { html = await read(row.page); } catch (error) { refuse([`the page ${row.page} ${error.message}`]); continue; }
    const reasons = postProblems({ slug: d.slug, label, title: d.title, body: d.body, html });
    if (reasons.length) refuse(reasons);
    else ready.push({ ...row, body: d.body });
  }
  if (out.refused.length || !ready.length) return out;
  const repository = (await graphql(REPO_QUERY, { owner, name }))?.repository;
  const target = repository?.discussionCategories?.nodes?.find(c => c.name === category);
  if (!repository?.id || !target) throw new Error(`${repo} has no discussion category named ${JSON.stringify(category)}`);
  const all = await listDiscussions(graphql, owner, name);
  const existing = new Map(all.filter(d => d.category?.name === category && trustedAuthor(d)).map(d => [d.title, d]));
  // Decide every draft before posting any: a same-titled discussion in the target category whose author this job cannot
  // confirm is ambiguous (a squatter, or one of ours whose association the job token does not see), and an ambiguous
  // draft refuses the whole run, so it neither skips silently nor posts a duplicate: a person looks.
  const toPost = [];
  for (const item of ready) {
    const { body, ...row } = item;
    const seen = existing.get(row.title);
    if (seen) { out.skipped.push({ ...row, url: seen.url, reason: `a discussion with this title exists in ${category} (#${seen.number})` }); continue; }
    const unconfirmed = all.filter(d => d.title === row.title && d.category?.name === category);
    if (unconfirmed.length) {
      out.refused.push({ slug: row.slug, page: row.page, titleSha256: sha256(row.title), bodySha256: row.bodySha256,
        reasons: [`a same-titled discussion in ${category} by an author this job cannot confirm: ${unconfirmed.map(d => `#${d.number} (${d.authorAssociation ?? 'no association'})`).join(', ')}`] });
      continue;
    }
    const elsewhere = all.filter(d => d.title === row.title).map(d => d.number);
    if (elsewhere.length) row.note = `same-titled discussion(s) in another category not counted: #${elsewhere.join(', #')}`;
    toPost.push({ ...row, body });
  }
  if (out.refused.length) return out;
  for (const { body, ...row } of toPost) {
    if (dryRun) { out.wouldPost.push(row); continue; }
    const made = (await graphql(CREATE_MUTATION, { repositoryId: repository.id, categoryId: target.id, title: row.title, body }))?.createDiscussion?.discussion;
    if (!made?.url) throw new Error(`${row.slug}: createDiscussion answered no discussion`);
    out.posted.push({ ...row, url: made.url, number: made.number });
    existing.set(row.title, { ...made, title: row.title });
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
  for (const r of audit.refused) { console.error(`REFUSED ${r.slug} (title sha256 ${r.titleSha256 ?? '-'}): nothing was posted`); for (const reason of r.reasons) console.error(`  - ${reason}`); }
  if (audit.error) console.error(`FAILED: ${audit.error}`);
  if (!code && !audit.posted.length && !audit.wouldPost.length && !audit.skipped.length) console.log('Nothing to post: no discussion draft in this folder.');
  process.exit(code);
}
