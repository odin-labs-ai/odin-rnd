// Find, as built (mission rnd-site-ux-nav-1101, WP4): scripts/build.mjs writes the site index to dist/data/index.json,
// lists it on dist/find/index.html without JavaScript, and adds the site chrome to every page. Checked on a build in a
// disposable copy (scripts/test-build.mjs), never in the checkout; the pure parts are tested in find-build.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { hrefOnSite, experimentIdsInData } from './site-index.mjs';
import { FIND_MARKER, GROUPS } from './find-build.mjs';
import { FIND_EXEMPT, escapeHtml, pageTitle } from './site-chrome.mjs';
import { journalRows } from './experiment-ledger.mjs';
import { builtCopy } from './test-build.mjs';
import { SITE_ORIGIN } from './site-header.mjs';
import { inspectDom, successfulDocument } from './chrome-dom-test.mjs';
import { chromeBinary } from './og-cards-render.mjs';

const schema = JSON.parse(readFileSync('scripts/schemas/site-index.schema.json', 'utf8'));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const built = () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  const files = walk(dist).map(file => relative(dist, file).split('\\').join('/'));
  const index = JSON.parse(readFileSync(join(dist, 'data/index.json'), 'utf8'));
  return { root, dist, files, index };
};
const chrome = chromeBinary();
const chromeRequired = process.env.GITHUB_ACTIONS === 'true';
test('Chrome activates the absolute Find link from a nested missing-page URL', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 120000 }, async () => {
  assert.ok(chrome, 'Chrome is required in CI');
  const dist = join(builtCopy(), 'dist');
  const findUrl = new URL('find/', SITE_ORIGIN).href;
  const findBody = readFileSync(join(dist, 'find/index.html'), 'utf8');
  const job = { file: join(dist, '404.html'), historyPath: '/odin-rnd/labs/missing', clickSelector: 'header.site-header nav a:last-of-type' };
  const [found, missing] = await inspectDom([
    { ...job, responseFixture: { url: findUrl, status: 200, body: findBody } },
    { ...job, responseFixture: { url: findUrl, status: 404, body: findBody } },
  ], { chrome, siteRoot: dist });
  assert.equal(new URL(found.sourceUrl).pathname, '/odin-rnd/labs/missing', 'the error document is viewed at a nested missing URL');
  assert.equal(successfulDocument(found, { url: findUrl, heading: 'Find something.' }), true, 'clicking Find loads the built Find response in this tab at the canonical URL');
  assert.equal(found.fixtureHits, 1, 'one main-document request received the built Find response');
  assert.equal(missing.url, findUrl, 'the 404 control reaches the same URL');
  assert.equal(missing.responseStatus, 404, 'the control is an HTTP 404 response');
  assert.equal(missing.fixtureHits, 1, 'one main-document request received the 404 control');
  assert.equal(missing.heading, found.heading, 'the control keeps the same rendered heading');
  assert.ok(missing.bodyText.includes('Find something.') && found.bodyText.includes('Find something.'), 'both responses render the built Find heading');
  assert.equal(successfulDocument(missing, { url: findUrl, heading: 'Find something.' }), false, 'changing only the response status to 404 fails the navigation proof');
});
test('Chrome activates Partners in the current tab and rejects a canceled click', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 120000 }, async () => {
  assert.ok(chrome, 'Chrome is required in CI');
  const dist = join(builtCopy(), 'dist');
  const [real, canceled, childCanceled, wrapperCanceled, keyboard, skippedByTab, skippedByParsedTab] = await inspectDom([
    { file: join(dist, 'index.html'), clickSelector: 'footer.site-footer a[href$="partners/"]' },
    { html: '<footer class="site-footer"><a href="partners/" onclick="return false">Partners</a></footer>', clickSelector: 'footer.site-footer a', expectNoNavigation: true },
    { html: '<footer class="site-footer"><a href="partners/"><span onclick="event.preventDefault()">Partners</span></a></footer>', clickSelector: 'footer.site-footer a', expectNoNavigation: true },
    { html: '<footer class="site-footer"><div><span onclick="event.preventDefault()"><a href="partners/">Partners</a></span></div></footer>', clickSelector: 'footer.site-footer a', expectNoNavigation: true },
    { file: join(dist, 'index.html'), clickSelector: 'footer.site-footer a[href$="partners/"]', activation: 'keyboard' },
    { html: '<main><a href="ahead/">Ahead</a></main><footer class="site-footer"><a href="partners/" tabindex="-1">Partners</a></footer>', clickSelector: 'footer.site-footer a', activation: 'keyboard' },
    { html: '<main><a href="ahead/">Ahead</a></main><footer class="site-footer"><a href="partners/" tabindex="-1.5">Partners</a></footer>', clickSelector: 'footer.site-footer a', activation: 'keyboard' },
  ], { chrome, siteRoot: dist });
  assert.equal(successfulDocument(real, { url: new URL('partners/', real.sourceUrl).href }), true, 'the built Partners link loads its site page in this tab');
  assert.match(real.heading, /Partner with/, 'the destination is the Partners page');
  assert.equal(canceled.navigated, false, 'an onclick return false control cannot prove navigation');
  assert.equal(childCanceled.navigated, false, 'activating the rendered child label catches navigation canceled below the anchor');
  assert.equal(wrapperCanceled.navigated, false, 'a wrapper around the link can cancel activation of the rendered label');
  assert.equal(keyboard.focused, true, 'Tab reaches the built Partners link in the footer');
  assert.equal(successfulDocument(keyboard, { url: new URL('partners/', keyboard.sourceUrl).href }), true, 'Enter on the focused Partners link loads its page with HTTP 200');
  assert.match(keyboard.heading, /Partner with/, 'keyboard navigation reaches the actual Partners page');
  assert.equal(skippedByTab.focused, false, 'Tab skips a Partners link with negative tabindex');
  assert.equal(skippedByTab.navigated, false, 'the skipped link cannot satisfy keyboard navigation');
  assert.equal(skippedByParsedTab.focused, false, 'Tab skips a browser-parsed negative tabindex with a suffix');
  assert.equal(skippedByParsedTab.navigated, false, 'the parsed negative tabindex cannot satisfy keyboard navigation');
});
const footerDom = `(() => {
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const readableForeground = el => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    const style = getComputedStyle(el);
    paint.fillStyle = style.getPropertyValue('-webkit-text-fill-color') || style.color;
    paint.fillRect(0, 0, 1, 1);
    return paint.getImageData(0, 0, 1, 1).data[3] > 0;
  };
  const visible = el => {
    if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (!readableForeground(el)) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/\\bopacity\\(0(?:\\.0*)?\\)/.test(style.filter) || style.clipPath !== 'none') return false;
    }
    return [...el.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  };
  const hittable = el => {
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    return [...el.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).some(rect => {
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === el || el.contains(hit);
    });
  };
  const unclippedText = text => {
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!lines.length) return false;
    for (let node = text.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflowClips = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);
      const containClips = style.contain.split(/\\s+/).includes('paint') || style.contain === 'strict' || style.contain === 'content';
      if (!overflowClips && !containClips) continue;
      const box = node.getBoundingClientRect();
      const edge = {
        top: box.top + parseFloat(style.borderTopWidth), bottom: box.bottom - parseFloat(style.borderBottomWidth),
        left: box.left + parseFloat(style.borderLeftWidth), right: box.right - parseFloat(style.borderRightWidth),
      };
      if (lines.some(rect => rect.top < edge.top - 1 || rect.bottom > edge.bottom + 1 || rect.left < edge.left - 1 || rect.right > edge.right + 1)) return false;
    }
    return true;
  };
  const visibleLabel = link => {
    const nodes = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (nodes.nextNode()) if (nodes.currentNode.textContent.trim()) parts.push(nodes.currentNode);
    return parts.length > 0 && parts.every(text => visible(text.parentElement) && hittable(text.parentElement) && unclippedText(text));
  };
  const footers = [...document.querySelectorAll('footer.site-footer')];
  const footer = footers[0];
  const links = footer ? [...footer.querySelectorAll('a')].filter(visible).filter(hittable).filter(a => a.innerText.trim() === 'Partners' && visibleLabel(a)) : [];
  return { url: location.href, footers: footers.length, footerVisible: visible(footer), partners: links.map(a => a.href), downloads: links.filter(a => a.hasAttribute('download')).length, targets: links.filter(a => a.hasAttribute('target')).length };
})()`;

