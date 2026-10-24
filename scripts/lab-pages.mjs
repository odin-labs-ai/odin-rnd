// The lab's provider-economics and evidence pages (vp-grow-odin-r-d bundle-3 WO-01, WO-03). Each page is a committed
// template under site/<page>/index.html with one marker; scripts/build.mjs calls renderLabPages() after it copies
// site/ to dist/ and writes the rendered pages into dist/ only. Nothing rendered is committed, so a record that lands
// later (an experiment's results.json) changes the built page and stales no committed file.
//
// Every number these pages show is read from a published experiment record and rendered by format() from
// scripts/number-provenance.mjs as a link to that record; the same module checks the built pages at the end of the
// build. The page configuration files (site/data/provider-economics.json, site/data/evidence.json) hold words and
// JSON pointers, never a number that is shown.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, NUMBER_WORDS, quoteProblem, recordProblem, resolvePointer, SOURCE_FILE } from './number-provenance.mjs';
import { displayNames, PROBE } from './broker-probe.mjs';

export const PAGES = {
  'provider-economics': { marker: '<!--PROVIDER_ECONOMICS-->', config: 'data/provider-economics.json' },
  evidence: { marker: '<!--EVIDENCE-->', config: 'data/evidence.json' },
  providers: { marker: '<!--PROVIDER_PARTNERS-->', config: 'data/provider-partners.json' },
  'provider-brief': { marker: '<!--PROVIDER_BRIEF-->', config: 'data/provider-brief.json' },
  'one-pager': { marker: '<!--LAB_PROOF-->', config: 'data/lab-proof.json' },
};

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** A reader over a site root (site/ in tests and the build): JSON by site-relative path, null when absent. */
export function siteReader(root = 'site', repoRoot = join(root, '..')) {
  const cache = new Map();
  const read = path => {
    if (!cache.has(path)) { const full = join(root, path); cache.set(path, existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : null); }
    return cache.get(path);
  };
  // The same record check the build gate runs: a number comes only from a measured experiment record.
  read.recordProblem = path => { const full = join(root, path); return existsSync(full) ? recordProblem(path, readFileSync(full, 'utf8'), repoRoot) : `${path} does not exist`; };
  read.quoteProblem = path => { const full = join(root, path); return existsSync(full) ? quoteProblem(path, readFileSync(full, 'utf8'), repoRoot) : `${path} does not exist`; };
  return read;
}

/** Why `text` (page configuration prose) states a number: a digit of any script, or a number word. */
export function statesNumber(text) {
  return /\p{Nd}/u.test(text) || NUMBER_WORDS.test(text);
}

/** One sourced number: a link to its record, carrying the pointer the build check resolves again. `up` is '../'. */
export function num(read, source, kind, up = '../') {
  const [path, pointer = ''] = source.split('#');
  if (!SOURCE_FILE.test(path)) throw new Error(`${source}: a number may only come from an experiment record`);
  const doc = read(path);
  if (doc === null) throw new Error(`${source}: ${path} does not exist`);
  const why = read.recordProblem ? read.recordProblem(path) : 'the reader cannot check records';
  if (why) throw new Error(`${source}: ${why}`);
  const value = resolvePointer(doc, pointer);
  if (value === undefined) throw new Error(`${source}: the pointer does not resolve`);
  return `<a class="lab-num" href="${up}${escape(path)}" data-source="${escape(source)}" data-format="${escape(kind)}">${escape(format(value, kind))}</a>`;
}

/** A string read from a record (a model id, a week, a date), shown as code or as a date; never a number. */
function str(read, source) {
  const [path, pointer = ''] = source.split('#');
  const doc = read(path);
  const value = doc === null ? undefined : resolvePointer(doc, pointer);
  if (typeof value !== 'string') throw new Error(`${source}: expected a string`);
  return value;
}

const time = value => `<time datetime="${escape(value)}">${escape(/^\d{4}-W\d{2}$/.test(value) ? value : value.slice(0, 10))}</time>`;

