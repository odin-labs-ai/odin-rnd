// Lab 01's counts (mission rnd-labs-human-first-1024): the "Counted from the published records" panels on
// /labs/agent-space/, from site/data/labs/agent-space/counts.json (odin-lab-counts v1, scripts/schemas/odin-lab-counts.schema.json),
// drawn at build time as inline SVG bar charts, each with a table of the same numbers and their sources. The space's own
// measurements are a separate record (scripts/lab-telemetry.mjs).
//
// Every number names its source, "data/labs/agent-space/<record>.json#<JSON pointer>", and the build recomputes it from
// there: with derive "value" (the default) the pointer must resolve to that number; with derive "count" it must
// resolve to a list whose length (or, with `where`, the count of its items whose fields equal `where`'s) is that
// number. A number without a source, a source that is not a committed lab record (SOURCE_RECORD: a published dispatch,
// the films record or the vendored telemetry pack, never this file or a page), or a value its source does not give fails the build, every reason
// listed. Its words pass the dispatch publisher's screen. A new record kind widens SOURCE_RECORD in its own reviewed change.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { format, resolvePointer } from './number-provenance.mjs';

export const COUNTS_FILE = 'data/labs/agent-space/counts.json';
export const COUNTS_SCHEMA_FILE = new URL('./schemas/odin-lab-counts.schema.json', import.meta.url);
/** The only records a number may come from: a published dispatch, the films record, or the vendored telemetry pack (each gated by its own check). */
export const SOURCE_RECORD = /^data\/labs\/agent-space\/(?:dispatches\/session-[a-z0-9-]+|films|telemetry)\.json$/;

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isPrimitive = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** The number a bar's source gives, or the reason it gives none. */
export function sourceValue(bar, root) {
  const hash = bar.source.indexOf('#');
  const file = hash < 0 ? bar.source : bar.source.slice(0, hash), pointer = hash < 0 ? null : bar.source.slice(hash + 1);
  if (pointer === null) return { problem: 'the source names no JSON pointer (data/labs/agent-space/<record>.json#/<pointer>)' };
  if (!SOURCE_RECORD.test(file)) return { problem: `${file} is not a committed lab record (a published dispatch, the films record or the telemetry pack)` };
  if (!existsSync(join(root, file))) return { problem: `${file} is missing` };
  let target;
  try { target = resolvePointer(JSON.parse(readFileSync(join(root, file), 'utf8')), pointer); } catch (error) { return { problem: `${file} is not JSON (${error.message})` }; }
  if (target === undefined) return { problem: `${bar.source} does not resolve` };
  const derive = bar.derive ?? 'value';
  if (bar.where !== undefined && derive !== 'count') return { problem: '`where` only applies to derive "count"' };
  if (derive === 'value') return typeof target === 'number' && Number.isFinite(target) ? { value: target } : { problem: `${bar.source} is not a number` };
  if (!Array.isArray(target)) return { problem: `${bar.source} is not a list to count` };
  const where = Object.entries(bar.where ?? {});
  if (!where.every(([, v]) => isPrimitive(v))) return { problem: '`where` may only compare fields with plain values' };
  return { value: target.filter(item => where.every(([key, v]) => item !== null && typeof item === 'object' && item[key] === v)).length };
}

