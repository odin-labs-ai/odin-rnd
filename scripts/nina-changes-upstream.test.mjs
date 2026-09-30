import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkUpstream, loadUpstream, refresh } from './nina-changes-upstream.mjs';

// EXP 006 refute r2 N12: the upstream PR states the spotlight entry shows come from a committed record, refreshed from
// GitHub before each publish (never in CI or the build), and shape-checked offline.

test('upstream.json holds the live states: #39 merged 2026-09-28, #41 open', () => {
  const r = loadUpstream();
  assert.deepEqual(r.prs.map(p => [p.repo, p.pr, p.state, p.mergedAt]), [['xhulz/nina', 39, 'MERGED', '2026-09-28'], ['xhulz/nina', 41, 'OPEN', null]]);
});

test('--refresh rewrites the states from GitHub (stubbed here: no network in tests) and the shape check refuses a bad record', () => {
  const r = loadUpstream();
  const next = refresh(r, (repo, pr) => (pr === 41 ? { state: 'MERGED', title: 'Keep eval', mergedAt: '2026-10-05T10:00:00Z' } : { state: 'MERGED', title: 'Help', mergedAt: '2026-09-28T10:26:00Z' }), new Date('2026-10-06T00:00:00Z'));
  assert.deepEqual(next.prs.map(p => [p.pr, p.state, p.mergedAt]), [[39, 'MERGED', '2026-09-28'], [41, 'MERGED', '2026-10-05']]);
  assert.equal(next.checkedAt, '2026-10-06T00:00:00Z');
  for (const bad of [{ ...r, prs: [{ ...r.prs[0], state: 'merged' }] }, { ...r, prs: [{ ...r.prs[1], mergedAt: '2026-10-01' }] }, { ...r, checkedAt: 'yesterday' }, { ...r, kind: 'x' }]) assert.throws(() => checkUpstream(bad));
  assert.doesNotMatch(readFileSync('scripts/nina-changes-spotlight.mjs', 'utf8'), /xhulz\/nina#4\d|pull\/39|pull\/41/, 'no PR state is typed in the renderer');
});