/** What one experiment has published: its pre-registration (always) and its results (when present). */
export function experiment(read, slug) {
  const prereg = read(`data/${slug}/preregistration.json`);
  if (!prereg) throw new Error(`data/${slug}/preregistration.json does not exist`);
  // The title is quoted from the frozen pre-registration, verbatim, as a <cite> the build gate checks again.
  const why = read.quoteProblem ? read.quoteProblem(`data/${slug}/preregistration.json`) : 'the reader cannot check pre-registrations';
  if (why) throw new Error(`EXP title of ${slug}: ${why}`);
  const title = `<cite data-quote="data/${escape(slug)}/preregistration.json#/experiment/title">${escape(prereg.experiment.title)}</cite>`;
  return { slug, id: prereg.experiment.id, title, prereg, results: read(`data/${slug}/results.json`) };
}

function unpublished(e, up = '../') {
  const window = e.prereg.window?.from && e.prereg.window?.to ? ` Its measurement window: ${time(e.prereg.window.from)} to ${time(e.prereg.window.to)}.` : '';
  return `<a href="${up}data/${e.slug}/preregistration.json">Pre-registered</a>; no result is published yet.${window}`;
}

function publishedWithoutSummary(e, note, up = '../') {
  return `Results are published: <a href="${up}data/${e.slug}/results.json">the record</a>${note ? ` and <a href="${up}${escape(note)}">the field note</a>` : ''}. This page does not summarise them yet.`;
}

/** EXP 017: the cost/recall table and a scatter of catches against cost per review (log scale, no tick numbers). */
export function frontierBlock(read, e, note) {
  const src = 'data/review-frontier/results.json';
  const on = new Set(e.results.decision.onFrontier);
  const seats = e.results.seats;
  if (!seats.length || seats.some(s => !(Number.isFinite(s.costPerReviewUsd) && s.costPerReviewUsd > 0))) throw new Error('EXP 017: every seat needs a positive cost per review for the log-scale scatter');
  if (new Set(seats.map(s => s.caughtOf)).size !== 1) throw new Error('EXP 017: seats were scored out of different totals');
  const rows = e.results.seats.map((s, i) => {
    const p = `${src}#/seats/${i}`;
    return `<tr><th scope="row">${escape(s.seat)}</th><td><code>${escape(s.model)}</code></td><td>${num(read, `${p}/caught`, 'int')} of ${num(read, `${p}/caughtOf`, 'int')} <span class="lab-ci">(${num(read, `${p}/caughtCI/0`, 'pct')} to ${num(read, `${p}/caughtCI/1`, 'pct')})</span></td><td>${num(read, `${p}/falseAlarms`, 'int')} of ${num(read, `${p}/falseAlarmsOf`, 'int')}</td><td>${num(read, `${p}/costPerReviewUsd`, 'usd')}</td><td>${num(read, `${p}/runsComplete`, 'int')}</td><td>${on.has(s.seat) ? 'on' : 'off'}</td></tr>`;
  }).join('');
  const table = `<div class="table-scroll" role="region" aria-label="Review cost and recall, per model" tabindex="0"><table><caption>Pooled over each model's runs (the Runs column). The interval is the Wilson interval on defects caught. Cost is what the broker billed, per review.</caption><thead><tr><th scope="col">Seat</th><th scope="col">Model</th><th scope="col">Defects caught</th><th scope="col">False alarms</th><th scope="col">Cost per review</th><th scope="col">Runs</th><th scope="col">Frontier</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  // Scatter: x = log10(cost per review), y = caught. Positions only; the values are in the table above.
  const W = 560, H = 260, L = 40, R = 120, T = 20, B = 40;
  const xs = e.results.seats.map(s => Math.log10(s.costPerReviewUsd)), ys = e.results.seats.map(s => s.caught);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], yMax = seats[0].caughtOf;
  const px = x => L + ((x - x0) / ((x1 - x0) || 1)) * (W - L - R), py = y => H - B - (y / yMax) * (H - T - B);
  const points = e.results.seats.map((s, i) => `<g class="${on.has(s.seat) ? 'lab-on' : 'lab-off'}"><circle cx="${px(xs[i]).toFixed(1)}" cy="${py(ys[i]).toFixed(1)}" r="6"></circle><text x="${(px(xs[i]) + 10).toFixed(1)}" y="${(py(ys[i]) + 4).toFixed(1)}">${escape(s.seat)}</text></g>`).join('');
  const svg = `<figure class="lab-figure"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="frontier-figure-caption"><line class="lab-axis" x1="${L}" y1="${H - B}" x2="${W - R + 20}" y2="${H - B}"></line><line class="lab-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"></line><text class="lab-axis-label" x="${L}" y="${H - 10}">cost per review, log scale →</text><text class="lab-axis-label" x="${L + 6}" y="${T + 4}">defects caught ↑ (axis from none caught)</text>${points}</svg><figcaption id="frontier-figure-caption">Each point is a model: further right costs more per review, higher catches more defects. Filled points are on the cost/recall frontier. The numbers are in the table above.</figcaption></figure>`;
  const spend = `<p>The broker billed ${num(read, `${src}#/spend/brokerReportedUsd`, 'usd')} for all ${num(read, `${src}#/spend/reviews`, 'int')} reviews. <a href="../${escape(note)}">The field note</a> gives the method, the limits and what the result does not show; <a href="../${src}">the record</a> holds every figure.</p>`;
  return table + svg + spend;
}

/** The latest weekly probe week: answered calls, 5xx, other-model answers and latency per broker and model. */
export function probeBlock(read, weeks) {
  if (!weeks.length) return '<p>No probe week has been recorded yet.</p>';
  const week = weeks[weeks.length - 1];
  const src = `data/broker-probe/${week}.json`;
  const record = read(src);
  const brokers = Object.keys(PROBE.brokers);
  const names = displayNames(brokers, read('data/provider-terms.json'));
  const rows = brokers.map(b => {
    const e = record.brokers[b];
    if (e?.held) return `<tr><th scope="row">${escape(names[b])}</th><td colspan="5">not probed: its terms are under review before any measurement is published</td></tr>`;
    if (!e || !e.keyed) return `<tr><th scope="row">${escape(names[b])}</th><td colspan="5">not keyed this week</td></tr>`;
    return Object.entries(e.models).map(([m, s]) => {
      const p = `${src}#/brokers/${b}/models/${m}`;
      const lat = k => (s[k] === null || s[k] === undefined ? '—' : num(read, `${p}/${k}`, 'int'));
      return `<tr><th scope="row">${escape(names[b])}</th><td><code>${escape(m)}</code></td><td>${num(read, `${p}/ok`, 'int')} of ${num(read, `${p}/attempted`, 'int')}</td><td>${num(read, `${p}/status5xx`, 'int')}</td><td>${num(read, `${p}/servedMismatch`, 'int')}</td><td>${lat('latencyMsP50')} / ${lat('latencyMsP95')}</td></tr>`;
    }).join('');
  }).join('');
  return `<div class="table-scroll" role="region" aria-label="Latest weekly broker probe" tabindex="0"><table><caption>The week of ${time(record.week)}. Latency in milliseconds, measured from a GitHub-hosted runner. A broker shown by letter has terms that do not yet allow naming it next to a number.</caption><thead><tr><th scope="col">Broker</th><th scope="col">Model</th><th scope="col">Answered</th><th scope="col">5xx</th><th scope="col">Other model served</th><th scope="col">p50 / p95</th></tr></thead><tbody>${rows}</tbody></table></div><p><a href="../probe/">Every week of the probe</a> and how it is measured.</p>`;
}

