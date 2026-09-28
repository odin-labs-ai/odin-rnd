// WO-04: ground-truth labeller. Every corpus patch is applied to a fresh copy of base/, committed
// in a fresh git repo and scored by the WO-01 contract (bce-engine 0.3.1, --extractor ast).
// bce's label is the truth. Where the author's intent (manifest.json) disagrees, the item is
// flagged disagree:true; it is kept, never edited to make bce agree, and reported.
//
//   node experiments/jev-gate/label.mjs            write labels.json and corpus.sha256
//   node experiments/jev-gate/label.mjs --check    re-label and compare byte for byte
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BCE_VERSION, EXTRACTOR, HERE, mapLimit, scoreTree } from './bce-contract.mjs';

export const BASE = join(HERE, 'base');
export const BLUEPRINT = join(HERE, 'blueprint.json');
export const CORPUS = join(HERE, 'corpus');
export const LABELS = join(HERE, 'labels.json');
export const CORPUS_SHA = join(HERE, 'corpus.sha256');

export const patchIds = () => readdirSync(CORPUS).filter(f => /^c\d{3}\.patch$/.test(f)).map(f => f.slice(0, 4)).sort();

export async function labelOne(id) {
  const patch = readFileSync(join(CORPUS, id + '.patch'), 'utf8');
  try {
    const r = await scoreTree({ blueprint: BLUEPRINT, tree: BASE, patch });
    return { id, label: r.label, score: r.score, rules: r.rules, violations: r.violations.map(v => ({ rule: v.rule, ref: v.ref })) };
  } catch (e) {
    // A bce crash is recorded as an exclusion with its reason, never silently dropped.
    return { id, label: 'EXCLUDED', reason: String(e.message).split('\n')[0] };
  }
}

export async function buildLabels() {
  const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
  const intent = Object.fromEntries(manifest.items.map(i => [i.id, i]));
  const scored = await mapLimit(patchIds(), 4, labelOne);
  const items = scored.map(s => {
    const m = intent[s.id];
    if (!m) throw new Error(`${s.id} has no manifest entry`);
    const expected = m.intent === 'drift' ? 'RED' : 'GREEN';
    const disagree = s.label !== 'EXCLUDED' && s.label !== expected;
    const rulesMatchIntent = s.label === 'EXCLUDED' ? false : JSON.stringify([...m.targets].sort()) === JSON.stringify(s.rules);
    return { ...s, intended: expected, intendedRules: [...m.targets].sort(), rulesMatchIntent, disagree };
  });
  const count = pred => items.filter(pred).length;
  return {
    schemaVersion: 1,
    truth: 'bce label (RED = the change breaks a blueprint rule, GREEN = it does not). intended is the author intent from manifest.json; disagree:true items are excluded from the primary metrics and reported as a sensitivity analysis.',
    engine: { package: 'bce-engine', version: BCE_VERSION, extractor: EXTRACTOR },
    blueprintSha256: sha256(readFileSync(BLUEPRINT)),
    counts: {
      total: items.length,
      RED: count(i => i.label === 'RED'),
      GREEN: count(i => i.label === 'GREEN'),
      EXCLUDED: count(i => i.label === 'EXCLUDED'),
      disagree: count(i => i.disagree),
      rulesDifferFromIntent: count(i => i.label !== 'EXCLUDED' && !i.rulesMatchIntent),
    },
    items,
  };
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const walk = dir => readdirSync(dir).sort().flatMap(name => {
  const abs = join(dir, name);
  return statSync(abs).isDirectory() ? walk(abs) : [abs];
});

/** Files pinned by corpus.sha256: everything the labels depend on, plus the labels themselves. */
export function pinnedFiles() {
  const top = ['blueprint.json', 'rules.txt', 'gate-question.json', 'corpus-spec.json', 'manifest.json', 'labels.json'].map(f => join(HERE, f));
  return [...walk(BASE), ...walk(CORPUS), ...top].map(abs => relative(HERE, abs).split('\\').join('/')).sort();
}

/** `<sha256>  <path>` lines, sorted by path (sha256sum format, checkable with `shasum -a 256 -c`). */
export function corpusSha256Listing() {
  return pinnedFiles().map(rel => `${sha256(readFileSync(join(HERE, rel)))}  ${rel}`).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const labels = JSON.stringify(await buildLabels(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const same = readFileSync(LABELS, 'utf8') === labels;
    const listing = same && readFileSync(CORPUS_SHA, 'utf8') === corpusSha256Listing();
    console.log(same ? 'labels.json reproduces byte for byte' : 'labels.json DIFFERS');
    console.log(listing ? 'corpus.sha256 reproduces' : 'corpus.sha256 DIFFERS');
    process.exitCode = same && listing ? 0 : 1;
  } else {
    writeFileSync(LABELS, labels);
    writeFileSync(CORPUS_SHA, corpusSha256Listing());
    const parsed = JSON.parse(labels);
    console.log(JSON.stringify(parsed.counts));
    for (const i of parsed.items.filter(i => i.disagree || i.label === 'EXCLUDED' || !i.rulesMatchIntent)) console.log(`${i.id}: intended ${i.intended} [${i.intendedRules.join(', ')}], bce ${i.label} [${(i.rules || []).join(', ')}]${i.disagree ? ' DISAGREE' : ''} ${i.reason || ''}`);
    console.log('corpus sha256: ' + sha256(readFileSync(CORPUS_SHA)));
  }
}