test('Chrome sees one usable Partners footer on every built page and rejects hidden or misdirected fixtures', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 600000 }, async () => {
  assert.ok(chrome, 'Chrome is required in CI');
  const { root, dist, files } = built();
  const pages = files.filter(file => file.endsWith('.html'));
  // Compare the build with its source pages plus the four pages rendered only by generators. A missing built page
  // must fail before the browser loop; walking dist alone would silently skip it.
  const sourcePages = walk(join(root, 'site')).filter(file => file.endsWith('.html')).map(file => relative(join(root, 'site'), file).split('\\').join('/'));
  const generatedPages = ['journal/index.html', 'projects/index.html', 'records/document-store/index.html', 'records/telemetry-truth/index.html'];
  assert.deepEqual([...pages].sort(), [...sourcePages, ...generatedPages].sort(), 'all source and generator pages are present before Chrome checks them');
  const footer = '<footer class="site-footer"><a href="partners/">Partners</a></footer>';
  const fixtures = [
    `<dialog>${footer}</dialog>`, `<dialog open>${footer}</dialog>`,
    '<footer class="site-footer"><div popover><a href="partners/">Partners</a></div></footer>',
    '<footer class="site-footer"><a href="partners/"><template>Partners</template></a></footer>',
    `<!-- first --!><base href="journal/"><!-- second -->${footer}`,
    `<footer class="site-footer" style="display: none /* temporarily hidden */;" ><a href="partners/">Partners</a></footer>`,
    `<style>.site-footer { transform: scale(0) }</style>${footer}`,
    `<style>.site-footer a { clip-path: inset(50%) }</style>${footer}`,
    `<style>.site-footer a { filter: opacity(0) }</style>${footer}`,
    `<style>.site-footer a { color: transparent; text-shadow: none }</style>${footer}`,
    `<style>.site-footer a { color: color(srgb 0 0 0 / 0); text-shadow: none }</style>${footer}`,
    `<style>.site-footer a { -webkit-text-fill-color: transparent; text-shadow: none }</style>${footer}`,
    '<footer class="site-footer"><a href="partners/"><span>Partners</span></a></footer>',
    '<style>.site-footer a span { opacity: 0 }</style><footer class="site-footer"><a href="partners/"><span>Partners</span></a></footer>',
    '<style>.site-footer a span { clip-path: inset(50%) }</style><footer class="site-footer"><a href="partners/"><span>Partners</span></a></footer>',
    '<style>.site-footer a span { display: inline-block; width: 8em; white-space: nowrap; text-indent: 100%; overflow: hidden }</style><footer class="site-footer"><a href="partners/"><span>Partners</span></a></footer>',
    '<footer class="site-footer"><a href="partners/" download>Partners</a></footer>',
    '<iframe name="hidden-frame" hidden></iframe><footer class="site-footer"><a href="partners/" target="hidden-frame">Partners</a></footer>',
  ];
  const result = await inspectDom([...pages.map(file => ({ file: join(dist, file), expression: footerDom })), ...fixtures.map(html => ({ html, expression: footerDom }))], { chrome, siteRoot: dist });
  const expected = new URL('partners/', result[pages.indexOf('index.html')].url).href;
  pages.forEach((page, i) => {
    assert.equal(result[i].footers, 1, `${page}: one footer in the browser DOM`);
    assert.equal(result[i].footerVisible, true, `${page}: footer is visible`);
    assert.deepEqual(result[i].partners, [page === '404.html' ? new URL('partners/', SITE_ORIGIN).href : expected], `${page}: one visible Partners link to the real page`);
    assert.equal(result[i].downloads, 0, `${page}: Partners navigates without download`);
    assert.equal(result[i].targets, 0, `${page}: Partners navigates the current page`);
  });
  const [closed, open, popover, template, base, style, scaled, clipped, filtered, transparentText, modernTransparentText, transparentFill, nestedLabel, fadedNestedLabel, clippedNestedLabel, overflowNestedLabel, download, frame] = result.slice(pages.length);
  assert.equal(closed.footerVisible, false, 'closed dialog hides its footer');
  assert.equal(open.footerVisible, true, 'open dialog shows its footer');
  assert.equal(open.partners.length, 1, 'open dialog shows its link');
  assert.deepEqual(popover.partners, [], 'closed popover hides the link');
  assert.deepEqual(template.partners, [], 'template text does not label a link');
  assert.notEqual(base.partners[0], new URL('partners/', base.url).href, 'abrupt comment end exposes a base that changes the destination');
  assert.equal(style.footerVisible, false, 'inline CSS comment still hides the footer');
  assert.equal(scaled.footerVisible, false, 'a zero-area transformed footer is not visible');
  assert.deepEqual(scaled.partners, [], 'a zero-area transformed link is not usable');
  assert.deepEqual(clipped.partners, [], 'a fully clipped Partners link is not usable');
  assert.deepEqual(filtered.partners, [], 'a fully transparent Partners link is not visible');
  assert.deepEqual(transparentText.partners, [], 'a transparent Partners label without a text shadow is unreadable');
  assert.deepEqual(modernTransparentText.partners, [], 'a color(srgb) transparent Partners label is unreadable');
  assert.deepEqual(transparentFill.partners, [], 'a transparent glyph fill makes the Partners label unreadable');
  assert.deepEqual(nestedLabel.partners, [new URL('partners/', nestedLabel.url).href], 'a visible nested label remains usable');
  assert.deepEqual(fadedNestedLabel.partners, [], 'an invisible nested label cannot make the anchor appear usable');
  assert.deepEqual(clippedNestedLabel.partners, [], 'a fully clipped nested label cannot make the anchor appear usable');
  assert.deepEqual(overflowNestedLabel.partners, [], 'text outside a nested overflow clip cannot make the anchor appear usable');
  assert.equal(download.downloads, 1, 'a download link is distinguishable from navigation');
  assert.equal(frame.targets, 1, 'a hidden-frame target is distinguishable from current-page navigation');
});

