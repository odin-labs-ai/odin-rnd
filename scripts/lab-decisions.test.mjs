// "How we decide" (scripts/lab-decisions.mjs): the counts come from the published files, every gate refuses what it
// should, and the rendered page labels every reviewer and advocate an AI model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECISIONS_FILE, parseReview, readDecisions, renderDecisions, statedCount, tableIds, totals } from './lab-decisions.mjs';
import { textOf } from './experiment-ledger.mjs';

// A copy of the repository's published inputs, so a test can break one file without touching the tree.
function fixture(edit) {
  const dir = mkdtempSync(join(tmpdir(), 'odin-decisions-'));
  cpSync('experiments', join(dir, 'experiments'), { recursive: true, filter: src => !/node_modules/.test(src) });
  cpSync('site/data', join(dir, 'site/data'), { recursive: true });
  edit?.(dir);
  return dir;
}
const config = dir => JSON.parse(readFileSync(join(dir, 'site', DECISIONS_FILE), 'utf8'));
const writeConfig = (dir, value) => writeFileSync(join(dir, 'site', DECISIONS_FILE), JSON.stringify(value));
const refuses = (dir, ...patterns) => { try { for (const pattern of patterns) assert.throws(() => readDecisions(join(dir, 'site')), pattern); } finally { rmSync(join(dir), { recursive: true, force: true }); } };

test('the published ledger reads, and every count is the one its files give', () => {
  const ledger = readDecisions('site');
  const byRound = ledger.experiments.flatMap(e => e.rounds.map(r => [e.id, r.reviews.map(v => `${v.side}:${v.vetoes.length}`).join(' ')]));
  assert.deepEqual(byRound, [
    ['EXP 020', 'MongoDB:5 PostgreSQL:6'],
    ['EXP 020', 'MongoDB:1 PostgreSQL:1'],
    ['EXP 021', 'MongoDB:8 PostgreSQL:8'],
    ['EXP 021', 'MongoDB:4 PostgreSQL:2'],
  ]);
  const t = totals(ledger);
  assert.equal(t.vetoes, 35);
  assert.equal(t.accepted, t.vetoes);
  assert.equal(t.amendments, 4);
  assert.equal(ledger.bench.length, 4);
  for (const e of ledger.experiments) for (const r of e.rounds) for (const v of r.reviews) assert.match(v.model, /Claude/);
});

test('the review parser reads both list styles and the verdict-line style, and ends a list at its first paragraph', () => {
  const head = '# MongoDB advocate review\n\nReviewer: an independent model reviewer (Claude, fresh context), 2026-10-25.\n\n';
  assert.deepEqual(parseReview(`${head}## Vetoes\n1. **V1, topology.** Fix.\n2. **The kill.** Fix.\n\n## Predictions\n`, 'x').vetoes, ['topology', 'The kill']);
  assert.deepEqual(parseReview(`${head}## 3. Vetoes\n- **V1: the tuned cell.**\n  - Why: x\n\nNo veto on the rest:\n- **Driver.** fine\n`, 'x').vetoes, ['the tuned cell']);
  const verdicts = parseReview(`${head}(1) THE RULE: ACCEPT.\n(2) THE PARAGRAPH: VETO, narrow.\n`, 'x');
  assert.deepEqual([verdicts.vetoes, verdicts.accepts], [['the paragraph'], ['the rule']]);
  assert.throws(() => parseReview('# MongoDB advocate\n\nReviewer: a person.\n\n## Vetoes\n', 'x'), /model reviewer/);
  assert.throws(() => parseReview('# A review\n\nReviewer: an independent model reviewer (Claude, x).\n', 'x'), /which advocate/);
  assert.deepEqual(tableIds('| # | From |\n|---|---|\n| M1 | a |\n| M2 / P3 | b |\n'), ['M1', 'M2', 'P3']);
  assert.equal(statedCount('All 16 vetoes were accepted.'), 16);
  assert.equal(statedCount('`x` (4 vetoes)'), 4);
  assert.equal(statedCount('two vetoes'), 2);
  assert.equal(statedCount('Every veto was accepted.'), null);
});

test('a quote that is not in its file is refused', () => refuses(fixture(dir => {
  const c = config(dir); c.experiments[0].rounds[0].outcome.quote = 'Every veto was rejected.'; writeConfig(dir, c);
}), /does not contain the quoted outcome/));

