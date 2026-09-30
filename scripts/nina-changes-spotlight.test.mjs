import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRecords, FIXTURE_BANNER } from '../experiments/jev-gate/runner-guard.mjs';
import { callHitsFingerprint, classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { loadFingerprints } from '../experiments/nina-changes/fingerprints.mjs';
import { seenCalls } from '../experiments/nina-changes/fixtures/synthetic6.mjs';
import { computeResults6 } from '../experiments/nina-changes/results6.mjs';
import { recordToolCalls } from '../experiments/nina-changes/stream6.mjs';
import { checkResults, renderSpotlightCard } from './jev-gate-results-site.mjs';
import { checkRecord } from './nina-changes-prereg.mjs';
import { addNinaEntry, attributionLine, entryId, entryShown, loadEntryData, renderNinaEntry } from './nina-changes-spotlight.mjs';
import { builtCopy } from './test-build.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkPinned6 } from '../experiments/nina-changes/guard6.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';
import { spotlightShown } from '../experiments/nina-changes/spotlight-gate.mjs';

const GATE = 'experiments/nina-changes/spotlight-gate.mjs';

// EXP 006 REVISION 5: nina's entry in "Tools leaving the factory" — rendered only on a PASS with an explicit
// held:false (EXP 005's card gate, reused) and a PASSING manipulation check; figures from the EXP 006 results record.

const { prereg, amendment } = checkRecords({ mode: 'practice' });
const { record: prereg6 } = checkRecord();
const labels = JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8'));
const fingerprints = loadFingerprints();
const truth = Object.fromEntries(labels.items.map(i => [i.id, i.label]));

// A real results6 record (FIXTURE) from 180 synthetic diff-seen runs, each correct: the bar and the manipulation PASS.
function passingResults({ blindRuns = 0 } = {}) {
  const calls = [];
  let n = 0;
  for (const id of Object.keys(truth).sort()) {
    const toolCalls = recordToolCalls(seenCalls(readFileSync(`experiments/jev-gate/corpus/${id}.patch`, 'utf8')), c => callHitsFingerprint(c, fingerprints.items[id]));
    for (let k = 1; k <= 3; k += 1) {
      const blind = n++ < blindRuns;
      const tc = blind ? [] : toolCalls;
      const d = classifyDiffSeen({ calls: tc, fp: fingerprints.items[id] });
      const decision = truth[id] === 'RED' ? 'REJECT' : 'ACCEPT';
      calls.push({ id, run: k, gate: 'reviewer', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:01:00Z', latencyMs: 1, status: 'ok', harnessFailure: null, decision, verdictLine: 'VERDICT', abstention: null, costUsd: 0.25, costBasis: 'api-equivalent', toolCalls: tc, diffSeen: { seen: d.seen, rule: d.rule, evidence: d.evidence }, stream: { finalResultLine: true }, hook: { ran: true, error: false } });
    }
  }
  const run = { schemaVersion: 1, kind: 'gate-run', gate: 'reviewer', experiment: 'EXP 006', mode: 'counted', fixture: true, banner: FIXTURE_BANNER, parentSha256: '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a', amendmentSha256: '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb', notBefore: '2026-09-30T00:00:00Z', code: {}, pins: { patches: [], fingerprintsSha256: 'f'.repeat(64) }, items: Object.keys(truth), partial: null, calls };
  return computeResults6({ exp005: { prereg, amendment }, bar6: prereg6.bar, labels, run, fingerprints, fingerprintsSha256: 'f'.repeat(64), stamp: { fixture: true, parentSha256: run.parentSha256, amendmentSha256: run.amendmentSha256 } });
}
const pass = passingResults();
const open = { kind: 'spotlight-decision', held: false };
const upstream = JSON.parse(readFileSync('experiments/nina-changes/upstream.json', 'utf8')).prs;
const data = (results, decision) => ({ results, decision, measuredOn: '2026-10-02T12:00:00Z', upstream });

test('PASS with an explicit held:false renders nina\'s entry, every figure from the results record', () => {
  assert.equal(pass.spotlight.verdict, 'PASS'); assert.equal(pass.manipulation.state, 'PASS');
  const entry = renderNinaEntry(data(pass, open));
  assert.match(entry, /^<article class="project-row project-featured" id="project-nina"><div class="project-number">005<span>HARNESS<\/span><\/div>/);
  for (const part of ['nina: harness orchestration for Claude Code', 'Marcos Schulz (xhulz)', 'github.com/xhulz/nina', `— ${attributionLine}.`, 'journal/nina-reviews-the-change.html#results', 'journal/jev-as-a-fast-gate.html#spotlight', 'xhulz/nina#39 (merged 2026-09-28)', 'xhulz/nina#41 (open)', 'no local patch to nina', '0 of 180 harness failures', '0 of 90 runs missed drift', '0 of 90 runs falsely rejected', 'the same verdict on 60 of 60 changes', 'in 180 of 180 runs a tool output showed it at least one line of the change', '02 OCT 2026', '<div class="project-links">', '<p class="project-note">', '<dl class="project-spec">']) assert(entry.includes(part), part);
  assert.equal(attributionLine, 'used with the permission of its author, as confirmed by Odin Labs');
  // A figure changed in the record changes the entry: nothing is typed in the renderer.
  const blind5 = passingResults({ blindRuns: 5 });
  assert(renderNinaEntry(data({ ...blind5, spotlight: { ...blind5.spotlight, verdict: 'PASS' }, spotlightEligible: true }, open)).includes('175 of 180 runs'));
});

test('FAIL, held, a missing decision, a non-boolean held, or a failed manipulation check render nothing', () => {
  assert.equal(entryShown(data(pass, open)), true);
  assert.equal(renderNinaEntry(data(pass, { ...open, held: true })), '', 'held');
  assert.equal(renderNinaEntry(data(pass, null)), '', 'no decision record');
  assert.equal(renderNinaEntry(data(pass, { ...open, held: 'false' })), '', 'only an explicit boolean false opens it');
  assert.equal(renderNinaEntry(data({ ...pass, spotlight: { ...pass.spotlight, verdict: 'FAIL' } }, open)), '', 'bar FAIL');
  assert.equal(renderNinaEntry(data({ ...pass, manipulation: { ...pass.manipulation, state: 'FAIL' }, spotlightEligible: false }, open)), '', 'manipulation FAIL');
  const tooBlind = passingResults({ blindRuns: 19 });
  assert.equal(tooBlind.manipulation.state, 'FAIL');
  assert.equal(renderNinaEntry(data(tooBlind, open)), '', '19 of 180 diff-blind');
  assert.equal(renderNinaEntry(null), '');
});

test('the entry goes next after 002 Laya, and there is only ever one nina entry', () => {
  const home = readFileSync('site/index.html', 'utf8');
  const built = addNinaEntry(home, data(pass, open));
  const at = s => built.indexOf(s);
  assert(at('<div class="project-number">002') < at(`id="${entryId}"`) && at(`id="${entryId}"`) < at('<div class="project-number">003'));
  assert.throws(() => addNinaEntry(built, data(pass, open)), /one nina entry only/);
  assert.equal(addNinaEntry(home, data(pass, { ...open, held: true })), home, 'closed gate: the page is unchanged');
  // EXP 005's gated card (the slot this supersedes) stays closed on its committed, held decision.
  assert.equal(renderSpotlightCard(checkResults()), '');
});

test('the live site renders no nina entry: no EXP 006 results exist yet (fresh build copy)', { timeout: 600_000 }, () => {
  assert.equal(loadEntryData(), null);
  const page = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  assert(!page.includes(`id="${entryId}"`) && !page.includes('HARNESS</span>'));
});

test('the gate is pinned (an edit makes the guard refuse), the markup renderer is not; the record states the split', () => {
  assert.match(prereg6.spotlightArtefact.pass, /Tools leaving the factory/);
  assert.match(prereg6.spotlightArtefact.fail, /no entry/);
  assert.match(prereg6.spotlightArtefact.renderer, /scripts\/nina-changes-spotlight\.mjs, the markup, not pinned/);
  assert.match(prereg6.spotlightArtefact.gate, /experiments\/nina-changes\/spotlight-gate\.mjs, pinned/);
  assert.ok(!('scripts/nina-changes-spotlight.mjs' in prereg6.files), 'the markup renderer is not pinned (N5)');
  // Refute r2 B1: the GATE is pinned, and an edit to it makes the counted guard refuse.
  assert.equal(prereg6.files[GATE], createHash('sha256').update(readFileSync(GATE)).digest('hex'));
  const root = scratchDir('nc-gate');
  try {
    mkdirSync(join(root, 'experiments/nina-changes'), { recursive: true });
    writeFileSync(join(root, GATE), readFileSync(GATE, 'utf8').replace("data.results.manipulation?.state === 'PASS'", 'true'));
    assert.throws(() => checkPinned6({ [GATE]: prereg6.files[GATE] }, root), /spotlight-gate\.mjs at [0-9a-f]{64}; it hashes to/);
    writeFileSync(join(root, GATE), readFileSync(GATE));
    assert.doesNotThrow(() => checkPinned6({ [GATE]: prereg6.files[GATE] }, root));
  } finally { removeScratch(root); }
  // The renderer holds no gate logic: it imports the pinned gate.
  const renderer = readFileSync('scripts/nina-changes-spotlight.mjs', 'utf8');
  assert.match(renderer, /import \{ checkDecision, entryShown \} from '\.\.\/experiments\/nina-changes\/spotlight-gate\.mjs';/);
  assert.doesNotMatch(renderer, /held\s*===|manipulation\?\.state\s*===|spotlightEligible\s*===/);
});

test('spotlight-gate.mjs carries EXP 005\'s spotlightShown byte-identical (scripts/jev-gate-results-site.mjs at b2dbb1fd)', () => {
  const fixture = readFileSync('experiments/nina-changes/fixtures/exp005-b2dbb1fd/jev-gate-results-site.mjs.txt', 'utf8');
  assert.equal(createHash('sha256').update(fixture).digest('hex'), 'a88a5e2b8649b21f487374f97158e4d84c82ff371971d70cced5705b019b347f');
  const line = src => src.split('\n').find(l => l.startsWith('export const spotlightShown = '));
  assert.equal(line(readFileSync(GATE, 'utf8')), line(fixture));
  assert.equal(line(readFileSync('scripts/jev-gate-results-site.mjs', 'utf8')), line(fixture), 'EXP 005\'s own copy is unchanged too');
  assert.equal(spotlightShown({ results: { spotlight: { verdict: 'PASS' } }, decision: { held: false } }), true);
});
