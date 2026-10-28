// The runs of every lab, read from the records only (vision-plan vp-living-labs-off-the-laptop, bundle 2). A results
// lab's tile (scripts/lab-tiles.mjs) links its pinned record; when that record carries `runs`, each run is a record v1
// (scripts/lab-record.mjs, docs/lab-record.md), and this module turns them into what the Labs index shows on the
// lab's card: "runner · commit · record hash" for the latest run, and one badge; and the runs page, labs/runs/index.html
// (from site/labs/runs/index.html, <!--LAB_RUNS-->), every run of every lab, newest first, each row linking its record;
// and the Atom feeds (scripts/lab-feeds.mjs: feed.xml and labs/<lab>/feed.xml), linked from the Labs index, the runs
// page and the page of every lab with runs, which also gets its badge and links in an "Its runs" section.
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
//   - the rendered card text or the runs page fails the kit's leak screen (pageLeaks, with only the runs' own hashes
//     masked); the runs page's template is missing on the published site.
// scripts/labs.mjs (renderLabs) calls withLabRuns() on its pages; scripts/build.mjs writes them into dist/ only.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escape, pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordProblems } from './lab-record.mjs';
import { readTiles } from './lab-tiles.mjs';
import { checkedFeeds, feedProblems, readUpdates, renderFeeds, SITE_FEED, SITE_URL, UPDATES_FILE } from './lab-feeds.mjs';

