// Vendors "The engine, measured over time" (founder plan 6) into site/data/labs/agent-space/engine-history.json, from the
// git history of two files in the agent space's private repository: its claims table and its telemetry pack. Every
// commit that CHANGED a figure is one dated point (date = the commit's date, value = the figure at that commit), cited by
// its full sha and checked to be an ancestor of the private main head (tier 2, as scripts/vendor-telemetry.mjs does). A
// figure restated unchanged in a later commit is not a new measurement and adds no point.
//
//   node scripts/vendor-engine-history.mjs --fetch <dir> --repo <owner/name> --claims-path <path> --pack-path <path>
//        (reads both files' history with gh into <dir>; the repository, its paths and <dir> are private, are given
//        only on the command line, and are never committed)
//   node scripts/vendor-engine-history.mjs --from <dir> [--pin-out scripts/engine-history.pin.json] > site/data/labs/agent-space/engine-history.json
//   node scripts/vendor-engine-history.mjs --verify site/data/labs/agent-space/engine-history.json --from <dir>
//
// --from is deterministic: the same <dir> gives the same bytes. --verify re-derives the committed file from <dir> and
// refuses unless it is byte for byte the same (the build cannot read the private history; anyone with access can run
// this). Nothing private reaches the output: no repository name, no path, no claim text; each claim is named by the
// public label Lab 01 already shows for it (CLAIM_LABELS), and every note is written here from the figures, not copied.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/agent-space/engine-history.json';
export const PIN_FILE = 'scripts/engine-history.pin.json';

/** The public engine claims Lab 01 shows, by the label it shows them with (scripts/lab-telemetry.mjs, telemetry.json). */
export const CLAIM_LABELS = {
  7: 'the fine-tuned 1.5B model against the larger stack',
  8: 'model calls per successful task',
  9: 'byte-identical seeded replays',
  10: 'the full test suite',
  15: 'agents as QA, on a real outage',
  20: '1,000 agents in one campus',
  d7: 'the campus scene\'s draw calls and frame time',
};

/** A claims-table row: its claim text and its status (main, work-branch or null). */
function claimRows(table) {
  const rows = {};
  for (const line of table.split('\n')) {
    const m = /^\|\s*([0-9a-z]+)\s*\|(.*?)\|(.*?)\|/.exec(line);
    if (!m || !(m[1] in CLAIM_LABELS)) continue;
    const status = m[3].trim();
    rows[m[1]] = { text: m[2], status: /^MAIN\b/.test(status) ? 'main' : /^LANE\b/.test(status) ? 'work-branch' : null };
  }
  return rows;
}

