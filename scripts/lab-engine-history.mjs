// "The engine, measured over time" on Lab 01 (founder plan 6), from site/data/labs/agent-space/engine-history.json
// (odin-engine-history v1, scripts/schemas/odin-engine-history.schema.json), which scripts/vendor-engine-history.mjs
// builds from the git history of the agent space's private claims table and telemetry pack.
//
// The build refuses it, every reason listed, when:
//   - its bytes are not the pinned ones (scripts/engine-history.pin.json: the file's sha256, the sha256 of the private
//     versions it was built from, and the private main head they were checked against);
//   - it misses the schema (every object is closed: no repository name, path or claim text can ride along);
//   - a point has no full commit, names another main head than the one recorded (vendored.mainCheck), is not a real date,
//     is dated after the build, or is out of date order; or a value is not a finite number;
//   - any text fails the publisher's screen.
// Lab 01's "The engine underneath" shows it (scripts/lab-telemetry.mjs): the one series with several points, engine
// claims in the main build, as a step chart (a value held until a commit changes it; never estimated between points),
// and beside each engine figure with one point, "Measured once so far, on <date>". A figure with one point is never
// drawn. Every point cites its commit by hash; this page cannot check a private commit, and says so; anyone with access
// can re-derive the file with the vendor script's --verify. A figure becomes a series by itself the first time a later
// commit changes it: re-vendoring is all it takes.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cite, escape, parsePin, pinProblems as kitPinProblems, readPinned, realInstant, screenHits, validate } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_HISTORY_FILE = 'data/labs/agent-space/engine-history.json';
export const ENGINE_HISTORY_SCHEMA = join(here, 'schemas/odin-engine-history.schema.json');
export const ENGINE_HISTORY_PIN = join(here, 'engine-history.pin.json');

// The kit's (scripts/lab-kit.mjs); exported here too, as before.
export { cite, realInstant };

/**
 * Why the committed bytes are not the pinned ones. The pin is a second, separately reviewed file: it must name the same
 * file sha256, the same private-source sha256 and the same private main head the record itself carries, so neither can
 * be edited alone. (Whether that source sha256 is what the private history gives is --verify's job; the build cannot
 * read the history.)
 */
export function pinProblems(bytes, pin) {
  // One kit pin (scripts/lab-kit.mjs), committed here as JSON.
  const pinFile = 'scripts/engine-history.pin.json';
  const parsed = parsePin(pin, { pinFile, format: 'odin-engine-history-pin', file: `site/${ENGINE_HISTORY_FILE}` });
  if (!parsed.pin) return parsed.problems;
  return [...parsed.problems, ...kitPinProblems(bytes, parsed.pin, { pinFile, file: ENGINE_HISTORY_FILE, vendor: 'scripts/vendor-engine-history.mjs' })];
}

/** Everything that makes an engine-history record unpublishable. */
export function engineHistoryProblems(record, { now = new Date(), where = ENGINE_HISTORY_FILE } = {}) {
  const problems = validate(JSON.parse(readFileSync(ENGINE_HISTORY_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-engine-history v1)`);
  if (problems.length) return problems;
  const screen = (text, at) => screenHits(text).map(hit => `${at}: ${hit.reason}`);
  const v = record.vendored;
  for (const key of ['from', 'rule']) problems.push(...screen(v[key], `${where}#/vendored/${key}`));
  problems.push(...screen(v.mainCheck.how, `${where}#/vendored/mainCheck/how`));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.mainCheck.checked) || !realInstant(`${v.mainCheck.checked}T00:00:00Z`)) problems.push(`${where}#/vendored/mainCheck/checked: not a real date`);
  const ids = new Set();
  for (const [i, s] of record.series.entries()) {
    const at = `${where}#/series/${i}`;
    if (ids.has(s.id)) problems.push(`${at}/id: ${s.id} is listed twice`);
    ids.add(s.id);
    for (const key of ['title', 'unit', 'note']) problems.push(...screen(s[key], `${at}/${key}`));
    let last = null;
    for (const [j, p] of s.points.entries()) {
      const pat = `${at}/points/${j}`;
      const when = realInstant(p.at);
      if (!when) problems.push(`${pat}/at: ${p.at} is not a real date`);
      else {
        if (when > now) problems.push(`${pat}/at: ${p.at} is after this build`);
        if (last && when < last) problems.push(`${pat}/at: ${p.at} comes before the point above it`);
        last = when;
      }
      if (p.onMain !== v.mainCheck.main) problems.push(`${pat}/onMain: a point must name the main head it was checked against (${v.mainCheck.main})`);
      if (!Object.keys(p.values).length) problems.push(`${pat}/values: no value`);
      for (const [k, val] of Object.entries(p.values)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) problems.push(`${pat}/values: ${JSON.stringify(k)} is not a plain name`);
        if (typeof val !== 'number' || !Number.isFinite(val)) problems.push(`${pat}/values/${k}: not a finite number`);
        problems.push(...screen(k.replaceAll('_', ' '), `${pat}/values/${k}`));
      }
      problems.push(...screen(p.change, `${pat}/change`));
    }
  }
  return problems;
}

