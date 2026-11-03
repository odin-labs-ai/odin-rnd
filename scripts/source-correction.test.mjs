// Dated corrections on the partners, evidence and providers pages (mission rnd-site-ux-nav-1101 wave 6, lane D). #168 put
// each one as an unstyled paragraph between the page's lead and its opening actions. Each now sits directly under the
// actions in its own ruled block, open and readable without a click, under a plain dated label ("Corrected on …"). The
// correction's words are pinned by hash to the text #168 published (213e1f1), so a later edit cannot reword one silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PINNED = {
  partners: '32d5c95b716451d5116ac59e33a03c34549d8f20fcc17ff6384297b5b8de2564',
  evidence: '95f1b243a4ef61ca77e9d6d5491c5ae8dea714d6c7e74fff38989bdbf47525d1',
  providers: 'ed01b1897f9eb0b3f07fe074cfd4d010ceed0d92a409618419d0bfe683bda373',
};
const sha = text => createHash('sha256').update(text).digest('hex');
const BLOCK = /<div class="source-correction"><p class="correction-when">Corrected on (<time datetime="(\d{4}-\d{2}-\d{2})">([^<]+)<\/time>)<\/p><p>([^]*?)<\/p><\/div>/g;

for (const [page, pinned] of Object.entries(PINNED)) {
  test(`${page}: the correction is open under the opening actions, under a dated label, its words unchanged`, () => {
    const html = readFileSync(`site/${page}/index.html`, 'utf8');
    assert.doesNotMatch(html, /<p class="source-correction">/, 'no longer a loose paragraph above the actions');
    const found = [...html.matchAll(BLOCK)];
    assert.equal(found.length, 1, 'exactly one correction block');
    const [whole, , datetime, shown, inner] = found[0];
    assert.equal(sha(inner), pinned, 'the correction text is byte for byte what #168 published');
    // The line's date is the correction's own date, written as the number-provenance pages allow (text = datetime).
    assert.equal(shown, datetime);
    assert.ok(inner.includes(`<time datetime="${datetime}">${datetime}</time>`), 'the line and the correction carry the same date');
    // Under the hero's actions, inside the hero, readable without a click: never in a <details>, never hidden.
    const actions = html.indexOf('<div class="company-actions">');
    const at = html.indexOf(whole);
    assert.ok(actions > 0 && at > actions && at < html.indexOf('</section>', actions), 'below the opening actions, in the hero');
    assert.equal(html.slice(html.indexOf('</div>', actions) + '</div>'.length, at).trim(), '', 'directly after them');
    assert.doesNotMatch(whole, /\shidden\b|<details|<summary/);
    assert.equal((html.match(/class="source-correction"/g) || []).length, 1, 'no second, closed copy anywhere on the page');
    assert.ok(!/<details class="source-correction"/.test(html), 'never a disclosure');
    // The label's own words carry no digit outside its <time> (the page is under number provenance).
    assert.doesNotMatch(whole.slice(0, whole.indexOf('</p>')).replace(/<time\b[^>]*>[^<]*<\/time>/g, '').replace(/<[^>]+>/g, ''), /\d/);
  });
}

test('the correction block is styled for all three pages, and the stacked partner tracks lose their stray right padding', () => {
  const css = readFileSync('site/assets/company.css', 'utf8');
  for (const page of Object.keys(PINNED)) assert.match(readFileSync(`site/${page}/index.html`, 'utf8'), /<link rel="stylesheet" href="\.\.\/assets\/company\.css">/, page);
  assert.match(css, /\.source-correction\{[^}]*border:1px solid var\(--rule\)/, 'a ruled box of its own');
  assert.match(css, /\.source-correction\{[^}]*font-size:14px/, 'smaller than the lead');
  assert.match(css, /\.correction-when\{[^}]*font:12px\/1\.6 var\(--mono\)/, 'the dated label reads as a label');
  assert.doesNotMatch(css, /\.source-correction[^{]*\{[^}]*display:none/, 'never hidden');
  // launch.css (loaded after company.css) sets these paddings with equal specificity; the override is scoped to win.
  assert.match(css, /@media\(max-width:900px\)\{\.company-page \.track-grid>div,\.company-page \.tier-row article\{padding-right:0\}\}/);
  assert.match(css, /@media\(max-width:760px\)\{\.company-page \.independence,\.company-page \.measure-box\{padding:20px 18px\}\}/);
  assert.match(readFileSync('site/partners/index.html', 'utf8'), /<body class="company-page">/);
});
