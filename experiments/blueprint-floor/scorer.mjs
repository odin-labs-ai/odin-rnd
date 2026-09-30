// EXP 007 R2-8: the census scorer, pinned before any census call. Pure: the same records give the same results.
//
// Per rule: the translator's class after the mechanical checks (a failed check lowers it once; see protocol.mjs), then
// the adjudicator: confirm keeps it, dispute takes the LOWER of the two classes (not < partial < expressible), so a
// dispute can only lower expressibility. A harness failure in either role is class error, counted as not.
// Per plugin (primary stratum only): n, the expressible share (final expressible / n) and the partial share.
// Headline: the median across plugins of the expressible share (strict). A plugin whose primary stratum is empty has no
// share and is listed, not counted. Also: the median before disputes, the median with partial counted as 0.5 (reported,
// not decisive), the controls' calibration bar, translator-adjudicator agreement (Cohen's kappa over the 3 classes), the
// dispute, downgrade, engine-limit and error lists, and the comparison with abide's own type field.
// Kill (pre-registered): median expressible share < 25% -> premise refuted; the census is the result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORDER = ['not', 'partial', 'expressible'];
export const KILL_THRESHOLD = 0.25;
export const CALIBRATION = { positiveMin: 6, positiveOf: 7, negativeMax: 1, negativeOf: 6 };
const lower = (a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const counted = c => (c === 'error' ? 'not' : c);

/** The final class of one rule from its record. Returns { final, preDispute, disputed, downgraded, failedCheck, engineLimit, error }. */
export function finalClass(record) {
  const none = { disputed: false, downgraded: false, failedCheck: null, engineLimit: false };
  if (!record) return { ...none, final: 'error', preDispute: 'error', error: 'no record' };
  const t = record.translator;
  if (!t || record.translatorError || !ORDER.includes(t.classAfterMechanical)) return { ...none, final: 'error', preDispute: 'error', error: record.translatorError ?? 'translator harness failure' };
  const pre = t.classAfterMechanical;
  const base = { disputed: false, downgraded: t.classAfterMechanical !== t.translatorClass, failedCheck: t.failedCheck ?? null, engineLimit: Boolean(t.engineLimit) };
  const a = record.adjudicator;
  if (!a || record.adjudicatorError || !['confirm', 'dispute'].includes(a.verdict) || (a.verdict === 'dispute' && !ORDER.includes(a.proposedClass))) return { ...base, final: 'error', preDispute: pre, error: record.adjudicatorError ?? 'adjudicator harness failure' };
  if (a.verdict === 'confirm') return { ...base, final: pre, preDispute: pre, error: null };
  return { ...base, disputed: true, final: lower(pre, a.proposedClass), preDispute: pre, error: null };
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cohen's kappa over the three classes, for pairs [a, b]. null when there is no pair or chance agreement is total. */
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { kappa: null, n: 0, observed: null, expected: null };
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = ORDER.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return { kappa: pe === 1 ? null : (po - pe) / (1 - pe), n, observed: po, expected: pe };
}

const tally = classes => ({ n: classes.length, expressible: classes.filter(c => c === 'expressible').length, partial: classes.filter(c => c === 'partial').length, not: classes.filter(c => c === 'not').length, error: classes.filter(c => c === 'error').length });
const share = (k, n) => (n ? k / n : null);

/**
 * Score the census. `rules`: [{ ruleId, plugin, stratum: primary|secondary|control-positive|control-negative, abideType? }];
 * `records`: { [ruleId]: { translator: { translatorClass, classAfterMechanical, failedCheck, engineLimit }, adjudicator:
 * { verdict, proposedClass }, translatorError?, adjudicatorError? } }. `plugins`: the plugin names in selection order.
 */
export function score({ rules, records, plugins }) {
  const ids = rules.map(r => r.ruleId);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate ruleId in the census');
  const extra = Object.keys(records).filter(id => !ids.includes(id));
  if (extra.length) throw new Error(`records for rules outside the census: ${extra.join(', ')}`);
  const per = Object.fromEntries(rules.map(r => [r.ruleId, { ...finalClass(records[r.ruleId]), ...r }]));
  const of = stratum => rules.filter(r => r.stratum === stratum).map(r => per[r.ruleId]);

  const perPlugin = plugins.map(plugin => {
    const rs = of('primary').filter(r => r.plugin === plugin);
    const t = tally(rs.map(r => r.final)), pre = tally(rs.map(r => r.preDispute));
    return { plugin, ...t, expressibleShare: share(t.expressible, t.n), partialShare: share(t.partial, t.n), preDisputeExpressibleShare: share(pre.expressible, t.n), sensitivityShare: share(t.expressible + 0.5 * t.partial, t.n) };
  });
  const withRules = perPlugin.filter(p => p.n > 0);
  const med = median(withRules.map(p => p.expressibleShare));
  const secondary = of('secondary'), pos = of('control-positive'), neg = of('control-negative');
  const posHit = pos.filter(r => ['expressible', 'partial'].includes(r.final)).length, negHit = neg.filter(r => r.final === 'expressible').length;
  const all = Object.values(per);
  const pairs = all.filter(r => !r.error && records[r.ruleId]?.adjudicator).map(r => [r.preDispute, records[r.ruleId].adjudicator.verdict === 'confirm' ? r.preDispute : records[r.ruleId].adjudicator.proposedClass]);
  const abide = of('primary').filter(r => r.plugin === 'abide' && r.abideType);
  const agrees = r => (r.abideType === 'lint' ? counted(r.final) === 'expressible' : ['partial', 'not'].includes(counted(r.final)));
  const lm = abide.filter(r => ['lint', 'model'].includes(r.abideType));
  return {
    schemaVersion: 1,
    perPlugin,
    pluginsWithoutRules: perPlugin.filter(p => p.n === 0).map(p => p.plugin),
    median: { expressibleShare: med, preDispute: median(withRules.map(p => p.preDisputeExpressibleShare)), partialAsHalf: median(withRules.map(p => p.sensitivityShare)), plugins: withRules.length },
    kill: { threshold: KILL_THRESHOLD, rule: 'median expressible share < 25% -> premise refuted; the census is the result', median: med, refuted: med !== null && med < KILL_THRESHOLD, variant: med !== null && med < KILL_THRESHOLD ? 'refuted' : 'interim' },
    secondary: { ...tally(secondary.map(r => r.final)), expressibleShare: share(secondary.filter(r => r.final === 'expressible').length, secondary.length) },
    controls: {
      positive: { n: pos.length, expressibleOrPartial: posHit, finals: Object.fromEntries(pos.map(r => [r.ruleId, r.final])) },
      negative: { n: neg.length, expressible: negHit, finals: Object.fromEntries(neg.map(r => [r.ruleId, r.final])) },
      bar: `at least ${CALIBRATION.positiveMin} of ${CALIBRATION.positiveOf} positive controls final expressible or partial, and at most ${CALIBRATION.negativeMax} of ${CALIBRATION.negativeOf} negative controls final expressible`,
      calibrated: pos.length === CALIBRATION.positiveOf && neg.length === CALIBRATION.negativeOf && posHit >= CALIBRATION.positiveMin && negHit <= CALIBRATION.negativeMax,
    },
    agreement: cohenKappa(pairs),
    disputes: all.filter(r => r.disputed).map(r => ({ ruleId: r.ruleId, from: r.preDispute, to: r.final })),
    downgrades: all.filter(r => r.downgraded).map(r => ({ ruleId: r.ruleId, failedCheck: r.failedCheck })),
    engineLimit: all.filter(r => r.engineLimit).map(r => r.ruleId),
    errors: all.filter(r => r.final === 'error').map(r => ({ ruleId: r.ruleId, reason: r.error })),
    abide: {
      mapping: 'lint ~ expressible; model ~ partial or not; unenforceable and deferred reported as-is',
      comparable: lm.length,
      agree: lm.filter(agrees).length,
      agreement: share(lm.filter(agrees).length, lm.length),
      byType: Object.fromEntries(['lint', 'model', 'unenforceable', 'deferred'].map(t => [t, tally(abide.filter(r => r.abideType === t).map(r => r.final))])),
    },
  };
}

/** The census population from the committed files: every primary and sampled secondary plugin rule, and the controls. */
export function loadCensusRules(root = '.') {
  const R = 'experiments/blueprint-floor';
  const selection = JSON.parse(readFileSync(join(root, R, 'rules/selection.json'), 'utf8'));
  const rules = [];
  for (const p of selection.plugins) {
    const rec = JSON.parse(readFileSync(join(root, R, 'rules', `${p.plugin}.json`), 'utf8'));
    for (const r of rec.rules) rules.push({ ruleId: r.ruleId, plugin: p.plugin, stratum: r.stratum, ...(p.plugin === 'abide' ? { abideType: r.withheld.check.type } : {}) });
  }
  for (const f of ['positive', 'negative']) {
    const rec = JSON.parse(readFileSync(join(root, R, 'controls', `${f}.json`), 'utf8'));
    for (const r of rec.rules) rules.push({ ruleId: r.ruleId, plugin: null, stratum: r.stratum });
  }
  return { rules, plugins: selection.plugins.map(p => p.plugin) };
}