test('the build writes the site index with every item schema-valid and linking a file of the built site', () => {
  const { dist, files, index } = built();
  assert.ok(Array.isArray(index.items) && index.items.length > 0, 'the index lists everything the site publishes');
  // Exact per-kind counts, each from a source the index does not read through buildIndex: the experiment folders and
  // data in site/, the committed journal pages, updates.json, the frozen lab dates and the tool pages.
  const count = type => index.items.filter(item => item.type === type).length;
  assert.equal(count('experiment'), experimentIdsInData('site').length, 'one item per experiment on the site');
  assert.equal(count('note'), readdirSync('site/journal').filter(name => name.endsWith('.html')).length, 'one item per field note');
  assert.equal(count('update'), JSON.parse(readFileSync('site/data/updates.json', 'utf8')).updates.length, 'one item per update');
  assert.equal(count('lab'), Object.keys(JSON.parse(readFileSync('site/data/find-lab-dates.json', 'utf8')).labs).length, 'one item per lab');
  assert.equal(count('tool'), readdirSync('site/projects', { withFileTypes: true }).filter(e => e.isDirectory()).length, 'one item per tool page');
  assert.equal(index.items.length, ['experiment', 'note', 'update', 'lab', 'tool'].map(count).reduce((a, b) => a + b), 'no item of another kind');
  const pages = new Set(files);
  for (const item of index.items) {
    assert.deepEqual(validate(schema, item), [], `${item.id} matches the schema`);
    assert.ok(hrefOnSite(item.href, pages), `${item.id} links ${item.href}, a file of the built site`);
    assert.ok(existsSync(join(dist, item.href.split('#')[0].replace(/\/$/, '/index.html'))), `${item.id}: ${item.href} resolves`);
  }
  const topics = JSON.parse(readFileSync('site/data/find-topics.json', 'utf8')).topics;
  assert.deepEqual(index.topics, Object.fromEntries(topics.map(t => [t.id, t.label])), 'every topic carries its label');
  for (const item of index.items) for (const topic of item.topics) assert.ok(topic in index.topics, `${item.id}: topic ${topic} has a label`);
  for (const item of index.items) for (const key of ['title', 'summary']) {
    assert.doesNotMatch(item[key], /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i, `${item.id}'s ${key} is plain text, which the Find page shows as it is`);
  }
  assert.ok(!existsSync('site/data/index.json'), 'the index is built, never committed');
});

