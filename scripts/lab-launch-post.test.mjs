import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SYN_THEME } from './test-synthetic-names.mjs';
import { labDrafts, labUrl } from './lab-launch-drafts.mjs';
import { CREATE_MUTATION, DISCUSSIONS_QUERY, REPO_QUERY, draftsIn, parseDiscussionDraft, postLaunchDiscussions, postProblems, sha256 } from './lab-launch-post.mjs';
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
const run = (graphql, drafts, extra = {}) => postLaunchDiscussions({ drafts, repo: 'odin-labs-ai/odin-rnd', category: 'Show and tell', dryRun: false, graphql, fetchPage: served(), ...extra });

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
  const existing = [{ number: 1, title: 'Something else', url: 'https://github.com/odin-labs-ai/odin-rnd/discussions/1' }, { number: 2, title: 'Another', url: 'https://github.com/odin-labs-ai/odin-rnd/discussions/2' },
    { number: 247, title: 'Lab 98: How many pebbles fit in the jar?', url: 'https://github.com/odin-labs-ai/odin-rnd/discussions/247' }];
  const gql = mockGraphql({ existing, pageSize: 1 });
  const out = await run(gql, [draft('same-model-harness'), draft('strangers')]);
  assert.equal(gql.calls.filter(c => c.query === DISCUSSIONS_QUERY).length, 3, 'every page of the list is read');
  assert.deepEqual(out.skipped.map(s => [s.slug, s.url]), [['strangers', 'https://github.com/odin-labs-ai/odin-rnd/discussions/247']]);
  assert.deepEqual(out.posted.map(p => p.slug), ['same-model-harness']);
  assert.deepEqual(gql.creates().map(c => c.variables.title), ['Lab 97: Do two jars hold more than one?']);
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
  assert.ok(!out.refused[0].reasons.join('\n').includes(SYN_THEME), 'the refusal never repeats the text');
  assert.equal(gql.calls.length, 0);

  const invented = { ...good, body: good.body.replace(LEAD, 'A sentence the page never said, 7 times.') };
  const reasons = postProblems({ slug: 'strangers', title: invented.title, body: invented.body, html: pages.strangers });
  assert.match(reasons.join('\n'), /body line 2 \(sha256 [0-9a-f]{12}\): not on the page/);
  assert.match(postProblems({ ...good, title: 'Lab 98: A headline of our own', html: pages.strangers }).join('\n'), /the title is not/);
  assert.match(postProblems({ ...good, body: good.body.replace(labUrl('strangers'), `${SITE_URL}labs/other/`), html: pages.strangers }).join('\n'), /a page link other than/);
  assert.deepEqual(postProblems({ ...good, html: pages.strangers }), []);
});

test('dry run: lists and checks, posts nothing, reports would-post and skip rows', async () => {
  const gql = mockGraphql({ existing: [{ number: 248, title: 'Lab 97: Do two jars hold more than one?', url: 'https://github.com/odin-labs-ai/odin-rnd/discussions/248' }] });
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
