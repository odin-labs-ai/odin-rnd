// Readability rules of the site's stylesheets (mission rnd-site-ux-nav-1101): the 12px text floor, the mobile header's
// scroll shade and the word-boundary wrap in table cells. These read the committed CSS; the measured result (computed
// font sizes and page widths at 390px) is in the PR's browser walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'site/assets';
const css = name => readFileSync(join(ASSETS, name), 'utf8');

/** Every font size under 12px a stylesheet sets, as "selector → size". */
function smallSizes(text) {
  const found = [];
  for (const [, selector, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, size] of body.matchAll(/font(?:-size)?:[^;}]*?(?<![\d.])(\d+(?:\.\d+)?)px/g)) {
      if (Number(size) < 12) found.push(`${selector.trim()} → ${size}px`);
    }
  }
  return found;
}

test('no stylesheet sets HTML text under 12px; only the factory drawing\'s SVG labels are smaller, by design', () => {
  for (const name of readdirSync(ASSETS).filter(file => file.endsWith('.css')).sort()) {
    // Exempt only a rule whose every selector is inside the factory drawing's SVG.
    const small = smallSizes(css(name)).filter(rule => !rule.split(' → ')[0].split(',').every(selector => /^\.factory-svg\b/.test(selector.trim())));
    assert.deepEqual(small, [], `${name} sets text under 12px`);
  }
  assert.deepEqual(smallSizes('.a{font:11px/1.6 var(--mono)}.b{font-size:12px}.c{font-size:9.5px}'), ['.a → 11px', '.c → 9.5px'], 'the reader finds both forms');
});

test('the mobile header\'s scroll shade is painted in the header\'s own colours, never a fixed dark green', () => {
  const style = css('style.css');
  const rule = style.match(/header\.site-header nav\{order:2;[^}]*\}/)?.[0];
  assert.ok(rule, 'the mobile header nav rule is there');
  assert.match(rule, /--scroll-bg:var\(--ground\)/, 'the shade ground is the header\'s own --ground (dark-surface redefines it)');
  assert.match(rule, /--scroll-shade:color-mix\(in srgb,var\(--paper\) \d+%,transparent\)/, 'the shade is the header\'s own text colour');
  assert.doesNotMatch(rule, /--scroll-(bg|shade):(#|rgb)/, 'no hard-coded shade colour');
  assert.match(style, /\.dark-surface\{--ground:#102b22;/, 'a dark-surface header redefines --ground, so the same rule paints dark there');
});

test('every table cell in the page body wraps at word boundaries; code and hashes still wrap anywhere', () => {
  const style = css('style.css');
  assert.match(style, /(^|\})main td,main th\{overflow-wrap:normal;word-break:normal\}/m, 'all tables in <main>, not only article tables');
  assert.doesNotMatch(style, /\.article-body td,\.article-body th\{overflow-wrap:normal/, 'the old article-only rule is gone');
  assert.match(style, /main code,main \.hash,td code,th code\{overflow-wrap:anywhere\}/);
});

test('the plain-language pass on Partners and Work with us keeps every original claim', () => {
  const partners = readFileSync('site/partners/index.html', 'utf8');
  const work = readFileSync('site/work-with-us/index.html', 'utf8');
  // What the lab is (the hero), what Track B is, and what Track B asks for, as the pages said before the pass.
  for (const claim of ['Odin Labs R&amp;D is where models, tools and vendors meet real work.', 'a running AI factory that ships changes every day, and a lab that measures',
    'A long-term partnership, not a project.', 'Something structural, not only budget for a project', 'with proof behind every step']) assert.ok(partners.includes(claim), `partners/: ${claim}`);
  // Start narrow rather than with a broad rollout; read the public record before talking; the fixtures are ours, not customer claims.
  for (const claim of ['<h2 id="fit-title">Start with one useful question, not a broad rollout.</h2>', '<h2 id="evidence-title">Read the public record before we talk.</h2>',
    'examples we wrote ourselves, not claims about customer results.']) assert.ok(work.includes(claim), `work-with-us/: ${claim}`);
  // The two resource labels name the pages as they are: both are English (lang="en"), and Partners has three tracks.
  assert.match(work, /<a href="\.\.\/partners\/">The partner programme<\/a><a href="\.\.\/one-pager\/">The lab on a page<\/a>/);
  for (const page of ['site/partners/index.html', 'site/one-pager/index.html']) assert.match(readFileSync(page, 'utf8'), /<html lang="en"/, `${page} is in English`);
  assert.equal(new Set(partners.match(/TRACK [A-Z]/g)).size, 3, 'Partners has three tracks');
});
