// Lab 01's telemetry (mission rnd-labs-human-first-1024): "The agent space, measured" and "The engine underneath" on
// /labs/agent-space/, from site/data/labs/agent-space/telemetry.json: the agent space's own odin-telemetry v1 pack,
// vendored by scripts/vendor-telemetry.mjs (schema scripts/schemas/odin-telemetry.schema.json). The vendored file
// records the pack's commit and the sha256 of the pack, its session record and its claims table, and says what was
// left out (the benchmark rows, the session's run id, every private path, and any figure without a claims row).
//
// The build refuses it, every reason listed, when it misses the schema; when a session figure is not what the
// session's own question rows give (every per-agent count, both latencies, the sources, the brains and the ok rate are
// recomputed from the rows, the way the space's measuring script computes them), or asked is not rounds times
// questions per round; when an engine figure differs from the digest taken when it was vendored (figuresSha256); when
// a figure in the main build has no commit, or does not name the main head the vendoring checked it is an ancestor of
// (vendored.mainCheck); or when any text, a source included, fails the dispatch publisher's
// screen (a source is a public label, a date or a commit: a path is refused). While agent_space is "pending" the
// page says it is being measured and shows no number. A figure whose claims row says LANE is labelled a work branch
// on the page, and one whose commit is not yet published says so.
//
// What this build cannot check: that the file came from the private pack, session record and claims table. They are
// not readable here, and a digest kept beside the values can be recomputed by whoever edits them. That provenance is
// checked by `scripts/vendor-telemetry.mjs --verify`, which vendors the private files again and refuses unless the
// result is this file; it compares every engine figure with its claims row and every "main build" commit with the
// private main head. The page says so next to the figures.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { format } from './number-provenance.mjs';

export const TELEMETRY_FILE = 'data/labs/agent-space/telemetry.json';
export const TELEMETRY_SCHEMA_FILE = new URL('./schemas/odin-telemetry.schema.json', import.meta.url);
export const WORK_BRANCH = 'Measured on a work branch: its claims row says LANE, not MAIN.';
export const NO_COMMIT = 'Its commit is not published yet, so this figure cannot be checked yet.';

/** JSON with every object's keys sorted: the form the digests are taken over. */
export const canonicalJson = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
/** The digest of the public engine figures, taken when they are vendored and again at every build. */
export const figuresDigest = engine => createHash('sha256').update(canonicalJson(engine)).digest('hex');

// The space's measuring script: the value at index floor(p * n) of the sorted list (the last one at most), to 2 places.
const quantile = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 100) / 100 : null;
};
const distinct = xs => [...new Set(xs.filter(Boolean))].sort();

