// The runs of every lab, read from the records only (vision-plan vp-living-labs-off-the-laptop, bundle 2). A results
// lab's tile (scripts/lab-tiles.mjs) links its pinned record; when that record carries `runs`, each run is a record v1
// (scripts/lab-record.mjs, docs/lab-record.md), and this module turns them into what the Labs index shows on the
// lab's card: "runner · commit · record hash" for the latest run, and one badge.
//
//   reproduced  two or more org machine classes ran the latest commit and printed the same recordHash
//   single      one org machine class ran it
//   different   two runs of the latest commit hold different recordHashes: shown as such, never folded into a match
//   laptop      only a laptop ran it: "single machine, a laptop re-run", never called an org machine
//
// The badge is derived from the runs present, never from a claim alone. The build fails, every reason listed, when:
//   - a run is not an honest record v1 (recordProblems, its ranAt checked against the build's clock), or names a lab
//     other than its tile's;
//   - a run's replicatedOn or differedOn names a machine class that has no run of the same commit with that hash
//     in the record (a replication is shown only with the run that replicated it);
//   - the rendered card text fails the kit's leak screen (pageLeaks, with only the runs' own hashes masked).
// scripts/labs.mjs (renderLabs) calls withLabRuns() on its pages; scripts/build.mjs writes them into dist/ only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escape, pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordProblems } from './lab-record.mjs';
import { readTiles } from './lab-tiles.mjs';

export const BADGES = {
  reproduced: 'Reproduced on a second org machine, same hash',
  single: 'Single machine',
  different: 'Different hash',
  laptop: 'Single machine, a laptop re-run',
};
const ORG = run => run.runner !== 'laptop';
const byTime = (a, b) => a.ranAt.localeCompare(b.ranAt) || a.machineClass.localeCompare(b.machineClass) || a.recordHash.localeCompare(b.recordHash);

/** Every reason a lab's runs may not be shown (empty when they may). */
export function runsProblems(runs, { lab, where, now = new Date() }) {
  if (!Array.isArray(runs) || !runs.length) return [`${where}#/runs: a record that carries runs carries at least one`];
  const problems = runs.flatMap((run, i) => recordProblems(run, `${where} runs[${i}]`, now));
  if (problems.length) return problems;
  runs.forEach((run, i) => {
    if (run.lab !== lab) problems.push(`${where}#/runs/${i}/lab: "${run.lab}" is not this tile's lab (${lab})`);
    for (const list of ['replicatedOn', 'differedOn']) run[list].forEach((x, j) => {
      if (!runs.some(s => s !== run && s.commit.sha === run.commit.sha && s.machineClass === x.machineClass && s.recordHash === x.recordHash)) problems.push(`${where}#/runs/${i}/${list}/${j}: no run of commit ${run.commit.sha.slice(0, 8)} on ${x.machineClass} with that hash is in the record`);
    });
  });
  return problems;
}

/** The badge state of a lab's runs: { state, latest, group } for the latest run's commit. */
export function runState(runs) {
  const latest = [...runs].sort(byTime).at(-1);
  const group = runs.filter(r => r.commit.sha === latest.commit.sha);
  if (new Set(group.map(r => r.recordHash)).size > 1) return { state: 'different', latest, group };
  const org = new Set(group.filter(ORG).map(r => r.machineClass));
  return { state: org.size >= 2 ? 'reproduced' : org.size === 1 ? 'single' : 'laptop', latest, group };
}

/** What the badge's state means, in words that say only what the records hold. */
function badgeText({ state, group }) {
  const classes = [...new Set(group.map(r => r.machineClass))];
  const list = items => items.map(c => `<code>${escape(c)}</code>`).join(', ');
  if (state === 'different') return `The runs of this commit do not agree: ${group.map(r => `<code>${escape(r.machineClass)}</code> printed record <code>${escape(r.recordHash.slice(0, 12))}</code>`).join(', ')}.`;
  if (state === 'reproduced') return `The same record hash on ${list(classes.filter(c => group.some(r => ORG(r) && r.machineClass === c)))}${group.some(r => !ORG(r)) ? ', and on a laptop' : ''}.`;
  if (state === 'single') return `Run on one org machine class, ${list(classes.filter(c => group.some(r => ORG(r) && r.machineClass === c)))}${group.some(r => !ORG(r)) ? ', and re-run on a laptop with the same hash' : ''}. The record holds no run of this commit on a second machine.`;
  return 'Run on a laptop. The record holds no run of this commit on another machine.';
}

/** The card's provenance: "runner · commit · record hash" for the latest run, and the badge. */
export function renderProvenance(runs) {
  const s = runState(runs), r = s.latest;
  return `<div class="lab-provenance lab-provenance-${s.state}"><p class="lab-provenance-line technical">LATEST RUN · <span>${escape(r.runner)}</span> · <span>commit <code>${escape(r.commit.sha.slice(0, 8))}</code></span> · <span>record <code>${escape(r.recordHash.slice(0, 12))}</code></span></p><p class="lab-badge" data-state="${s.state}"><strong>${escape(BADGES[s.state])}.</strong> ${badgeText(s)}</p></div>`;
}

/** Every results lab's runs, read from its pinned record (readTiles checks the pin): [{ tile, record, runs }]. */
export function readLabRuns(root = 'site', { now = new Date(), tiles = readTiles(root) } = {}) {
  const labs = [], problems = [];
  for (const tile of tiles) {
    if (tile.kind !== 'results' || !tile.record) continue;
    const record = JSON.parse(readFileSync(join(root, tile.record.href), 'utf8'));
    if (!('runs' in record)) continue;
    const found = runsProblems(record.runs, { lab: tile.experiment, where: tile.record.href, now });
    if (found.length) { problems.push(...found); continue; }
    labs.push({ tile, href: tile.record.href, runs: record.runs });
  }
  if (problems.length) throw new Error(`Lab runs refused:\n  ${problems.join('\n  ')}`);
  return labs;
}

const ANCHOR = '<ul class="lab-tile-links">';
const STYLE = '<link rel="stylesheet" href="../assets/lab-runs.css">';

/** renderLabs()'s pages with each run-carrying lab's card given its provenance. Throws on any problem. */
export function withLabRuns(pages, root = 'site', { now = new Date() } = {}) {
  const labs = readLabRuns(root, { now });
  let index = pages['labs/index.html'];
  if (typeof index !== 'string') throw new Error('withLabRuns: labs/index.html is not among the pages');
  for (const { tile, runs } of labs) {
    const start = index.indexOf(`aria-labelledby="lab-tile-${tile.experiment}">`);
    const end = index.indexOf('</article>', start);
    const at = start < 0 ? -1 : index.indexOf(ANCHOR, start);
    if (start < 0 || at < 0 || at > end || index.indexOf(`aria-labelledby="lab-tile-${tile.experiment}">`, start + 1) >= 0) throw new Error(`labs/index.html: the card of ${tile.experiment} is not there exactly once`);
    const html = renderProvenance(runs);
    const leaks = pageLeaks(`<div>${html}</div>`, runs.flatMap(recordHashes));
    if (leaks.length) throw new Error(`labs/index.html: the provenance of ${tile.experiment} fails the screen:\n  ${leaks.join('\n  ')}`);
    index = index.slice(0, at) + html + index.slice(at);
  }
  if (labs.length) {
    if (!index.includes('</head>')) throw new Error('labs/index.html: no </head>');
    index = index.replace('</head>', `  ${STYLE}\n</head>`);
  }
  return { ...pages, 'labs/index.html': index };
}
