import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOW, CATEGORIES, compute, DENY, formOf, render } from '../experiments/nina-changes/denial-census.mjs';
import { decideBash, decideFence5, decideFence6, fence6Tools, FENCE6_SETTINGS, OPEN_QUESTIONS, SANDBOX6_ONLY_SETTINGS, splitCompound } from '../experiments/nina-changes/fence6.mjs';
import { FENCE5_SETTINGS } from '../experiments/jev-gate/run_reviewer.mjs';

// EXP 006 WO-1-01: the census of EXP 005's 317 refused git commands, recomputed from the committed records.

const committed = JSON.parse(readFileSync('experiments/nina-changes/denial-census.json', 'utf8'));
const WS = '/home-cache/nina-changes-reviewer-AbC123/repo';

test('denial-census.json is exactly what the generator computes from the committed EXP 005 records', () => {
  assert.equal(readFileSync('experiments/nina-changes/denial-census.json', 'utf8'), render(compute()));
});

test('the census counts sum to 317 and every denial is mapped to ALLOW-IN-FENCE6 or STAYS-DENIED with a reason', () => {
  assert.equal(committed.totals.gitDenials, 317);
  assert.equal(committed.totals.denials, 317, 'every EXP 005 refusal was a git command');
  assert.equal(committed.categories.reduce((s, c) => s + c.denials, 0), 317);
  assert.equal(committed.commands.reduce((s, c) => s + c.count, 0), 317);
  assert.equal(committed.totals.allowInFence6 + committed.totals.staysDenied, 317);
  assert.deepEqual(committed.categories.map(c => c.category), CATEGORIES);
  for (const c of committed.commands) {
    assert.ok([ALLOW, DENY].includes(c.fence6), c.command);
    if (c.fence6 === DENY) assert.ok(typeof c.reason === 'string' && c.reason.length > 0, `${c.command}: a reason`);
    assert.equal(c.fence5, 'DENIED', `${c.command}: the offline model reproduces EXP 005's refusal`);
  }
  assert.equal(committed.totals.reports, 180);
  assert.equal(committed.runs.length, 180, 'one row per report');
});

test('the headline figures: the forms nina used, and the blind runs (first attempt denied, then a fallback)', () => {
  const cat = Object.fromEntries(committed.categories.map(c => [c.category, c]));
  assert.equal(cat['git -C <ws> <verb>'].denials, 103);
  assert.equal(cat['git --no-pager <verb>'].denials, 27);
  assert.equal(cat['-C + --no-pager'].denials, 29);
  assert.equal(cat.compound.denials, 158);
  assert.equal(committed.blindRuns.runs, 131);
  assert.equal(committed.blindRuns.firstAttemptStillDenied, 123, '123 of 131 blind runs started with a form fence6 still denies');
  assert.equal(committed.blindRuns.anyAllowedInFence6, 130, '130 of 131 blind runs tried a form fence6 allows');
  assert.equal(committed.totals.allowInFence6, 184);
});

test('fence6 keeps every fence5 deny rule and the whole sandbox; sandbox6-only drops only the text rules', () => {
  assert.deepEqual(FENCE6_SETTINGS, FENCE5_SETTINGS);
  assert.deepEqual(SANDBOX6_ONLY_SETTINGS.sandbox, FENCE5_SETTINGS.sandbox);
  assert.equal(SANDBOX6_ONLY_SETTINGS.permissions.deny, undefined);
  const tools = fence6Tools(WS);
  assert.deepEqual(tools.slice(0, 3), ['Read(./**)', 'Grep(./**)', 'Glob(./**)']);
  assert.equal(tools.length, 3 + 16);
  for (const verb of ['diff', 'status', 'show', 'log']) {
    for (const p of ['git', 'git --no-pager', `git -C ${WS}`, `git -C ${WS} --no-pager`]) assert.ok(tools.includes(`Bash(${p} ${verb}:*)`), `${p} ${verb}`);
  }
  assert.ok(!tools.some(t => /Bash\((?!git )/.test(t)), 'no non-git Bash rule, no blanket compound rule');
  assert.throws(() => fence6Tools('has space'), /without whitespace/);
  assert.ok(OPEN_QUESTIONS.length >= 5);
});

test('the offline model: allowed forms, and every escape form stays refused', () => {
  const ok = cmd => decideFence6(cmd, WS).allowed;
  for (const cmd of [`git -C ${WS} diff`, `git -C ${WS} --no-pager diff --stat`, 'git --no-pager diff', 'git status --short && git --no-pager diff',
    'git status --short; git --no-pager diff', 'git diff 2>/dev/null', 'git diff 2>&1', `git -C ${WS} status --short; git -C ${WS} diff`]) assert.ok(ok(cmd), cmd);
  for (const cmd of [`git -C ${WS}/.. status`, 'git -C .. status', `git --no-pager -C ${WS} show HEAD`, 'git -C /other/repo log -p', `git -C ${WS}/link log -p`,
    `git -C ${WS} diff --output=../x HEAD`, `git -C ${WS} diff --no-index ../c rules.txt`, 'git diff && cat ../x', 'git diff; cat ../x', 'git diff | tee ../x',
    `git -C ${WS} log --format=%H > ../x`, 'git diff > d.txt', 'git diff | head -5', 'GIT_DIR=../o/.git git log -p', 'git log -1 --format="$(cat ../x)"',
    'git diff || cat ../x', 'git log --stdin < ../x', 'git ls-files', `git -C "${WS}" diff`]) assert.ok(!ok(cmd), cmd);
  // The fence5 model reproduces EXP 005: none of the -C / --no-pager / compound forms were allowed.
  assert.ok(!decideFence5(`git -C ${WS} diff`).allowed && !decideFence5('git --no-pager diff').allowed && decideFence5('git diff 2>/dev/null').allowed);
  // An outside path under an allowed prefix is refused when the caller supplies the outside test.
  assert.ok(!decideBash(`git -C ${WS} diff ../x rules.txt`, { allow: fence6Tools(WS).filter(t => t.startsWith('Bash(')), outsidePath: t => t.startsWith('..') }).allowed);
});

test('compound splitting keeps 2>&1 whole and ignores operators inside quotes', () => {
  assert.deepEqual(splitCompound('git status --short 2>&1; git diff 2>&1 | head').parts, ['git status --short 2>&1', 'git diff 2>&1', 'head']);
  assert.deepEqual(splitCompound('git log --format="a;b|c" && git diff').parts, ['git log --format="a;b|c"', 'git diff']);
  assert.deepEqual(splitCompound('git diff\ncat x').ops, ['\\n']);
});

test('formOf puts each command in one category by the plan\'s priority', () => {
  assert.equal(formOf('git -C <ws>/repo diff').category, 'git -C <ws> <verb>');
  assert.equal(formOf('git -C <ws>/repo --no-pager diff').category, '-C + --no-pager');
  assert.equal(formOf('git --no-pager diff').category, 'git --no-pager <verb>');
  assert.equal(formOf('git diff 2>&1').category, 'redirection');
  assert.equal(formOf('git log --format="%H"').category, 'quoting');
  assert.equal(formOf('git status && git diff').category, 'compound');
  assert.equal(formOf('git diff').category, 'other');
});
