import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SYN_THEME } from './test-synthetic-names.mjs';
import { labDrafts, labUrl } from './lab-launch-drafts.mjs';
import { CREATE_MUTATION, DISCUSSIONS_QUERY, GRAPHQL_URL, REPO_QUERY, draftsIn, fetchPage, parseDiscussionDraft, postLaunchDiscussions, postProblems, sha256, tokenGraphql, trustedAuthor } from './lab-launch-post.mjs';
import { SITE_URL } from './labs.mjs';

// The Discussions poster (mission social-ai-driven-1114). Every page here is made up at run time, in the shape the lab
// pages are built in, and every draft is the generator's own output for that page (labDrafts), so the poster is tested
// on exactly what the weekly workflow hands it. GraphQL and the page read are mocks: nothing leaves the machine.
const here = dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'lab-launch-post-'));
after(() => rmSync(temp, { recursive: true, force: true }));

const CARD = `${SITE_URL}assets/og/odin-rnd-og-image.png`;
const LEAD = 'A jar sits on the bench. We counted how many pebbles it takes before the lid will not close. This page sets the count beside a guess, and keeps the two apart.';
function page({ slug = 'strangers', headline = 'How many pebbles fit in the jar?', lead = LEAD } = {}) {
  return `<!doctype html><html lang="en"><head><title>x</title><meta property="og:image" content="${CARD}"><link rel="canonical" href="${labUrl(slug)}"></head><body>
<main id="main">
  <section class="company-hero company-width labs-hero lab-hero"><div><h1 id="lab-title">${headline}</h1><p class="company-lead">${lead}</p></div></section>
  <section class="company-section"><h2>The guess, and the count.</h2>
    <ul><li>Guessed cap: <strong>40 pebbles</strong>, at most 80 on a quiet day.</li><li>Counted on 3 jars of 1.5 litres. Every jar held 61 to 64.</li></ul>
  </section>
  <section class="company-section"><h2>What this does not show.</h2><ul><li>Only round pebbles were tried.</li></ul></section>
</main></body></html>`;
}
const LABS = { strangers: { label: 'Lab 98', experiment: 'strangers', headline: 'How many pebbles fit in the jar?' }, 'same-model-harness': { label: 'Lab 97', experiment: 'same-model-harness', headline: 'Do two jars hold more than one?' } };
const pages = Object.fromEntries(Object.entries(LABS).map(([slug, t]) => [slug, page({ slug, headline: t.headline })]));
const draftFile = slug => { const r = labDrafts(LABS[slug], pages[slug]); assert.deepEqual(r.problems, []); return r.files['github-discussion.md']; };
const draft = slug => ({ slug, ...parseDiscussionDraft(draftFile(slug)) });

/** A mock GitHub GraphQL API: records every call, answers the three operations the poster may send. */
function mockGraphql({ existing = [], pageSize = 1 } = {}) {
  const calls = [];
  const fn = async (query, variables) => {
    calls.push({ query, variables });
    if (query === REPO_QUERY) return { repository: { id: 'R_1', discussionCategories: { nodes: [{ id: 'C_ann', name: 'Announcements' }, { id: 'C_show', name: 'Show and tell' }] } } };
    if (query === DISCUSSIONS_QUERY) {
      const from = variables.after ? Number(variables.after) : 0;
      const nodes = existing.slice(from, from + pageSize);
      return { repository: { discussions: { pageInfo: { hasNextPage: from + pageSize < existing.length, endCursor: String(from + pageSize) }, nodes } } };
    }
    if (query === CREATE_MUTATION) return { createDiscussion: { discussion: { number: 300 + calls.length, url: `https://github.com/odin-labs-ai/odin-rnd/discussions/${300 + calls.length}` } } };
    throw new Error('unexpected query');
  };
  fn.calls = calls;
  fn.creates = () => calls.filter(c => c.query === CREATE_MUTATION);
  return fn;
}
const served = (map = pages) => async url => {
  const slug = Object.keys(map).find(s => labUrl(s) === url);
  if (!slug) throw new Error('answered 404');
  if (typeof map[slug] === 'number') throw new Error(`answered ${map[slug]}`);
  return map[slug];
};
const cat = new Map(Object.entries(LABS));
const run = (graphql, drafts, extra = {}) => postLaunchDiscussions({ drafts, repo: 'odin-labs-ai/odin-rnd', category: 'Show and tell', dryRun: false, graphql, fetchPage: served(), cat, ...extra });
const ours = (number, title, more = {}) => ({ number, title, url: `https://github.com/odin-labs-ai/odin-rnd/discussions/${number}`, authorAssociation: 'MEMBER', category: { name: 'Show and tell' }, author: { __typename: 'User', login: 'someone' }, ...more });