test('the Find page lists every item without JavaScript, grouped by kind, each link resolving', () => {
  const { dist, index } = built();
  const html = readFileSync(join(dist, 'find/index.html'), 'utf8');
  assert.ok(!html.includes(FIND_MARKER), 'the marker is replaced');
  const staticBlock = html.match(/<div id="find-static" class="find-static">([\s\S]*?)<\/div>\s*<\/section>/)[1];
  const links = [...staticBlock.matchAll(/<li><a href="([^"]+)">/g)].map(m => m[1]);
  assert.equal(links.length, index.items.length, 'one row per item');
  for (const href of links) {
    assert.ok(href.startsWith('../'), `${href} is relative to find/`);
    const target = resolve(dist, 'find', href.split('#')[0]);
    assert.ok(existsSync(href.split('#')[0].endsWith('/') ? join(target, 'index.html') : target), `${href} resolves from /find/`);
  }
  const headings = [...staticBlock.matchAll(/<h2 id="find-([a-z]+)">/g)].map(m => m[1]);
  assert.deepEqual(headings, GROUPS.map(([type]) => type).filter(type => index.items.some(i => i.type === type)), 'groups in kind order');
  assert.equal((staticBlock.match(/<time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/g) || []).length, index.items.length, 'every row has its date in a <time>');
});

