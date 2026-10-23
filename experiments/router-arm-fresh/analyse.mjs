// EXP 019 analysis — frozen by sha256 in experiments/router-arm-fresh/preregistration.json before any counted cell.
//
//   node experiments/router-arm-fresh/analyse.mjs           read data/cells.json + data/billing.json, write results.json
//   node experiments/router-arm-fresh/analyse.mjs --check   recompute and exit 1 unless it equals the committed results.json
//
// Three fresh replicates of EXP 018's routed arm (lanes router-r4..r6), compared with EXP 018's fixed arms exactly as
// published (experiments/router-arm/results.json, pinned by sha256). The per-replicate and per-arm arithmetic and the
// decision rule are EXP 018's own frozen functions, imported, not copied. No network, no clock.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armSummary, decide } from '../router-arm/analyse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, d = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The fresh routed replicates: lanes 4..6 become replicates 1..3; any other lane is refused. */
export function freshRouter(cellsDoc, billingDoc, lanes) {
  const map = new Map(lanes.map((lane, i) => [lane, i + 1]));
  const cells = cellsDoc.cells.map(c => {
    if (c.arm !== 'router' || !map.has(c.replicate)) throw new Error(`EXP 019: unexpected cell ${c.arm} replicate ${c.replicate}`);
    return { ...c, replicate: map.get(c.replicate) };
  });
  const billing = billingDoc.billing.filter(b => b.arm === 'router' && map.has(b.replicate)).map(b => ({ ...b, replicate: map.get(b.replicate) }));
  return { cells, billing };
}

export function analyse(cellsDoc, billingDoc, reference, prereg) {
  const { tasks } = prereg.corpus, replicates = prereg.design.replicates;
  const { cells, billing } = freshRouter(cellsDoc, billingDoc, prereg.design.lanes);
  const router = armSummary('router', cells, billing, tasks, replicates);
  const billedRaw = billing.reduce((a, b) => a + (Number.isFinite(b.billedUsd) ? b.billedUsd : 0), 0);
  const fixed = Object.fromEntries(prereg.comparison.arms.map(id => [id, reference.arms[id]]));
  return {
    schemaVersion: 1, kind: 'odin-rnd.results', experiment: prereg.experiment.id, slug: prereg.experiment.slug,
    corpus: { name: prereg.corpus.name, tasks, outOfSampleTasks: cellsDoc.outOfSampleTasks },
    router,
    reference: { experiment: reference.experiment, file: prereg.comparison.file, sha256: prereg.comparison.sha256, arms: fixed },
    decision: prereg.comparison.arms.map(id => decide(router, fixed[id], replicates)),
    spend: {
      billedUsd: round(billedRaw), ceilingUsd: prereg.spend.ceilingUsd, withinCeiling: billedRaw <= prereg.spend.ceilingUsd,
      cumulativeReplayUsd: round(prereg.spend.priorReplayUsd + billedRaw), cumulativeCapUsd: prereg.spend.cumulativeCapUsd,
    },
  };
}

const stable = v => JSON.stringify(v, null, 2) + '\n';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  const refFile = join(HERE, '..', '..', prereg.comparison.file);
  if (sha(refFile) !== prereg.comparison.sha256) { console.error('EXP 019: the EXP 018 reference no longer matches its pinned sha256'); process.exit(1); }
  const out = stable(analyse(JSON.parse(readFileSync(join(HERE, 'data/cells.json'), 'utf8')), JSON.parse(readFileSync(join(HERE, 'data/billing.json'), 'utf8')), JSON.parse(readFileSync(refFile, 'utf8')), prereg));
  const target = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== out) { console.error('EXP 019: results.json is not what the frozen analysis computes'); process.exit(1); }
    console.log('EXP 019: results.json recomputes exactly');
  } else { writeFileSync(target, out); console.log(`EXP 019: wrote ${target}`); }
}