export const RUNS_PAGE = 'labs/runs/index.html';
const REPO_SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');

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
  // The lab and backing checks run on every run with the fields they read, so a refusal lists every reason at once.
  const readable = run => typeof run?.lab === 'string' && typeof run?.commit?.sha === 'string' && Array.isArray(run.replicatedOn) && Array.isArray(run.differedOn);
  runs.forEach((run, i) => {
    if (!readable(run)) return;
    if (run.lab !== lab) problems.push(`${where}#/runs/${i}/lab: "${run.lab}" is not this tile's lab (${lab})`);
    for (const list of ['replicatedOn', 'differedOn']) run[list].forEach((x, j) => {
      if (!runs.some(s => s !== run && readable(s) && s.commit.sha === run.commit.sha && s.machineClass === x.machineClass && s.recordHash === x.recordHash)) problems.push(`${where}#/runs/${i}/${list}/${j}: no run of commit ${run.commit.sha.slice(0, 8)} on ${x.machineClass} with that hash is in the record`);
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
  if (state === 'single') return `Run on one org machine class, ${list(classes.filter(c => group.some(r => ORG(r) && r.machineClass === c)))}${group.some(r => !ORG(r)) ? ', and re-run on a laptop with the same hash' : ''}. The record holds no run of this commit on a second org machine class.`;
  return 'Run on a laptop. The record holds no run of this commit on another machine.';
}

/** The card's provenance: "runner · commit · record hash" for the latest run, and the badge. */
export function renderProvenance(runs, { runsPage = false } = {}) {
  const s = runState(runs), r = s.latest;
  return `<div class="lab-provenance lab-provenance-${s.state}"><p class="lab-provenance-line technical">LATEST RUN · <span>${escape(r.runner)}</span> · <span>commit <code>${escape(r.commit.sha.slice(0, 8))}</code></span> · <span>record <code>${escape(r.recordHash.slice(0, 12))}</code></span></p><p class="lab-badge" data-state="${s.state}"><strong>${escape(BADGES[s.state])}.</strong> ${badgeText(s)}</p>${runsPage ? `<p class="lab-provenance-more"><a href="runs/#${escape(runAnchor(r))}">This run, among every run</a></p>` : ''}</div>`;
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
    labs.push({ tile, href: tile.record.href, runs: record.runs, page: labPage(tile) });
  }
  if (problems.length) throw new Error(`Lab runs refused:\n  ${problems.join('\n  ')}`);
  return labs;
}

/** A run's anchor on the runs page: lab, machine class, when and its hash, so it never changes once published. */
export const runAnchor = run => `run-${run.lab}-${run.machineClass}-${run.ranAt.replace(/[^0-9]/g, '')}-${run.recordHash.slice(0, 12)}`;

/** Every run of every lab, newest first (ties: lab, machine class, record hash), with its lab and record. */
export function runRows(labs) {
  return labs.flatMap(({ tile, href, runs }) => runs.map(run => ({ tile, href, run })))
    .sort((a, b) => b.run.ranAt.localeCompare(a.run.ranAt) || a.run.lab.localeCompare(b.run.lab) || byTime(a.run, b.run));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = iso => `<time datetime="${escape(iso)}">${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}, ${iso.slice(11, 16)} UTC</time>`;
const labPage = tile => tile.links.find(l => /^labs\/[a-z0-9-]+\/index\.html$/.test(l.href))?.href;

/** The runs page's table: one row per run, each linking its lab and its record; or the empty state. */
export function renderRuns(labs) {
  const rows = runRows(labs);
  if (!rows.length) return '<div class="lab-empty" id="no-runs"><p class="technical">NO RUN YET</p><p>No lab record holds a run yet. A run appears here when its record is published.</p></div>';
  const body = rows.map(({ tile, href, run }) => {
    const page = labPage(tile);
    const lab = `${escape(tile.label)}: ${escape(tile.title)}`;
    return `<tr id="${escape(runAnchor(run))}"><td>${when(run.ranAt)}</td><td>${page ? `<a href="../../${escape(page)}">${lab}</a>` : lab}</td><td>${escape(run.runner)}</td><td><code>${escape(run.machineClass)}</code></td><td><code>${escape(run.commit.sha.slice(0, 8))}</code></td><td><code>${escape(run.recordHash.slice(0, 12))}</code></td><td>${escape(run.result.verdict)}, ${escape(String(run.result.breaches))} breaches</td><td><a href="../../${escape(href)}">The record</a></td></tr>`;
  }).join('');
  return `<div class="lab-table-wrap"><table class="lab-runs-table"><caption>${rows.length === 1 ? 'One run' : `${rows.length} runs`}, newest first. Hashes are shortened; each record holds them in full.</caption><thead><tr><th scope="col">Ran</th><th scope="col">Lab</th><th scope="col">Runner</th><th scope="col">Machine class</th><th scope="col">Commit</th><th scope="col">Record hash</th><th scope="col">The check printed</th><th scope="col">Record</th></tr></thead><tbody>${body}</tbody></table></div><p class="lab-source">A record names a runner and a machine class by a word from a closed list, never a runner or host name. The record hash covers what ran, on which commit, and what it printed, not where or when.</p>`;
}

const ANCHOR = '<ul class="lab-tile-links">';
const STYLE = '<link rel="stylesheet" href="../assets/lab-runs.css">';

/** renderLabs()'s pages with each run-carrying lab's card given its provenance. Throws on any problem. */
export function withLabRuns(pages, root = 'site', { now = new Date() } = {}) {
  const labs = readLabRuns(root, { now });
  // The runs page: required on the published site; a fixture renders it only when it carries the template.
  if (resolve(root) === REPO_SITE && !existsSync(join(root, RUNS_PAGE))) throw new Error(`${RUNS_PAGE}: the runs page is required on the published site`);
  const runsPage = existsSync(join(root, RUNS_PAGE));
  let index = pages['labs/index.html'];
  if (typeof index !== 'string') throw new Error('withLabRuns: labs/index.html is not among the pages');
  for (const { tile, runs } of labs) {
    const start = index.indexOf(`aria-labelledby="lab-tile-${tile.experiment}">`);
    const end = index.indexOf('</article>', start);
    const at = start < 0 ? -1 : index.indexOf(ANCHOR, start);
    if (start < 0 || at < 0 || at > end || index.indexOf(`aria-labelledby="lab-tile-${tile.experiment}">`, start + 1) >= 0) throw new Error(`labs/index.html: the card of ${tile.experiment} is not there exactly once`);
    const html = renderProvenance(runs, { runsPage });
    const leaks = pageLeaks(`<div>${html}</div>`, runs.flatMap(recordHashes));
    if (leaks.length) throw new Error(`labs/index.html: the provenance of ${tile.experiment} fails the screen:\n  ${leaks.join('\n  ')}`);
    index = index.slice(0, at) + html + index.slice(at);
  }
  if (labs.length || runsPage) {
    if (!index.includes('</head>')) throw new Error('labs/index.html: no </head>');
    index = index.replace('</head>', `  ${STYLE}\n</head>`);
  }
  if (!runsPage) return { ...pages, 'labs/index.html': index };
  const section = index.indexOf('id="labs"'), close = index.indexOf('</section>', section);
  if (section < 0 || close < 0) throw new Error('labs/index.html: no section id="labs" to link the runs page from');
  index = `${index.slice(0, close)}<p class="lab-runs-link"><a href="runs/">Every run of every lab, newest first</a></p>${index.slice(close)}`;
  let runsHtml = readFileSync(join(root, RUNS_PAGE), 'utf8');
  if (!runsHtml.includes('<!--LAB_RUNS-->')) throw new Error(`${RUNS_PAGE}: <!--LAB_RUNS--> is missing`);
  runsHtml = runsHtml.replace('<!--LAB_RUNS-->', () => renderRuns(labs));
  if (/<!--[A-Z_]+-->/.test(runsHtml)) throw new Error(`${RUNS_PAGE}: unresolved content marker`);
  const known = labs.flatMap(l => l.runs.flatMap(recordHashes));
  const leaks = pageLeaks(runsHtml, known);
  if (leaks.length) throw new Error(`${RUNS_PAGE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return withFeeds({ ...pages, 'labs/index.html': index, [RUNS_PAGE]: runsHtml }, labs, root, known);
}

const head = (html, path, links) => {
  if (!html.includes('</head>')) throw new Error(`${path}: no </head>`);
  return html.replace('</head>', `${links.map(l => `  ${l}\n`).join('')}</head>`);
};
const alternate = (title, href) => `<link rel="alternate" type="application/atom+xml" title="${escape(title)}" href="${escape(href)}">`;
const SITE_FEED_TITLE = 'Odin Labs R&D: every update and every lab run';

/** A lab page's "Its runs" section: the badge, and links to its runs, its feed and the site feed. */
export function renderLabRunsSection(lab) {
  const s = lab.runs[0].lab;
  return `<section class="company-section company-width lab-runs-section" id="lab-runs" aria-labelledby="lab-runs-title"><div class="company-section-heading"><h2 id="lab-runs-title">Its runs.</h2><p>The runs of this lab's check that its record holds, each with its own record hash.</p></div>${renderProvenance(lab.runs)}<ul class="lab-follow"><li><a href="../runs/#runs-${escape(s)}">Every run of this lab</a></li><li><a href="feed.xml">This lab's feed (Atom)</a></li><li><a href="../../${SITE_FEED}">The site feed (Atom)</a></li></ul></section>`;
}

/** The feeds, written and checked, and linked from the Labs index, the runs page and every lab page. */
function withFeeds(pages, labs, root, known) {
  // The updates: required on the published site; a fixture without them feeds its runs only.
  const updates = resolve(root) === REPO_SITE || existsSync(join(root, UPDATES_FILE)) ? readUpdates(root) : [];
  const feeds = checkedFeeds(renderFeeds(labs, updates, { anchor: runAnchor }), known);
  // Lab 01's own feed of dispatches (scripts/labs.mjs) is checked by the same reader.
  const lab01 = pages['labs/agent-space/feed.xml'];
  if (lab01) {
    const problems = feedProblems(lab01, { self: `${SITE_URL}labs/agent-space/feed.xml`, where: 'labs/agent-space/feed.xml' });
    if (problems.length) throw new Error(`Atom feeds refused:\n  ${problems.join('\n  ')}`);
  }
  if (!feeds[SITE_FEED]) return pages;
  const out = { ...pages, ...feeds };
  const site = up => alternate(SITE_FEED_TITLE, `${up}${SITE_FEED}`);
  let index = head(out['labs/index.html'], 'labs/index.html', [site('../')]);
  index = index.replace('<p class="lab-runs-link"><a href="runs/">Every run of every lab, newest first</a></p>', m => `${m}<p class="lab-runs-link"><a href="../${SITE_FEED}">Follow every update and every run (Atom)</a></p>`);
  out['labs/index.html'] = index;
  out[RUNS_PAGE] = head(out[RUNS_PAGE], RUNS_PAGE, [site('../../')]).replace('<p class="lab-source">A record names', m => `<p class="lab-runs-link"><a href="../../${SITE_FEED}">Follow every update and every run (Atom)</a></p>${m}`);
  for (const lab of labs.filter(l => l.page)) {
    const html = out[lab.page];
    if (typeof html !== 'string') throw new Error(`${lab.page}: the page of ${lab.tile.experiment} is not among the pages`);
    const section = renderLabRunsSection(lab);
    const leaks = pageLeaks(section, lab.runs.flatMap(recordHashes));
    if (leaks.length) throw new Error(`${lab.page}: its runs section fails the screen:\n  ${leaks.join('\n  ')}`);
    if (html.split('</main>').length !== 2) throw new Error(`${lab.page}: not exactly one </main>`);
    out[lab.page] = head(html, lab.page, [alternate(`${lab.tile.label}: ${lab.tile.title}`, 'feed.xml'), STYLE.replace('../', '../../')]).replace('</main>', () => `${section}</main>`);
  }
  // A lab page without runs is left exactly as its own renderer wrote it (each lab's tests compare the two).
  for (const lab of labs.filter(l => l.page)) out[lab.page] = head(out[lab.page], lab.page, [site('../../')]);
  return out;
}
