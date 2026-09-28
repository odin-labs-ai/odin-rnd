// EXP 005 WO-03/04/05: corpus quotas, patch application, labels, hashes and the leakage lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from '../experiments/jev-gate/author-corpus.mjs';
import { corpusSha256Listing, labelOne, pinnedFiles } from '../experiments/jev-gate/label.mjs';
import { lintConfig, lintText, scanSecrets } from '../experiments/jev-gate/lint.mjs';
import { git } from '../experiments/jev-gate/patchlib.mjs';

const started = performance.now();
const dir = new URL('../experiments/jev-gate/', import.meta.url).pathname;
const read = rel => readFileSync(join(dir, rel), 'utf8');
const spec = JSON.parse(read('corpus-spec.json'));
const manifest = JSON.parse(read('manifest.json'));
const labels = JSON.parse(read('labels.json'));
const blueprint = JSON.parse(read('blueprint.json'));
const patchFiles = readdirSync(join(dir, 'corpus')).sort();
const sha256 = text => createHash('sha256').update(text).digest('hex');

test('manifest meets the corpus-spec quotas exactly', () => {
  assert.equal(manifest.items.length, spec.total);
  assert.ok(spec.total >= 60);
  for (const f of spec.families) {
    const items = manifest.items.filter(i => i.family === f.family);
    assert.equal(items.length, f.quota, f.family);
    assert.ok(items.every(i => i.intent === f.intent), `${f.family} intent`);
  }
  const drift = manifest.items.filter(i => i.intent === 'drift');
  const clean = manifest.items.filter(i => i.intent === 'clean');
  assert.deepEqual([drift.length, clean.length], [spec.intendedSplit.drift, spec.intendedSplit.clean]);
  assert.ok(clean.filter(i => i.nearMiss).length * 3 >= clean.length, 'at least a third of the clean items are near-misses');
  for (const c of blueprint.constraints) {
    assert.ok(drift.filter(i => i.targets.includes(c.id)).length >= 2, `rule ${c.id} is targeted by at least 2 drift items`);
  }
  for (const removed of spec.removedFamilies) assert.ok(!manifest.items.some(i => i.family === removed.family));
});

test('ids are neutral and contiguous; patch files carry nothing else', () => {
  const ids = manifest.items.map(i => i.id);
  assert.deepEqual(ids, Array.from({ length: ids.length }, (_, k) => 'c' + String(k + 1).padStart(3, '0')));
  assert.deepEqual(patchFiles, ids.map(id => id + '.patch'));
  // the shuffle breaks family order: no run of 5 consecutive ids shares a family
  for (let k = 0; k + 5 <= ids.length; k++) assert.ok(new Set(manifest.items.slice(k, k + 5).map(i => i.family)).size > 1);
});

