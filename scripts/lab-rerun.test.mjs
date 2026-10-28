import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KITS, kitProblems, kitSteps, maskKit, renderKit, runKit } from './lab-rerun.mjs';
import { REVIEW_RECORD, REVIEW_TEMPLATE, readReview, receiptTokens } from './lab-review.mjs';
import { escape, pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';

// "Re-run this" (scripts/lab-rerun.mjs): Lab 06's check-it-yourself kit. The page shows the list CI runs, and CI runs
// exactly the list the page shows; the expected hashes are the record's.
const record = readReview('site');
const page = renderLabs()[REVIEW_TEMPLATE];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const sha = role => record.sources.find(s => s.role === role).sha256;
const clone = () => JSON.parse(readFileSync(`site/${REVIEW_RECORD}`, 'utf8'));

test('the kit runs from this checkout: every command exits 0 and prints exactly its line (what the CI job runs)', () => {
  const results = runKit('review', record);
  assert.equal(results.length, 3);
  for (const r of results) assert.ok(r.ok, `${r.command}: exit ${r.status}, printed ${JSON.stringify(r.got)}, expected ${JSON.stringify(r.prints)}\n${r.stderr}`);
});

test('the expected lines carry the hashes Lab 06\'s record cites, read from the record', () => {
  const steps = kitSteps('review', record);
  assert.deepEqual(steps.map(s => s.command), [
    'node experiments/review-frontier/analyse.mjs --check',
    'sha256sum experiments/review-frontier/results.json',
    'node experiments/nina-changes/write-results6.mjs --check',
  ]);
  assert.equal(steps[1].prints, `${sha('frontier')}  experiments/review-frontier/results.json`);
  assert.equal(sha('frontier'), 'fb01a382cf425e3619f861b8435e84242b183e3e8b4d7ef2fe60e9a05bb086e0');
  assert.equal(steps[2].prints, `PASS experiments/nina-changes/results/results.json recomputes byte for byte (sha256 ${sha('nina')})`);
  assert.equal(sha('nina'), '3ef7bcf6d0317b2095df953b404e86059f9b84ffc4af6b4cb476ddaa7d9c916c');
  // A record citing another hash expects another line, and the run then fails: the hash is never typed into the kit.
  const other = clone();
  other.sources.find(s => s.role === 'nina').sha256 = 'f'.repeat(64);
  const run = runKit('review', other);
  assert.equal(run[2].ok, false);
  assert.match(run[2].prints, /sha256 f{64}\)$/);
});

