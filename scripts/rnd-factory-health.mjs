// scripts/rnd-factory-health.mjs — the 24/7 R&D factory's own dashboard.
//
// CRITIC finding (rndf-1128): "the factory already has about 10 crons spread over two repos ... There is no single
// place where a failure such as lab-waiting shows up, and open records PRs pile up unnoticed." This is a read-only
// report of (a) each factory workflow's last few runs and (b) every open odin-rnd PR the record lander is supposed
// to land (records/* and data/broker-probe-*), so a stuck pipeline or a pile of unlanded data shows up in one place
// instead of needing a person to go look. It never opens, comments on, labels, closes or merges anything.
//
//   node scripts/rnd-factory-health.mjs [--json] [--runs N]
//       GH_TOKEN (or GITHUB_TOKEN) must be able to read Actions runs on odin-labs-ai/odin-labs (private) and
//       odin-labs-ai/odin-rnd, and list odin-rnd's pull requests. .github/workflows/rnd-weekly.yml mints the
//       read-only App token this needs; a same-repo GITHUB_TOKEN alone cannot read the private repo's runs.
//
// Runs wherever it is given a token with that read access; the only place that exists today is the hosted
// rnd-weekly.yml run (never an operator laptop, rule 02 §16).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';

// Every workflow file this factory's own scheduled automation runs today (not a cron inside it -- one row per
// workflow file). Widening this list is how a new cron joins the dashboard; narrowing it needs a reason.
export const WORKFLOWS = [
  { repo: 'odin-labs-ai/odin-labs', file: 'lab-runner.yml' },
  { repo: 'odin-labs-ai/odin-labs', file: 'lab-runner-legs.yml' },
  { repo: 'odin-labs-ai/odin-labs', file: 'rnd-record-lander.yml' },
  { repo: 'odin-labs-ai/odin-labs', file: 'lab-waiting.yml' },
  { repo: 'odin-labs-ai/odin-labs', file: 'rnd-telemetry-truth-capture.yml' },
  { repo: 'odin-labs-ai/odin-rnd', file: 'broker-probe.yml' },
  { repo: 'odin-labs-ai/odin-rnd', file: 'rnd-weekly.yml' },
];

async function get(path, token) {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'odin-rnd-factory-health' } });
  const json = await response.json().catch(() => ({}));
  if (response.status !== 200) throw new Error(`${path}: GitHub answered ${response.status}${json.message ? ` (${json.message})` : ''}`);
  return json;
}

/** The last `n` runs of one workflow file, oldest to newest: [{conclusion, status, htmlUrl, createdAt}]. */
export async function workflowRuns({ repo, file }, token, n = 7) {
  const json = await get(`/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=${n}`, token);
  return (json.workflow_runs ?? []).slice(0, n).reverse().map(r => ({ conclusion: r.conclusion, status: r.status, htmlUrl: r.html_url, createdAt: r.created_at }));
}

/** Every open odin-rnd PR the record lander is meant to land, oldest first: head ref starts with "records/" (the
 * lab runner's record-class PRs) or "data/broker-probe-" (the weekly probe's data PRs) -- the same two selectors
 * .github/workflows/rnd-record-lander.yml (odin-labs) reads. [{number, title, headRefName, createdAt, htmlUrl}]. */
export async function openRecordsPRs(token) {
  const out = [];
  for (let page = 1; ; page++) {
    const json = await get(`/repos/odin-labs-ai/odin-rnd/pulls?state=open&per_page=100&page=${page}`, token);
    if (!Array.isArray(json) || !json.length) break;
    for (const pr of json) {
      const ref = pr.head?.ref ?? '';
      if (/^records\//.test(ref) || /^data\/broker-probe-/.test(ref)) {
        out.push({ number: pr.number, title: pr.title, headRefName: ref, createdAt: pr.created_at, htmlUrl: pr.html_url });
      }
    }
    if (json.length < 100) break;
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The full report (odin-rnd-factory-health v1). A workflow or the PR listing that cannot be read is reported with
 * its own error, never silently dropped or mistaken for "nothing to report". */
export async function health(token, { runs = 7 } = {}) {
  const workflows = [];
  for (const w of WORKFLOWS) {
    try { workflows.push({ ...w, runs: await workflowRuns(w, token, runs) }); }
    catch (error) { workflows.push({ ...w, runs: [], error: error.message }); }
  }
  const report = { format: 'odin-rnd-factory-health', version: 1, asOf: new Date().toISOString(), workflows };
  try { report.openRecordsPRs = await openRecordsPRs(token); }
  catch (error) { report.openRecordsPRs = []; report.openRecordsPRsError = error.message; }
  return report;
}

const emoji = r => (r.status !== 'completed' ? '⏳' : r.conclusion === 'success' ? '🟢' : '🔴');

// `headRefName` comes from an open PR's branch name, and on this PUBLIC repo that is attacker-controlled (anyone can
// open a PR, including from a fork, with a head ref matching records/* or data/broker-probe-*). A git ref may legally
// contain Unicode line-separator look-alikes that are not ASCII control characters, so `git check-ref-format` never
// refuses them -- and Mattermost's own parser turns those into real newlines before it looks for a closing fence,
// which a crafted branch name could use to break out of renderLines()'s fenced block (rnd-weekly.mjs's inert()
// exists for exactly this class of bug, "refute pr39 final-8 #1"). Listed by numeric code point, never as a literal
// escape or glyph in source, to leave no room for one of them to end up copied into this file by mistake: 0x2424
// SYMBOL FOR NEWLINE, 0x2028 LINE SEPARATOR, 0x2029 PARAGRAPH SEPARATOR, 0x0085 NEXT LINE (NEL). This mirrors
// inert()'s normalisation without its inline-code-span wrapping (unnecessary inside an existing fence): strip every
// line-like character to a space and any backtick to a quote, so neither a fence-breaking backtick run nor a
// disguised newline can survive into the rendered line.
const LINE_LIKE_CODE_POINTS = new Set([0x2424, 0x2028, 0x2029, 0x0085]);
const isLineLike = ch => LINE_LIKE_CODE_POINTS.has(ch.codePointAt(0)) || /\s|\p{Cc}|\p{Cf}/u.test(ch);
const plain = text => Array.from(String(text), ch => (isLineLike(ch) ? ' ' : ch)).join('').replaceAll('`', "'").trim();

/** A human-readable line per workflow (the grid) plus the open-PR count, for the CLI and the weekly post alike. */
export function renderLines(report) {
  const lines = report.workflows.map(w => `${w.repo}/${w.file}: ${w.runs.length ? w.runs.map(emoji).join('') : '(no runs)'}${w.error ? ` ERROR: ${plain(w.error)}` : ''}`);
  lines.push(report.openRecordsPRsError
    ? `open records/data PRs: ERROR: ${plain(report.openRecordsPRsError)}`
    : `${report.openRecordsPRs.length} open records/data PR(s)${report.openRecordsPRs.length ? ': ' + report.openRecordsPRs.map(pr => `#${pr.number} (${plain(pr.headRefName)})`).join(', ') : ''}`);
  return lines;
}

export async function main(argv) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) { console.error('rnd-factory-health: GH_TOKEN (or GITHUB_TOKEN) is not set'); return 1; }
  const runsArg = argv.indexOf('--runs');
  const runs = runsArg !== -1 ? Number(argv[runsArg + 1]) : 7;
  if (!Number.isInteger(runs) || runs < 1) { console.error('rnd-factory-health: --runs wants a positive integer'); return 2; }
  const report = await health(token, { runs });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
  else for (const line of renderLines(report)) console.log(line);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