test('parseDiscussionDraft takes the title line and every byte after the Body heading', () => {
  const file = draftFile('strangers');
  const d = parseDiscussionDraft(file);
  assert.equal(d.title, 'Lab 98: How many pebbles fit in the jar?');
  assert.ok(d.body.startsWith(`\n${LEAD}\n`), 'the body starts with the blank line after the heading, as the hand posts did');
  assert.ok(d.body.endsWith(`Read the page: ${labUrl('strangers')}\n`));
  assert.ok(!d.body.includes('## Title') && !d.body.includes('DRAFT'), 'no heading or banner of the draft file is posted');
  assert.equal(parseDiscussionDraft('no headings here'), null);
});

test('posts each draft to Show and tell, title and body exactly as generated, passed only as GraphQL variables', async () => {
  const gql = mockGraphql();
  const drafts = [draft('same-model-harness'), draft('strangers')];
  const out = await run(gql, drafts);
  assert.deepEqual(out.refused, []);
  assert.equal(out.posted.length, 2);
  const creates = gql.creates();
  assert.equal(creates.length, 2);
  for (const [i, c] of creates.entries()) {
    assert.deepEqual(c.variables, { repositoryId: 'R_1', categoryId: 'C_show', title: drafts[i].title, body: drafts[i].body });
    assert.equal(out.posted[i].bodySha256, sha256(drafts[i].body));
    assert.ok(!('body' in out.posted[i]), 'the audit row never carries the body');
  }
  for (const c of gql.calls) for (const d of drafts) assert.ok(!c.query.includes(d.title) && !c.query.includes(d.body.trim().slice(0, 30)), 'no draft text inside any query');
});

test('dedupe: a draft whose title is already a discussion (on any page of the list) is skipped, the rest posted', async () => {
  const existing = [ours(1, 'Something else'), ours(2, 'Another'), ours(247, 'Lab 98: How many pebbles fit in the jar?')];
  const gql = mockGraphql({ existing, pageSize: 1 });
  const out = await run(gql, [draft('same-model-harness'), draft('strangers')]);
  assert.equal(gql.calls.filter(c => c.query === DISCUSSIONS_QUERY).length, 3, 'every page of the list is read');
  assert.deepEqual(out.skipped.map(s => [s.slug, s.url]), [['strangers', 'https://github.com/odin-labs-ai/odin-rnd/discussions/247']]);
  assert.deepEqual(out.posted.map(p => p.slug), ['same-model-harness']);
  assert.deepEqual(gql.creates().map(c => c.variables.title), ['Lab 97: Do two jars hold more than one?']);
});

test('dedupe trusts only the repository\'s people or its own bot, in the target category: a squatted title still posts', async () => {
  const title98 = 'Lab 98: How many pebbles fit in the jar?', title97 = 'Lab 97: Do two jars hold more than one?';
  const existing = [ours(5, title98, { authorAssociation: 'NONE' }), ours(6, title97, { category: { name: 'General' } }), ours(7, 'x', { authorAssociation: 'NONE', author: { __typename: 'Bot', login: 'github-actions' } })];
  const gql = mockGraphql({ existing, pageSize: 10 });
  const out = await run(gql, [draft('same-model-harness'), draft('strangers')]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.posted.map(p => [p.slug, p.note]), [['same-model-harness', 'same-titled discussion(s) by an untrusted author or in another category not counted: #6'], ['strangers', 'same-titled discussion(s) by an untrusted author or in another category not counted: #5']]);
  assert.ok(trustedAuthor(existing[2]), 'this workflow\'s own bot is trusted');
  assert.ok(!trustedAuthor({ authorAssociation: 'NONE', author: { __typename: 'User', login: 'github-actions' } }), 'a user named like the bot is not');
});

