import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, sitemapIsInsertion } from './reviewer-keep-isolation.mjs';

// EXP 011: the isolation check's rules, on synthetic paths (the check itself runs against a base at refute and publish time).
const journal = new Set(['site/journal/which-rules-need-a-model.html', 'site/journal/composable-harness-pre-registration.html']);

test('every file of EXP 005-009 is owned: experiments, scripts, data and existing notes', () => {
  for (const p of ['experiments/jev-gate/labels.json', 'experiments/nina-changes/fence6.mjs', 'experiments/blueprint-floor/rules/abide.json', 'experiments/latent-handoff/corpus.jsonl', 'experiments/composable-harness/FREEZE.json', 'experiments/laya-vs-jev/x.json', 'scripts/jev-gate-prereg.mjs', 'scripts/nina-changes-note.mjs', 'scripts/blueprint-floor-note.mjs', 'scripts/latent-handoff-site.mjs', 'scripts/composable-site.mjs', 'scripts/laya-journal.mjs', 'site/data/blueprint-floor/preregistration.json', 'site/data/composable-harness/preregistration.json']) {
    assert.equal(classify(p, journal), 'owned by another experiment', p);
  }
  assert.equal(classify('site/journal/which-rules-need-a-model.html', journal), 'an existing field note');
});

test('EXP 011\'s own files, the shared files and the re-recorded witnesses are allowed; anything else is not', () => {
  for (const p of ['experiments/reviewer-keep/preregistration.json', 'experiments/reviewer-keep/fixture/src/ids.ts', 'scripts/reviewer-keep-stats.mjs', 'site/journal/where-a-model-reviewer-earns-its-keep.html', 'site/data/reviewer-keep/preregistration.json', 'scripts/build.mjs', 'site/index.html', 'site/sitemap.xml', 'site/data/witnesses/manifest.json']) {
    assert.equal(classify(p, journal), null, p);
  }
  for (const p of ['scripts/check.mjs', 'package.json', 'site/assets/style.css', 'scripts/reviewer-keep/sub.mjs', 'site/data/witnesses/sub/x.json', 'experiments/reviewer-keeper/x.json']) {
    assert.match(classify(p, journal), /outside EXP 011/, p);
  }
});

test('the sitemap may only gain <url> entries', () => {
  const a = '<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>';
  assert.equal(sitemapIsInsertion(a, '<urlset><url><loc>a</loc></url><url><loc>n</loc></url><url><loc>b</loc></url></urlset>'), true);
  assert.equal(sitemapIsInsertion(a, '<urlset><url><loc>b</loc></url></urlset>'), false);
  assert.equal(sitemapIsInsertion(a, '<urlset><url><loc>b</loc></url><url><loc>a</loc></url></urlset>'), false);
  assert.equal(sitemapIsInsertion(a, '<urlset x="1"><url><loc>a</loc></url><url><loc>b</loc></url></urlset>'), false);
});