/** The committed record, pinned and checked; null when there is none. */
export function readEngineHistory(root = 'site', { now = new Date(), pin } = {}) {
  const usePin = pin ?? (existsSync(ENGINE_HISTORY_PIN) ? JSON.parse(readFileSync(ENGINE_HISTORY_PIN, 'utf8')) : null);
  return readPinned({ root, file: ENGINE_HISTORY_FILE, pin: bytes => pinProblems(bytes, usePin), check: record => engineHistoryProblems(record, { now }), refused: 'Lab 01 engine history refused' });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const d = realInstant(iso); return `<time datetime="${escape(iso)}">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC</time>`; };
const values = vals => Object.entries(vals).map(([k, v]) => `${escape(k.replaceAll('_', ' '))}: <strong>${escape(v.toLocaleString('en-GB'))}</strong>`).join(' · ');
// Every stated or drawn point cites its commit AND the private main head it was checked to be part of, and when, with
// the kit's cite (scripts/lab-kit.mjs), the sentence every lab uses.
/** Which engine-history series follows each engine figure Lab 01 shows (by claim), and the agent space's answer time. */
export const SERIES_FOR_CLAIM = { 10: 'test-suite', 20: 'tick-1000', d7: 'campus-draws' };
export const ANSWER_TIME = 'answer-time';
export const CLAIMS_ON_MAIN = 'claims-on-main';
const seriesById = (history, id) => history?.series.find(s => s.id === id) ?? null;
const shortDay = iso => { const d = realInstant(iso); return `<time datetime="${escape(iso)}">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}</time>`; };

// A step chart for a series with two or more points: each value is held flat until the next point changes it, then
// steps. A value is never estimated between points (a step is "it stayed this until it changed", which the history
// records); a series with one point is never drawn, only stated.
/** Which value each series' chart draws (the rest are listed under it); default: its first value. */
export const CHART_KEY = { 'tick-1000': 'p50_ms', 'campus-draws': 'p50_ms', 'answer-time': 'Odin_p50_s' };