test('every patch applies to base with git apply --check', () => {
  const repo = mkdtempSync(join(tmpdir(), 'exp005-apply-'));
  try {
    cpSync(join(dir, 'base'), repo, { recursive: true });
    git(repo, ['init', '-q', '-b', 'main']);
    for (const f of patchFiles) git(repo, ['apply', '--check', '-'], read('corpus/' + f));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the corpus regenerates byte for byte from the authoring source', () => {
  const { patches, manifest: rebuilt } = build();
  for (const [id, text] of Object.entries(patches)) assert.equal(text, read(`corpus/${id}.patch`), id);
  assert.equal(JSON.stringify(rebuilt, null, 2) + '\n', read('manifest.json'));
});

test('labels: every item labelled, none excluded, disagreements flagged against intent', () => {
  assert.equal(labels.engine.version, '0.3.1');
  assert.equal(labels.engine.extractor, 'ast');
  assert.equal(labels.blueprintSha256, sha256(read('blueprint.json')));
  assert.deepEqual(labels.items.map(i => i.id), manifest.items.map(i => i.id));
  const byId = Object.fromEntries(manifest.items.map(i => [i.id, i]));
  for (const i of labels.items) {
    assert.ok(i.label === 'RED' || i.label === 'GREEN', `${i.id} is ${i.label}`);
    assert.equal(i.intended, byId[i.id].intent === 'drift' ? 'RED' : 'GREEN');
    assert.equal(i.disagree, i.label !== i.intended);
    assert.equal(i.label === 'RED', i.rules.length > 0);
  }
  assert.equal(labels.counts.RED + labels.counts.GREEN, labels.items.length);
  assert.equal(labels.counts.disagree, labels.items.filter(i => i.disagree).length);
});

test('bce spot-check: 5 items re-label identically', async () => {
  // fixed choice: the first RED, the first GREEN, the only multi-rule item, and two near-miss items
  const firstRed = labels.items.find(i => i.label === 'RED').id;
  const firstGreen = labels.items.find(i => i.label === 'GREEN').id;
  const multi = labels.items.find(i => i.rules.length > 1)?.id ?? labels.items[2].id;
  const first = [...new Set([firstRed, firstGreen, multi])];
  const near = manifest.items.filter(i => i.nearMiss && !first.includes(i.id)).slice(0, 5 - first.length).map(i => i.id);
  const pick = [...first, ...near];
  assert.equal(pick.length, 5);
  const recorded = Object.fromEntries(labels.items.map(i => [i.id, i]));
  const again = await Promise.all(pick.map(labelOne));
  for (const r of again) {
    const { intended, intendedRules, rulesMatchIntent, disagree, ...truth } = recorded[r.id];
    assert.deepEqual(r, truth, r.id);
  }
});

test('corpus.sha256 recomputes to the committed listing', () => {
  assert.equal(corpusSha256Listing(), read('corpus.sha256'));
  const listed = read('corpus.sha256').trim().split('\n').map(l => l.split('  ')[1]);
  assert.deepEqual(listed, pinnedFiles());
  for (const f of patchFiles) assert.ok(listed.includes('corpus/' + f));
  for (const f of ['labels.json', 'manifest.json', 'rules.txt', 'blueprint.json', 'gate-question.json']) assert.ok(listed.includes(f));
});

test('leakage lint passes on every gate-facing file', () => {
  const cfg = lintConfig();
  const findings = [
    ...patchFiles.flatMap(f => lintText(read('corpus/' + f), f, cfg)),
    ...['rules.txt', 'gate-question.json'].flatMap(f => lintText(read(f), f, cfg)),
  ];
  assert.deepEqual(findings, []);
});

test('leakage lint negative controls fail, ordinary code passes', () => {
  const cfg = lintConfig();
  const header = (path, hunk = '') => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,4 @@${hunk}\n`;
  const kinds = (text, name = 'c999.patch') => lintText(text, name, cfg).map(f => f.kind);
  const body = " import { money } from './money';\n+import { x } from './x';\n";
  // passes: `cleanup()` and a colour called green in code; `cleanup` in a hunk header
  assert.deepEqual(kinds(header('src/domain/order.ts', ' export function cleanup(order: Order) {') + body + "+const colour = 'green'; cleanup();\n"), []);
  // family names, whole word, anywhere (hyphenated and spaced)
  assert.ok(kinds(header('src/domain/order.ts') + body + '+// fixes the infra-leak here\n').includes('family name'));
  assert.ok(kinds(header('src/domain/order.ts') + body + '+// a dynamic import is fine\n').includes('family name'));
  // label words as whole tokens in paths, hunk headers and ids
  assert.ok(kinds(header('src/domain/drift-helper.ts') + body).includes('label word'));
  assert.ok(kinds(header('src/domain/order.ts', ' export function clean(order: Order) {') + body).includes('label word'));
  assert.ok(kinds(header('src/domain/order.ts') + body, 'c001-clean.patch').includes('label word'));
  assert.ok(kinds(header('src/domain/order.ts') + body, 'drift-01.patch').includes('id'));
  // rule ids anywhere
  assert.ok(kinds(header('src/domain/order.ts') + body + '+// see domain-no-infra\n').includes('rule id'));
  // private paths, emails, credentials
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const p = '/Users/someone/x';\n").includes('private path'));
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const p = '/home/someone/x';\n").includes('private path'));
  assert.ok(!kinds(header('src/domain/order.ts') + body + "+const p = '<ws>/home/probe-user/canary.txt';\n").includes('private path'), 'The scrubbed isolation matrix canary home is not a private path');
  assert.ok(!kinds(header('src/domain/order.ts') + body + "+const p = '…/home/probe-user/canary.txt';\n").includes('private path'), 'The synthetic canary user is exempt however the path is quoted');
  for (const leak of ['/private/var/folders/ab/cd/T/x', '/var/folders/ab/cd/T/x', '/opt/homebrew/bin/claude', '/tmp/x', '/private/tmp/x', '/home/someone/x', '/home/probe-users/x', '/home/probe-user-2/x']) {
    assert.ok(kinds(header('src/domain/order.ts') + body + `+const p = '${leak}';\n`).includes('private path'), `${leak} is a local path`);
  }
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const to = 'someone@example.com';\n").includes('email address'));
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const to = 'someone@example.invalid';\n").includes('email address'));
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const to = 'rebase@example.invalid.com';\n").includes('email address'));
  assert.ok(!kinds(header('src/domain/order.ts') + body + "+GIT_AUTHOR_EMAIL=base@example.invalid\n").includes('email address'), 'The pinned base-commit identity is not a private address');
  assert.ok(kinds(header('src/domain/order.ts') + body + "+const k = 'ghp_" + 'a'.repeat(36) + "';\n").includes('GitHub token'));
});

test('no private paths, emails or credentials anywhere in experiments/jev-gate', () => {
  const walk = d => readdirSync(d).flatMap(n => {
    if (n === '.venv' || n === '__pycache__') return [];
    const abs = join(d, n);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
  const findings = walk(dir).flatMap(abs => scanSecrets(readFileSync(abs, 'utf8'), abs.slice(dir.length)));
  assert.deepEqual(findings, []);
});

test('corpus tests stay inside the time budget', () => {
  const ms = performance.now() - started;
  assert.ok(ms < 60_000, `corpus tests took ${Math.round(ms)} ms`);
});
