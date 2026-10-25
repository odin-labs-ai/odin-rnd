import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARD_PARTS_FILE, readDispatches, readHardParts, readLab, renderLabs } from './labs.mjs';

// The Labs pages (mission rnd-labs-human-first-1024). `pnpm test` runs before `pnpm build`, so these render in memory
// from site/. The empty state (no screened session yet) is rendered from a copy of site/ that holds no dispatch.
const pages = renderLabs();
const lab = readLab();
const page = pages['labs/agent-space/index.html'];
const realDispatches = readDispatches();
// Lab 03's tile is required on every Labs index, so a fixture site carries it and the records it links.
const LAB03_FILES = ['data/labs/failover.json', 'data/failover/preregistration.json', 'data/failover/amendment-01.json', 'journal/failover-pre-registration.html'];
function emptyPages() {
  const root = mkdtempSync(join(tmpdir(), 'labs-empty-'));
  try {
    for (const file of ['labs/index.html', 'labs/agent-space/index.html', 'data/labs/agent-space.json', 'data/labs/delivery/odin-rnd.json', ...LAB03_FILES]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join('site', file)));
    }
    return renderLabs(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('with no screened session, the lab page shows no dispatch and says the first session is being recorded', () => {
  const empty = emptyPages(), emptyPage = empty['labs/agent-space/index.html'];
  assert.match(emptyPage, /<div class="lab-empty" id="no-dispatch">/);
  assert.match(emptyPage, /The first session is being recorded\./);
  assert.doesNotMatch(emptyPage, /<video|class="lab-card"|assets\/labs\//);
  assert.match(empty['labs/index.html'], /<a class="lab-tile" href="agent-space\/">[\s\S]*The first session is being recorded\./);
  assert.doesNotMatch(empty['labs/agent-space/feed.xml'], /<entry>/);
  assert.match(empty['labs/agent-space/feed.xml'], /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"><id>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/labs\/agent-space\/<\/id>/);
  assert.match(empty['labs/agent-space/feed.xml'], new RegExp(`<updated>${lab.since}T00:00:00Z</updated>`));
});

test('the real site: with no dispatch it shows the empty box; with dispatches every one is on the page and in the feed, newest first', () => {
  const dispatchDir = 'site/data/labs/agent-space/dispatches';
  const onDisk = existsSync(dispatchDir) ? readdirSync(dispatchDir).filter(name => !name.startsWith('.')).length : 0;
  assert.equal(realDispatches.length, onDisk, 'every dispatch file on disk is read');
  if (!realDispatches.length) {
    assert.match(page, /<div class="lab-empty" id="no-dispatch">/);
    assert.doesNotMatch(page, /<video|class="lab-card"|assets\/labs\//);
    return;
  }
  assert.doesNotMatch(page, /id="no-dispatch"/);
  assert.match(page, /<video/);
  for (const dispatch of realDispatches) {
    assert.ok(page.includes(dispatch.clip.src), dispatch.session);
    for (const q of dispatch.questions) assert.ok(page.includes(q.evidence), `${dispatch.session} ${q.evidence}`);
    assert.ok(pages['labs/agent-space/feed.xml'].includes(`#${dispatch.session}`), dispatch.session);
  }
  assert.equal((pages['labs/agent-space/feed.xml'].match(/<entry>/g) ?? []).length, realDispatches.length);
  // newest first: realDispatches is sorted newest first; the page and the feed must show them in that order.
  const order = text => realDispatches.map(d => text.indexOf(d.session));
  for (const text of [page, pages['labs/agent-space/feed.xml']]) {
    const at = order(text);
    assert.ok(at.every(i => i >= 0), 'every session id appears');
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'sessions appear newest first');
  }
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
  assert.match(form, /a session can only ask a question of up to 300 characters/);
  assert.doesNotMatch(form, /left out|at most 300/, 'the form does not claim to enforce the cap');
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
      [withLink('https://example.com/odin-labs'), /follow\/0\/url: not on an allowed host/],
      [withLink('https://www.linkedin.com.evil.example/company/odin-labs'), /follow\/0\/url: not on an allowed host/],
      [withLink('https://github.com/odin-labs-ai/odin-rnd.evil.com'), /follow\/0\/url: a GitHub link outside this lab's repository/],
      [withLink('https://github.com/odin-labs-ai/odin-rnd%2eevil.com'), /follow\/0\/url: a GitHub link outside this lab's repository/],
      [withLink('https://github.com/odin-labs-ai/odin-rnd-extra'), /follow\/0\/url: a GitHub link outside this lab's repository/],
      [withLink('https://github.com/odin-labs-ai/odin-rnd%2F..%2Fother'), /follow\/0\/url: a GitHub link outside this lab's repository|a file path/],
      [withLink('https://user@www.linkedin.com/company/odin-labs'), /follow\/0\/url: not on an allowed host/],
      [withLink('http://www.linkedin.com/company/odin-labs'), /follow\/0\/url: not an https URL/],
      [withLink('https://www.linkedin.com/company/odin%2Dlabs/config.py'), /follow\/0\/url: a file path/],
      [{ ...good, ask: { ...good.ask, url: `https://github.com/odin-labs-ai/odin-rnd/issues/new?template=ask-${studio}.yml` } }, /ask\/url: a restricted name/],
    ];
    for (const [lab, expected] of cases) {
      writeFileSync(join(root, 'data/labs/agent-space.json'), JSON.stringify(lab));
      assert.throws(() => readLab(root), expected, String(expected));
    }
    for (const url of ['https://www.linkedin.com/company/odin-labs-rnd', 'https://x.com/odinlabs', 'https://twitter.com/odinlabs',
      'https://www.reddit.com/r/odinlabs/', 'https://github.com/odin-labs-ai/odin-rnd', 'https://github.com/odin-labs-ai/odin-rnd/discussions']) {
      writeFileSync(join(root, 'data/labs/agent-space.json'), JSON.stringify(withLink(url)));
      assert.equal(readLab(root).follow[0].url, url);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('two dated sessions render newest first on the page and in the feed (order checked against the dates, not the sort)', () => {
  if (!realDispatches.length) return assert.ok(true, 'needs one committed dispatch to clone; the empty state is tested above');
  const base = realDispatches[0];
  const root = mkdtempSync(join(tmpdir(), 'labs-order-'));
  try {
    for (const file of ['labs/index.html', 'labs/agent-space/index.html', 'data/labs/agent-space.json', 'data/labs/delivery/odin-rnd.json', ...LAB03_FILES]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join('site', file)));
    }
    const made = [['session-2026-01-02', '2026-01-02'], ['session-2026-03-04', '2026-03-04']];
    for (const [session, date] of made) {
      const swap = src => src.replaceAll(base.session, session);
      const d = { ...JSON.parse(JSON.stringify(base)), session, date };
      d.clip = { ...d.clip, src: swap(d.clip.src) }; d.poster = swap(d.poster); d.stills = d.stills.map(swap);
      d.source = { ...d.source, assetsSha256: Object.fromEntries(Object.entries(d.source.assetsSha256).map(([path, hash]) => [swap(path), hash])) };
      cpSync(join('site', 'assets/labs/agent-space', base.session), join(root, 'assets/labs/agent-space', session), { recursive: true });
      mkdirSync(join(root, 'data/labs/agent-space/dispatches'), { recursive: true });
      writeFileSync(join(root, 'data/labs/agent-space/dispatches', `${session}.json`), JSON.stringify(d));
    }
    const out = renderLabs(root);
    const newestFirst = [...made].sort((a, b) => b[1].localeCompare(a[1])).map(([session]) => session);
    assert.deepEqual(newestFirst, ['session-2026-03-04', 'session-2026-01-02']);
    for (const text of [out['labs/agent-space/index.html'], out['labs/agent-space/feed.xml']]) {
      const [a, b] = newestFirst.map(session => text.indexOf(session));
      assert.ok(a >= 0 && b >= 0 && a < b, 'the March session comes before the January one');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the lab page shows the films, the measured panels and the hard parts, in that order around the dispatches', () => {
  const at = id => page.indexOf(`<section class="company-section company-width" id="${id}"`);
  const order = ['films', 'dispatches', 'measured', 'hard-parts'].map(at);
  assert.ok(order.every(i => i >= 0), 'every section is on the page');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const hard = readHardParts();
  for (const part of hard.parts) {
    assert.ok(page.includes(`<h3>${part.title}</h3>`), part.title);
    for (const link of part.links) assert.ok(page.includes(`href="${link.href.startsWith('data/') ? `../../${link.href}` : link.href}"`), link.href);
  }
});

test('a hard part links only to its own page, this lab\'s repository or a published lab record, and passes the screen', () => {
  const root = mkdtempSync(join(tmpdir(), 'labs-hard-'));
  try {
    for (const file of ['labs/index.html', 'labs/agent-space/index.html', 'data/labs/agent-space.json', 'data/labs/delivery/odin-rnd.json']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join('site', file)));
    }
    mkdirSync(join(root, HARD_PARTS_FILE, '..'), { recursive: true });
    const good = JSON.parse(readFileSync(join('site', HARD_PARTS_FILE), 'utf8'));
    const withLink = href => { const r = structuredClone(good); r.parts = [{ title: 'A part.', text: 'Plain words.', links: [{ label: 'There', href }] }]; return r; };
    const cases = [
      [withLink('https://example.com/records'), /not this page, this lab's repository or a published lab record/],
      [withLink('https://github.com/odin-labs-ai/other-repo'), /not this page, this lab's repository or a published lab record/],
      [withLink('data/labs/agent-space/dispatches/session-2026-01-01.json'), /not this page, this lab's repository or a published lab record/],
      [withLink('../../secrets.json'), /not this page, this lab's repository or a published lab record/],
      [{ ...withLink('#films'), parts: [{ title: 'A part.', text: `Built with ${[...'tfolemag'].reverse().join('')}.`, links: [{ label: 'There', href: '#films' }] }] }, /parts\/0\/text: a restricted name/],
    ];
    for (const [record, expected] of cases) {
      writeFileSync(join(root, HARD_PARTS_FILE), JSON.stringify(record));
      assert.throws(() => readHardParts(root), expected, String(expected));
    }
    writeFileSync(join(root, HARD_PARTS_FILE), JSON.stringify(withLink('#nowhere-on-the-page')));
    assert.throws(() => renderLabs(root), /the link #nowhere-on-the-page lands on nothing on the page/);
    writeFileSync(join(root, HARD_PARTS_FILE), JSON.stringify(withLink('#films')));
    assert.match(renderLabs(root)['labs/agent-space/index.html'], /<a href="#films">There<\/a>/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