/** The probe weeks published under `root`, oldest first, as 'YYYY-Www'. */
export function probeWeeks(root = 'site') {
  const dir = join(root, 'data/broker-probe');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^\d{4}-W\d{2}\.json$/.test(f)).sort().map(f => f.slice(0, -'.json'.length));
}

/** The provider-economics section: one block per experiment in the series, then the probe, then what is unpublished. */
export function renderProviderEconomics(read, weeks) {
  const config = read(PAGES['provider-economics'].config);
  const blocks = [], pending = [];
  for (const item of config.series) {
    // An experiment planned but not yet pre-registered shows its fallback text until its pre-registration is published.
    if (!item.slug || (item.unregistered && !read(`data/${item.slug}/preregistration.json`))) { const f = item.unregistered ?? item; pending.push(`<li><strong>${escape(f.title)}</strong> ${escape(f.status)}</li>`); continue; }
    const e = experiment(read, item.slug);
    const head = `<h3 id="${escape(item.slug)}">${escape(e.id)}: ${e.title}</h3>`;
    if (!e.results) { pending.push(`<li><strong>${escape(e.id)}: ${e.title}</strong> ${unpublished(e)}</li>`); continue; }
    const body = item.slug === 'review-frontier' ? frontierBlock(read, e, item.note) : `<p>${publishedWithoutSummary(e, item.note)}</p>`;
    blocks.push(`<article class="lab-block">${head}${body}</article>`);
  }
  blocks.push(`<article class="lab-block"><h3 id="probe">The weekly broker probe, latest week</h3>${probeBlock(read, weeks)}</article>`);
  return `<section class="company-section company-width" id="published" aria-labelledby="published-title"><h2 id="published-title">Published results.</h2><div class="company-prose">${blocks.join('')}</div></section>`
    + `<section class="company-section company-width" id="not-yet" aria-labelledby="not-yet-title"><h2 id="not-yet-title">No published result yet.</h2><div class="company-prose"><p>These questions are part of the series. Until a result is published here, this site makes no claim about them.</p><ul class="lab-pending">${pending.join('')}</ul></div></section>`;
}

