// "How we decide" (founder's Lab 01 plan 4, 2026-10-26): a public ledger of how each pre-registration this site
// publishes was decided. Every advocate round with its vetoes and what became of them, every freeze, every amendment, and
// the gaps we disclosed. scripts/labs.mjs renders it into labs/how-we-decide/index.html.
//
// Nothing on the page is typed by hand except its framing words. site/data/labs/how-we-decide.json names, per
// experiment, the published files to read and the verbatim sentences that settle a round. Everything else is read from
// those files at build time:
//   - a round's vetoes are parsed from each review's own "Vetoes" section (a numbered or bulleted list of **titles**),
//     or from its "(n) THE <PART>: VETO / ACCEPT" verdict lines;
//   - each review must say, in its "Reviewer:" line, that it is a model reviewer, and the page labels it an AI model;
//   - a round reconciles with its freeze notes: the "M1 / P3" ids of the freeze table must be exactly M1..Mn and P1..Pm
//     for the two reviews' veto counts, and every number a quoted sentence states ("All 16 vetoes", "(4 vetoes)") must
//     equal the count computed from the review it names;
//   - a sentence that settles a round, and every disclosure, is quoted only if it is found verbatim in its file;
//   - amendments come from their records (date, title, what each change is, the first sentence of why);
//   - the brain bench's pre-registrations are cited by hash from its published results record, with their prediction
//     verdicts tallied from that record.
// Every row links the published file it comes from, and the build refuses a file that is not in this repository or on
// this site. Every string the page shows passes the publisher's screen (lab-dispatch-publish.mjs, through benchScreen);
// a verbatim quote may name a file (it is the record's own text), nothing else. A sentence in the page's own words that
// mentions a review, reviewer, jury, judge or advocate must say, in that sentence, that it is AI; a quote that does is
// followed by a note saying the reviewers it names are AI models.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { benchScreen } from './brain-bench-import.mjs';