test('a stated count that disagrees with the reviews is refused', () => refuses(fixture(dir => {
  const f = join(dir, 'experiments/failover/FREEZE-NOTES.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('All 16 vetoes were accepted.', 'All 15 vetoes were accepted.'));
  const c = config(dir); for (const r of c.experiments[1].rounds) { for (const k of r.claims ?? []) k.quote = k.quote.replace('16', '15'); if (r.outcome.quote.includes('16')) r.outcome.quote = r.outcome.quote.replace('16', '15'); } writeConfig(dir, c);
}), /says 15, but the round has 16/));

test('a freeze table that does not match the reviews is refused', () => refuses(fixture(dir => {
  const f = join(dir, 'experiments/mongodb-home-ground/reviews/mongodb-advocate.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('5. **Undefined gates.**', '5. Undefined gates.'));
}), /its table lists .* but the reviews' vetoes give/));

test('a review that does not say it is a model is refused', () => refuses(fixture(dir => {
  const f = join(dir, 'experiments/failover/reviews/postgresql-advocate.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('an independent model reviewer', 'an independent reviewer'));
}), /does not say it is a model reviewer/));

test('a missing file, or one outside what this site publishes, is refused', () => refuses(fixture(dir => {
  const c = config(dir); c.experiments[1].amendments.push('experiments/failover/amendment-09/amendment.json'); c.experiments[0].disclosures.push({ file: '../secret.json', pointer: '/x' }); writeConfig(dir, c);
}), /amendment-09\/amendment\.json: is not published/, /secret\.json: not a file this site or its repository publishes/));

test('the page\'s own words must pass the screen and say AI beside any advocate', () => refuses(fixture(dir => {
  const c = config(dir); c.why.push('Our advocates checked it with a call to +31 6 1234 5678.'); writeConfig(dir, c);
}), /without saying, in the same sentence, that it is AI/, /phone number/));

test('every block on the rendered page that names a reviewer or advocate says AI', () => {
  const html = renderDecisions(readDecisions('site'));
  const blocks = [...html.matchAll(/<(p|td|li|caption|th)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => textOf(m[2]));
  const bad = blocks.filter(text => /\b(review\w*|jury|judge\w*|advocate\w*)\b/i.test(text) && !/\bAI\b/.test(text));
  assert.deepEqual(bad, []);
  for (const href of html.matchAll(/href="([^"]+)"/g)) assert.match(href[1], /^(https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/blob\/main\/|\.\.\/\.\.\/)/);
});

test('a source outside what is published, even through "..", is refused', () => refuses(fixture(dir => {
  const c = config(dir); c.experiments[0].disclosures.push({ file: 'experiments/../../outside.json', pointer: '/x' }); writeConfig(dir, c);
  writeFileSync(join(dir, '..', 'outside.json'), '{"x":["a secret"]}');
}), /outside\.json: not a file this site or its repository publishes/));

test('a review listed twice in a round is refused', () => refuses(fixture(dir => {
  const c = config(dir); c.experiments[0].rounds[0].reviews.push(c.experiments[0].rounds[0].reviews[0]); writeConfig(dir, c);
}), /a review is listed twice/));

test('a veto list item without a title is refused, never silently dropped', () => refuses(fixture(dir => {
  const f = join(dir, 'experiments/failover/reviews/v1.1-mongodb-advocate.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('- **V2, the change stream consumer.**', '- V2, the change stream consumer.'));
}), /a veto list item has no \*\*title\*\*/));

test('a record title that fails the screen is refused', () => refuses(fixture(dir => {
  const f = join(dir, 'experiments/failover/preregistration.json');
  const r = JSON.parse(readFileSync(f, 'utf8')); r.experiment.title = 'Call +31 6 1234 5678'; writeFileSync(f, JSON.stringify(r));
}), /phone number/));

test('a source that is a symlink out of its published root is refused', () => refuses(fixture(dir => {
  writeFileSync(join(dir, 'outside-linked.json'), '{"x":["a secret"]}');
  symlinkSync(join(dir, 'outside-linked.json'), join(dir, 'experiments/linked.json'));
  const c = config(dir); c.experiments[0].disclosures.push({ file: 'experiments/linked.json', pointer: '/x' }); writeConfig(dir, c);
}), /linked\.json: resolves outside experiments\//));

test('a round needs exactly one advocate per side', () => refuses(fixture(dir => {
  const c = config(dir); c.experiments[0].rounds[1].reviews[1] = 'experiments/mongodb-home-ground/reviews/mongodb-advocate.md'; writeConfig(dir, c);
}), /exactly one MongoDB and one PostgreSQL advocate review, not MongoDB,MongoDB/));
