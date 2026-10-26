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
// The page draws each point as a dot on a time axis and nothing between points: no line, no interpolation. A series with
// one point says "One measurement so far". Every point cites its commit by hash; this page cannot check a private commit,
// and says so; anyone with access can re-derive the file with the vendor script's --verify.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_HISTORY_FILE = 'data/labs/agent-space/engine-history.json';
export const ENGINE_HISTORY_SCHEMA = join(here, 'schemas/odin-engine-history.schema.json');
export const ENGINE_HISTORY_PIN = join(here, 'engine-history.pin.json');
export const ONE_POINT = 'One measurement so far.';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** A timestamp that is a real calendar instant (2026-02-30 or 24:00 is refused), or null. */
export function realInstant(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s ? date : null;
}

/** Why the committed bytes are not the pinned ones. */
export function pinProblems(bytes, pin) {
  if (!pin || pin.format !== 'odin-engine-history-pin' || pin.version !== 1) return ['scripts/engine-history.pin.json: missing, or not odin-engine-history-pin v1'];
  const problems = [];
  if (pin.file !== `site/${ENGINE_HISTORY_FILE}`) problems.push(`scripts/engine-history.pin.json: file is not site/${ENGINE_HISTORY_FILE}`);
  if (!/^[0-9a-f]{64}$/.test(pin.sourceSha256 ?? '')) problems.push('scripts/engine-history.pin.json: sourceSha256 is not a sha256');
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? '')) problems.push('scripts/engine-history.pin.json: commit is not a 40-hex commit');
  if (pin.fileSha256 !== sha256(bytes)) problems.push(`${ENGINE_HISTORY_FILE}: its sha256 is ${sha256(bytes)}, the pin says ${pin.fileSha256}; re-vendor with scripts/vendor-engine-history.mjs`);
  return problems;
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
  const file = join(root, ENGINE_HISTORY_FILE);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const usePin = pin ?? (existsSync(ENGINE_HISTORY_PIN) ? JSON.parse(readFileSync(ENGINE_HISTORY_PIN, 'utf8')) : null);
  const problems = [...pinProblems(bytes, usePin), ...engineHistoryProblems(JSON.parse(bytes), { now })];
  if (problems.length) throw new Error(`Lab 01 engine history refused:\n  ${problems.join('\n  ')}`);
  return JSON.parse(bytes);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const d = realInstant(iso); return `<time datetime="${escape(iso)}">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC</time>`; };
const values = vals => Object.entries(vals).map(([k, v]) => `${escape(k.replaceAll('_', ' '))}: <strong>${escape(v.toLocaleString('en-GB'))}</strong>`).join(' · ');
const cite = p => `Private commit <code>${escape(p.commit.slice(0, 8))}</code>, cited by hash; this page cannot check it, anyone with access can.`;

// A dot plot on a time axis for a series with two or more points: one dot per point, its height the first value;
// nothing is drawn between dots, so a gap reads as a gap.
function dotPlot(s) {
  const W = 320, H = 120, PAD = 28;
  const times = s.points.map(p => realInstant(p.at).getTime()), key = Object.keys(s.points[0].values)[0];
  const ys = s.points.map(p => p.values[key]);
  const t0 = Math.min(...times), t1 = Math.max(...times), y1 = Math.max(...ys, 1);
  const x = t => PAD + (t1 > t0 ? (W - 2 * PAD) * (t - t0) / (t1 - t0) : (W - 2 * PAD) / 2);
  const y = v => H - PAD - (H - 2 * PAD) * v / y1;
  const dots = s.points.map((p, i) => `<circle class="engine-dot" cx="${x(times[i]).toFixed(1)}" cy="${y(ys[i]).toFixed(1)}" r="5"></circle><text class="lab-chart-value" x="${x(times[i]).toFixed(1)}" y="${(y(ys[i]) - 9).toFixed(1)}" text-anchor="middle">${escape(ys[i])}</text>`).join('');
  const axis = `<line class="engine-axis" x1="${PAD}" x2="${W - PAD}" y1="${H - PAD}" y2="${H - PAD}"></line><text class="lab-chart-label" x="${PAD}" y="${H - 8}">${escape(s.points[0].at.slice(0, 10))}</text><text class="lab-chart-label" x="${W - PAD}" y="${H - 8}" text-anchor="end">${escape(s.points.at(-1).at.slice(0, 10))}</text>`;
  const desc = s.points.map(p => `${p.at.slice(0, 10)}: ${key.replaceAll('_', ' ')} ${p.values[key]}`).join('; ');
  return `<svg class="lab-chart engine-plot" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="engine-${escape(s.id)}-title engine-${escape(s.id)}-desc"><desc id="engine-${escape(s.id)}-desc">${escape(key.replaceAll('_', ' '))} at each point, with nothing drawn between points: ${escape(desc)}</desc>${axis}${dots}</svg>`;
}

/** The section: one panel per series, every point with its date, values, what changed and its citation. */
export function renderEngineHistory(record) {
  if (!record) return '';
  const panels = record.series.filter(s => s.points.length).map(s => {
    const one = s.points.length === 1;
    const rows = s.points.map(p => `<li><p class="engine-when">${day(p.at)}</p><p>${values(p.values)} <span class="engine-unit">(${escape(s.unit)})</span></p><p>${escape(p.change[0].toUpperCase() + p.change.slice(1))}.</p><p class="lab-source">${cite(p)}</p></li>`).join('');
    return `<figure class="lab-panel engine-series" id="engine-${escape(s.id)}"><h4 id="engine-${escape(s.id)}-title">${escape(s.title)}</h4><p>${escape(s.note)}</p>${one ? `<p class="engine-one"><span class="engine-dot-key" aria-hidden="true"></span>${ONE_POINT}</p>` : dotPlot(s)}<ol class="engine-points">${rows}</ol></figure>`;
  }).join('');
  const v = record.vendored;
  const empty = record.series.filter(s => !s.points.length).map(s => s.title);
  return `<section class="company-section company-width" id="engine-over-time" aria-labelledby="engine-over-time-title"><div class="company-section-heading"><h2 id="engine-over-time-title">The engine, measured over time.</h2><p>Each dot is a moment a figure changed in the agent space's own records: one commit, cited by its hash. Nothing is drawn between dots: a gap is a gap, not a guess.</p></div><p class="lab-telemetry-note">From ${escape(v.from)}: ${escape(v.commitsRead.claims)} versions of the claims table and ${escape(v.commitsRead.pack)} of the telemetry pack. The rule: ${escape(v.rule)}. Every commit was checked against the private main head <code>${escape(v.mainCheck.main.slice(0, 8))}</code> on <time datetime="${escape(v.mainCheck.checked)}">${escape(v.mainCheck.checked)}</time> (${escape(v.mainCheck.how)}).${empty.length ? ` Not measured yet: ${escape(empty.join(', '))}.` : ''}</p><div class="lab-panels">${panels}</div></section>`;
}
