// A short, dated window into the lab run records on the home and Updates pages.
// This is built into dist/ only. The editorial updates feed and its frozen dates stay as written.
import { escape, pageLeaks, recordHashes } from './lab-kit.mjs';
import { readLabRuns, runAnchor, runRows } from './lab-runs.mjs';

export const LATEST_RUNS_LIMIT = 3;
const BOUNDARY = 'These are checks of committed records. A matching hash does not establish a new experiment or independent validation.';
const HOME_CUE = 'Record checks, not new experiments.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One newest run per lab, so repeated checks of one record cannot fill the window. */
export function latestRuns(labs, limit = LATEST_RUNS_LIMIT) {
  const seen = new Set();
  return runRows(labs).filter(({ tile }) => {
    if (seen.has(tile.experiment)) return false;
    seen.add(tile.experiment);
    return true;
  }).slice(0, limit);
}

const runDay = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
function runTime(iso) {
  return `<time datetime="${escape(iso)}">${runDay(iso)}, ${iso.slice(11, 16)} UTC</time>`;
}

/** A standalone section of run links. The title points to the exact row, and the source to its pinned record. */
export function renderLatestRuns(labs, { prefix = '', level = 3, collapsed = false } = {}) {
  const rows = latestRuns(labs);
  if (!rows.length) return '';
  if (![2, 3].includes(level)) throw new Error('Latest lab runs: heading level must be 2 or 3');
  const heading = `h${level}`, itemHeading = `h${level + 1}`;
  const items = rows.map(({ tile, href, run }) => `<li class="latest-run">
    <p class="latest-run-meta technical">${runTime(run.ranAt)} · ${escape(run.machineClass)}</p>
    <${itemHeading}><a href="${escape(prefix)}labs/runs/#${escape(runAnchor(run))}">${escape(tile.label)}: ${escape(tile.title)}</a></${itemHeading}>
    <p>The check printed <strong>${escape(run.result.verdict)}</strong> with ${escape(run.result.breaches)} breaches. Record <code>${escape(run.recordHash.slice(0, 12))}</code>.</p>
    <p><a href="${escape(prefix)}${escape(href)}">Read the committed record</a></p>
  </li>`).join('');
  const list = `<ol class="latest-runs-list">${items}</ol><p class="latest-runs-all"><a href="${escape(prefix)}labs/runs/">See all lab runs</a></p>`;
  const lead = collapsed
    ? `<p class="latest-runs-cue">${HOME_CUE}</p><details class="latest-runs-disclosure"><summary><strong><time datetime="${escape(rows[0].run.ranAt)}">${runDay(rows[0].run.ranAt)}</time>: ${escape(rows[0].tile.label)}, ${escape(rows[0].run.result.verdict)}</strong></summary><p>${BOUNDARY}</p>${list}</details>`
    : `<p>One latest run per lab. ${BOUNDARY}</p>${list}`;
  const section = `<section class="latest-runs" aria-labelledby="latest-runs-title"><${heading} id="latest-runs-title">Latest lab runs</${heading}>${lead}</section>`;
  const problems = pageLeaks(section, labs.flatMap(lab => lab.runs.flatMap(recordHashes)));
  if (problems.length) throw new Error(`Latest lab runs refused:\n  ${problems.join('\n  ')}`);
  return section;
}

/** Insert after the home update list, within the one already-open section. */
export function placeHomeLatestRuns(html, labs) {
  const section = renderLatestRuns(labs, { collapsed: true });
  if (!section) return html;
  const start = html.indexOf('<section class="updates-feed content-section" id="updates"');
  if (start < 0 || html.indexOf('<section class="updates-feed content-section" id="updates"', start + 1) >= 0) throw new Error('Latest lab runs: expected one home updates section');
  const list = html.indexOf('<ol class="update-list" aria-labelledby="updates-title">', start);
  const listEnd = html.indexOf('</ol>', list);
  const close = html.indexOf('</section>', listEnd);
  if (list < 0 || listEnd < 0 || close < 0 || html.slice(start, close).includes('id="latest-runs-title"')) throw new Error('Latest lab runs: home insertion point missing or already filled');
  return `${html.slice(0, close)}${section}\n    ${html.slice(close)}`;
}

/** Place the run window before the dated editorial archive on Updates. */
export function placeUpdatesLatestRuns(html, labs) {
  const section = renderLatestRuns(labs, { prefix: '../', level: 2 });
  if (!section) return html;
  const marker = '<!-- updates-list: rendered by scripts/updates.mjs --write from site/data/updates.json; do not edit by hand -->';
  const at = html.indexOf(marker);
  if (at < 0 || html.indexOf(marker, at + 1) >= 0 || html.includes('id="latest-runs-title"')) throw new Error('Latest lab runs: Updates insertion point missing or already filled');
  return `${html.slice(0, at)}${section}\n      ${html.slice(at)}`;
}

/** Read only validated, pinned records and update the two built pages. */
export function latestRunPages(home, updates, root = 'site') {
  const labs = readLabRuns(root);
  return { home: placeHomeLatestRuns(home, labs), updates: placeUpdatesLatestRuns(updates, labs) };
}
