// "How this site got built" on Lab 01 (cycle del-no-theatre-vr-sdlc, WO-NOTHEATRE-01/02). The odin-labs exporter
// (delivery-record-export) reads GitHub and the review log and writes site/data/labs/delivery/odin-rnd.json
// (odin-delivery v1, scripts/schemas/odin-delivery-v1.schema.json): every merged pull request in its window, each
// recorded review round (verdict + the head it judged), each CI run attempt, each landing and each Pages deploy. This
// module checks that record and renders it; scripts/labs.mjs fills <!--LAB_DELIVERY--> with renderDelivery().
// No-theatre gates (the build fails, nothing is rendered):
//   - a record that misses the schema, or whose id, source or shape does not follow from its own fields;
//   - free text (a pull request's title, a workflow's name, this page's own words) that fails the publisher's screen;
//     structured fields (shas, run ids, row ids, times, GitHub URLs) are held to their exact shape instead and still
//     screened for restricted names and places, the way the publisher treats a proof's internal fields;
//   - counts that do not reconcile with the record's own PR list (one pr and one landing record per PR, nothing else);
//   - telemetry that differs from the figures recomputed from the records;
//   - a rendered element (event, table row, bar, link) that does not name an existing record, or a link that is not
//     that record's own public URL.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLabLink, screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DELIVERY_FILE = 'data/labs/delivery/odin-rnd.json';
export const DELIVERY_SCHEMA_FILE = join(here, 'schemas/odin-delivery-v1.schema.json');
export const REPO = 'odin-labs-ai/odin-rnd';
const REPO_URL = `https://github.com/${REPO}`;
const schema = JSON.parse(readFileSync(DELIVERY_SCHEMA_FILE, 'utf8'));

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const nameOrPlace = text => screenHits(text).filter(hit => /^a (restricted|place) name/.test(hit.reason)).map(hit => hit.reason);

/** The id a record must carry, from its own fields. */
export function recordId(r) {
  if (r.kind === 'pr') return `pr-${r.pr}`;
  if (r.kind === 'review') return `pr-${r.pr}/review/${String(r.source).replace(/^verdict-row:/, '')}`;
  if (r.kind === 'ci') return `pr-${r.pr}/ci/${String(r.source).match(/runs\/(\d+)\//)?.[1]}/${r.attempt}`;
  if (r.kind === 'landing') return `pr-${r.pr}/landing`;
  if (r.kind === 'deploy') return `pr-${r.pr}/deploy/${String(r.source).match(/runs\/(\d+)$/)?.[1]}`;
  return null;
}

/** The public URL a record's element links to: its source when that is a URL, else the commit it judged. */
export function recordLink(r) {
  return r.kind === 'review' ? `${REPO_URL}/commit/${r.ref}` : r.source;
}