/** Fill a claim's text: {name} placeholders become sourced numbers, model ids, broker names, words or dates. */
export function fillClaim(read, claim, up = '../') {
  if (statesNumber(claim.text)) throw new Error(`claim ${claim.id}: its text states a number (a digit or a number word); every number must be a sourced value`);
  return escape(claim.text).replace(/\{([a-zA-Z0-9]+)\}/g, (whole, name) => {
    const v = claim.values?.[name];
    if (!v) throw new Error(`claim ${claim.id}: no value for {${name}}`);
    if (v.format === 'code') return `<code>${escape(str(read, v.source))}</code>`;
    // The last key of a pointer that resolves (a model id keyed in its record), so a name and its counts share a path.
    if (v.format === 'key') { const [path, pointer = ''] = v.source.split('#'); if (resolvePointer(read(path), pointer) === undefined) throw new Error(`claim ${claim.id}: ${v.source} does not resolve`); return `<code>${escape(pointer.split('/').pop().replaceAll('~1', '/').replaceAll('~0', '~'))}</code>`; }
    if (v.format === 'word') { const w = str(read, v.source); if (statesNumber(w)) throw new Error(`claim ${claim.id}: word value '${w}' holds a digit`); return `<strong>${escape(w)}</strong>`; }
    if (v.format === 'date') return time(str(read, v.source));
    if (v.format === 'broker') return escape(displayNames(Object.keys(PROBE.brokers), read('data/provider-terms.json'))[v.id]);
    return num(read, v.source, v.format, up);
  });
}

/** A claim's measurement window: dates read from its record (earliest start to latest end over a list, or two pointers). */
function claimWindow(read, w) {
  if (!w) return '';
  const values = key => {
    const spec = w[key];
    const [path, pointer = ''] = spec.source.split('#');
    const at = resolvePointer(read(path), pointer);
    const list = (Array.isArray(at) ? at.map(x => (spec.field ? x[spec.field] : x)) : [at]).filter(x => typeof x === 'string').sort();
    if (!list.length) throw new Error(`window ${spec.source}: no dates`);
    return key === 'from' ? list[0] : list[list.length - 1];
  };
  const from = values('from'), to = w.to ? values('to') : null;
  return to && to.slice(0, 10) !== from.slice(0, 10) ? `Measured ${time(from)} to ${time(to)}.` : `Measured ${time(from)}.`;
}

/**
 * Qualitative sentences in a claim ("the intervals overlap") are checked against the record here, so a sentence that
 * stops being true stops the build instead of staying on the page.
 */
