// Lab 01's telemetry (mission rnd-labs-human-first-1024): "The agent space, measured" and "The engine underneath" on
// /labs/agent-space/, from site/data/labs/agent-space/telemetry.json: the agent space's own odin-telemetry v1 pack,
// vendored (scripts/schemas/odin-telemetry.schema.json). The vendored file records the pack's commit and sha256 and
// says what was left out (the benchmark rows, which belong to the brain benchmark lab, and the session's run id).
//
// The build refuses it, every reason listed, when it misses the schema; when a figure has no source (every engine
// figure names its claims row and commit, the measured session its record's sha256 and run commit); when the session's
// counts do not add up (answered over asked, a proof card over answered, p50 over p95, an ok rate over 1, or asked
// not equal to rounds times questions per round); or when any text fails the dispatch publisher's screen. A source is
// a path or a commit, so it is not refused as a path, but it may carry no restricted name, place, price or long id.
// While agent_space is "pending" the page says it is being measured and shows no number. A figure whose commit is not
// a commit on the main build (a work branch) is labelled so on the page.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { format } from './number-provenance.mjs';

export const TELEMETRY_FILE = 'data/labs/agent-space/telemetry.json';
export const TELEMETRY_SCHEMA_FILE = new URL('./schemas/odin-telemetry.schema.json', import.meta.url);
/** A commit on the main build: a hex sha. Anything else (a branch name) is a work branch. */
export const isMainCommit = commit => /^[0-9a-f]{7,40}$/.test(commit);
export const WORK_BRANCH = 'Measured on a work branch, not yet in the main build.';

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Strings under a `source` are paths and commits: screened for everything but being a path.
function sourceProblems(source, at) {
  const out = [];
  (function walk(v, p) {
    if (typeof v === 'string') out.push(...screenHits(v).filter(hit => !hit.reason.startsWith('a file path')).map(hit => `${p}: ${hit.reason}`));
    else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, `${p}/${k}`);
  })(source, at);
  return out;
}