const minutes = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 60000);
const median = values => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** The telemetry, recomputed from the records alone. */
export function telemetryOf(record) {
  const perPr = [...record.prs].sort((a, b) => a - b).map(pr => {
    const of = kind => record.records.filter(r => r.pr === pr && r.kind === kind);
    const reviews = of('review'), ci = of('ci');
    const opened = of('pr')[0], landed = of('landing')[0];
    return {
      pr,
      reviewRounds: reviews.length,
      fixNeededRounds: reviews.filter(r => r.state === 'FIX-NEEDED').length,
      ciRuns: new Set(ci.map(r => r.source.match(/runs\/(\d+)\//)[1])).size,
      ciReruns: ci.filter(r => r.attempt > 1).length,
      minutesToLand: opened && landed ? minutes(opened.at, landed.at) : 0,
    };
  });
  const sum = key => perPr.reduce((n, row) => n + row[key], 0);
  return {
    perPr,
    totals: {
      prs: perPr.length, reviewRounds: sum('reviewRounds'), fixNeededRounds: sum('fixNeededRounds'),
      ciRuns: sum('ciRuns'), ciReruns: sum('ciReruns'), deploys: record.records.filter(r => r.kind === 'deploy').length,
      medianMinutesToLand: median(perPr.map(row => row.minutesToLand)),
    },
  };
}

/** Every reason this record may not be published; an empty list when it may. */
export function deliveryProblems(record, where = DELIVERY_FILE) {
  const problems = validate(schema, record).map(p => `${where}#${p}`);
  if (problems.length) return problems;
  const ids = new Set();
  for (const [i, r] of record.records.entries()) {
    const at = `${where}#/records/${i}`;
    if (r.id !== recordId(r)) problems.push(`${at}: id ${JSON.stringify(r.id)} does not follow from its fields (expected ${JSON.stringify(recordId(r))})`);
    if (ids.has(r.id)) problems.push(`${at}: duplicate id ${r.id}`);
    ids.add(r.id);
    if (r.repo !== REPO) problems.push(`${at}: not this lab's repository`);
    // The source must resolve: a public URL into this repository that matches the record, or a review row id.
    if (r.kind === 'review') { if (!/^verdict-row:/.test(r.source)) problems.push(`${at}: a review's source is its row id`); }
    else if (!isLabLink(r.source)) problems.push(`${at}: source is not a public URL into ${REPO}`);
    if (r.kind === 'pr' && r.source !== `${REPO_URL}/pull/${r.pr}`) problems.push(`${at}: source is not pull request #${r.pr}`);
    if (r.kind === 'landing' && r.source !== `${REPO_URL}/commit/${r.ref}`) problems.push(`${at}: source is not the merge commit`);
    if (!isLabLink(recordLink(r))) problems.push(`${at}: its link is not a public URL into ${REPO}`);
    if (Number.isNaN(Date.parse(r.at))) problems.push(`${at}: at is not a time`);
    // Structured fields: exact shape above, and no restricted name or place. Free text: the publisher's full screen.
    for (const key of ['id', 'at', 'ref', 'state', 'source']) problems.push(...nameOrPlace(r[key]).map(reason => `${at}/${key}: ${reason}`));
    const text = {};
    if (r.kind === 'pr') text.title = r.title;
    if (r.kind === 'ci') text.workflow = r.workflow;
    problems.push(...screenTree(text, where, {}, `/records/${i}`));
  }
  // Counts reconcile with the record's own PR list.
  const prs = new Set(record.prs);
  for (const pr of prs) {
    for (const kind of ['pr', 'landing']) {
      const n = record.records.filter(r => r.pr === pr && r.kind === kind).length;
      if (n !== 1) problems.push(`${where}: #${pr} has ${n} ${kind} records, not 1`);
    }
  }
  for (const r of record.records) if (!prs.has(r.pr)) problems.push(`${where}: record ${r.id} is for #${r.pr}, which is not in the PR list`);
  const sorted = [...prs].sort((a, b) => a - b);
  if (record.window.fromPr !== sorted[0] || record.window.toPr !== sorted.at(-1)) problems.push(`${where}: the window is not the PR list's first and last`);
  if (record.generatedFrom.latestPr !== record.window.toPr || JSON.stringify(record.generatedFrom.window) !== JSON.stringify(record.window)) problems.push(`${where}: generatedFrom does not match the window`);
  if (record.generatedFrom.verdictRowsRead < record.records.filter(r => r.kind === 'review').length) problems.push(`${where}: more review records than review rows read`);
  // Telemetry equals what the records say.
  const expected = telemetryOf(record);
  if (JSON.stringify(record.telemetry) !== JSON.stringify(expected)) problems.push(`${where}#/telemetry: differs from the figures recomputed from the records (expected ${JSON.stringify(expected.totals)})`);
  for (const [i, a] of record.aggregates.entries()) if (a.ciPassPercent > 100) problems.push(`${where}#/aggregates/${i}/ciPassPercent: above 100`);
  // An aggregate's label is made to pass the full screen (odin-labs delivery-private-projection), so it gets it.
  problems.push(...screenTree(record.aggregates, where, {}, '/aggregates'));
  return problems;
}

/** The committed record, checked; the build fails on any problem. */
export function readDelivery(root = 'site') {
  const record = JSON.parse(readFileSync(join(root, DELIVERY_FILE), 'utf8'));
  const problems = deliveryProblems(record);
  if (problems.length) throw new Error(`Delivery record refused:\n  ${problems.join('\n  ')}`);
  return record;
}

// The page's own words. Every one passes the publisher's screen (checked in renderDelivery).
export const COPY = {
  title: 'How this site got built.',
  lead: 'This site is built in the open, one pull request at a time. A change is read by an AI reviewer whose job is to find what is wrong with it, checked by the same build and tests anyone can run from the repository, and only then merged and published. Below is that record, made by a script from GitHub and our review log; nothing in it is typed by hand. Where a step did not happen, the record says so.',
  howToRead: 'A review round is one full pass of the reviewer over the change. "Sent back" means it found something to fix; "Approved" means it found nothing that blocks. A review that stopped before it reached a verdict leaves no row and is not counted. Every round names the exact version of the change it judged, and its row id in our review log. Time to land runs from opening the pull request to merging it.',
  privateNote: 'The review log itself stays private, because it also covers work that is not public. Only the verdict, the version judged, the time and the row id leave it.',
};

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n, one, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;
const duration = mins => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return [h ? count(h, 'hour') : '', m || !h ? count(m, 'minute') : ''].filter(Boolean).join(' and ');
};
const when = iso => `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${iso.slice(11, 16)} UTC`;
const short = sha => sha.slice(0, 7);
const VERDICT = { SHIP: 'Approved', 'FIX-NEEDED': 'Sent back' };
const CONCLUSION = { success: 'passed', failure: 'failed', cancelled: 'was cancelled', skipped: 'was skipped', timed_out: 'timed out' };
const link = (r, body, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${escape(recordLink(r))}" data-source="${escape(r.id)}">${body}</a>`;

/** One plain sentence about a PR, from its records only. */
export function prSentence(pr, rows, telemetry) {
  const t = telemetry.perPr.find(row => row.pr === pr);
  const reviews = rows.filter(r => r.kind === 'review');
  const last = reviews.at(-1);
  let review;
  if (!reviews.length) review = `#${pr} has no recorded review round.`;
  else if (reviews.length === 1) review = last.state === 'SHIP' ? `#${pr} was approved on its first review round.` : `#${pr} had one review round, and it sent the change back.`;
  else review = last.state === 'SHIP' ? `#${pr} needed ${count(reviews.length, 'review round')} before it shipped — here is each one.` : `#${pr} had ${count(reviews.length, 'review round')}; the last one sent it back.`;
  const ci = t.ciRuns ? ` CI ran ${count(t.ciRuns, 'time')}${t.ciReruns ? `, with ${count(t.ciReruns, 'rerun')}` : ''}.` : ' No CI run is recorded for it.';
  return `${review}${ci} It landed ${duration(t.minutesToLand)} after it was opened.`;
}

function prTimeline(pr, record, telemetry) {
  const rows = record.records.filter(r => r.pr === pr).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const opened = rows.find(r => r.kind === 'pr');
  let round = 0;
  const events = rows.filter(r => r.kind !== 'pr').map(r => {
    if (r.kind === 'review') {
      round += 1;
      return `<li class="delivery-event delivery-review delivery-${r.state === 'SHIP' ? 'ship' : 'fix'}" data-source="${escape(r.id)}"><span class="delivery-when">${when(r.at)}</span><span>Review round ${round}: <strong>${VERDICT[r.state]}</strong> (${escape(r.state)}) on version ${link(r, `<code>${short(r.ref)}</code>`)}. <span class="delivery-row">Row ${escape(r.source.replace(/^verdict-row:/, '').slice(0, 8))}</span></span></li>`;
    }
    if (r.kind === 'ci') return `<li class="delivery-event delivery-ci" data-source="${escape(r.id)}"><span class="delivery-when">${when(r.at)}</span><span>${escape(r.workflow)} ${CONCLUSION[r.state] ?? escape(r.state)} on <code>${short(r.ref)}</code>${r.attempt > 1 ? ` (rerun, attempt ${r.attempt})` : ''}. ${link(r, 'See the run')}</span></li>`;
    if (r.kind === 'landing') return `<li class="delivery-event delivery-landing" data-source="${escape(r.id)}"><span class="delivery-when">${when(r.at)}</span><span><strong>Merged</strong> as ${link(r, `<code>${short(r.ref)}</code>`)}.</span></li>`;
    return `<li class="delivery-event delivery-deploy" data-source="${escape(r.id)}"><span class="delivery-when">${when(r.at)}</span><span>Published to this site: the deploy ${CONCLUSION[r.state] ?? escape(r.state)}. ${link(r, 'See the deploy')}</span></li>`;
  });
  return `<article class="delivery-pr" id="delivery-pr-${pr}" data-source="${escape(opened.id)}"><h4>${link(opened, `#${pr}`)} ${escape(opened.title)}</h4><p class="delivery-sentence">${escape(prSentence(pr, rows, telemetry))}</p><ol class="delivery-events">${events.join('')}</ol></article>`;
}

function roundsChart(record, telemetry) {
  const rows = telemetry.perPr, max = Math.max(1, ...rows.map(r => r.reviewRounds)), unit = 64, bar = 22, gap = 10, left = 56;
  const height = rows.length * (bar + gap) + gap;
  const bars = rows.map((row, i) => {
    const y = gap + i * (bar + gap), pr = record.records.find(r => r.kind === 'pr' && r.pr === row.pr);
    const fix = row.fixNeededRounds * unit, ship = (row.reviewRounds - row.fixNeededRounds) * unit;
    return `<a href="${escape(pr.source)}" data-source="${escape(pr.id)}" tabindex="-1"><text x="${left - 10}" y="${y + bar * 0.7}" text-anchor="end">#${row.pr}</text>`
      + (fix ? `<rect class="delivery-bar-fix" data-source="${escape(pr.id)}" x="${left}" y="${y}" width="${fix}" height="${bar}"/>` : '')
      + (ship ? `<rect class="delivery-bar-ship" data-source="${escape(pr.id)}" x="${left + fix}" y="${y}" width="${ship}" height="${bar}"/>` : '')
      + `<text x="${left + fix + ship + 8}" y="${y + bar * 0.7}">${row.reviewRounds}</text></a>`;
  }).join('');
  return `<svg class="delivery-chart" viewBox="0 0 ${left + max * unit + 40} ${height}" aria-hidden="true" focusable="false">${bars}</svg>`;
}

function telemetryTable(record, telemetry) {
  const body = telemetry.perPr.map(row => {
    const pr = record.records.find(r => r.kind === 'pr' && r.pr === row.pr);
    return `<tr data-source="${escape(pr.id)}"><th scope="row">${link(pr, `#${row.pr}`)}</th><td data-figure="reviewRounds">${row.reviewRounds}</td><td data-figure="fixNeededRounds">${row.fixNeededRounds}</td><td data-figure="ciRuns">${row.ciRuns}</td><td data-figure="ciReruns">${row.ciReruns}</td><td data-figure="minutesToLand">${row.minutesToLand}</td></tr>`;
  }).join('');
  const t = telemetry.totals;
  return `<table class="delivery-table"><caption>Per pull request: review rounds, how many sent the change back, CI runs and reruns, and minutes from opening to merging.</caption><thead><tr><th scope="col">Pull request</th><th scope="col">Review rounds</th><th scope="col">Sent back</th><th scope="col">CI runs</th><th scope="col">Reruns</th><th scope="col">Minutes to land</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th scope="row">All ${t.prs}</th><td data-total="reviewRounds">${t.reviewRounds}</td><td data-total="fixNeededRounds">${t.fixNeededRounds}</td><td data-total="ciRuns">${t.ciRuns}</td><td data-total="ciReruns">${t.ciReruns}</td><td data-total="medianMinutesToLand">median ${t.medianMinutesToLand}</td></tr></tfoot></table>`;
}

/** Every rendered element that names no existing record, or links anywhere but its record's own public URL. */
export function renderedProblems(html, record) {
  const byId = new Map(record.records.map(r => [r.id, r]));
  const problems = [];
  // Every row of a table body names its record; header and total rows (outside <tbody>) carry no record's figures.
  const bodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(m => m[1]).join('');
  for (const m of bodies.matchAll(/<tr\b([^>]*)>/g)) if (!/data-source=/.test(m[1])) problems.push(`${m[0]}: a table row with no source record`);
  for (const m of html.matchAll(/<(a|li|tr|rect|article)\b([^>]*)>/g)) {
    const [tag, name, attrs] = m;
    if (name === 'tr' && !/data-source=/.test(attrs)) continue;
    const id = attrs.match(/data-source="([^"]*)"/)?.[1];
    if (!id) { problems.push(`${tag}: no source record`); continue; }
    const r = byId.get(id.replaceAll('&amp;', '&'));
    if (!r) { problems.push(`${tag}: names ${id}, which is not a record`); continue; }
    if (name === 'a') {
      const href = attrs.match(/href="([^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
      if (href !== recordLink(r)) problems.push(`${tag}: links to ${href}, not its record's ${recordLink(r)}`);
      if (!isLabLink(href)) problems.push(`${tag}: not a public URL into ${REPO}`);
    }
  }
  return problems;
}

/** The "How this site got built" section body. Throws when the copy fails the screen or an element has no source. */
export function renderDelivery(record) {
  const copyProblems = screenTree(COPY, 'lab-delivery COPY');
  if (copyProblems.length) throw new Error(`Delivery copy refused:\n  ${copyProblems.join('\n  ')}`);
  const telemetry = record.telemetry, t = telemetry.totals;
  const prs = [...record.prs].sort((a, b) => b - a);
  const said = `${count(t.prs, 'change')} merged from #${record.window.fromPr} to #${record.window.toPr}: ${count(t.reviewRounds, 'review round')}, of which ${count(t.fixNeededRounds, 'sent the change back', 'sent the change back')}; ${count(t.ciRuns, 'CI run')} with ${count(t.ciReruns, 'rerun')}; ${count(t.deploys, 'deploy')} to this site. The median change landed ${duration(t.medianMinutesToLand)} after it was opened.`;
  const summary = said[0].toUpperCase() + said.slice(1);
  const sentences = prs.map(pr => prSentence(pr, record.records.filter(r => r.pr === pr), telemetry));
  const textProblems = screenTree({ summary, sentences }, 'lab-delivery text');
  if (textProblems.length) throw new Error(`Delivery text refused:\n  ${textProblems.join('\n  ')}`);
  const html = `<div class="delivery" id="delivery"><div class="company-section-heading"><h2 id="delivery-title">${escape(COPY.title)}</h2><p>${escape(COPY.lead)}</p></div>`
    + `<p class="delivery-summary">${escape(summary)}</p>`
    + `<div class="delivery-telemetry"><h3>Review rounds per change</h3><p class="delivery-legend"><span class="delivery-key delivery-key-fix"></span> sent back <span class="delivery-key delivery-key-ship"></span> approved</p>${roundsChart(record, telemetry)}${telemetryTable(record, telemetry)}</div>`
    + `<div class="delivery-timeline"><h3>Every change, newest first</h3><p>${escape(COPY.howToRead)}</p><p class="delivery-private">${escape(COPY.privateNote)}</p>${prs.map(pr => prTimeline(pr, record, telemetry)).join('')}</div>`
    + `<p class="delivery-cursor technical">RECORD · PULL REQUESTS #${record.window.fromPr}–#${record.window.toPr} · GITHUB READ ${escape(record.generatedFrom.ghFetchedAt.replace('T', ' ').replace('Z', ' UTC'))} · ${record.generatedFrom.verdictRowsRead} REVIEW ROWS READ</p></div>`;
  const problems = renderedProblems(html, record);
  if (problems.length) throw new Error(`Delivery section refused (an element without a resolvable source):\n  ${problems.join('\n  ')}`);
  return html;
}
