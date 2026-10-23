// EXP 017 — turns one private counted run (run-seat.sh output) into the public run file. Frozen by sha256 in
// experiments/review-frontier/preregistration.json.
//
//   node collect.mjs <private-run-dir> <sealed-manifest.json> > experiments/review-frontier/runs/<seat>-<run>.json
//
// The public file holds no case id, bundle id, file name, finding or diff text. Cases and changes are numbered
// 1..60 and 1..58 in the sealed manifest's own order, which is the same for every run, so runs can be paired
// case by case without saying what a case is.
//   cases[]   { n, kind: "seeded"|"clean", flagged }   flagged = caught (seeded) or false alarm (clean),
//                                                       exactly as the review-recall scorer decided in report.json
//   reviews[] { n, costUsd, latencySec, attempts, noVerdict, servedModel, upstream }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function collect(runDir, manifest) {
  const meta = JSON.parse(readFileSync(join(runDir, 'key-usage.json'), 'utf8'));
  const reportPath = join(runDir, 'report.json');
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const rows = existsSync(join(runDir, 'verdicts.jsonl'))
    ? readFileSync(join(runDir, 'verdicts.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const byBundle = new Map(rows.map(r => [r.bundle, r]));
  const missed = new Set(report?.missed ?? []), alarms = new Set(report?.falseAlarms ?? []);
  const complete = report !== null && manifest.bundles.every(b => byBundle.has(b.id));
  const cases = manifest.cases.map((c, i) => ({
    n: i + 1,
    kind: c.kind === 'seeded-defect' ? 'seeded' : 'clean',
    flagged: !complete ? null : c.kind === 'seeded-defect' ? !missed.has(c.id) : alarms.has(c.id),
  }));
  const reviews = manifest.bundles.map((b, i) => {
    const r = byBundle.get(b.id);
    const costFile = join(runDir, 'reviews', `${b.id}.cost`);
    return r ? {
      n: i + 1,
      costUsd: existsSync(costFile) ? Number(readFileSync(costFile, 'utf8').trim()) : null,
      latencySec: r.latencySec ?? null,
      attempts: r.attempts ?? null,
      noVerdict: r.noVerdict === true,
      servedModel: r.served?.model ?? null,
      upstream: r.served?.provider ?? null,
    } : { n: i + 1, costUsd: null, latencySec: null, attempts: null, noVerdict: null, servedModel: null, upstream: null };
  });
  return {
    schemaVersion: 1,
    kind: 'odin-rnd.exp017.run',
    seat: meta.seat, run: meta.run, model: meta.model,
    start: meta.start, end: meta.end, harnessExit: meta.harnessExit, complete,
    corpusVersion: report?.corpusVersion ?? manifest.corpusVersion,
    keyUsageUsd: { before: meta.keyBefore?.usage ?? null, after: meta.keyAfter?.usage ?? null },
    cases, reviews,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [runDir, manifestPath] = process.argv.slice(2);
  if (!runDir || !manifestPath) { console.error('usage: collect.mjs <private-run-dir> <sealed-manifest.json>'); process.exit(1); }
  process.stdout.write(JSON.stringify(collect(runDir, JSON.parse(readFileSync(manifestPath, 'utf8'))), null, 1) + '\n');
}