test('refused: a page that does not answer 200 refuses the run and nothing is posted', async () => {
  const gql = mockGraphql();
  const out = await run(gql, [draft('same-model-harness'), draft('strangers')], { fetchPage: served({ ...pages, strangers: 404 }) });
  assert.deepEqual(out.refused.map(r => r.slug), ['strangers']);
  assert.match(out.refused[0].reasons.join('\n'), /answered 404/);
  assert.deepEqual(out.posted, []);
  assert.equal(gql.calls.length, 0, 'no GraphQL call at all after a refusal');
});

test('refused: a draft that fails the text screen, or quotes a line not on the page, posts nothing and names no text', async () => {
  const dirty = LEAD.replace('A jar sits', `A ${SYN_THEME} jar sits`);
  const servedDirty = { ...pages, strangers: page({ lead: dirty }) };
  const good = draft('strangers');
  const screened = { ...good, body: good.body.replace(LEAD, dirty) };
  const gql = mockGraphql();
  const out = await run(gql, [draft('same-model-harness'), screened], { fetchPage: served(servedDirty) });
  assert.deepEqual(out.refused.map(r => r.slug), ['strangers']);
  assert.match(out.refused[0].reasons.join('\n'), /restricted name/);
  assert.ok(!JSON.stringify(out.refused).includes(SYN_THEME), 'the refusal never repeats the text');
  assert.ok(!('title' in out.refused[0]) && /^[0-9a-f]{64}$/.test(out.refused[0].titleSha256), 'a refused row names its title by sha256 only');
  assert.equal(gql.calls.length, 0);

  const invented = { ...good, body: good.body.replace(LEAD, 'A sentence the page never said, 7 times.') };
  const label = 'Lab 98';
  const reasons = postProblems({ slug: 'strangers', label, title: invented.title, body: invented.body, html: pages.strangers });
  assert.match(reasons.join('\n'), /body line 2 \(sha256 [0-9a-f]{12}\): not a passage of the page, whole/);
  // A fragment of a page sentence (here one that drops its first words) is not the page's own text.
  const fragment = { ...good, body: good.body.replace('- Guessed cap: 40 pebbles, at most 80 on a quiet day.', '- at most 80 on a quiet day.') };
  assert.notEqual(fragment.body, good.body);
  assert.match(postProblems({ ...fragment, label, html: pages.strangers }).join('\n'), /not a passage of the page, whole/);
  assert.match(postProblems({ ...good, label, title: 'Lab 98: A headline of our own', html: pages.strangers }).join('\n'), /the title is not/);
  assert.match(postProblems({ ...good, label: 'Lab 12', html: pages.strangers }).join('\n'), /the title is not/, 'the lab number must be the catalogue\'s');
  assert.match(postProblems({ ...good, label, body: good.body.replace(labUrl('strangers'), `${SITE_URL}labs/other/`), html: pages.strangers }).join('\n'), /a page link other than/);
  assert.match(postProblems({ ...good, label, body: good.body.replace(labUrl('strangers'), 'https://example.com/elsewhere/'), html: pages.strangers }).join('\n'), /a page link other than|a link to somewhere other than this lab/);
  assert.deepEqual(postProblems({ ...good, label, html: pages.strangers }), []);
  const offCatalogue = await run(mockGraphql(), [{ ...good, slug: 'not-a-lab' }]);
  assert.match(offCatalogue.refused[0].reasons.join('\n'), /not on the lab catalogue/);
});