/** Everything that makes a counts record unpublishable; with `root`, every number is recomputed from its source there. */
export function countsProblems(record, where = COUNTS_FILE, root = 'site') {
  const problems = validate(JSON.parse(readFileSync(COUNTS_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-lab-counts v1)`);
  if (problems.length) return problems;
  const ids = new Set();
  for (const [p, panel] of record.panels.entries()) {
    if (ids.has(panel.id)) problems.push(`${where}#/panels/${p}/id: ${panel.id} is listed twice`);
    ids.add(panel.id);
    for (const [b, bar] of panel.bars.entries()) {
      const at = `${where}#/panels/${p}/bars/${b}`;
      // The source is a path, checked as one below; it may still carry no restricted name or place.
      problems.push(...screenHits(bar.source).filter(hit => !hit.reason.startsWith('a file path')).map(hit => `${at}/source: ${hit.reason}`));
      const { value, problem } = sourceValue(bar, root);
      if (problem) problems.push(`${at}/source: ${problem}`);
      else if (value !== bar.value) problems.push(`${at}/value: ${bar.value} is not what its source gives (${value})`);
    }
  }
  const { panels, ...rest } = record;
  problems.push(...screenTree({ ...rest, panels: panels.map(({ bars, ...panel }) => ({ ...panel, bars: bars.map(({ source, value, derive, where: w, ...bar }) => ({ ...bar, where: w })) })) }, where));
  return problems;
}

/** The committed counts record, checked; null when there is none. */
export function readCounts(root = 'site') {
  if (!existsSync(join(root, COUNTS_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, COUNTS_FILE), 'utf8'));
  const problems = countsProblems(record, COUNTS_FILE, root);
  if (problems.length) throw new Error(`Lab counts refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const shown = value => format(value, Number.isInteger(value) ? 'int' : 'num');
const howDerived = bar => (bar.derive ?? 'value') === 'value' ? 'the value'
  : `counted${bar.where ? `, where ${Object.entries(bar.where).map(([k, v]) => `${k} is ${JSON.stringify(v)}`).join(' and ')}` : ''}`;

// One bar chart: a label above each bar, the value at its end. Sized in a 320-wide box, about the width a panel gets, so its text stays near its set size on a phone and a desktop.
function chart(panel) {
  const W = 320, VALUE = 36, ROW = 44, max = Math.max(...panel.bars.map(bar => bar.value), 1);
  const rows = panel.bars.map((bar, i) => {
    const y = i * ROW, width = bar.value === 0 ? 0 : Math.max(2, Math.round((W - VALUE) * bar.value / max));
    return `<text class="lab-chart-label" x="0" y="${y + 14}">${escape(bar.label)}</text><rect class="lab-chart-bar" x="0" y="${y + 20}" width="${width}" height="14" rx="2"></rect><text class="lab-chart-value" x="${width + 6}" y="${y + 32}">${shown(bar.value)}</text>`;
  }).join('');
  const summary = panel.bars.map(bar => `${bar.label}: ${shown(bar.value)}`).join('; ');
  return `<svg class="lab-chart" viewBox="0 0 ${W} ${panel.bars.length * ROW}" role="img" aria-labelledby="counts-${escape(panel.id)}-title counts-${escape(panel.id)}-desc"><desc id="counts-${escape(panel.id)}-desc">${escape(summary)} (${escape(panel.unit)})</desc>${rows}</svg>`;
}

/** The panels, each a chart with its numbers as a table, every number linked to the record it comes from. */
export function renderCounts(record, up = '../../') {
  if (!record) return '';
  const panels = record.panels.map(panel => `<figure class="lab-panel" id="counts-${escape(panel.id)}"><h3 id="counts-${escape(panel.id)}-title">${escape(panel.title)}</h3><p>${escape(panel.line)}</p>${chart(panel)}<details class="lab-panel-table"><summary>The numbers, with their sources</summary><table><thead><tr><th scope="col">What</th><th scope="col">${escape(panel.unit[0].toUpperCase() + panel.unit.slice(1))}</th><th scope="col">Source</th></tr></thead><tbody>${panel.bars.map(bar => {
    const file = bar.source.slice(0, bar.source.indexOf('#'));
    return `<tr><th scope="row">${escape(bar.label)}</th><td><a href="${up}${escape(file)}" data-source="${escape(bar.source)}" data-format="${Number.isInteger(bar.value) ? 'int' : 'num'}">${shown(bar.value)}</a></td><td><code>${escape(bar.source)}</code> <span>(${escape(howDerived(bar))})</span></td></tr>`;
  }).join('')}</tbody></table></details></figure>`).join('');
  return `<h3 class="lab-subhead" id="counts">${escape(record.title)}</h3><p class="lab-telemetry-note">${escape(record.note)}</p><div class="lab-panels">${panels}</div>`;
}
