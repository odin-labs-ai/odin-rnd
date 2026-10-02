// EXP 008-X, WO-03 pass 1: ground-truth labels for the 140 new items, in the same shape EXP 005's label.mjs writes.
// Every patch is applied to a fresh copy of the EXP 005 base/ and scored by the EXP 005 contract (bce-engine 0.3.1,
// --extractor ast, sha-asserted bce-contract.mjs). bce's label is the truth.
//
// Where bce disagrees with the author's intent (manifest-x.json), the run appends the disagreement to
// adjudication-x.jsonl and exits non-zero. A disagreement is resolved by RE-AUTHORING the item in author-x.mjs, never
// by editing a label; the resolution is appended to the same log. The finished corpus has 0 disagreements and 0
// EXCLUDED items.
//
//   node experiments/latent-handoff/corpus-x/label-x.mjs            write labels-x.json and corpus-x.sha256
//   node experiments/latent-handoff/corpus-x/label-x.mjs --check    re-label and compare byte for byte
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE, JEV, BASE, CORPUS, MANIFEST, INDEX, loadExp005 } from './author-x.mjs';

export const BLUEPRINT = join(JEV, 'blueprint.json');
export const LABELS = join(HERE, 'labels-x.json');
export const SHA_FILE = join(HERE, 'corpus-x.sha256');
export const ADJUDICATION = join(HERE, 'adjudication-x.jsonl');

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const patchIds = () => readdirSync(CORPUS).filter(f => /^c\d{3}\.patch$/.test(f)).map(f => f.slice(0, 4)).sort();

export async function labelOne(bce, id) {
  const patch = readFileSync(join(CORPUS, id + '.patch'), 'utf8');
  try {
    const r = await bce.scoreTree({ blueprint: BLUEPRINT, tree: BASE, patch });
    return { id, label: r.label, score: r.score, rules: r.rules, violations: r.violations.map(v => ({ rule: v.rule, ref: v.ref })) };
  } catch (e) {
    return { id, label: 'EXCLUDED', reason: String(e.message).split('\n')[0] };
  }
}

/** Label `ids` (all by default) and join the manifest intent, exactly as EXP 005's buildLabels does. */
export async function buildLabels(ids = patchIds()) {
  const { bce } = await loadExp005();
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const intent = Object.fromEntries(manifest.items.map(i => [i.id, i]));
  const scored = await bce.mapLimit(ids, 4, id => labelOne(bce, id));
  const items = scored.map(s => {
    const m = intent[s.id];
    if (!m) throw new Error(`${s.id} has no manifest-x entry`);
    const expected = m.intent === 'drift' ? 'RED' : 'GREEN';
    const disagree = s.label !== 'EXCLUDED' && s.label !== expected;
    const rulesMatchIntent = s.label === 'EXCLUDED' ? false : JSON.stringify([...m.targets].sort()) === JSON.stringify(s.rules);
    return { ...s, intended: expected, intendedRules: [...m.targets].sort(), rulesMatchIntent, disagree };
  });
  const count = pred => items.filter(pred).length;
  return {
    schemaVersion: 1,
    truth: 'bce label (RED = the change breaks a blueprint rule, GREEN = it does not). intended is the author intent from manifest-x.json. Every intent/bce disagreement met while authoring was resolved by re-authoring the item (adjudication-x.jsonl), never by editing a label.',
    engine: { package: 'bce-engine', version: bce.BCE_VERSION, extractor: bce.EXTRACTOR },
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

/** Files pinned by corpus-x.sha256: every patch, manifest-x.json, labels-x.json, corpus-x.json. */
export function pinnedFiles() {
  return [...readdirSync(CORPUS).filter(f => f.endsWith('.patch')).map(f => `corpus/${f}`), 'manifest-x.json', 'labels-x.json', 'corpus-x.json'].sort();
}

/** `<sha256>  <path>` lines, sorted by path (sha256sum format; `shasum -a 256 -c corpus-x.sha256` from this directory). */
export function shaListing() {
  return pinnedFiles().map(rel => `${sha256(readFileSync(join(HERE, rel)))}  ${rel}`).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = await buildLabels();
  const text = JSON.stringify(record, null, 2) + '\n';
  const bad = record.items.filter(i => i.disagree || i.label === 'EXCLUDED');
  if (process.argv.includes('--check')) {
    const same = readFileSync(LABELS, 'utf8') === text;
    const listing = same && readFileSync(SHA_FILE, 'utf8') === shaListing();
    console.log(same ? 'labels-x.json reproduces byte for byte' : 'labels-x.json DIFFERS');
    console.log(listing ? 'corpus-x.sha256 reproduces' : 'corpus-x.sha256 DIFFERS');
    process.exitCode = same && listing && !bad.length ? 0 : 1;
  } else {
    const manifest = Object.fromEntries(JSON.parse(readFileSync(MANIFEST, 'utf8')).items.map(i => [i.id, i]));
    const index = Object.fromEntries(JSON.parse(readFileSync(INDEX, 'utf8')).items.map(i => [i.id, i]));
    for (const i of bad) {
      appendFileSync(ADJUDICATION, JSON.stringify({
        event: 'disagreement', id: i.id, family: manifest[i.id].family, patchSha256: index[i.id].patchSha256,
        intended: i.intended, intendedRules: i.intendedRules, bce: i.label, bceRules: i.rules ?? [], reason: i.reason ?? null,
        resolution: 'pending: re-author the item in author-x.mjs (never relabel)',
      }) + '\n');
    }
    // One summary line per labelling pass, so the log also records the passes that met no disagreement.
    appendFileSync(ADJUDICATION, JSON.stringify({
      event: 'label-pass', at: new Date().toISOString(), corpusXSha256: sha256(readFileSync(INDEX)), counts: record.counts,
      disagreements: bad.map(i => i.id),
    }) + '\n');
    writeFileSync(LABELS, text);
    writeFileSync(SHA_FILE, shaListing());
    console.log(JSON.stringify(record.counts));
    for (const i of record.items.filter(i => i.disagree || i.label === 'EXCLUDED' || !i.rulesMatchIntent)) {
      console.log(`${i.id} ${manifest[i.id].family}: intended ${i.intended} [${i.intendedRules.join(', ')}], bce ${i.label} [${(i.rules || []).join(', ')}]${i.disagree ? ' DISAGREE' : ''} ${i.reason || ''}`);
    }
    process.exitCode = bad.length ? 1 : 0;
  }
}