test('the page renders the block: every command and every line, in order, as the CI job runs them', () => {
  const main = page.split('<main id="main">')[1].split('</main>')[0];
  const block = main.split('id="rerun"')[1].split('</section>')[0];
  const shown = [...block.matchAll(/<pre class="lab-rerun-command"><code>([^<]*)<\/code><\/pre><p>prints<\/p><pre class="lab-rerun-output"><samp>([^<]*)<\/samp><\/pre>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(shown, kitSteps('review', record).map(s => [escape(s.command), escape(s.prints)]));
  assert.match(textOf(block), /Re-run this\. Three commands recompute the two records above\./);
  assert.match(textOf(block), /On macOS, shasum -a 256 in place of sha256sum prints the same line\./);
  assert.match(block, /<a href="https:\/\/github\.com\/odin-labs-ai\/odin-rnd">this site's repository<\/a>/);
  // The repository's address is a link, never page text (the screen refuses it as text).
  assert.doesNotMatch(textOf(block), /github\.com/);
});

test('the mask lets through exactly the kit\'s commands and lines: any other path on the page is still refused', () => {
  const known = [...recordHashes(record), ...receiptTokens(record)];
  assert.ok(pageLeaks(page, known).some(p => /a file path or file name/.test(p)), 'unmasked, the screen refuses the block');
  assert.deepEqual(pageLeaks(maskKit(page, 'review', record), known), []);
  // The same command or line OUTSIDE the block is not masked: only the block, as rendered, once.
  for (const plant of ['node experiments/review-frontier/collect.mjs --check', 'cat site/data/labs/review/record.json', '<code>node experiments/review-frontier/analyse.mjs --write</code>',
    '<code>node experiments/review-frontier/analyse.mjs --check</code>', '<samp>EXP 017: results.json matches the frozen analysis</samp>']) {
    const planted = page.replace('<main id="main">', `<main id="main"><p>${plant}</p>`);
    assert.ok(pageLeaks(maskKit(planted, 'review', record), known).some(p => /a file path or file name/.test(p)), plant);
  }
  // A page without the block as rendered is refused by the mask, not silently passed.
  assert.throws(() => maskKit(page.replace('<code>node experiments/review-frontier/analyse.mjs --check</code>', '<code>x</code>'), 'review', record), /block is not on the page as rendered/);
  const block = renderKit('review', record);
  assert.throws(() => maskKit(page.replace(block, block + block), 'review', record), /block is on the page twice/);
});

test('refusals: a lab without public inputs, a program off the list, a shell argument, a file outside experiments/', () => {
  assert.match(kitProblems('rogue', record)[0], /no kit/);
  assert.match(kitProblems('review', { sources: [] }).join('\n'), /the record has no source frontier/);
  const saved = KITS.review;
  try {
    for (const [argv, reason] of [
      [['bash', 'experiments/review-frontier/analyse.mjs'], /bash is not one of node, sha256sum/],
      [['node', 'experiments/review-frontier/analyse.mjs', '--check;rm'], /is not a plain argument/],
      [['node', 'experiments/review-frontier/analyse.mjs', '$(id)'], /is not a plain argument/],
      [['node', 'scripts/build.mjs'], /is not a regular file of this repository under experiments\//],
      [['node', 'experiments/../scripts/build.mjs'], /is not a regular file of this repository under experiments\//],
      [['node', 'experiments/review-frontier/missing.mjs'], /is not a regular file of this repository under experiments\//],
      [['node', 'experiments/review-frontier'], /is not a regular file of this repository under experiments\//],
    ]) {
      KITS.review = [{ ...saved[0], argv }];
      assert.match(kitProblems('review', record).join('\n'), reason, argv.join(' '));
      assert.throws(() => renderKit('review', record), /the review kit is refused/);
    }
  } finally { KITS.review = saved; }
});

test('a symlink under experiments/, to a script inside or outside the repository, is refused; a regular file is not', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-rerun-'));
  const outside = mkdtempSync(join(tmpdir(), 'lab-rerun-outside-'));
  const saved = KITS.review;
  try {
    mkdirSync(join(root, 'experiments/review-frontier'), { recursive: true });
    mkdirSync(join(root, 'experiments/nina-changes'), { recursive: true });
    writeFileSync(join(outside, 'evil.mjs'), 'console.log(1)\n');
    for (const f of ['review-frontier/results.json', 'nina-changes/write-results6.mjs']) writeFileSync(join(root, 'experiments', f), '');
    symlinkSync(join(outside, 'evil.mjs'), join(root, 'experiments/review-frontier/analyse.mjs'));
    assert.match(kitProblems('review', record, { root }).join('\n'), /experiments\/review-frontier\/analyse\.mjs is not a regular file/);
    rmSync(join(root, 'experiments/review-frontier/analyse.mjs'));
    symlinkSync(join(root, 'experiments/review-frontier/results.json'), join(root, 'experiments/review-frontier/analyse.mjs'));
    assert.match(kitProblems('review', record, { root }).join('\n'), /analyse\.mjs is not a regular file/, 'a symlink inside is refused too');
    rmSync(join(root, 'experiments/review-frontier/analyse.mjs'));
    writeFileSync(join(root, 'experiments/review-frontier/analyse.mjs'), '');
    assert.deepEqual(kitProblems('review', record, { root }), []);
    // A file under a directory that links out of experiments/ does not resolve inside it.
    symlinkSync(outside, join(root, 'experiments/review-frontier/linked'));
    KITS.review = [{ ...saved[0], argv: ['node', 'experiments/review-frontier/linked/evil.mjs'] }];
    assert.match(kitProblems('review', record, { root }).join('\n'), /linked\/evil\.mjs is not a regular file/);
  } finally { KITS.review = saved; rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('a step passes only on exit 0 and exactly its line and one line end', () => {
  const steps = kitSteps('review', record);
  const as = out => (cmd, args) => ({ status: 0, stdout: out(steps.find(s => s.argv.slice(1).join(' ') === args.join(' ')).prints), stderr: '' });
  assert.ok(runKit('review', record, { spawn: as(l => `${l}\n`) }).every(r => r.ok));
  for (const [name, out] of [['trailing space', l => `${l} \n`], ['a tab', l => `${l}\t\n`], ['a blank line', l => `${l}\n\n`], ['no line end', l => l], ['a second line', l => `${l}\nmore\n`], ['a line before', l => `x\n${l}\n`]]) {
    assert.ok(runKit('review', record, { spawn: as(out) }).every(r => !r.ok), name);
  }
  assert.ok(runKit('review', record, { spawn: () => ({ status: 1, stdout: `${steps[0].prints}\n` }) }).every(r => !r.ok), 'exit 1');
});

test('the kit\'s files are tracked in this repository (a clone has them), and the CI job runs this list', () => {
  const tracked = new Set(spawnSync('git', ['ls-files', 'experiments'], { encoding: 'utf8' }).stdout.split('\n'));
  for (const s of KITS.review) for (const a of s.argv.slice(1)) if (!a.startsWith('-')) assert.ok(tracked.has(a), `${a} is tracked`);
  const workflow = readFileSync('.github/workflows/lab-kits.yml', 'utf8');
  assert.match(workflow, /run: node scripts\/lab-rerun\.mjs review\n/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /pull_request:/);
});