export const DECISIONS_FILE = 'data/labs/how-we-decide.json';
export const DECISIONS_PAGE = 'labs/how-we-decide/index.html';
export const BENCH_RESULTS = 'data/labs/brain-bench/results.json';
const REPO_BLOB = 'https://github.com/odin-labs-ai/odin-rnd/blob/main/';
const ACTOR = /\b(review\w*|jury|juries|judge\w*|advocate\w*|refute\w*)\b/i;
const sentences = text => String(text).split(/(?<=[.!?:])\s+/);
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** The vetoes and verdicts one review states. { side, model, date, vetoes: [title], accepts: [title] } or throws. */
export function parseReview(text, where) {
  const lines = text.split('\n');
  const head = lines.slice(0, 8).join(' ');
  const side = /\b(MongoDB|PostgreSQL) advocate\b/.exec(head)?.[1];
  if (!side) throw new Error(`${where}: does not say which advocate it is in its first lines`);
  const reviewer = lines.find(line => line.startsWith('Reviewer:'));
  const model = reviewer && /\bmodel reviewer \(([^)]+)\)/.exec(reviewer)?.[1];
  if (!model) throw new Error(`${where}: its "Reviewer:" line does not say it is a model reviewer (model, setting)`);
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(head)?.[1] ?? null;
  const vetoes = [], accepts = [];
  const at = lines.findIndex(line => /^##\s+(\d+\.\s+)?Vetoes\s*$/.test(line));
  if (at >= 0) {
    // The list ends at the next heading, or at the first plain paragraph after it ("No veto on the other points…").
    for (const line of lines.slice(at + 1)) {
      if (/^##\s/.test(line)) break;
      const item = /^(?:\d+\.|-)\s+\*\*(.+?)\*\*/.exec(line);
      if (item) vetoes.push(item[1].replace(/^V\d+[,:]\s*/, '').replace(/[.:]$/, '').trim());
      // A list item without a **title** would be dropped from the count: refuse it rather than stop silently.
      else if (/^(?:\d+\.|-)\s/.test(line)) throw new Error(`${where}: a veto list item has no **title**, so it cannot be counted ("${line.slice(0, 60)}")`);
      else if (vetoes.length && /^\S/.test(line)) break;
    }
  }
  for (const line of lines) {
    const verdict = /^\(\d+\)\s+THE\s+([A-Z][A-Z ]*?):\s+(VETO|ACCEPT)\b/.exec(line);
    if (verdict) (verdict[2] === 'VETO' ? vetoes : accepts).push(`the ${verdict[1].toLowerCase()}`);
  }
  if (at < 0 && !vetoes.length && !accepts.length) throw new Error(`${where}: has neither a "Vetoes" section nor "(n) THE …: VETO/ACCEPT" lines`);
  return { side, model, date, vetoes, accepts };
}

/** The ids in a freeze-note table's first column ("M2 / P3" gives M2 and P3). */
export function tableIds(text) {
  return text.split('\n').filter(line => /^\|\s*[A-Z]\d+(\s*\/\s*[A-Z]\d+)*\s*\|/.test(line))
    .flatMap(line => line.split('|')[1].split('/').map(id => id.trim()));
}

/** The one number a sentence states ("All 16 vetoes", "(4 vetoes)", "two vetoes"), or null. */
export function statedCount(sentence) {
  const m = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+vetoes?\b/i.exec(sentence);
  return m ? (WORDS[m[1].toLowerCase()] ?? Number(m[1])) : null;
}

const pointer = (value, path) => path.split('/').slice(1).reduce((v, key) => (v == null ? v : v[key]), value);
const firstSentence = text => (/^.*?[.!?](?=\s+[A-Z(]|$)/s.exec(String(text).trim())?.[0] ?? String(text)).replace(/\s+/g, ' ');

/** The ledger: the config with every count and quote read from its files. Throws, every reason listed, on a problem. */
export function readDecisions(root = 'site') {
  const repo = join(root, '..');
  const config = JSON.parse(readFileSync(join(root, DECISIONS_FILE), 'utf8'));
  const problems = [];
  const read = path => {
    const base = path.startsWith('experiments/') ? repo : path.startsWith('data/') ? root : null;
    // A source stays inside what is published: experiments/ in this repository, data/ on this site, no "..".
    const full = base && resolve(base, path);
    const inside = base && path.split('/').every(part => part && part !== '.' && part !== '..') && full.startsWith(resolve(base, path.split('/')[0]) + sep);
    if (!inside) { problems.push(`${path}: not a file this site or its repository publishes (experiments/… or data/…, no "..")`); return null; }
    if (!existsSync(full)) { problems.push(`${path}: is not published`); return null; }
    return readFileSync(full, 'utf8');
  };
  const quoted = (path, quote, what) => {
    const text = read(path);
    if (text != null && !text.replace(/\s+/g, ' ').includes(quote)) problems.push(`${path}: does not contain the quoted ${what} "${quote.slice(0, 80)}"`);
    return { quote, file: path };
  };
  if (config.format !== 'odin-decision-ledger' || config.version !== 1) problems.push(`${DECISIONS_FILE}: not odin-decision-ledger v1`);
  const experiments = (config.experiments ?? []).map(exp => {
    const recordText = read(exp.record);
    const record = recordText ? JSON.parse(recordText) : {};
    if (record.experiment?.id !== exp.id) problems.push(`${exp.record}: is not ${exp.id}`);
    const pinText = read(exp.record.replace(/\.json$/, '.sha256'));
    const rounds = (exp.rounds ?? []).map(round => {
      if (new Set(round.reviews).size !== round.reviews.length) problems.push(`${round.name}: a review is listed twice, which would count its vetoes twice`);
      const reviews = round.reviews.map(path => {
        const text = read(path);
        if (text == null) return null;
        try { return { file: path, ...parseReview(text, path) }; } catch (error) { problems.push(error.message); return null; }
      }).filter(Boolean);
      const vetoes = reviews.reduce((n, r) => n + r.vetoes.length, 0);
      if (round.freezeNotes && round.tableIds) {
        const ids = tableIds(read(round.freezeNotes) ?? '').sort();
        const want = Object.entries(round.tableIds).flatMap(([prefix, path]) => {
          const n = reviews.find(r => r.file === path)?.vetoes.length ?? 0;
          return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
        }).sort();
        if (ids.join(',') !== want.join(',')) problems.push(`${round.freezeNotes}: its table lists ${ids.join(', ')}, but the reviews' vetoes give ${want.join(', ')}`);
      }
      for (const claim of round.claims ?? []) {
        const said = statedCount(claim.quote);
        const counted = claim.of === 'all' ? vetoes : reviews.find(r => r.file === claim.of)?.vetoes.length;
        quoted(claim.in, claim.quote, 'count');
        if (said === null) problems.push(`${claim.in}: "${claim.quote}" states no number of vetoes`);
        else if (said !== counted) problems.push(`${claim.in}: "${claim.quote}" says ${said}, but ${claim.of === 'all' ? 'the round' : claim.of} has ${counted}`);
      }
      const outcome = quoted(round.outcome.file, round.outcome.quote, 'outcome');
      const accepted = round.outcome.accepted === 'all' ? vetoes : null;
      if (accepted === null) problems.push(`${round.name}: outcome.accepted must be "all" (no other outcome has happened yet; add one when it does)`);
      return { name: round.name, date: reviews.map(r => r.date).find(Boolean) ?? null, reviews, vetoes, accepted, outcome };
    });
    const amendments = (exp.amendments ?? []).map(path => {
      const text = read(path);
      if (!text) return null;
      const a = JSON.parse(text);
      if (a.experiment !== exp.id || a.kind !== 'odin-rnd.amendment') problems.push(`${path}: is not an amendment of ${exp.id}`);
      if (!read(path.replace(/\.json$/, '.sha256'))) problems.push(`${path}: has no pin`);
      return { file: path, id: a.amendment, date: a.authoredOn, title: a.title, changes: (a.changes ?? []).map(c => c.what).filter(Boolean), why: firstSentence(a.why) };
    }).filter(Boolean);
    const disclosures = (exp.disclosures ?? []).flatMap(src => {
      const text = read(src.file);
      if (!text) return [];
      const value = pointer(JSON.parse(text), src.pointer);
      const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
      if (!list || !list.length) { problems.push(`${src.file}#${src.pointer}: holds no disclosure`); return []; }
      return list.map(quote => ({ quote, file: src.file }));
    });
    return {
      id: exp.id, title: record.experiment?.title ?? exp.id, record: exp.record, page: exp.page ?? null,
      frozenOn: record.source?.frozenOn ?? null, pin: (pinText ?? '').trim().split(/\s+/)[0] ?? null,
      published: amendments.length ? JSON.parse(read(exp.amendments[0]) ?? '{}').amends?.frozenCommit ?? null : null,
      history: exp.history ? quoted(exp.record, exp.history, 'history') : null,
      rounds, amendments, disclosures,
    };
  });
  const benchText = config.bench ? read(config.bench.results) : null;
  const bench = benchText ? JSON.parse(benchText).experiments.map(e => {
    const tally = {};
    for (const p of e.predictions ?? []) tally[p.verdict] = (tally[p.verdict] ?? 0) + 1;
    return { id: e.id, title: e.title, date: e.date, commit: e.prereg?.commit, sha256: e.prereg?.sha256, predictions: (e.predictions ?? []).length, tally, caveats: (e.caveats ?? []).length };
  }) : [];
  for (const e of bench) if (!/^[0-9a-f]{7,40}$/.test(e.commit ?? '') || !/^[0-9a-f]{64}$/.test(e.sha256 ?? '')) problems.push(`${config.bench.results}: ${e.id} cites its pre-registration without a commit and sha256`);
  const ledger = { config, experiments, bench };
  problems.push(...ledgerTextProblems(ledger));
  if (problems.length) throw new Error(`How we decide:\n  ${problems.join('\n  ')}`);
  return ledger;
}

/** The ledger's totals, computed from its rows. */
export function totals(ledger) {
  const rounds = ledger.experiments.flatMap(e => e.rounds);
  return {
    preregistrations: ledger.experiments.length + ledger.bench.length,
    rounds: rounds.length,
    reviews: rounds.reduce((n, r) => n + r.reviews.length, 0),
    vetoes: rounds.reduce((n, r) => n + r.vetoes, 0),
    accepted: rounds.reduce((n, r) => n + (r.accepted ?? 0), 0),
    amendments: ledger.experiments.reduce((n, e) => n + e.amendments.length, 0),
    disclosures: ledger.experiments.reduce((n, e) => n + e.disclosures.length, 0),
  };
}

// Hashes and commit ids come from the files and are shown as such; they are not text the screen should read.
const unhash = text => String(text).replace(/\b[0-9a-f]{7,64}\b/g, ' ');
/** Every reason a string the page shows may not be published. Quotes may name a file (their own record's words). */
function screen(text, at, { quote = false } = {}) {
  return benchScreen(unhash(text)).filter(reason => !(quote && reason.startsWith('a file path'))).map(reason => `${at}: ${reason} ("${String(text).slice(0, 60)}")`);
}
function aiProblems(text, at) {
  return sentences(text).filter(s => ACTOR.test(s) && !/\bAI\b/.test(s)).map(s => `${at}: mentions a review, reviewer, jury, judge or advocate without saying, in the same sentence, that it is AI ("${s.slice(0, 80)}")`);
}
export function ledgerTextProblems({ config, experiments, bench }) {
  const out = [];
  const own = (text, at) => out.push(...screen(text, at), ...aiProblems(text, at));
  for (const key of ['title', 'lead', 'boundary']) own(config[key] ?? '', `${DECISIONS_FILE}#/${key}`);
  for (const [i, p] of (config.why ?? []).entries()) own(p, `${DECISIONS_FILE}#/why/${i}`);
  own(config.benchNote ?? '', `${DECISIONS_FILE}#/benchNote`);
  for (const e of experiments) {
    out.push(...screen(e.title, e.record, { quote: true }), ...screen(e.id, e.record));
    for (const r of e.rounds) {
      own(r.name, `${e.id} round`);
      for (const v of r.reviews) for (const t of [...v.vetoes, ...v.accepts, v.model]) out.push(...screen(t, `${v.file}`, { quote: true }));
      out.push(...screen(r.outcome.quote, r.outcome.file, { quote: true }));
    }
    for (const a of e.amendments) for (const t of [a.title, a.why, ...a.changes]) out.push(...screen(t, a.file, { quote: true }));
    for (const d of e.disclosures) out.push(...screen(d.quote, d.file, { quote: true }));
    if (e.history) out.push(...screen(e.history.quote, e.record, { quote: true }));
  }
  for (const b of bench) for (const t of [b.id, b.title, ...Object.keys(b.tally)]) out.push(...screen(t, BENCH_RESULTS, { quote: true }));
  return out;
}

const fileLink = (path, up, label) => path.startsWith('data/')
  ? `<a href="${escape(up + path)}">${escape(label)}</a>`
  : `<a href="${escape(REPO_BLOB + path)}">${escape(label)}</a>`;
const day = iso => iso ? `<time datetime="${escape(iso)}">${escape(new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time>` : 'undated';
// A record's own words are shown verbatim; when they name a reviewer or advocate without saying it is AI, a note says so.
const aiNote = text => ACTOR.test(text) && !/\bAI\b/.test(text) ? ' <span class="decision-ai-note">(every reviewer and advocate named here is an AI model)</span>' : '';
const said = text => `${escape(text)}${aiNote(text)}`;
const quote = (q, up) => `<q>${escape(q.quote)}</q>${aiNote(q.quote)} ${fileLink(q.file, up, 'source')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The page's ledger section (the marker <!--DECISIONS_LEDGER-->). */
export function renderDecisions(ledger, up = '../../') {
  const t = totals(ledger);
  const summary = `<p class="decision-totals">${plural(t.preregistrations, 'pre-registration')}; ${plural(t.rounds, 'round')} of review by AI model advocates (${plural(t.reviews, 'review')}); ${plural(t.vetoes, 'veto', 'vetoes')}, ${t.accepted} accepted; ${plural(t.amendments, 'amendment')}; ${plural(t.disclosures, 'disclosed gap')}. Every number here is counted from the files linked below when the site is built.</p>`;
  const experiment = e => {
    const rounds = e.rounds.map(r => `<tr><th scope="row">${escape(r.name)}<br><span class="decision-meta">${day(r.date)}</span></th><td>${r.reviews.map(v => `<p><strong>${escape(v.side)} advocate</strong> <span class="decision-ai">AI model: ${escape(v.model)}</span> ${fileLink(v.file, up, 'read the review')}<br>${v.vetoes.length ? `${plural(v.vetoes.length, 'veto', 'vetoes')}: ${v.vetoes.map(said).join('; ')}` : 'no veto'}${v.accepts.length ? `. Accepted: ${v.accepts.map(escape).join('; ')}` : ''}</p>`).join('')}</td><td>${r.accepted} of ${r.vetoes} accepted. ${quote(r.outcome, up)}</td></tr>`).join('');
    const amendments = e.amendments.map(a => `<tr><th scope="row">Amendment ${escape(a.id)}<br><span class="decision-meta">${day(a.date)}</span></th><td><p><strong>${said(a.title)}</strong> ${fileLink(a.file, up, 'the record')}</p>${a.changes.length ? `<ul>${a.changes.map(c => `<li>${said(c)}</li>`).join('')}</ul>` : ''}</td><td>${said(a.why)}</td></tr>`).join('');
    const disclosures = e.disclosures.map(d => `<li>${quote(d, up)}</li>`).join('');
    return `<article class="decision-experiment" id="${escape(e.id.toLowerCase().replace(/\s+/g, '-'))}"><h3>${escape(e.id)}: ${escape(e.title)}</h3>
<p class="decision-freeze">Frozen ${day(e.frozenOn)}; the record is ${fileLink(e.record, up, 'published here')} (sha256 <code>${escape((e.pin ?? '').slice(0, 12))}…</code>)${e.published ? `, merged to main as <code>${escape(e.published.slice(0, 8))}</code> before any counted run` : ''}.${e.page ? ` <a href="${escape(up + e.page)}">The plain-words note</a>.` : ''}</p>
${e.history ? `<p class="decision-history">Earlier version: ${quote(e.history, up)}</p>` : ''}
<div class="table-scroll" role="region" aria-label="${escape(e.id)} rounds" tabindex="0"><table><caption>Rounds of review by AI model advocates, one for each store, each with the power to veto.</caption><thead><tr><th scope="col">Round</th><th scope="col">What each AI model advocate vetoed</th><th scope="col">What happened</th></tr></thead><tbody>${rounds}</tbody></table></div>
${amendments ? `<div class="table-scroll" role="region" aria-label="${escape(e.id)} amendments" tabindex="0"><table><caption>Amendments, each dated and published before the result it affects.</caption><thead><tr><th scope="col">Amendment</th><th scope="col">What it changed</th><th scope="col">Why</th></tr></thead><tbody>${amendments}</tbody></table></div>` : '<p>No amendment.</p>'}
${disclosures ? `<h4>Gaps we disclosed</h4><ul class="decision-disclosures">${disclosures}</ul>` : ''}</article>`;
  };
  const bench = ledger.bench.length ? `<article class="decision-experiment" id="brain-bench"><h3>Lab 02: every brain on the same tasks</h3><p>${escape(ledger.config.benchNote)}</p>
<div class="table-scroll" role="region" aria-label="Lab 02 pre-registrations" tabindex="0"><table><caption>Each pre-registration is cited by hash: its commit and sha256, from ${fileLink(BENCH_RESULTS, up, 'the published results record')}.</caption><thead><tr><th scope="col">Experiment</th><th scope="col">Pre-registration</th><th scope="col">Predictions</th></tr></thead><tbody>${ledger.bench.map(b => `<tr><th scope="row">${escape(b.id)}<br><span class="decision-meta">${day(b.date)}</span></th><td>${said(b.title)}<br>commit <code>${escape(b.commit)}</code>, sha256 <code>${escape(b.sha256.slice(0, 12))}…</code></td><td>${plural(b.predictions, 'prediction')}: ${Object.entries(b.tally).map(([v, n]) => `${n} ${escape(v)}`).join('; ')}. ${plural(b.caveats, 'caveat')} on <a href="${escape(up)}labs/brain-bench/">the lab page</a>.</td></tr>`).join('')}</tbody></table></div></article>` : '';
  return `${summary}${ledger.experiments.map(experiment).join('')}${bench}<p class="lab-ask-note">${escape(ledger.config.boundary)}</p>`;
}

/** The page's markers. */
export const decisionValues = ledger => ({
  '<!--DECISIONS_LEAD-->': escape(ledger.config.lead),
  '<!--DECISIONS_WHY-->': ledger.config.why.map(p => `<p>${escape(p)}</p>`).join(''),
  '<!--DECISIONS_LEDGER-->': renderDecisions(ledger),
});
