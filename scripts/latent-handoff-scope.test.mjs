import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as headFences from './latent-handoff-fences.mjs';

const { scopeViolations, currentBranch, diffBase, changedPaths, loadBaseFences, fileAt } = headFences;

test('a latent-handoff branch may touch only its own files and its declared shared files', () => {
  assert.deepEqual(scopeViolations('exp/latent-handoff-corpus', ['experiments/jev-gate/labels.json']), ['experiments/jev-gate/labels.json']);
  assert.deepEqual(scopeViolations('exp/latent-handoff-corpus', ['experiments/latent-handoff/corpus.jsonl', 'scripts/latent-handoff-strata.mjs', 'scripts/latent-handoff-strata.test.mjs']), []);
  assert.deepEqual(scopeViolations('exp/latent-handoff-fences', ['scripts/latent-handoff-private-terms.mjs', 'scripts/latent-handoff-private-terms.test.mjs', 'experiments/latent-handoff/permission.sha256']), []);
  // Live experiments' files and tooling, the shared checker (pinned by EXP 006) and the witness receipts stay out of reach.
  for (const path of ['experiments/nina-changes/preregistration.json', 'scripts/nina-changes-runner.mjs', 'scripts/jev-gate-prereg.mjs', 'scripts/check.mjs', 'site/data/witnesses/manifest.json', 'site/data/experiments.json', 'package.json', '.github/workflows/publish.yml', 'experiments/latent-handoff-x/a.json', 'scripts/sub/latent-handoff.mjs']) {
    assert.deepEqual(scopeViolations('exp/latent-handoff-corpus', [path]), [path], path);
  }
  // The site is shared only with a publish branch (`publish` or `publish-*`); the checker stays out of reach there too.
  for (const branch of ['exp/latent-handoff-publish', 'exp/latent-handoff-publish-field-note']) {
    assert.deepEqual(scopeViolations(branch, ['site/journal/x.html', 'site/index.html', 'site/data/latent-handoff/station.json']), [], branch);
    assert.deepEqual(scopeViolations(branch, ['scripts/check.mjs', 'experiments/nina-changes/x.json']), ['scripts/check.mjs', 'experiments/nina-changes/x.json'], branch);
  }
  assert.deepEqual(scopeViolations('exp/latent-handoff-publisher', ['site/journal/x.html']), ['site/journal/x.html']);
  assert.deepEqual(scopeViolations('exp/latent-handoff-corpus', ['site/journal/x.html']), ['site/journal/x.html']);
  // Other branches are not judged by this fence.
  assert.deepEqual(scopeViolations('exp/nina-changes-b1', ['experiments/jev-gate/labels.json']), []);
  assert.deepEqual(scopeViolations('main', ['scripts/check.mjs']), []);
});

test('this change stays inside its scope, judged by the fences at its base', async t => {
  const branch = currentBranch(process.cwd());
  if (!/^exp\/latent-handoff-/.test(branch ?? '')) { t.skip(`branch ${branch ?? '(none)'} is not a latent-handoff branch`); return; }
  const base = diffBase(process.cwd());
  assert(base, 'a latent-handoff branch must have a diff base (fails closed)');
  const judge = (await loadBaseFences(base, process.cwd())) ?? headFences;
  const violations = judge.scopeViolations(branch, changedPaths(base, process.cwd()));
  assert.deepEqual(violations, [], `${branch} touches files outside its scope: ${violations.join(', ')}`);
});

test('no gate file present at the base is deleted (on every branch)', async t => {
  const base = diffBase(process.cwd());
  if (!base) {
    assert.notEqual(process.env.GITHUB_EVENT_NAME, 'pull_request', 'no diff base in a pull_request run (fails closed)');
    t.skip('no origin/main to compare against');
    return;
  }
  const judge = (await loadBaseFences(base, process.cwd())) ?? headFences;
  const missing = judge.gateFiles.filter(path => fileAt(base, path, process.cwd()) !== null && !existsSync(path));
  assert.deepEqual(missing, [], `gate files deleted: ${missing.join(', ')}`);
});

test('gate files change only on the fences branch (on every branch, judged at the base)', async t => {
  const base = diffBase(process.cwd());
  if (!base) {
    assert.notEqual(process.env.GITHUB_EVENT_NAME, 'pull_request', 'no diff base in a pull_request run (fails closed)');
    t.skip('no origin/main to compare against');
    return;
  }
  const judge = (await loadBaseFences(base, process.cwd())) ?? headFences;
  if (!judge.gateEditViolations) { t.skip('the base predates this rule'); return; }
  const branch = currentBranch(process.cwd());
  if (branch === 'HEAD' && !process.env.GITHUB_ACTIONS) { t.skip('detached HEAD outside CI: no branch to judge'); return; }
  const edits = judge.gateEditViolations(branch, changedPaths(base, process.cwd()));
  assert.deepEqual(edits, [], `gate files edited outside the fences branch: ${edits.join(', ')}`);
});

test('gate edits are confined to the fences branch', () => {
  const { gateEditViolations, gateFiles } = headFences;
  assert.deepEqual(gateEditViolations('exp/latent-handoff-fences', gateFiles), []);
  assert.deepEqual(gateEditViolations('exp/latent-handoff-fences-r2', gateFiles), []);
  for (const branch of ['exp/latent-handoff-corpus', 'exp/latent-handoff-publish', 'feat/other', 'main']) {
    assert.deepEqual(gateEditViolations(branch, ['scripts/latent-handoff-scope.test.mjs', 'experiments/latent-handoff/a.json']), ['scripts/latent-handoff-scope.test.mjs'], branch);
  }
});
