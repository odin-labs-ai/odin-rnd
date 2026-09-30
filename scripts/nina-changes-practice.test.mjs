import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { practiceItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { loadBaseLines } from '../experiments/nina-changes/base-lines.mjs';
import { classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { fingerprintItem } from '../experiments/nina-changes/fingerprints.mjs';
import { seenCalls } from '../experiments/nina-changes/fixtures/synthetic6.mjs';
import { buildPractice6, OUT } from '../experiments/nina-changes/practice/author-practice6.mjs';

// EXP 006 R2-3 / R3-5: practice rows p04 (a file in a new directory), p05 (a rename), p06 (modify + add). Never scored.

const rows = JSON.parse(readFileSync(OUT, 'utf8'));
const baseSet = new Set(loadBaseLines().sha256s);

test('practice-rows.json rebuilds byte for byte and holds only non-corpus practice ids', () => {
  assert.equal(readFileSync(OUT, 'utf8'), `${JSON.stringify(buildPractice6(), null, 2)}\n`);
  assert.deepEqual(practiceItems(OUT).map(i => i.id), ['p04', 'p05', 'p06']);
});

test('each practice row has the shape it is for, at least one fingerprint, and a synthetic seen/blind pair that classifies', () => {
  const fp = Object.fromEntries(rows.items.map(i => [i.id, fingerprintItem(i.patch, baseSet)]));
  assert.deepEqual([fp.p04.added, fp.p04.modified], [['src/reports/revenue.ts'], []], 'p04: add-only, in a directory the base does not have');
  assert.deepEqual(fp.p05.renames, [{ from: 'src/infra/mail/mailer.ts', to: 'src/infra/mail/smtp-mailer.ts' }]);
  assert.deepEqual([fp.p06.added, fp.p06.modified], [['src/domain/refund.ts'], ['src/domain/index.ts']]);
  for (const { id, patch } of rows.items) {
    assert.ok(fp[id].plus.length + fp[id].minus.length >= 1, `${id} has a fingerprint`);
    assert.equal(classifyDiffSeen({ calls: seenCalls(patch), fp: fp[id] }).seen, true, `${id} seen`);
    const blind = [{ tool: 'Bash', input: { command: 'git status --short > "$TMPDIR/st.txt"' }, isError: true, output: 'denied' }, { tool: 'Read', input: { file_path: 'rules.txt' }, isError: false, output: '     1→rules' }];
    assert.equal(classifyDiffSeen({ calls: blind, fp: fp[id] }).seen, false, `${id} blind`);
  }
  // p04 can be seen only by rule (b): the new directory as `?? src/reports/`, then a Read of the file.
  assert.equal(classifyDiffSeen({ calls: seenCalls(rows.items[0].patch).map(c => (c.input.command === 'git status --short' ? { ...c, output: '?? src/reports/\n' } : c)), fp: fp.p04 }).rule, 'b');
});
