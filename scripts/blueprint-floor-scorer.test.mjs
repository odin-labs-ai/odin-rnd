import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cohenKappa, finalClass, KILL_THRESHOLD, loadCensusRules, median, score } from '../experiments/blueprint-floor/scorer.mjs';

// EXP 007 R2-8: the pinned census scorer, on hand-calculated fixtures (committed in fixtures/scorer.json).

const { cases } = JSON.parse(readFileSync('experiments/blueprint-floor/fixtures/scorer.json', 'utf8'));
const byName = name => cases.find(c => c.name.startsWith(name));
const close = (a, b) => assert(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('four plugins: per-plugin shares, the median exactly at 25% is not below it (interim), the dispute only lowers', () => {
  const c = byName('four plugins'), r = score(c.input);
  for (const [p, s] of Object.entries(c.expect.shares)) close(r.perPlugin.find(x => x.plugin === p).expressibleShare, s);
  close(r.median.expressibleShare, c.expect.median);
  close(r.median.preDispute, c.expect.preDispute);
  close(r.median.partialAsHalf, c.expect.partialAsHalf);
  assert.equal(r.median.plugins, c.expect.plugins);
  assert.equal(r.kill.refuted, c.expect.refuted); assert.equal(r.kill.variant, c.expect.variant);
  assert.deepEqual(r.disputes, c.expect.disputes);
  assert.equal(r.perPlugin.find(x => x.plugin === 'a').partialShare, 0.25);
  assert.equal(KILL_THRESHOLD, 0.25);
});

test('all harness errors: every rule counts as not, the median is 0, the premise is refuted, every error listed', () => {
  const c = byName('all harness errors'), r = score(c.input);
  for (const [p, s] of Object.entries(c.expect.shares)) assert.equal(r.perPlugin.find(x => x.plugin === p).expressibleShare, s);
  assert.equal(r.median.expressibleShare, 0);
  assert.equal(r.kill.variant, 'refuted');
  assert.deepEqual(r.errors.map(e => e.ruleId), c.expect.errors);
  assert.equal(r.agreement.n, c.expect.kappaN); assert.equal(r.agreement.kappa, null);
  assert.match(r.agreement.rule, /ended in error are excluded; computed over all census rules including controls/);
  assert.equal(r.perPlugin.find(x => x.plugin === 'b').error, 2);
});

test('ties below the threshold; a plugin with no rules has no share and is listed; downgrades and engine limits are listed', () => {
  const c = byName('ties below'), r = score(c.input);
  assert.equal(r.perPlugin.find(x => x.plugin === 'empty').expressibleShare, null);
  assert.deepEqual(r.pluginsWithoutRules, c.expect.pluginsWithoutRules);
  close(r.median.expressibleShare, c.expect.median);
  assert.equal(r.median.plugins, 2);
  assert.equal(r.kill.refuted, true);
  assert.deepEqual(r.downgrades.map(d => d.ruleId), c.expect.downgrades);
  assert.deepEqual(r.downgrades.map(d => d.failedCheck), ['teeth', 'validate']);
  assert.deepEqual(r.engineLimit, c.expect.engineLimit);
  assert.equal(r.secondary.expressible, c.expect.secondaryExpressible);
  // The secondary rule is never in a plugin's primary share.
  assert.equal(r.perPlugin.find(x => x.plugin === 'a').n, 5);
  // A dispute that proposes a HIGHER class leaves the class where it was.
  assert.deepEqual(r.disputes.find(d => d.ruleId === 'b/3'), { ruleId: 'b/3', from: 'not', to: 'not' });
});

test('controls: the calibration bar (>= 6/7 positive, <= 1/6 negative), and one more negative expressible misses it', () => {
  const c = byName('controls'), r = score(c.input);
  assert.equal(r.controls.positive.expressibleOrPartial, c.expect.positiveHits);
  assert.equal(r.controls.negative.expressible, c.expect.negativeExpressible);
  assert.equal(r.controls.calibrated, true);
  assert.equal(r.median.expressibleShare, 1, 'controls are outside every median');
  const miss = structuredClone(c.input);
  miss.records.n2 = { translator: { translatorClass: 'expressible', classAfterMechanical: 'expressible', failedCheck: null }, adjudicator: { verdict: 'confirm', proposedClass: 'expressible' } };
  assert.equal(score(miss).controls.calibrated, false);
  const fewer = structuredClone(c.input);
  fewer.records.p6 = { translator: { translatorClass: 'not', classAfterMechanical: 'not', failedCheck: null }, adjudicator: { verdict: 'confirm', proposedClass: 'not' } };
  assert.equal(score(fewer).controls.calibrated, false);
});

test('Cohen\'s kappa, by hand: pairs (e,e) (p,p) (n,n) (e,p) give (0.75 - 0.3125) / 0.6875', () => {
  const k = cohenKappa([['expressible', 'expressible'], ['partial', 'partial'], ['not', 'not'], ['expressible', 'partial']]);
  close(k.kappa, (0.75 - 0.3125) / 0.6875);
  assert.equal(cohenKappa([['not', 'not'], ['not', 'not']]).kappa, null, 'chance agreement 1: kappa undefined, reported as null');
});

test('final class rules: confirm keeps, dispute takes the lower, missing adjudication and translator errors are error', () => {
  const t = cls => ({ translatorClass: cls, classAfterMechanical: cls, failedCheck: null });
  assert.equal(finalClass({ translator: t('partial'), adjudicator: { verdict: 'confirm', proposedClass: 'partial' } }).final, 'partial');
  assert.equal(finalClass({ translator: t('expressible'), adjudicator: { verdict: 'dispute', proposedClass: 'not' } }).final, 'not');
  assert.equal(finalClass({ translator: t('partial'), adjudicator: { verdict: 'dispute', proposedClass: 'expressible' } }).final, 'partial');
  assert.equal(finalClass({ translator: t('expressible') }).final, 'error');
  assert.equal(finalClass(undefined).final, 'error');
  assert.equal(median([0.1, 0.9, 0.5]), 0.5); assert.equal(median([0, 1]), 0.5); assert.equal(median([]), null);
  assert.throws(() => score({ plugins: ['a'], rules: [{ ruleId: 'x', plugin: 'a', stratum: 'primary' }, { ruleId: 'x', plugin: 'a', stratum: 'primary' }], records: {} }), /duplicate/);
  assert.throws(() => score({ plugins: ['a'], rules: [], records: { y: {} } }), /outside the census/);
});

test('the real census population: 145 primary, 30 secondary, 13 controls; abide types come only from the withheld field', () => {
  const { rules, plugins } = loadCensusRules();
  assert.equal(plugins.length, 8);
  assert.equal(rules.filter(r => r.stratum === 'primary').length, 145);
  assert.equal(rules.filter(r => r.stratum === 'secondary').length, 30);
  assert.equal(rules.filter(r => r.stratum.startsWith('control')).length, 13);
  const r = score({ rules, plugins, records: {} });
  assert.deepEqual(r.pluginsWithoutRules, ['jev-belay']);
  assert.deepEqual(Object.fromEntries(Object.entries(r.breakdown['pi-verdict']).map(([g, t]) => [g, t.n])), { bash: 14, path: 26, jev: 1 });
  assert.equal(r.median.plugins, 7);
  assert.equal(r.errors.length, rules.length, 'no record: every rule is error, counted as not');
  assert.equal(r.abide.comparable, rules.filter(x => ['lint', 'model'].includes(x.abideType)).length);
});
