// EXP 023 analysis. erratum-01.json and erratum-02.json both disclose, with exact hashes and timestamps, that
// analysis.sha256 in preregistration.json was filled in -- and, after erratum-02's code fixes, recomputed again --
// after the raw capture (capture/records-prs.json) had already been fetched. Neither edit had any result-dependent
// freedom: the first is a hash of unchanged bytes, the second fixes defects a review found, verified in erratum-02
// to leave every published number in results.json unchanged. Read both erratum files before trusting "frozen
// before capture" anywhere else in this directory's prose.
//
//   node experiments/record-lander-backlog/analyse.mjs           read capture/records-prs.json, write results.json
//   node experiments/record-lander-backlog/analyse.mjs --check   recompute and exit 1 unless it equals results.json
//
// Inputs: capture/records-prs.json only -- the raw `gh pr list` output the preregistration describes, fetched once
// and never hand-edited. No network, no clock inside this script: "now" (for stillOutstanding ages) is read from
// the capture file's own fetchedAt field, frozen at capture time, not from the machine running --check later.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86400000;
const BRANCH_RE = /^records\/(rogue|review|red-build|measured-blind)-([0-9-]+)-([0-9]{6})$/;

/** The PR's lab and its list of YYYYMMDD day strings, or null if the head ref doesn't match the lander's own
 * naming contract (odin-labs .github/lab-runner/record-pr.sh). The final 6-digit group is always the HHMMSS
 * branch-cut suffix, never a day: splitting on '-' and dropping the last numeric group isolates the day list.
 * Every group must be exactly 8 digits -- an empty group (a doubled '--' in the branch name, e.g.
 * "records/rogue-20261101--120000") is not silently dropped: erratum-02.json #10 found that filtering empty
 * groups out before the digit check let a malformed branch still contribute its one real day. */
export function parseBranch(headRefName) {
  const m = BRANCH_RE.exec(headRefName);
  if (!m) return null;
  const [, lab, dayDigits] = m;
  const days = dayDigits.split('-');
  if (!days.length || !days.every(d => /^\d{8}$/.test(d))) return null;
  return { lab, days };
}

const dayStart = yyyymmdd => Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8));
const toYmd = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

/** Every in-window YYYYMMDD day, window.to excluded (half-open), in ascending order. */
export function windowDays(fromMs, toMs) {
  const out = [];
  for (let t = fromMs; t < toMs; t += DAY_MS) out.push(toYmd(t));
  return out;
}