const listAt = (read, a) => { const [path, pointer = ''] = a.source.split('#'); const list = resolvePointer(read(path), pointer); return Array.isArray(list) ? list : null; };
export const ASSERTS = {
  // The item at `index` has the smallest (min-at) or largest (max-at) `field` in the list: "the cheapest", "the dearest".
  'min-at': (read, a) => { const l = listAt(read, a); if (!l?.[a.index]) return 'no such item'; return l.every(x => x[a.field] >= l[a.index][a.field]) ? null : `item ${a.index} does not have the smallest ${a.field}`; },
  'max-at': (read, a) => { const l = listAt(read, a); if (!l?.[a.index]) return 'no such item'; return l.every(x => x[a.field] <= l[a.index][a.field]) ? null : `item ${a.index} does not have the largest ${a.field}`; },
  // max/min of `wide` exceeds max/min of `narrow`: "the price varied far more than what it caught" (factor `by`).
  'spread-greater': (read, a) => {
    const l = listAt(read, a); if (!l?.length) return 'no items';
    const ratio = f => { const v = l.map(x => x[f]); return Math.max(...v) / Math.min(...v); };
    return ratio(a.wide) > (a.by ?? 1) * ratio(a.narrow) ? null : `the spread of ${a.wide} is not more than ${a.by ?? 1}x the spread of ${a.narrow}`;
  },
  // Every broker in every arm answered with the model asked for: servedMatch complete, no mismatch, no silent swap.
  'served-as-asked': (read, a) => {
    const [path, pointer = ''] = a.source.split('#');
    const arms = resolvePointer(read(path), pointer);
    if (!arms || typeof arms !== 'object' || !Object.keys(arms).length) return 'no arms';
    for (const [arm, x] of Object.entries(arms)) {
      if (x.silentSubstitutions !== 0) return `${arm}: silent substitutions are not zero`;
      for (const [b, v] of Object.entries(x.perBroker ?? {})) if (!v.servedMatch || v.servedMatch.matched !== v.servedMatch.of || (v.mismatches ?? []).length) return `${arm}/${b}: an answer came from a different model`;
      if (!Object.keys(x.perBroker ?? {}).length) return `${arm}: no brokers`;
    }
    return null;
  },
  'intervals-overlap': (read, a) => {
    const [path, pointer = ''] = a.source.split('#');
    const ivs = resolvePointer(read(path), pointer).map(x => x[a.field]);
    if (ivs.length < 2 || ivs.some(iv => !Array.isArray(iv) || iv.length !== 2)) return 'no intervals to compare';
    return Math.max(...ivs.map(iv => iv[0])) <= Math.min(...ivs.map(iv => iv[1])) ? null : 'some intervals do not overlap';
  },
};

/** Sourced claims as list items: each claim's asserts are checked, its numbers read from and linked to its record. */
export function renderClaims(read, list, up = '../') {
  return list.map(c => {
    const [path] = (c.record ?? '').split('#');
    if (!SOURCE_FILE.test(path) || read(path) === null) throw new Error(`claim ${c.id}: record '${c.record}' is not a published experiment record`);
    for (const a of c.asserts ?? []) {
      const check = ASSERTS[a.kind];
      const why = check ? check(read, a) : `unknown assertion '${a.kind}'`;
      if (why) throw new Error(`claim ${c.id}: ${a.kind}: ${why}`);
    }
    return `<li id="${escape(c.id)}"><p>${fillClaim(read, c, up)}</p><p class="lab-source">${claimWindow(read, c.window)} Source: <a href="${up}${escape(path)}"><code>${escape(path)}</code></a>${c.note ? ` · <a href="${up}${escape(c.note)}">the field note</a>` : ''}.</p></li>`;
  }).join('');
}

export function renderEvidence(read) {
  const config = read(PAGES.evidence.config);
  const claims = renderClaims(read, config.claims);
  const notYet = config.notMeasured.map(n => {
    if (statesNumber(`${n.claim} ${n.why ?? ''} ${n.planned ?? ''}`)) throw new Error(`not-measured item '${n.claim}' states a number`);
    let status = escape(n.why ?? '');
    let planned = n.planned;
    // An item tied to an experiment shows that experiment's state; while the experiment is not yet pre-registered
    // (unregistered: true), its why/planned fallback shows instead, and both disappear once it is.
    if (n.slug && (!n.unregistered || read(`data/${n.slug}/preregistration.json`))) {
      const e = experiment(read, n.slug);
      status = `${escape(e.id)}, “${e.title}”: ${e.results ? publishedWithoutSummary(e, n.note) : unpublished(e)}`;
      planned = null;
    }
    return `<li><strong>${escape(n.claim)}</strong> ${status}${planned ? ` <em>${escape(planned)}</em>` : ''}</li>`;
  }).join('');
  return `<section class="company-section company-width" id="measured" aria-labelledby="measured-title"><h2 id="measured-title">What we have measured.</h2><div class="company-prose"><p>Each claim below is a sentence whose numbers are read from the experiment record it cites, at build time. Each number links to that record.</p><ol class="lab-claims">${claims}</ol></div></section>`
    + `<section class="company-section company-width" id="not-measured" aria-labelledby="not-measured-title"><h2 id="not-measured-title">What we have not measured yet.</h2><div class="company-prose"><p>These are things an investor or a provider might expect us to claim. Until a published result backs them, we do not.</p><ul class="lab-pending">${notYet}</ul></div></section>`;
}