export function stepChart(s) {
  if (s.points.length < 2) throw new Error(`${s.id}: a step chart needs two or more points`);
  const first = Object.keys(s.points[0].values), key = first.includes(CHART_KEY[s.id]) ? CHART_KEY[s.id] : first[0];
  const W = 320, H = 130, PAD = 28;
  const times = s.points.map(p => realInstant(p.at).getTime()), ys = s.points.map(p => p.values[key]);
  const t0 = times[0], t1 = times.at(-1), y1 = Math.max(...ys, 1);
  const x = t => (PAD + (W - 2 * PAD) * (t - t0) / (t1 - t0)).toFixed(1);
  const y = v => (H - PAD - (H - 2 * PAD) * v / y1).toFixed(1);
  const steps = s.points.slice(1).map((p, i) => `<line class="engine-step" x1="${x(times[i])}" y1="${y(ys[i])}" x2="${x(times[i + 1])}" y2="${y(ys[i])}"></line><line class="engine-step" x1="${x(times[i + 1])}" y1="${y(ys[i])}" x2="${x(times[i + 1])}" y2="${y(ys[i + 1])}"></line>`).join('');
  const dots = s.points.map((p, i) => `<circle class="engine-dot" cx="${x(times[i])}" cy="${y(ys[i])}" r="4.5"></circle><text class="lab-chart-value" x="${x(times[i])}" y="${(+y(ys[i]) - 9).toFixed(1)}" text-anchor="middle">${escape(ys[i])}</text>`).join('');
  const axis = `<line class="engine-axis" x1="${PAD}" x2="${W - PAD}" y1="${H - PAD}" y2="${H - PAD}"></line><text class="lab-chart-label" x="${PAD}" y="${H - 8}">${escape(s.points[0].at.slice(0, 10))}</text><text class="lab-chart-label" x="${W - PAD}" y="${H - 8}" text-anchor="end">${escape(s.points.at(-1).at.slice(0, 10))}</text>`;
  const desc = s.points.map(p => `${p.at.slice(0, 10)}: ${p.values[key]}`).join('; ');
  return `<svg class="lab-chart engine-plot" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="engine-${escape(s.id)}-title engine-${escape(s.id)}-desc"><desc id="engine-${escape(s.id)}-desc">${escape(key.replaceAll('_', ' '))}, held until each change: ${escape(desc)}</desc>${axis}${steps}${dots}</svg>`;
}

/**
 * A figure's history beside it: nothing for no point; "Measured once so far, on <date>" with its citation for one point
 * (never drawn); a step chart and every point with its citation for two or more. So a figure measured once becomes a
 * series by itself, here and in the chart, the first time a later commit changes it: re-vendoring is all it takes.
 */
export function measuredLine(history, id) {
  const s = seriesById(history, id);
  if (!s || !s.points.length) return '';
  const mc = history.vendored.mainCheck;
  if (s.points.length === 1) return `<p class="engine-once">Measured once so far, on ${shortDay(s.points[0].at)}. ${cite(s.points[0], mc)}</p>`;
  return `<div class="engine-history"><p class="engine-once">Measured ${s.points.length} times, from ${shortDay(s.points[0].at)} to ${shortDay(s.points.at(-1).at)}.</p>${stepChart(s)}${pointList(s, mc, 'Each measurement, with its commit')}</div>`;
}

const pointList = (s, mc, summary) => `<details class="lab-panel-table"><summary>${escape(summary)}</summary><ol class="engine-points">${s.points.map(p => `<li><p class="engine-when">${day(p.at)}</p><p>${values(p.values)}</p><p>${escape(p.change[0].toUpperCase() + p.change.slice(1))}.</p><p class="lab-source">${cite(p, mc)}</p></li>`).join('')}</ol></details>`;

/** "Engine claims in the main build over time": the step chart and every point with its citation. Nothing for no history. */
export function renderClaimsOverTime(history) {
  const s = seriesById(history, CLAIMS_ON_MAIN);
  if (!s || !s.points.length) return '';
  if (s.points.length === 1) return `<div class="lab-panel engine-series" id="engine-${escape(s.id)}"><h4 id="engine-${escape(s.id)}-title">Engine claims in the main build over time</h4>${measuredLine(history, s.id)}</div>`;
  const v = history.vendored;
  return `<figure class="lab-panel lab-panel-wide engine-series" id="engine-${escape(s.id)}"><h4 id="engine-${escape(s.id)}-title">Engine claims in the main build over time</h4><p>${escape(s.note)}</p>${stepChart(s)}${pointList(s, v.mainCheck, 'Each change, with its commit')}<p class="lab-source">From ${escape(v.from)}: ${escape(v.commitsRead.claims)} versions of the claims table and ${escape(v.commitsRead.pack)} of the telemetry pack. The rule: ${escape(v.rule)}. A figure measured once becomes a series by itself the first time a later commit changes it. Every commit was checked against the private main head <code>${escape(v.mainCheck.main.slice(0, 8))}</code> on <time datetime="${escape(v.mainCheck.checked)}">${escape(v.mainCheck.checked)}</time> (${escape(v.mainCheck.how)}).</p></figure>`;
}