export function analyse(capture, prereg) {
  const { from, to } = prereg.window;
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const authoredMs = Date.parse(prereg.experiment.authoredOn + 'T00:00:00Z');
  const fetchedAtMs = Date.parse(capture.fetchedAt);
  const rule = prereg.decision.rule;
  const days = windowDays(fromMs, toMs);

  const perLab = {};
  const anomalies = [];
  for (const lab of prereg.labs) {
    // day -> {mergedAt, prNumber} | undefined, built only from MERGED PRs (a closed-without-merging PR never covers
    // a day on its own -- it was turned down, per record-pr.sh's own "closed as superseded/published on main").
    const landedBy = new Map();
    const openDays = new Set();
    for (const pr of capture.pullRequests) {
      const parsed = parseBranch(pr.headRefName);
      if (!parsed || parsed.lab !== lab) continue;
      for (const day of parsed.days) {
        if (pr.state === 'MERGED' && pr.mergedAt) {
          const existing = landedBy.get(day);
          if (existing) {
            anomalies.push({ lab, day, reason: 'named in more than one merged PR', prNumbers: [existing.prNumber, pr.number] });
            // The day's own landing latency is measured from its earliest merge, not whichever row the capture
            // happens to list first (erratum-02.json #8): a reordered capture must report the same latency.
            if (Date.parse(pr.mergedAt) < Date.parse(existing.mergedAt)) landedBy.set(day, { mergedAt: pr.mergedAt, prNumber: pr.number });
          } else {
            landedBy.set(day, { mergedAt: pr.mergedAt, prNumber: pr.number });
          }
        } else if (pr.state === 'OPEN') {
          openDays.add(day);
        }
      }
    }
    const inWindowLanded = days.filter(d => landedBy.has(d));
    const latencies = inWindowLanded.map(d => (Date.parse(landedBy.get(d).mergedAt) - dayStart(d)) / DAY_MS);
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    const max = sorted.length ? sorted[sorted.length - 1] : null;
    const coverage = inWindowLanded.length / days.length;
    const stillOutstanding = days
      .filter(d => !landedBy.has(d) && dayStart(d) + 3 * DAY_MS < authoredMs)
      .map(d => ({ day: d, open: openDays.has(d), ageDaysAtCapture: Math.round(((fetchedAtMs - dayStart(d)) / DAY_MS) * 10) / 10 }));
    const verdict = (median !== null && median <= rule.currentMedianLatencyMaxDays && coverage >= rule.currentMinCoverage) ? 'current'
      : ((max !== null && max > rule.backloggedMaxLatencyMinDays) || coverage < rule.backloggedMaxCoverage) ? 'backlogged'
      : 'mixed';
    perLab[lab] = {
      daysInWindow: days.length,
      daysLanded: inWindowLanded.length,
      coverage: Math.round(coverage * 1000) / 1000,
      medianLatencyDays: median === null ? null : Math.round(median * 100) / 100,
      maxLatencyDays: max === null ? null : Math.round(max * 100) / 100,
      stillOutstanding,
      verdict,
    };
  }
  return { experiment: prereg.experiment.id, window: { from, to }, preregistrationSha256: prereg.sha256 ?? null, capturedAt: capture.fetchedAt, perLab, anomalies };
}

export const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

/** Every way the committed pins no longer match what is actually on disk (empty when both hold). Real
 * verification, not a pass-through of whatever the sidecar or the preregistration claims: before erratum-02.json
 * #7, --check copied preregistration.sha256's own text into the output without ever hashing preregistration.json,
 * and never checked analysis.sha256 against analyse.mjs's own bytes at all -- changing either file's content
 * without updating its pin would have recomputed and passed silently. */
export function checkPins({ preregText, pinnedPreregHash, analyseBytes, pinnedAnalyseHash }) {
  const problems = [];
  const actualPrereg = sha256Hex(preregText);
  if (actualPrereg !== pinnedPreregHash) problems.push(`preregistration.json (sha256 ${actualPrereg}) no longer matches its own pin, preregistration.sha256 (${pinnedPreregHash})`);
  const actualAnalyse = sha256Hex(analyseBytes);
  if (actualAnalyse !== pinnedAnalyseHash) problems.push(`analyse.mjs (sha256 ${actualAnalyse}) no longer matches preregistration.json#/analysis/sha256 (${pinnedAnalyseHash})`);
  return problems;
}

function main(argv) {
  const preregText = readFileSync(join(HERE, 'preregistration.json'), 'utf8');
  const prereg = JSON.parse(preregText);
  const pinnedPreregHash = readFileSync(join(HERE, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const analyseBytes = readFileSync(fileURLToPath(import.meta.url));
  const pinProblems = checkPins({ preregText, pinnedPreregHash, analyseBytes, pinnedAnalyseHash: prereg.analysis.sha256 });
  if (pinProblems.length) { console.error(`EXP 023: ${pinProblems.join('; ')}`); return 1; }
  prereg.sha256 = pinnedPreregHash;
  const capture = JSON.parse(readFileSync(join(HERE, 'capture', 'records-prs.json'), 'utf8'));
  const text = JSON.stringify(analyse(capture, prereg), null, 2) + '\n';
  const out = join(HERE, 'results.json');
  if (argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 023: results.json is not what the frozen analysis computes from the committed inputs'); return 1; }
    console.log('EXP 023: results.json recomputes exactly');
    return 0;
  }
  writeFileSync(out, text);
  console.log(`EXP 023: wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