test('dry run: lists and checks, posts nothing, reports would-post and skip rows', async () => {
  const gql = mockGraphql({ existing: [ours(248, 'Lab 97: Do two jars hold more than one?')] });
  const out = await run(gql, [draft('same-model-harness'), draft('strangers')], { dryRun: true });
  assert.equal(gql.creates().length, 0);
  assert.deepEqual(out.posted, []);
  assert.deepEqual(out.skipped.map(s => s.slug), ['same-model-harness']);
  assert.deepEqual(out.wouldPost.map(s => s.slug), ['strangers']);
});

test('the CLI: refuses usage, and without a token writes an audit with the error and posts nothing', () => {
  const script = join(here, 'lab-launch-post.mjs');
  assert.equal(spawnSync(process.execPath, [script, '--dir', temp], { encoding: 'utf8' }).status, 3);
  const dir = join(temp, '2026-11-16');
  mkdirSync(join(dir, 'strangers'), { recursive: true });
  writeFileSync(join(dir, 'strangers', 'github-discussion.md'), draftFile('strangers'));
  assert.deepEqual(draftsIn(dir).map(d => d.slug), ['strangers']);
  const audit = join(temp, 'audit.json');
  const env = { ...process.env }; delete env.GITHUB_TOKEN;
  const r = spawnSync(process.execPath, [script, '--dir', dir, '--repo', 'odin-labs-ai/odin-rnd', '--category', 'Show and tell', '--audit', audit, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  const a = JSON.parse(readFileSync(audit, 'utf8'));
  assert.equal(a.date, '2026-11-16');
  assert.equal(a.dryRun, true);
  assert.match(a.error, /GITHUB_TOKEN/);
  assert.deepEqual(a.posted, []);
});

test('fetchPage asks for no redirect and takes only a 200; tokenGraphql throws without echoing the variables', async t => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return seen.length === 1 ? new Response('<html>', { status: 200 }) : new Response('', { status: seen.length === 2 ? 404 : 203 }); };
  assert.equal(await fetchPage(labUrl('strangers')), '<html>');
  await assert.rejects(fetchPage(labUrl('strangers')), /answered 404/);
  await assert.rejects(fetchPage(labUrl('strangers')), /answered 203/);
  assert.ok(seen.every(s => s.init.redirect === 'error'));
  const secret = `body ${SYN_THEME}`;
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: `cannot post ${secret}` }] }), { status: 200 }); };
  const gql = tokenGraphql('tok-test');
  const error = await gql(CREATE_MUTATION, { title: secret, body: secret }).catch(e => e);
  assert.match(error.message, /GraphQL answered 200: FORBIDDEN/);
  assert.ok(!error.message.includes(SYN_THEME) && !error.message.includes('tok-test'));
  const last = seen.at(-1);
  assert.equal(last.url, GRAPHQL_URL);
  assert.deepEqual(JSON.parse(last.init.body), { query: CREATE_MUTATION, variables: { title: secret, body: secret } });
});

test('the workflow posts only from this repository\'s main, on the schedule or an unticked manual run', () => {
  const wf = readFileSync(join(here, '..', '.github/workflows/lab-launch-drafts.yml'), 'utf8');
  const post = wf.slice(wf.indexOf('\n  post:\n'));
  assert.match(post, /\n    if: github.repository == 'odin-labs-ai\/odin-rnd' && github.ref == 'refs\/heads\/main'\n/);
  assert.match(post, /\n    permissions:\n      contents: read\n      discussions: write\n/);
  assert.match(post, /POST: \$\{\{ github.event_name == 'schedule' \|\| \(github.event_name == 'workflow_dispatch' && inputs.dry_run == false\) \}\}/);
  assert.match(wf, /dry_run:\n        description: [^\n]+\n        type: boolean\n        required: false\n        default: true\n/);
  assert.doesNotMatch(wf, /\n  pull_request|\n  pull_request_target|secrets\./, 'no pull request trigger, no secret');
  assert.match(wf, /\nconcurrency:\n  group: lab-launch-drafts\n  cancel-in-progress: false\n/);
});
