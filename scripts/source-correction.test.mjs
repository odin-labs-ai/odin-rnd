// Dated corrections on the partners, evidence and providers pages (mission rnd-site-ux-nav-1101 wave 6, lane D). #168 put
// each one as an unstyled paragraph between the page's lead and its opening actions. It stays there, open and readable
// without a click, now in a ruled block of its own under a plain dated label ("Corrected on …"), so a visitor meets the
// correction before the buttons. The correction's words are pinned by hash to the text #168 published (213e1f1), so a later
// edit cannot reword one silently.
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
const BLOCK = /<div class="source-correction"><p class="correction-when">Corrected on <time datetime="(\d{4}-\d{2}-\d{2})">(\d{4}-\d{2}-\d{2})<\/time><\/p><p>([^]*?)<\/p><\/div>/g;

for (const [page, pinned] of Object.entries(PINNED)) {
  test(`${page}: the correction is open between the lead and the buttons, under a dated label, its words unchanged`, () => {
    const html = readFileSync(`site/${page}/index.html`, 'utf8');
    assert.doesNotMatch(html, /<p class="source-correction">/, 'no longer an unstyled paragraph');
    assert.equal((html.match(/class="source-correction"/g) || []).length, 1, 'one correction block, no second copy');
    const found = [...html.matchAll(BLOCK)];
    assert.equal(found.length, 1, 'the block is exactly a dated label and the correction paragraph');
    const [whole, datetime, shown, inner] = found[0];
    assert.equal(sha(inner), pinned, 'the correction text is byte for byte what #168 published');
    // The label is the correction's own date, written as the number-provenance pages allow (text = datetime), and the
    // label carries nothing else: it is matched as raw markup above.
    assert.equal(shown, datetime);
    assert.ok(inner.includes(`<time datetime="${datetime}">${datetime}</time>`), 'the label and the correction carry the same date');
    // Where #168 put it: directly after the lead, directly before the opening actions, in the hero.
    const lead = html.indexOf('<p class="company-lead">');
    const leadEnd = html.indexOf('</p>', lead) + '</p>'.length;
    const at = html.indexOf(whole), actions = html.indexOf('<div class="company-actions">');
    assert.ok(lead > 0 && actions > 0, 'the hero has its lead and its actions');
    assert.equal(html.slice(leadEnd, at).trim(), '', 'directly after the lead');
    assert.equal(html.slice(at + whole.length, actions).trim(), '', 'directly before the buttons');
    assert.ok(actions < html.indexOf('</section>', lead), 'in the hero');
    assert.doesNotMatch(whole, /\shidden\b|<details|<summary/, 'readable without a click');
  });
}

test('the correction block is styled for all three pages as a ruled block, smaller than the lead', () => {
  const css = readFileSync('site/assets/company.css', 'utf8');
  for (const page of Object.keys(PINNED)) assert.match(readFileSync(`site/${page}/index.html`, 'utf8'), /<link rel="stylesheet" href="\.\.\/assets\/company\.css">/, page);
  assert.match(css, /\.source-correction\{[^}]*border:1px solid var\(--rule\)/, 'a ruled box of its own');
  assert.match(css, /\.source-correction\{[^}]*font-size:14px/, 'smaller than the lead');
  assert.match(css, /\.correction-when\{[^}]*font:12px\/1\.6 var\(--mono\)/, 'the dated label reads as a label');
  assert.doesNotMatch(css, /\.source-correction[^{]*\{[^}]*display:none/, 'never hidden');
});

// Partners padding. launch.css stacks the tracks' columns and levels into one column in one media block; inside it the
// columns and levels keep the right padding of the side-by-side layout. The fix must apply at exactly that breakpoint and
// win the cascade, though company.css loads before launch.css on the partners page.
/** Simple selector specificity [ids, classes+attributes+pseudo-classes, types] for the plain selectors used here. */
const specificity = selector => {
  const s = selector.replace(/::?[a-z-]+(\([^)]*\))?/g, m => (m.startsWith('::') ? ' x' : ' .p'));
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length, (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length];
};
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
/** Every rule in `css` as { media, selectors, body }, one level of @media. */
function rules(css) {
  const out = [];
  const text = css.replace(/\/\*[^]*?\*\//g, '');
  for (let i = 0; i < text.length;) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    if (head.startsWith('@media')) {
      let depth = 1, j = open + 1;
      for (; depth && j < text.length; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      for (const r of rules(text.slice(open + 1, j - 1))) out.push({ ...r, media: head });
      i = j;
    } else {
      const close = text.indexOf('}', open);
      out.push({ media: '', selectors: head.split(',').map(s => s.trim()), body: text.slice(open + 1, close) });
      i = close + 1;
    }
  }
  return out;
}

test('partners: the padding fix applies at the breakpoint where the tracks stack, and wins over launch.css', () => {
  const launch = rules(readFileSync('site/assets/launch.css', 'utf8'));
  const company = rules(readFileSync('site/assets/company.css', 'utf8'));
  const partners = readFileSync('site/partners/index.html', 'utf8');
  assert.ok(partners.indexOf('href="../assets/company.css"') < partners.indexOf('href="../assets/launch.css"'), 'company.css loads first, so the fix must win on specificity');
  assert.match(partners, /<body class="company-page">/);
  const stack = launch.find(r => r.media && r.selectors.includes('.track-grid') && r.selectors.includes('.tier-row') && /grid-template-columns:1fr/.test(r.body));
  assert.ok(stack, 'launch.css stacks the track columns and levels');
  for (const [target, base] of [['.track-grid>div', '.track-grid>div'], ['.tier-row article', '.tier-row article']]) {
    const fix = company.find(r => r.selectors.some(s => s.endsWith(target) && s.startsWith('.company-page')) && /padding-right:0/.test(r.body));
    assert.ok(fix, `${target}: company.css removes the right padding`);
    assert.equal(fix.media.replace(/\s+/g, ''), stack.media.replace(/\s+/g, ''), `${target}: at the same breakpoint as the stacking (${stack.media})`);
    const sets = launch.filter(r => r.selectors.includes(base) && /padding(-right)?:/.test(r.body));
    assert.ok(sets.length, `${target}: launch.css sets its padding`);
    const mine = fix.selectors.find(s => s.endsWith(target));
    assert.ok(beats(specificity(mine), specificity(base)), `${mine} outranks ${base}`);
  }
  const inset = company.find(r => r.selectors.includes('.company-page .measure-box') && /padding:20px 18px/.test(r.body));
  assert.ok(inset && /max-width:760px/.test(inset.media), 'boxed notes get a narrower inset on phones');
  assert.ok(beats(specificity('.company-page .measure-box'), specificity('.measure-box')));
});