const num = s => Number(String(s).replace(/,/g, ''));
// The figures each metric reads, from a claims row's text (or null when the row does not state them).
const FROM_ROW = {
  tests: row => { const m = /([\d,]+) passed \/ ([\d,]+) failed/.exec(row?.text ?? ''); return m ? { passed: num(m[1]), failed: num(m[2]) } : null; },
  tick: row => { const m = /([\d,]+) moving[\s\S]*?p50 ([\d.]+) ms \/ p95 ([\d.]+) ms per tick/.exec(row?.text ?? ''); return m ? { agents: num(m[1]), p50_ms: num(m[2]), p95_ms: num(m[3]) } : null; },
  draws: row => { const m = /draws ([\d,]+) calls at p50 ([\d.]+) ms per frame, against the placeholders' ([\d,]+) at ([\d.]+) ms/.exec(row?.text ?? ''); return m ? { draws: num(m[1]), p50_ms: num(m[2]), placeholder_draws: num(m[3]), placeholder_p50_ms: num(m[4]) } : null; },
};

/** The public series, built from the commits and file versions in `dir`. Deterministic. */
export function build(dir) {
  const read = f => readFileSync(join(dir, f), 'utf8');
  const claimsCommits = JSON.parse(read('claims-commits.json')).sort((a, b) => a.date.localeCompare(b.date));
  const packCommits = JSON.parse(read('pack-commits.json')).sort((a, b) => a.date.localeCompare(b.date));
  const ancestry = JSON.parse(read('ancestry.json'));
  const problems = [];
  const onMain = sha => {
    const seen = ancestry.commits[sha];
    if (!seen || seen.behind_by !== 0 || !['ahead', 'identical'].includes(seen.status)) problems.push(`commit ${sha} is not shown as an ancestor of main ${ancestry.main}`);
    return ancestry.main;
  };
  const point = (c, values, change) => ({ at: c.date, commit: c.sha, onMain: onMain(c.sha), values, change });

  // Engine claims on the main build: a point each time the count on main, or the count recorded, changes.
  const status = [];
  let before = {};
  for (const c of claimsCommits) {
    const rows = claimRows(read(`claims/${c.sha}.md`));
    const ids = Object.keys(CLAIM_LABELS).filter(id => rows[id]);
    const main = ids.filter(id => rows[id].status === 'main').length;
    const notes = [];
    for (const id of ids) {
      if (!before[id]) notes.push(`${CLAIM_LABELS[id]}: recorded, ${rows[id].status === 'main' ? 'in the main build' : 'on a work branch'}`);
      else if (before[id].status !== rows[id].status) notes.push(`${CLAIM_LABELS[id]}: ${rows[id].status === 'main' ? 'moved from a work branch into the main build' : rows[id].status === 'work-branch' ? 'moved back to a work branch' : 'lost its status'}`);
    }
    for (const id of Object.keys(before)) if (!rows[id]) notes.push(`${CLAIM_LABELS[id]}: removed from the claims table`);
    // A point whenever either count changes, or a claim's status does; a change with no note would be a bug, so refuse it.
    const counts = { on_main: main, recorded: ids.length }, last = status.at(-1)?.values;
    const countsChanged = !last || last.on_main !== counts.on_main || last.recorded !== counts.recorded;
    if (countsChanged && !notes.length) problems.push(`commit ${c.sha}: the counts changed with no claim recorded, moved or removed`);
    if (notes.length) status.push(point(c, counts, notes.join('; ')));
    before = rows;
  }

  // A figure from the claims table: a point each time its parsed value changes.
  const fromClaims = (claim, read_, describe) => {
    const points = [];
    let last = null;
    for (const c of claimsCommits) {
      const value = read_(claimRows(read(`claims/${c.sha}.md`))[claim]);
      if (!value || JSON.stringify(value) === JSON.stringify(last)) continue;
      points.push(point(c, value, last ? describe(last, value) : 'first recorded'));
      last = value;
    }
    return points;
  };
  const changed = (a, b) => Object.keys(b).filter(k => a[k] !== b[k]).map(k => `${k.replaceAll('_', ' ')} ${a[k]} → ${b[k]}`).join(', ');

  // Answer time per agent from the telemetry pack: a point each time a measured session's figures change.
  const latency = [];
  let lastLatency = null;
  for (const c of packCommits) {
    const pack = JSON.parse(read(`pack/${c.sha}.json`));
    if (pack.agent_space?.status !== 'measured') continue;
    const value = Object.fromEntries(Object.entries(pack.agent_space.per_agent).sort(([a], [b]) => a.localeCompare(b)).flatMap(([agent, a]) => [[`${agent}_p50_s`, a.latency_s.p50], [`${agent}_p95_s`, a.latency_s.p95]]));
    if (JSON.stringify(value) === JSON.stringify(lastLatency)) continue;
    latency.push(point(c, value, lastLatency ? changed(lastLatency, value) : 'first measured, in a seeded live session'));
    lastLatency = value;
  }

  const series = [
    { id: 'claims-on-main', title: 'Engine claims in the main build', unit: 'claims', note: 'Of the engine claims Lab 01 shows, how many were in the main build, each time that changed. A claim measured on a work branch counts only once it is merged.', points: status },
    { id: 'test-suite', title: 'The full test suite', unit: 'tests', note: 'Tests passed and failed in the engine\'s full suite.', points: fromClaims('10', FROM_ROW.tests, changed) },
    { id: 'tick-1000', title: 'Server time per tick, with 1,000 agents', unit: 'ms per tick', note: '1,000 moving and talking agents in one campus, at 10 ticks a second.', points: fromClaims('20', FROM_ROW.tick, changed) },
    { id: 'campus-draws', title: 'The campus scene: draw calls and frame time', unit: 'draws, ms per frame', note: 'Instanced art and text level-of-detail against the placeholders.', points: fromClaims('d7', FROM_ROW.draws, changed) },
    { id: 'answer-time', title: 'Answer time per agent', unit: 'seconds', note: 'From a visitor\'s question to the agent\'s proof record, including the scripted visitor\'s own overhead.', points: latency },
  ];
  if (problems.length) throw new Error(`vendor-engine-history refused:\n  ${problems.join('\n  ')}`);
  const sourceSha256 = sha256([...claimsCommits.map(c => `${c.sha} claims ${sha256(readFileSync(join(dir, `claims/${c.sha}.md`)))}`), ...packCommits.map(c => `${c.sha} pack ${sha256(readFileSync(join(dir, `pack/${c.sha}.json`)))}`)].sort().join('\n'));
  const record = {
    format: 'odin-engine-history', version: 1,
    vendored: {
      from: 'the git history of the agent space\'s claims table and telemetry pack, kept in its private repository',
      rule: 'a point is a commit that changed a figure; a figure restated unchanged adds no point, and nothing is drawn between points',
      mainCheck: { main: ancestry.main, how: ancestry.how, checked: ancestry.checked },
      commitsRead: { claims: claimsCommits.length, pack: packCommits.length },
      sourceSha256,
    },
    series,
  };
  return { record, sourceSha256 };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;
export const pinFor = (bytes, sourceSha256, main) => ({ format: 'odin-engine-history-pin', version: 1, file: OUT_FILE, fileSha256: sha256(bytes), sourceSha256, commit: main });

/** Read both files' histories with gh into `dir`, and check each commit against the private main head. */
export function fetchHistory(dir, { repo, claimsPath, packPath }, today = new Date().toISOString().slice(0, 10)) {
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commits = path => JSON.parse(gh(['api', `repos/${repo}/commits?path=${encodeURIComponent(path)}&sha=main&per_page=100`, '--jq', '[.[] | {sha: .sha, date: .commit.committer.date}]']));
  const raw = (path, sha) => gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}?ref=${sha}`]);
  mkdirSync(join(dir, 'claims'), { recursive: true });
  mkdirSync(join(dir, 'pack'), { recursive: true });
  const claims = commits(claimsPath), pack = commits(packPath);
  for (const c of claims) writeFileSync(join(dir, `claims/${c.sha}.md`), raw(claimsPath, c.sha));
  for (const c of pack) writeFileSync(join(dir, `pack/${c.sha}.json`), raw(packPath, c.sha));
  writeFileSync(join(dir, 'claims-commits.json'), JSON.stringify(claims));
  writeFileSync(join(dir, 'pack-commits.json'), JSON.stringify(pack));
  const main = JSON.parse(gh(['api', `repos/${repo}/commits/main`, '--jq', '{sha: .sha}'])).sha;
  const ancestry = { main, how: 'GitHub compare of each cited commit against the private main head; behind by 0 means the commit is part of main', checked: today, commits: {} };
  for (const sha of new Set([...claims, ...pack].map(c => c.sha))) ancestry.commits[sha] = JSON.parse(gh(['api', `repos/${repo}/compare/${sha}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}']));
  writeFileSync(join(dir, 'ancestry.json'), JSON.stringify(ancestry, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  if (a.fetch) {
    if (!a.repo || !a['claims-path'] || !a['pack-path']) { console.error('--fetch needs --repo, --claims-path and --pack-path'); process.exit(2); }
    fetchHistory(a.fetch, { repo: a.repo, claimsPath: a['claims-path'], packPath: a['pack-path'] });
    console.error(`fetched into ${a.fetch}`);
    process.exit(0);
  }
  const { record, sourceSha256 } = build(a.from);
  const bytes = serialise(record);
  if (a.verify) {
    const committed = readFileSync(a.verify, 'utf8');
    if (committed !== bytes) { console.error(`NOT VERIFIED: ${a.verify} is not what the private history gives`); process.exit(1); }
    console.log(`VERIFIED: ${a.verify} is byte for byte what the private history gives (source sha256 ${sourceSha256}).`);
    process.exit(0);
  }
  if (a['pin-out']) writeFileSync(a['pin-out'], `${JSON.stringify(pinFor(bytes, sourceSha256, record.vendored.mainCheck.main), null, 1)}\n`);
  process.stdout.write(bytes);
}
