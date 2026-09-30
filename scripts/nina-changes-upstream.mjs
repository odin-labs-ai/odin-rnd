// EXP 006: the live state of the upstream nina PRs Odin Labs opened, as a committed record the spotlight entry reads
// (refute r2 N12: never hard-coded in a renderer).
//   node scripts/nina-changes-upstream.mjs --refresh   ask GitHub (gh) for each PR's state; rewrite upstream.json
//   node scripts/nina-changes-upstream.mjs --check     offline shape check (the tests and the build use this)
// --refresh is run by the commander before each publish, never in CI or the build (it needs the network and gh).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const upstreamPath = 'experiments/nina-changes/upstream.json';
const STATES = ['OPEN', 'MERGED', 'CLOSED'];

export function checkUpstream(record) {
  assert.equal(record?.kind, 'upstream-prs', 'upstream.json is not an upstream-prs record');
  assert.ok(Number.isFinite(Date.parse(record.checkedAt)) && /Z$/.test(record.checkedAt), 'upstream.json checkedAt is an ISO UTC time');
  assert.ok(Array.isArray(record.prs) && record.prs.length > 0, 'upstream.json lists the PRs');
  for (const p of record.prs) {
    assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/, 'repo is owner/name');
    assert.ok(Number.isInteger(p.pr) && p.pr > 0, 'pr is a number');
    assert.ok(typeof p.title === 'string' && p.title.length > 0, 'title');
    assert.ok(STATES.includes(p.state), `state is one of ${STATES.join(', ')}`);
    assert.ok(p.state === 'MERGED' ? /^\d{4}-\d{2}-\d{2}$/.test(p.mergedAt ?? '') : p.mergedAt === null, 'mergedAt is a date exactly when merged');
  }
  return record;
}

export const loadUpstream = (root = '.') => checkUpstream(JSON.parse(readFileSync(join(root, upstreamPath), 'utf8')));

export function refresh(record, gh = (repo, pr) => JSON.parse(execFileSync('gh', ['pr', 'view', String(pr), '--repo', repo, '--json', 'state,title,mergedAt'], { encoding: 'utf8' })), now = new Date()) {
  const prs = record.prs.map(p => {
    const live = gh(p.repo, p.pr);
    return { repo: p.repo, pr: p.pr, title: live.title, state: live.state, mergedAt: live.state === 'MERGED' ? String(live.mergedAt).slice(0, 10) : null };
  });
  return checkUpstream({ ...record, checkedAt: now.toISOString().replace(/\.\d+Z$/, 'Z'), prs });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--refresh') {
    const next = refresh(loadUpstream());
    writeFileSync(upstreamPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(next.prs.map(p => `${p.repo}#${p.pr} ${p.state}${p.mergedAt ? ` ${p.mergedAt}` : ''}`).join('\n'));
  } else if (command === '--check') {
    const r = loadUpstream();
    console.log(`PASS ${upstreamPath} (checked ${r.checkedAt}): ${r.prs.map(p => `#${p.pr} ${p.state}`).join(', ')}`);
  } else { console.error('usage: node scripts/nina-changes-upstream.mjs --refresh | --check'); process.exit(2); }
}
