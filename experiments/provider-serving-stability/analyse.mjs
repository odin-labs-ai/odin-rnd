// EXP 022 analysis — frozen by sha256 in experiments/provider-serving-stability/preregistration.json. Reads the
// published, already-anonymised runs-anon/*.jsonl: broker is a letter, servedModel is a per-(letter,canonicalModel)
// token (identity-1, identity-2, ...), not the broker's raw string. Matching is by canonicalModel, not
// requestedModel (dropped at anonymisation): each broker spells requestedModel its own way, but canonicalModel is
// normalised to the same string by every broker's row for the same requested model.
//
//   node experiments/provider-serving-stability/analyse.mjs           read runs-anon/*.jsonl, write results.json
//   node experiments/provider-serving-stability/analyse.mjs --check   recompute and exit 1 unless it equals results.json
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function readCapture(dir) {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a call */ }
    }
  }
  return rows;
}

export function counted(row, fromMs, toMs) {
  const t = Date.parse(row.ts);
  return !row._header && row.ok === true && Number.isFinite(t) && t >= fromMs && t < toMs
    && typeof row.servedModel === 'string' && row.servedModel.length > 0;
}

export function pairVerdict(n, distinct, minCalls) {
  if (n < minCalls) return 'not enough calls';
  return distinct.length === 1 ? 'stable' : 'unstable';
}

export function analyse(rows, prereg) {
  const { from, to } = prereg.window;
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const minCalls = prereg.decision.rule.minCalls;
  const perPair = {};
  for (const broker of prereg.brokers) {
    perPair[broker] = {};
    for (const model of prereg.models) {
      const calls = rows.filter(r => r.broker === broker && r.canonicalModel === model && counted(r, fromMs, toMs));
      const counts = {};
      for (const r of calls) counts[r.servedModel] = (counts[r.servedModel] ?? 0) + 1;
      const distinct = Object.keys(counts).sort();
      perPair[broker][model] = {
        n: calls.length,
        distinctServedModels: distinct,
        servedModelCounts: Object.fromEntries(distinct.map(d => [d, counts[d]])),
        verdict: pairVerdict(calls.length, distinct, minCalls),
      };
    }
  }
  return { experiment: prereg.experiment.id, window: { from, to }, preregistrationSha256: prereg.sha256 ?? null, perPair };
}

function main() {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  prereg.sha256 = readFileSync(join(HERE, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const text = JSON.stringify(analyse(readCapture(join(HERE, 'runs-anon')), prereg), null, 2) + '\n';
  const out = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 022: results.json is not what the frozen analysis computes from the committed inputs'); return 1; }
    console.log('EXP 022: results.json recomputes exactly'); return 0;
  }
  writeFileSync(out, text);
  console.log(`EXP 022: wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