/**
 * The provider brief (vp-grow-odin-r-d bundle-4 WO-01, WO-VG-05): a one-page summary for a model provider or broker.
 * Its measured claims use the evidence page's machinery. A claim's record must hold a decided result: a record whose
 * pre-registered verdict is incomplete (EXP 018) appears only in the list of what is not a result, with that verdict
 * read from its record, and none of its figures. EXP 019 (results published 2026-10-23, verdict decided) is listed there
 * as published but not summarised by this brief: a link to its record and field note, none of its figures, until the
 * brief's owner takes it into the claims.
 */
export const NOT_A_CLAIM_RECORD = /^data\/router-arm(?:-fresh)?\//;
/** Verdict words that are not a result: the not-a-result list refuses any other. */
export const UNDECIDED = /^(?:incomplete|inconclusive|not run|pending)$/i;

/** Every record path a claim reads: its record, and each `source` anywhere in it (values, window, asserts). */
function claimSources(node, at = '', out = []) {
  if (Array.isArray(node)) node.forEach((x, i) => claimSources(x, `${at}/${i}`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if ((k === 'source' || k === 'record') && typeof v === 'string') out.push([`${at}/${k}`, v]); else claimSources(v, `${at}/${k}`, out); }
  return out;
}

export function briefProblems(config) {
  const problems = [];
  for (const c of config?.claims ?? []) for (const [where, source] of claimSources(c)) if (NOT_A_CLAIM_RECORD.test(source)) problems.push(`claim ${c.id}: ${where.slice(1)} reads ${source}, which has no decided result and may not back a claim`);
  return problems;
}

export function renderProviderBrief(read) {
  const config = read(PAGES['provider-brief'].config);
  const problems = briefProblems(config);
  if (problems.length) throw new Error(`site/${PAGES['provider-brief'].config} is refused:\n${problems.join('\n')}`);
  const claims = renderClaims(read, config.claims);
  const notResults = config.notResults.map(n => {
    if (statesNumber(`${n.claim} ${n.why ?? ''}`)) throw new Error(`not-a-result item '${n.claim}' states a number`);
    if (!n.slug) return `<li><strong>${escape(n.claim)}</strong> ${escape(n.why)}</li>`;
    const e = experiment(read, n.slug);
    if (!e.results) return `<li><strong>${escape(n.claim)}</strong> ${escape(e.id)}, “${e.title}”: ${unpublished(e)}</li>`;
    // A decided result this brief has not taken into its claims yet (EXP 019): link the record, cite none of its figures.
    // Only an item marked `published: "not summarised"` may do this; any other item with results must name its verdict.
    if (n.published === 'not summarised') return `<li><strong>${escape(n.claim)}</strong> ${escape(e.id)}, “${e.title}”: ${publishedWithoutSummary(e, n.note)}</li>`;
    // Results exist but the verdict is not a decided result: say so from the record and cite none of its figures.
    if (!n.verdict) throw new Error(`not-a-result item '${n.claim}': ${n.slug} has results; name the pointer to its verdict`);
    const verdict = str(read, n.verdict);
    if (statesNumber(verdict)) throw new Error(`not-a-result item '${n.claim}': verdict '${verdict}' holds a digit`);
    if (!UNDECIDED.test(verdict)) throw new Error(`not-a-result item '${n.claim}': verdict '${verdict}' is decided; a decided result belongs in the claims`);
    return `<li><strong>${escape(n.claim)}</strong> ${escape(e.id)}, “${e.title}”: its pre-registered verdict is <strong>${escape(verdict)}</strong>, so this brief cites none of its figures. <a href="../data/${escape(n.slug)}/results.json">The record</a>${n.note ? ` and <a href="../${escape(n.note)}">the field note</a>` : ''} say why.</li>`;
  }).join('');
  return `<section class="company-section company-width" id="measured" aria-labelledby="measured-title"><h2 id="measured-title">What we have measured.</h2><div class="company-prose"><p>Each number below is read from the published experiment record it links to, when the site is built.</p><ol class="lab-claims">${claims}</ol></div></section>`
    + `<section class="company-section company-width" id="not-results" aria-labelledby="not-results-title"><h2 id="not-results-title">What is not a result yet.</h2><div class="company-prose"><ul class="lab-pending">${notResults}</ul></div></section>`;
}

/**
 * The lab's proof strip (lab launch, 2026-10-24): the home page and the lab on a page (one-pager/) show the same sourced
 * claims from data/lab-proof.json, rendered by the evidence page's machinery, so the two never drift. `up` is '' on the
 * home page and '../' on a page one folder down. Like the brief, a claim may not read a record without a decided result.
 */
export function renderLabProof(read, up = '../') {
  const config = read(PAGES['one-pager'].config);
  const problems = briefProblems(config);
  if (problems.length) throw new Error(`site/${PAGES['one-pager'].config} is refused:\n${problems.join('\n')}`);
  return renderClaims(read, config.claims, up);
}

/**
 * The signed-partner list (vp-grow-odin-r-d bundle-3 WO-02). Only a signed agreement on record makes a partner: each
 * entry needs a name, a signedOn date (real, not in the future) and an evidence id (the private record of the signed
 * agreement). Any other field, a logo or a status included, is refused, so a lead, a free-text status or a logo cannot
 * reach the page through this file.
 */
export const PLACEHOLDER_EVIDENCE = /^(?:tbd|tba|todo|pending|none|null|unknown|na|n-a|to-be-signed|placeholder|draft)$/i;

export function partnerProblems(config, today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  if (!Array.isArray(config?.partners)) return ['partners must be a list'];
  config.partners.forEach((p, i) => {
    const at = `partners[${i}]`;
    for (const key of Object.keys(p ?? {})) if (!['name', 'signedOn', 'evidence'].includes(key)) problems.push(`${at}: field '${key}' is not allowed`);
    if (typeof p?.name !== 'string' || !p.name.trim()) problems.push(`${at}: name is missing`);
    // A real calendar date (it must survive a round trip, so 2026-02-30 fails) that is not in the future.
    const d = typeof p?.signedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.signedOn) ? new Date(`${p.signedOn}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== p.signedOn) problems.push(`${at}: signedOn must be the date the agreement was signed (YYYY-MM-DD)`);
    else if (p.signedOn > today) problems.push(`${at}: signedOn ${p.signedOn} is in the future; a planned signing is not a signed agreement`);
    // The id of a private record: lower-case letters, digits and hyphens. A link of any form, or a placeholder, is not one.
    if (typeof p?.evidence !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(p.evidence) || PLACEHOLDER_EVIDENCE.test(p.evidence)) problems.push(`${at}: evidence must be the id of the private record of the signed agreement (lower-case letters, digits, hyphens; not a link or a placeholder)`);
  });
  return problems;
}

export function renderPartners(read, today) {
  const config = read(PAGES.providers.config);
  const problems = partnerProblems(config, today);
  if (problems.length) throw new Error(`site/${PAGES.providers.config} is refused:\n${problems.join('\n')}`);
  if (!config.partners.length) return '<p class="lab-empty">No partner agreement is signed yet.</p>';
  return `<ul class="lab-partners">${config.partners.map(p => `<li><strong>${escape(p.name)}</strong>, agreement signed ${time(p.signedOn)}</li>`).join('')}</ul>`;
}

/**
 * The home page's proof strip: scripts/build.mjs places it at this marker while it renders the home page. The
 * number-provenance gate (HOME_PROOF in scripts/number-provenance.mjs) checks the finished strip in dist/index.html.
 */
export const HOME_MARKER = '<!--LAB_PROOF-->';

/** The home page `html` with its proof strip placed at HOME_MARKER, which it must hold exactly once. */
export function placeHomeProof(html, read = siteReader()) {
  const parts = html.split(HOME_MARKER);
  if (parts.length !== 2) throw new Error(`site/index.html must hold ${HOME_MARKER} exactly once`);
  return parts.join(renderLabProof(read, ''));
}

/** Render the lab pages into `dist` from the templates in `root` (site/). Returns {page: html}. */
export function renderLabPages({ root = 'site', read = siteReader(root), weeks = probeWeeks(root) } = {}) {
  const out = {};
  for (const [page, { marker }] of Object.entries(PAGES)) {
    const template = readFileSync(join(root, page, 'index.html'), 'utf8');
    if (template.split(marker).length !== 2) throw new Error(`site/${page}/index.html must hold ${marker} exactly once`);
    const body = page === 'evidence' ? renderEvidence(read) : page === 'providers' ? renderPartners(read) : page === 'provider-brief' ? renderProviderBrief(read) : page === 'one-pager' ? renderLabProof(read) : renderProviderEconomics(read, weeks);
    out[page] = template.replace(marker, body);
    if (/<!--[A-Z_]+-->/.test(out[page])) throw new Error(`Unresolved content marker in ${page}`);
  }
  return out;
}