test('every page carries the chrome: one Find link (bar the 404 page) and one chrome stylesheet that resolves', () => {
  const { dist, files } = built();
  for (const rel of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dist, rel), 'utf8');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]*chrome\.css)">/g)].map(m => m[1]);
    assert.equal(sheets.length, 1, `${rel} links chrome.css once`);
    assert.equal(resolve(dirname(join(dist, rel)), sheets[0]), resolve(dist, 'assets/chrome.css'), `${rel}: chrome.css resolves`);
    const nav = html.match(/<header class="site-header[\s\S]*?<\/header>/)?.[0] ?? '';
    const finds = (nav.match(/>Find<\/a>/g) || []).length;
    assert.equal(finds, 1, `${rel} has one Find link in its header${FIND_EXEMPT.has(rel) ? ' (its own)' : ''}`);
  }
});

test('the home field-note rows are unchanged by the chrome: one row per note, five open', () => {
  const { dist, index } = built();
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const notes = index.items.filter(i => i.type === 'note').length;
  assert.equal((home.match(/<a class="journal-row" href="/g) || []).length, notes, 'one home row per field note');
  assert.equal(journalRows(home).length, notes);
  assert.match(home, new RegExp(`Show the ${notes - 5} earlier notes`), 'the home still opens five and folds the rest');
  assert.doesNotMatch(home, /class="crumbs"|class="related"/, 'no breadcrumbs or related links on the home');
});

test('the sitemap lists /find/', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/<\/loc><\/url><\/urlset>/);
});

test('each built page marks only its own page current, while parent sections keep a visual marker', () => {
  const { dist } = built();
  const marksOf = rel => {
    const nav = readFileSync(join(dist, rel), 'utf8').match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];
    return {
      page: [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(m => m[1]),
      section: [...nav.matchAll(/<a\b[^>]*data-current-section[^>]*>([^<]*)<\/a>/g)].map(m => m[1]),
    };
  };
  const expected = {
    'index.html': [],
    'journal/a-passing-pipeline.html': [],
    'journal/index.html': ['Notes &amp; updates'],
    'labs/rogue/index.html': [],
    'labs/index.html': ['Labs'],
    'experiments/index.html': ['All results'],
    'updates/index.html': [],
    'work-with-us/index.html': ['Work with us'],
    'one-pager/index.html': ['Start here'],
    'methods/index.html': ['How we test'],
    // Partners left the header for the footer (plain-language home, 2026-11-16).
    'partners/index.html': [],
    'projects/index.html': [],
    'projects/ci-witness/index.html': [],
    'find/index.html': ['Find'],
  };
  for (const [rel, current] of Object.entries(expected)) assert.deepEqual(marksOf(rel).page, current, rel);
  assert.deepEqual(marksOf('journal/a-passing-pipeline.html').section, ['Notes &amp; updates'], 'a note highlights its parent section');
  assert.deepEqual(marksOf('labs/rogue/index.html').section, ['Labs'], 'a lab page highlights its parent section');
});

test('the sitemap lists /journal/ and /projects/ directly before /find/, which stays last', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/journal\/<\/loc><\/url><url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/projects\/<\/loc><\/url><url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/<\/loc><\/url><\/urlset>/);
});