/** The session's figures as its question rows give them; latency counts only answers with their own proof record. */
export function sessionFromRows(rows, agents) {
  const per_agent = {};
  for (const agent of agents) {
    const r = rows.filter(x => x.agent === agent);
    if (!r.length) continue;
    const proofs = r.filter(x => x.proof).map(x => x.s);
    per_agent[agent] = {
      asked: r.length,
      answered: r.filter(x => x.answered).length,
      with_proof: r.filter(x => x.proof).length,
      latency_s: { p50: quantile(proofs, 0.5), p95: quantile(proofs, 0.95) },
      follow_ups: r.filter(x => x.answered && !x.proof).length,
      sources: distinct(r.map(x => x.source)),
      brain_kinds: distinct(r.map(x => x.via)),
    };
  }
  const ok = rows.filter(x => x.ok).length, proofs = rows.filter(x => x.proof).length;
  return { per_agent, ok_rate: Math.round((ok / Math.max(1, proofs)) * 1e4) / 1e4, ok, proofs };
}

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Strings under a `source` are public labels, dates and commits, screened like every other word: a path is refused.
function sourceProblems(source, at) {
  const out = [];
  (function walk(v, p) {
    if (typeof v === 'string') out.push(...screenHits(v).map(hit => `${p}: ${hit.reason}`));
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
    const given = sessionFromRows(space.rows, Object.keys(space.per_agent));
    for (const [name, agent] of Object.entries(space.per_agent)) {
      for (const [field, value] of Object.entries(agent)) {
        const fromRows = given.per_agent[name]?.[field];
        if (canonicalJson(value) !== canonicalJson(fromRows)) problems.push(`${where}#/agent_space/per_agent/${name}/${field}: ${canonicalJson(value)}, the session rows give ${canonicalJson(fromRows) ?? 'nothing'}`);
      }
    }
    for (const agent of new Set(space.rows.map(x => x.agent))) if (!(agent in space.per_agent)) problems.push(`${where}#/agent_space/rows: rows for ${agent}, who has no figures`);
    if (!Object.keys(space.per_agent).length) problems.push(`${where}#/agent_space/per_agent: no agent`);
    if (space.ok_rate !== given.ok_rate) problems.push(`${where}#/agent_space/ok_rate: ${space.ok_rate}, the session rows give ${given.ok_rate}`);
    if (space.rows.length !== space.rounds * space.questions_per_round) problems.push(`${where}#/agent_space: ${space.rows.length} asked, not ${space.rounds} rounds of ${space.questions_per_round}`);
    if (space.rows.some(x => x.round >= space.rounds)) problems.push(`${where}#/agent_space/rows: a row from a round after the last`);
    problems.push(...sourceProblems(space.source, `${where}#/agent_space/source`));
  }
  const digest = figuresDigest(record.engine);
  if (digest !== record.vendored.figuresSha256) problems.push(`${where}#/engine: the figures are not the ones vendored (sha256 ${digest}, vendored ${record.vendored.figuresSha256}); re-vendor them with scripts/vendor-telemetry.mjs`);
  for (const pin of record.vendored.pinned) {
    const figure = record.engine.find(f => String(f.claim) === pin.claim);
    if (!figure || figure.source.commit !== pin.commit) problems.push(`${where}#/vendored/pinned: claim ${pin.claim}'s pin is not its figure's commit`);
  }
  for (const [i, figure] of record.engine.entries()) {
    if (figure.source.status === 'main' && !figure.source.commit) problems.push(`${where}#/engine/${i}/source: a figure in the main build without its commit`);
    if (figure.source.status === 'main' && figure.source.onMain !== record.vendored.mainCheck.main) problems.push(`${where}#/engine/${i}/source/onMain: a figure in the main build must name the main head its commit was checked against (${record.vendored.mainCheck.main})`);
    if (figure.source.status !== 'main' && 'onMain' in figure.source) problems.push(`${where}#/engine/${i}/source/onMain: only a figure in the main build is checked against main`);
    problems.push(...sourceProblems(figure.source, `${where}#/engine/${i}/source`));
  }
  // Every other string is page text.
  const { agent_space: { source, ...spaceText }, engine, vendored: { commit, packSha256, packBuiltAtCommit, claimsSha256, figuresSha256, mainCheck: { main, ...mainCheck }, ...vendored }, ...rest } = record;
  problems.push(...screenTree({ ...rest, vendored: { ...vendored, mainCheck }, agent_space: spaceText, engine: engine.map(({ source: s, ...figure }) => figure) }, where));
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
  // All latencies 0 is a valid record: every bar and mark then sits at 0 instead of dividing by it.
  const x = v => (max > 0 ? Math.round((W - VALUE) * v / max) : 0);
  const rows = agents.map(([name, a], i) => {
    const y = i * ROW, width = Math.max(2, x(a.latency_s.p50)), p95 = x(a.latency_s.p95);
    return `<text class="lab-chart-label" x="0" y="${y + 14}">${escape(name)}</text><rect class="lab-chart-bar" x="0" y="${y + 20}" width="${width}" height="14" rx="2"></rect><line class="lab-chart-mark" x1="${p95}" x2="${p95}" y1="${y + 17}" y2="${y + 37}"></line><text class="lab-chart-value" x="${p95 + 6}" y="${y + 32}">${seconds(a.latency_s.p50)} · p95 ${seconds(a.latency_s.p95)}</text>`;
  }).join('');
  const summary = agents.map(([name, a]) => `${name}: p50 ${seconds(a.latency_s.p50)}, p95 ${seconds(a.latency_s.p95)}`).join('; ');
  return `<svg class="lab-chart" viewBox="0 0 ${W} ${agents.length * ROW}" role="img" aria-labelledby="space-latency-title space-latency-desc"><desc id="space-latency-desc">${escape(summary)}</desc>${rows}</svg>`;
}

function renderSpace(space) {
  if (space.status === 'pending') return `<div class="lab-panel lab-pending" id="space-measured"><p class="technical">BEING MEASURED</p><p>The agent space's own numbers (answer time per agent, how many answers came with a proof card) are being measured in a live session. No number appears here until it has been.</p></div>`;
  const agents = Object.entries(space.per_agent);
  const rows = agents.map(([name, a]) => `<tr><th scope="row">${escape(name)}</th><td>${a.asked}</td><td>${a.answered}</td><td>${a.with_proof}</td><td>${a.follow_ups}</td><td>${seconds(a.latency_s.p50)}</td><td>${seconds(a.latency_s.p95)}</td><td>${escape(a.sources.map(s => KIND[s] ?? s).join(', '))}</td><td>${escape(a.brain_kinds.map(b => BRAIN[b] ?? b).join(', '))}</td></tr>`).join('');
  const total = agents.reduce((n, [, a]) => n + a.asked, 0), answered = agents.reduce((n, [, a]) => n + a.answered, 0);
  const { ok, proofs } = sessionFromRows(space.rows, agents.map(([name]) => name));
  return `<figure class="lab-panel lab-panel-wide" id="space-measured"><h3 id="space-latency-title">Answer time per agent</h3><p class="lab-method"><strong>How this was measured:</strong> ${escape(space.note)}</p>${latencyChart(agents)}<p>${total} questions in ${space.rounds} rounds of ${space.questions_per_round}: ${answered} answered, ${proofs} with a proof card of their own, and ${ok} of those ${proofs} proof records say the answer was checked ok. A follow-up ("How do you know?") points at the record of the answer before it, so it is counted apart from the proof cards.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">Agent</th><th scope="col">Asked</th><th scope="col">Answered</th><th scope="col">With a proof card</th><th scope="col">Follow-ups</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">Answers from</th><th scope="col">Brain</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-source">Source: the record of a live session on <time datetime="${escape(space.source.started.slice(0, 10))}">${escape(space.source.started.slice(0, 10))}</time>, run at commit <code>${escape(space.source.run_commit.slice(0, 8))}</code> (sha256 <code>${escape(space.source.sha256.slice(0, 12))}</code>, kept in a private repository). Its ${space.rows.length} question rows are copied here unchanged, and every number above is recomputed from them each time this page is built.</p></figure>`;
}

function engineSource(source, pin) {
  const where = source.status === 'main' ? 'in the main build (an ancestor of its main head)' : 'on a work branch';
  if (!source.commit) return `Source: claims row ${escape(source.row)}, ${where}. ${NO_COMMIT}`;
  return `Source: claims row ${escape(source.row)}, ${where}, commit <code>${escape(source.commit.slice(0, 8))}</code>.${pin ? ` How that commit was found: ${escape(pin.how)}` : ''}`;
}

function renderEngine(engine, pinned = []) {
  return `<ul class="lab-engine">${engine.map(f => `<li><p class="lab-engine-what">${escape(f.what)}</p><p class="lab-engine-value"><strong>${escape(f.value.replaceAll('->', '→'))}</strong> <span>${escape(f.unit)}</span></p>${f.source.status === 'main' ? '' : `<p class="lab-engine-branch">${WORK_BRANCH}</p>`}<p class="lab-source">${engineSource(f.source, pinned.find(p => p.claim === String(f.claim)))}</p></li>`).join('')}</ul>`;
}

/** The space's measurements and the engine figures, each with its source; the vendoring noted under them. */
export function renderTelemetry(record, { benchLink = false } = {}) {
  if (!record) return '<p class="lab-none">The agent space\'s own numbers are being measured.</p>';
  const v = record.vendored;
  const bench = benchLink ? 'The brain benchmark from the same pack has <a href="../brain-bench/">its own lab</a>.' : 'The brain benchmark from the same pack gets its own lab.';
  return `<h3 class="lab-subhead">The agent space, measured</h3>${renderSpace(record.agent_space)}<h3 class="lab-subhead" id="engine">The engine underneath</h3><p class="lab-telemetry-note">${escape(record.rule[0].toUpperCase() + record.rule.slice(1))}.</p>${renderEngine(record.engine, v.pinned)}<p class="lab-source lab-vendored">From ${escape(v.from)}, at commit <code>${escape(v.commit.slice(0, 8))}</code> (sha256 <code>${escape(v.packSha256.slice(0, 12))}</code>). Kept: ${escape(v.kept)}. Left out: ${escape(v.leftOut)}.${v.omitted.map(o => ` Left out until it has a source: claim ${escape(o.claim)} (${escape(o.why)}).`).join('')} The engine figures come from a claims table kept in a private repository (sha256 <code>${escape(v.claimsSha256.slice(0, 12))}</code>). When they were vendored, each was compared with its claims row, and each commit was checked against the private main head <code>${escape(v.mainCheck.main.slice(0, 8))}</code> on <time datetime="${escape(v.mainCheck.checked)}">${escape(v.mainCheck.checked)}</time> (${escape(v.mainCheck.how)}). This page's build cannot read those private files, so it checks only that the figures are the ones vendored; anyone with access can check the rest again with the vendoring script's --verify. ${bench}</p>`;
}
