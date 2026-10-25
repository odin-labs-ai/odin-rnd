import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLab, renderLabs } from './labs.mjs';

// The Labs pages (mission rnd-labs-human-first-1024). `pnpm test` runs before `pnpm build`, so these render in memory
// from site/. Until a screened session is published there is no dispatch: the page says the first one is coming.
const pages = renderLabs();
const lab = readLab();
const page = pages['labs/agent-space/index.html'];

test('with no screened session, the lab page shows no dispatch and says the first session is being recorded', () => {
  assert.match(page, /<div class="lab-empty" id="no-dispatch">/);
  assert.match(page, /The first session is being recorded\./);
  assert.doesNotMatch(page, /<video|class="lab-card"|assets\/labs\//);
  assert.match(pages['labs/index.html'], /<a class="lab-tile" href="agent-space\/">[\s\S]*The first session is being recorded\./);
  assert.doesNotMatch(pages['labs/agent-space/feed.xml'], /<entry>/);
  assert.match(pages['labs/agent-space/feed.xml'], /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"><id>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/labs\/agent-space\/<\/id>/);
  assert.match(pages['labs/agent-space/feed.xml'], new RegExp(`<updated>${lab.since}T00:00:00Z</updated>`));
});

test('the lab page says what the lab is, and asks through the ask-the-agents form', () => {
  for (const line of [...lab.whatItIs, ...lab.howItWorks, lab.whyItMatters, lab.oneLine]) assert.ok(page.includes(line.replaceAll('&', '&amp;')), line);
  assert.match(page, /<a class="button button-primary" id="ask-the-agents" href="https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/issues\/new\?template=ask-the-agents\.yml">Ask the agents<\/a>/);
  assert.match(page, /<link rel="alternate" type="application\/atom\+xml" title="Lab 01: The agent space" href="feed\.xml">/);
});

test('a follow channel without a page says coming soon and links nowhere; only real links are links', () => {
  assert.deepEqual(lab.follow.map(link => link.channel), ['LinkedIn', 'Reddit', 'X', 'GitHub']);
  for (const { channel, url } of lab.follow) {
    if (url) assert.match(page, new RegExp(`<a href="${url.replaceAll('.', '\\.')}">${channel} `));
    else assert.match(page, new RegExp(`<li><span class="lab-soon">${channel}</span> <span class="technical">COMING SOON</span></li>`));
  }
  assert.deepEqual(lab.follow.filter(link => link.url).map(link => link.url), ['https://github.com/odin-labs-ai/odin-rnd']);
});

test('Labs is in the header of the home, the partner pages and both Labs pages, and in the sitemap', () => {
  assert.match(readFileSync('site/index.html', 'utf8'), /<a href="labs\/">Labs<\/a>/);
  for (const file of ['site/partners/index.html', 'site/one-pager/index.html']) assert.match(readFileSync(file, 'utf8'), /<a href="\.\.\/labs\/">Labs<\/a>/, file);
  assert.match(pages['labs/index.html'], /<a href="\.\/" aria-current="page">Labs<\/a>/);
  assert.match(page, /<a href="\.\.\/" aria-current="page">Labs<\/a>/);
  const sitemap = readFileSync('site/sitemap.xml', 'utf8');
  for (const path of ['labs/', 'labs/agent-space/']) assert.ok(sitemap.includes(`<loc>https://odin-labs-ai.github.io/odin-rnd/${path}</loc>`), path);
});

test('the ask form asks for a short public question, an optional agent and consent, and nothing personal', () => {
  const form = readFileSync('.github/ISSUE_TEMPLATE/ask-the-agents.yml', 'utf8');
  assert.match(form, /^labels: \['ask-the-agents'\]$/m);
  assert.match(form, /at most 300 characters/);
  assert.match(form, /- label: My question is public and may appear in a recording\.\n {10}required: true/);
  assert.match(form, /id: agent[\s\S]*- Odin\n {8}- Atlas\n {8}- Juno\n {4}validations:\n {6}required: false/);
  assert.deepEqual([...form.matchAll(/^ {4}id: (\S+)$/gm)].map(m => m[1]), ['question', 'agent', 'public']);
});

test('a follow or ask link is screened as a URL: allowed hosts only, and no restricted name, place or path in it', () => {
  const root = mkdtempSync(join(tmpdir(), 'labs-url-'));
  try {
    mkdirSync(join(root, 'data/labs'), { recursive: true });
    const good = JSON.parse(readFileSync('site/data/labs/agent-space.json', 'utf8'));
    const studio = [...'tfolemag'].reverse().join(''), town = [...'nrooH'].reverse().join('');
    const withLink = url => { const lab = structuredClone(good); lab.follow[0].url = url; return lab; };
    const cases = [
      [withLink(`https://www.linkedin.com/company/${studio}`), /follow\/0\/url: a restricted name/],
      [withLink(`https://www.linkedin.com/company/odin-labs-${town}`), /follow\/0\/url: a place name/],
      [withLink('https://example.com/odin-labs'), /follow\/0\/url: not under an allowed link prefix/],
      [withLink('http://www.linkedin.com/company/odin-labs'), /follow\/0\/url: not an https URL/],
      [withLink('https://www.linkedin.com/company/odin%2Dlabs/config.py'), /follow\/0\/url: a file path/],
      [{ ...good, ask: { ...good.ask, url: `https://github.com/odin-labs-ai/odin-rnd/issues/new?template=ask-${studio}.yml` } }, /ask\/url: a restricted name/],
    ];
    for (const [lab, expected] of cases) {
      writeFileSync(join(root, 'data/labs/agent-space.json'), JSON.stringify(lab));
      assert.throws(() => readLab(root), expected, String(expected));
    }
    writeFileSync(join(root, 'data/labs/agent-space.json'), JSON.stringify(withLink('https://www.linkedin.com/company/odin-labs-rnd')));
    assert.equal(readLab(root).follow[0].url, 'https://www.linkedin.com/company/odin-labs-rnd');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