/** Everything that makes a vendored telemetry record unpublishable. */
export function telemetryProblems(record, where = TELEMETRY_FILE) {
  const problems = validate(JSON.parse(readFileSync(TELEMETRY_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-telemetry v1 as vendored)`);
  if (problems.length) return problems;
  const space = record.agent_space;
  if (space.status === 'pending' && Object.keys(space).some(key => key !== 'status' && key !== 'note')) problems.push(`${where}#/agent_space: a pending session carries no figures`);
  if (space.status === 'measured') {
    let asked = 0;
    for (const [name, agent] of Object.entries(space.per_agent)) {
      const at = `${where}#/agent_space/per_agent/${name}`;
      asked += agent.asked;
      if (agent.answered > agent.asked) problems.push(`${at}: answered ${agent.answered} of ${agent.asked} asked`);
      if (agent.with_proof > agent.answered) problems.push(`${at}: ${agent.with_proof} proof cards for ${agent.answered} answers`);
      if (agent.latency_s.p50 > agent.latency_s.p95) problems.push(`${at}/latency_s: p50 is over p95`);
    }
    if (!Object.keys(space.per_agent).length) problems.push(`${where}#/agent_space/per_agent: no agent`);
    if (space.ok_rate > 1) problems.push(`${where}#/agent_space/ok_rate: over 1`);
    if (asked !== space.rounds * space.questions_per_round) problems.push(`${where}#/agent_space: ${asked} asked, not ${space.rounds} rounds of ${space.questions_per_round}`);
    problems.push(...sourceProblems(space.source, `${where}#/agent_space/source`));
  }
  for (const [i, figure] of record.engine.entries()) problems.push(...sourceProblems(figure.source, `${where}#/engine/${i}/source`));
  // Every other string is page text.
  const { agent_space: { source, ...spaceText }, engine, vendored: { commit, packSha256, packBuiltAtCommit, ...vendored }, ...rest } = record;
  problems.push(...screenTree({ ...rest, vendored, agent_space: spaceText, engine: engine.map(({ source: s, ...figure }) => figure) }, where));
  return problems;
}

/** The committed telemetry record, checked; null when there is none. */
export function readTelemetry(root = 'site') {
  if (!existsSync(join(root, TELEMETRY_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, TELEMETRY_FILE), 'utf8'));
  const problems = telemetryProblems(record);
  if (problems.length) throw new Error(`Lab telemetry refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const seconds = v => `${format(v, 'num')} s`;
const BRAIN = { rules: 'rules', scripted: 'scripted', http: 'an external HTTP service', mcp: 'an MCP tool', model: 'a model', local: 'a local model' };
const KIND = { 'world-checked': 'the live world', wiki: 'a page it has read', tool: 'a tool', model: 'a model' };

// Answer time per agent: a bar for p50, its p95 beside it. Sized like the counts charts (a 320-wide box).
function latencyChart(agents) {
  const W = 320, VALUE = 112, ROW = 44, max = Math.max(...agents.map(([, a]) => a.latency_s.p95));
  const rows = agents.map(([name, a], i) => {
    const y = i * ROW, width = Math.max(2, Math.round((W - VALUE) * a.latency_s.p50 / max)), p95 = Math.round((W - VALUE) * a.latency_s.p95 / max);
    return `<text class="lab-chart-label" x="0" y="${y + 14}">${escape(name)}</text><rect class="lab-chart-bar" x="0" y="${y + 20}" width="${width}" height="14" rx="2"></rect><line class="lab-chart-mark" x1="${p95}" x2="${p95}" y1="${y + 17}" y2="${y + 37}"></line><text class="lab-chart-value" x="${p95 + 6}" y="${y + 32}">${seconds(a.latency_s.p50)} · p95 ${seconds(a.latency_s.p95)}</text>`;
  }).join('');
  const summary = agents.map(([name, a]) => `${name}: p50 ${seconds(a.latency_s.p50)}, p95 ${seconds(a.latency_s.p95)}`).join('; ');
  return `<svg class="lab-chart" viewBox="0 0 ${W} ${agents.length * ROW}" role="img" aria-labelledby="space-latency-title space-latency-desc"><desc id="space-latency-desc">${escape(summary)}</desc>${rows}</svg>`;
}

function renderSpace(space) {
  if (space.status === 'pending') return `<div class="lab-panel lab-pending" id="space-measured"><p class="technical">BEING MEASURED</p><p>The agent space's own numbers (answer time per agent, how many answers came with a proof card) are being measured in a live session. No number appears here until it has been.</p></div>`;
  const agents = Object.entries(space.per_agent);
  const rows = agents.map(([name, a]) => `<tr><th scope="row">${escape(name)}</th><td>${a.asked}</td><td>${a.answered}</td><td>${a.with_proof}</td><td>${a.follow_ups}</td><td>${seconds(a.latency_s.p50)}</td><td>${seconds(a.latency_s.p95)}</td><td>${escape(a.sources.map(s => KIND[s] ?? s).join(', '))}</td><td>${escape(a.brain_kinds.map(b => BRAIN[b] ?? b).join(', '))}</td></tr>`).join('');
  const total = agents.reduce((n, [, a]) => n + a.asked, 0);
  return `<figure class="lab-panel lab-panel-wide" id="space-measured"><h3 id="space-latency-title">Answer time per agent</h3><p class="lab-method"><strong>How this was measured:</strong> ${escape(space.note)}</p>${latencyChart(agents)}<p>${total} questions in ${space.rounds} rounds of ${space.questions_per_round}; answered: ${format(space.ok_rate, 'pct')}. A follow-up ("How do you know?") points at the record of the answer before it, so it is counted apart from the proof cards.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">Agent</th><th scope="col">Asked</th><th scope="col">Answered</th><th scope="col">With a proof card</th><th scope="col">Follow-ups</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">Answers from</th><th scope="col">Brain</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-source">Source: a live session on <time datetime="${escape(space.source.started.slice(0, 10))}">${escape(space.source.started.slice(0, 10))}</time>, run at commit <code>${escape(space.source.run_commit.slice(0, 8))}</code>; its session record has sha256 <code>${escape(space.source.sha256.slice(0, 12))}</code>.</p></figure>`;
}

function renderEngine(engine) {
  return `<ul class="lab-engine">${engine.map(f => `<li><p class="lab-engine-what">${escape(f.what)}</p><p class="lab-engine-value"><strong>${escape(f.value.replaceAll('->', '→'))}</strong> <span>${escape(f.unit)}</span></p>${isMainCommit(f.source.commit) ? '' : `<p class="lab-engine-branch">${WORK_BRANCH}</p>`}<p class="lab-source">Source: claims row ${escape(f.source.row)}, ${isMainCommit(f.source.commit) ? 'commit' : 'branch'} <code>${escape(f.source.commit)}</code>.</p></li>`).join('')}</ul>`;
}

/** The space's measurements and the engine figures, each with its source; the vendoring noted under them. */
export function renderTelemetry(record, { benchLink = false } = {}) {
  if (!record) return '<p class="lab-none">The agent space\'s own numbers are being measured.</p>';
  const v = record.vendored;
  const bench = benchLink ? 'The brain benchmark from the same pack has <a href="../brain-bench/">its own lab</a>.' : 'The brain benchmark from the same pack gets its own lab.';
  return `<h3 class="lab-subhead">The agent space, measured</h3>${renderSpace(record.agent_space)}<h3 class="lab-subhead" id="engine">The engine underneath</h3><p class="lab-telemetry-note">${escape(record.rule[0].toUpperCase() + record.rule.slice(1))}.</p>${renderEngine(record.engine)}<p class="lab-source lab-vendored">From ${escape(v.from)}, at commit <code>${escape(v.commit.slice(0, 8))}</code> (sha256 <code>${escape(v.packSha256.slice(0, 12))}</code>). Kept: ${escape(v.kept)}. Left out: ${escape(v.leftOut)}. ${bench}</p>`;
}