test('wave 3, as built: one canonical nav on every page, journal/ and projects/ listing every note and tool, crumbs to them', () => {
  const { dist, files, index } = built();
  const CANONICAL = ['Start here', 'Findings', 'Labs', 'All results', 'Notes &amp; updates', 'How we test', 'Work with us', 'Find'];
  for (const rel of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dist, rel), 'utf8');
    const nav = html.match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(m => m[1]), CANONICAL, `${rel}: the canonical nav`);
    assert.equal(/<a href="[^"]*find\/" aria-current="page">Find<\/a>/.test(nav), rel === 'find/index.html', `${rel}: Find is current on /find/ only`);
    // The browser test above checks the rendered Partners footer and its effective destination on every page.
  }
  const rows = page => [...readFileSync(join(dist, page), 'utf8').matchAll(/<li class="update-item" data-reveal><a href="\.\.\/([^"]+)">/g)].map(m => m[1]);
  const hrefsOf = type => index.items.filter(i => i.type === type).map(i => i.href).sort();
  assert.deepEqual(rows('journal/index.html').sort(), hrefsOf('note'), 'journal/ lists every note once');
  assert.deepEqual(rows('projects/index.html').sort(), hrefsOf('tool'), 'projects/ lists every tool once');
  const experiments = readFileSync(join(dist, 'experiments/index.html'), 'utf8');
  assert.equal((experiments.match(/id="every-experiment"/g) || []).length, 1, 'experiments/ ends with All experiments');
  // The All experiments list is exactly the experiments the site's own data publishes, read without the index: one row
  // each, newest number first, each row linking its index item's page.
  const block = experiments.match(/<section [^>]*id="every-experiment"[\s\S]*?<\/section>/)[0];
  const listed = [...block.matchAll(/<span class="update-kind technical">(EXP \d{3})\b/g)].map(m => m[1]);
  const published = experimentIdsInData('site');
  assert.equal(listed.length, published.length, 'one row per experiment the site publishes');
  assert.deepEqual([...listed].sort(), published, 'exactly the experiments the site publishes');
  assert.deepEqual(listed, [...published].reverse(), 'newest number first');
  const rowLinks = [...block.matchAll(/<li class="update-item" data-reveal><a href="\.\.\/([^"]+)">/g)].map(m => m[1]);
  const byId = new Map(index.items.filter(i => i.type === 'experiment').map(i => [i.id, i.href]));
  assert.deepEqual(rowLinks, listed.map(label => byId.get(`exp-${label.slice(4)}`)), 'each row links its experiment\'s page');
  for (const item of index.items.filter(i => i.type === 'note' || i.type === 'tool')) {
    const page = item.href.endsWith('/') ? `${item.href}index.html` : item.href;
    const crumbs = readFileSync(join(dist, page), 'utf8').match(/<nav class="crumbs"[\s\S]*?<\/nav>/)[0];
    const up = item.type === 'note' ? '../journal/' : '../../projects/';
    assert.ok(crumbs.includes(`<a href="${up}">${item.type === 'note' ? 'Field notes' : 'Tools'}</a>`), `${page}: the trail leads to its index page`);
    const label = crumbs.match(/<li aria-current="page">([\s\S]*?)<\/li>/)[1];
    const slug = page.split('/').at(-1) === 'index.html' ? page.split('/').at(-2) : page.split('/').at(-1).replace(/\.html$/, '');
    assert.notEqual(label, slug, `${page}: the trail names the page, not its slug`);
    const html = readFileSync(join(dist, page), 'utf8');
    assert.equal(label, escapeHtml(pageTitle(html)), `${page}: the label is the page's own heading`);
    assert.ok(label.length > slug.length / 2 && /\s/.test(label), `${page}: a title in words`);
  }
});
