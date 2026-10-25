// Lab 02, every brain on the same tasks (mission rnd-labs-human-first-1024). scripts/labs.mjs calls renderBench()
// and writes, into dist/ only (nothing rendered is committed):
//   labs/brain-bench/index.html   the lab page, from site/labs/brain-bench/index.html (<!--BENCH_*--> markers)
// The words come from site/data/labs/brain-bench.json, the numbers from
// site/data/labs/brain-bench/results.json (odin-brain-bench v1, written by scripts/brain-bench-import.mjs). The build
// reads the record again and refuses it, as the import does, when a string fails the screen, when a figure has no
// source, when its interval is not the Wilson interval of its counts, or when its prose differs from the words file.
// Prose never states a number: it names one with a placeholder, {EXP-W01:tuned-1gb:of}, resolved here from the record,
// so every number on the page is one the record holds with its source.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { benchScreen, benchScreenTree, wilson } from './brain-bench-import.mjs';

export const NOTES = 'data/labs/brain-bench.json';
export const RESULTS = 'data/labs/brain-bench/results.json';
// The record's sha256, pinned in a one-line text file: a change to the record shows up as a change to this line too.
export const PIN = 'data/labs/brain-bench/results.sha256';
export const TEMPLATE = 'labs/brain-bench/index.html';
const PROSE = ['title', 'question', 'date', 'prereg', 'predictions', 'unpredicted', 'caveats', 'comparators'];

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const date = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const pct = v => `${(v * 100).toFixed(1)} %`;
const interval = ci => `${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)} %`;
const of = f => `${f.successes} / ${f.n}`;
const thousands = v => v.toLocaleString('en-GB');

/** Every way a figure (an object with n and successes) lacks its source or does not add up. */
function figureProblems(figure, at, commit) {
  const problems = [];
  const s = figure.source;
  if (!s || s.commit !== commit || typeof s.file !== 'string' || !s.file || !/^EXP-W\d{2}$/.test(s.experiment ?? '')) problems.push(`${at}: no source (experiment, file and the private commit)`);
  else if (!(Array.isArray(s.lines) && s.lines.length && s.lines.every(r => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && r[0] <= r[1])) && typeof s.pointer !== 'string') problems.push(`${at}: the source names no rows`);
  else if (Array.isArray(s.lines)) {
    // A sensitivity figure is its brain's rows with some re-run: its source holds the re-run rows and the rows they replace.
    const count = lines => (lines ?? []).reduce((t, [a, b]) => t + b - a + 1, 0);
    const want = s.replaces ? figure.rerun : figure.n;
    if (count(s.lines) !== want || (s.replaces && count(s.replaces.lines) !== want)) problems.push(`${at}: its rows are not its ${want} episodes`);
  }
  if (!Number.isInteger(figure.n) || figure.n <= 0 || !Number.isInteger(figure.successes) || figure.successes < 0 || figure.successes > figure.n) problems.push(`${at}: not a count`);
  else if (String(wilson(figure.successes, figure.n)) !== String(figure.ci)) problems.push(`${at}: the interval is not the Wilson 95 % interval of ${figure.successes} / ${figure.n}`);
  return problems;
}

/** Every figure in the record, with where it is: brain rows, their breakdowns and sensitivity checks. */
export function figures(record) {
  const out = [];
  for (const exp of record.experiments) for (const brain of exp.brains) {
    out.push([`${exp.id}/${brain.id}`, brain]);
    for (const [kind, cells] of Object.entries(brain.breakdown ?? {})) for (const [id, cell] of Object.entries(cells)) out.push([`${exp.id}/${brain.id}/${kind}.${id}`, cell]);
    if (brain.sensitivity) out.push([`${exp.id}/${brain.id}/sensitivity`, brain.sensitivity]);
  }
  return out;
}

/** The lab's words and its record, checked; throws with every reason. */
export function readBench(root = 'site') {
  const notes = JSON.parse(readFileSync(join(root, NOTES), 'utf8'));
  const raw = readFileSync(join(root, RESULTS));
  const record = JSON.parse(raw);
  const problems = [];
  const pin = existsSync(join(root, PIN)) ? readFileSync(join(root, PIN), 'utf8') : '';
  if (pin !== `${createHash('sha256').update(raw).digest('hex')}  results.json\n`) problems.push(`${PIN}: does not pin the sha256 of ${RESULTS} (run the import again)`);
  if (notes.format !== 'odin-lab-bench' || notes.version !== 1 || notes.slug !== 'brain-bench') problems.push(`${NOTES}: not odin-lab-bench v1 for brain-bench`);
  if (record.format !== 'odin-brain-bench' || record.version !== 1) problems.push(`${RESULTS}: not odin-brain-bench v1`);
  const commit = record.source?.commit;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) problems.push(`${RESULTS}#/source/commit: not a full commit`);
  problems.push(...benchScreenTree(notes).map(p => `${NOTES}#${p}`), ...benchScreenTree(record).map(p => `${RESULTS}#${p}`));
  for (const [at, figure] of figures(record)) problems.push(...figureProblems(figure, `${RESULTS} ${at}`, commit));
  for (const exp of record.experiments ?? []) {
    const words = notes.experiments.find(e => e.id === exp.id);
    if (!words) { problems.push(`${RESULTS} ${exp.id}: no words for it in ${NOTES}`); continue; }
    for (const key of PROSE) {
      const want = key === 'prereg' ? words.prereg.commit : JSON.stringify(words[key] ?? []);
      const have = key === 'prereg' ? exp.prereg?.commit : JSON.stringify(exp[key] ?? []);
      if (want !== have && !(key === 'comparators' && !words[key] && !exp[key]?.length)) problems.push(`${RESULTS} ${exp.id}/${key}: differs from ${NOTES} (run the import again)`);
    }
    if (exp.prereg?.sha256 !== words.prereg.sha256) problems.push(`${RESULTS} ${exp.id}/prereg: the pre-registration hash differs from ${NOTES}`);
    for (const brain of exp.brains) if (!notes.brains[brain.id]) problems.push(`${RESULTS} ${exp.id}/${brain.id}: no label in ${NOTES}`);
    // This site publishes no money figures: the record carries none, and the rendered page is screened for them below.
    if ('runSpendUsd' in exp || exp.brains.some(b => ['costPerTaskUsd', 'totalCostUsd', 'listPriceEstimateUsd'].some(k => k in b))) problems.push(`${RESULTS} ${exp.id}: a money figure in the record`);
    for (const brain of exp.brains) {
      // With a telemetry pack, every figure it covers keeps its pack row; the sensitivity check is never the registered result.
      if (record.source.pack && !brain.source?.pack?.pointer) problems.push(`${RESULTS} ${exp.id}/${brain.id}: no pack row`);
      if (brain.sensitivity && (brain.sensitivity.registered !== false || (record.source.pack && !brain.sensitivity.source?.pack))) problems.push(`${RESULTS} ${exp.id}/${brain.id}/sensitivity: must be marked not registered, with its pack row`);
    }
  }
  if (problems.length) throw new Error(`Lab 02 refused:\n  ${problems.join('\n  ')}`);
  // Every placeholder in every piece of prose must resolve.
  const page = { notes, record };
  for (const text of prose(notes)) resolve(text, page);
  return page;
}

/** Every prose string a placeholder may sit in. */
export function prose(notes) {
  return [...notes.findings.flatMap(f => [f.head, f.text]), ...notes.experiments.flatMap(e => [e.question, ...e.predictions.flatMap(p => [p.text, p.detail]), ...(e.unpredicted ?? []), ...e.caveats])];
}

const BREAKDOWN = /^(task|world|kind)\.([a-z0-9-]+)$/;
/** One placeholder's value as text: {EXP-W01:tuned-1gb:of}; {EXP-W02::episodes} for the whole experiment. */
export function value(token, { record }) {
  const [expId, brainId, field] = token.split(':');
  const exp = record.experiments.find(e => e.id === expId);
  if (!exp) throw new Error(`{${token}}: no experiment ${expId}`);
  if (!brainId) {
    if (field === 'episodes') return thousands(exp.design.episodes);
    throw new Error(`{${token}}: no such experiment field`);
  }
  const brain = exp.brains.find(b => b.id === brainId);
  if (!brain) throw new Error(`{${token}}: no brain ${brainId} in ${expId}`);
  const s = brain.sensitivity;
  const fields = {
    of: () => of(brain), n: () => String(brain.n), successes: () => String(brain.successes), rate: () => pct(brain.rate), ci: () => interval(brain.ci),
    fallbacks: () => thousands(brain.fallbacks),
    sensitivity: () => s && of(s), sensitivityCi: () => s && interval(s.ci), rerun: () => s && String(s.rerun), rerunWon: () => s && String(s.rerunWon),
    errorSeeds: () => s && `${s.seeds.from}–${s.seeds.to}`,
  };
  const cell = BREAKDOWN.exec(field ?? '');
  const out = cell ? brain.breakdown?.[cell[1]]?.[cell[2]] && of(brain.breakdown[cell[1]][cell[2]]) : fields[field]?.();
  if (out == null) throw new Error(`{${token}}: no such field for ${expId}/${brainId}`);
  return out;
}

/** Prose with its placeholders resolved, HTML-escaped. */
export const resolve = (text, page) => escape(text).replace(/\{([A-Z0-9-]+:[a-z0-9.-]*:[A-Za-z0-9.-]+)\}/g, (_, token) => escape(value(token, page)));

// The chart: one row per brain, a dot at its rate and a whisker across its 95 % interval, on a 0–100 % axis.
const SHAPE = {
  local: (x, y) => `<circle cx="${x}" cy="${y}" r="6"/>`,
  cloud: (x, y) => `<path d="M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z"/>`,
  rules: (x, y) => `<rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" rx="1"/>`,
};
// Each row is a label beside its own SVG strip, positioned in percent, so the labels wrap as HTML on a phone and the
// strip keeps its marks round at any width.
export function chart(rows, { id, caption }) {
  // The axis starts at the tenth below the lowest interval, so results near the top are not squeezed together; no bar
  // is drawn from it, and the caption says where it starts.
  const from = Math.floor(Math.min(...rows.map(r => r.ci[0])) * 10) / 10, step = 1 - from > 0.5 ? 0.2 : 0.1;
  const x = v => `${(2 + (v - from) / (1 - from) * 96).toFixed(2)}%`;
  const ticks = Array.from({ length: Math.round((1 - from) / step) + 1 }, (_, i) => Math.round((from + i * step) * 100));
  const grid = ticks.map(t => `<line class="bench-grid" x1="${x(t / 100)}" x2="${x(t / 100)}" y1="0" y2="100%"/>`).join('');
  const axis = `<div class="bench-chart-row bench-axis" aria-hidden="true"><span></span><svg class="bench-strip" height="22">${ticks.map(t => `<text class="bench-tick" x="${x(t / 100)}" y="15" text-anchor="middle">${t} %</text>`).join('')}</svg></div>`;
  const body = rows.map(r => `<div class="bench-chart-row"><span class="bench-name">${escape(r.label)}${r.tag ? ` <span class="bench-tag">${escape(r.tag)}</span>` : ''}</span><svg class="bench-strip" height="34"><g class="bench-row bench-${r.where}"><title>${escape(`${r.label}${r.tag ? ` (${r.tag})` : ''}: ${of(r)} finished, ${pct(r.rate)}, 95 % interval ${interval(r.ci)}`)}</title><rect class="bench-hit" x="0" y="0" width="100%" height="100%"/>${grid}<line class="bench-whisker" x1="${x(r.ci[0])}" x2="${x(r.ci[1])}" y1="50%" y2="50%"/><line class="bench-whisker" x1="${x(r.ci[0])}" x2="${x(r.ci[0])}" y1="35%" y2="65%"/><line class="bench-whisker" x1="${x(r.ci[1])}" x2="${x(r.ci[1])}" y1="35%" y2="65%"/><svg x="${x(r.rate)}" y="50%" overflow="visible"><g class="bench-mark">${SHAPE[r.where](0, 0)}</g></svg></g></svg></div>`).join('');
  return `<figure class="bench-chart"><div role="img" aria-labelledby="${id}-caption">${axis}${body}</div><figcaption id="${id}-caption">${escape(caption)} The dot is the share of tasks finished; the line is its 95 % interval. Two brains differ only where their lines do not overlap. The axis starts at ${ticks[0]} %. The table below holds the same numbers.</figcaption></figure>`;
}

const legend = labels => `<ul class="bench-legend" aria-label="Key">${['local', 'cloud', 'rules'].map(w => `<li class="bench-${w}"><svg viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true"><g class="bench-mark">${SHAPE[w](0, 0)}</g></svg>${escape(labels.where[w])}</li>`).join('')}</ul>`;

function table(rows, notes, { withExperiment }) {
  const L = notes.labels;
  const head = `<tr>${withExperiment ? '<th scope="col">Experiment</th>' : ''}<th scope="col">Brain</th><th scope="col">Where</th><th scope="col">Finished</th><th scope="col">Rate</th><th scope="col">95 % interval</th><th scope="col">Fallbacks</th><th scope="col">Model time per task</th></tr>`;
  const body = rows.map(r => `<tr class="bench-${r.where}">${withExperiment ? `<td>${escape(r.experiment)}</td>` : ''}<th scope="row">${escape(r.label)}<span class="bench-model">${escape(notes.brains[r.id].model)}</span></th><td>${escape(L.where[r.where])}</td><td>${of(r)}</td><td>${pct(r.rate)}</td><td>${interval(r.ci)}</td><td>${thousands(r.fallbacks)}</td><td>${r.modelMsPerTask ? `${(r.modelMsPerTask / 1000).toFixed(1)} s` : '—'}</td></tr>`).join('');
  return `<div class="bench-table-scroll" tabindex="0"><table class="bench-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function breakdown(rows, kind, notes, caption) {
  const ids = [...new Set(rows.flatMap(r => Object.keys(r.breakdown?.[kind] ?? {})))].sort((a, b) => (a === 'follow') - (b === 'follow') || a.localeCompare(b));
  if (!ids.length) return '';
  const names = notes.labels[`${kind}s`];
  const head = `<tr><th scope="col">Brain</th>${ids.map(id => `<th scope="col">${escape(names[id])}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr><th scope="row">${escape(r.label)}${r.tag ? ` <span class="bench-tag">${escape(r.tag)}</span>` : ''}</th>${ids.map(id => { const c = r.breakdown?.[kind]?.[id]; return `<td>${c ? of(c) : '—'}</td>`; }).join('')}</tr>`).join('');
  return `<div class="bench-table-scroll" tabindex="0"><table class="bench-table bench-breakdown"><caption>${escape(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

const VERDICT_CLASS = { holds: 'holds', fails: 'fails' };
function experimentNotes(exp, page) {
  const r = text => resolve(text, page);
  return `<div class="bench-exp" id="${escape(exp.id.toLowerCase())}"><h3><span class="technical">${escape(exp.id)} · ${escape(date(exp.date))}</span>${escape(exp.title)}</h3><p class="bench-exp-question">${r(exp.question)}</p>`
    + `<p class="bench-exp-design">${exp.design.tasks === 1 ? 'One task' : `${exp.design.tasks} task families`} · ${exp.design.worlds} worlds · seeds ${exp.design.seeds.from}–${exp.design.seeds.to} · ${exp.design.episodesPerBrain} episodes per brain · harness ${escape(exp.design.harness.join(', '))}</p>`
    + `<h4>What we predicted, and what happened</h4><ol class="bench-predictions">${exp.predictions.map(p => `<li><span class="bench-verdict bench-verdict-${VERDICT_CLASS[p.verdict] ?? 'other'}">${escape(p.verdict)}</span><p><strong>${escape(p.id)}.</strong> ${r(p.text)}</p><p>${r(p.detail)}</p></li>`).join('')}</ol>`
    + (exp.unpredicted.length ? `<h4>Not predicted, but clear</h4><ul class="bench-list">${exp.unpredicted.map(t => `<li>${r(t)}</li>`).join('')}</ul>` : '')
    + `<h4>Caveats</h4><ul class="bench-list bench-caveats">${exp.caveats.map(t => `<li>${r(t)}</li>`).join('')}</ul>`
    + `<p class="bench-source technical">PRE-REGISTERED AT ${escape(exp.prereg.commit)} · PRE-REGISTRATION SHA-256 ${escape(exp.prereg.sha256.slice(0, 16))}… · COUNTED FROM ${thousands(exp.design.episodes)} RESULT ROWS AT ${escape(page.record.source.commit.slice(0, 12))}</p></div>`;
}

const rowsOf = (exp, page, tag) => exp.brains.map(b => ({ ...b, label: page.notes.brains[b.id].label, experiment: exp.id, tag }));

/** The experiments, in three sections: the whole task set (EXP-W01 with EXP-W02), then the instruction task under h4 and under h5. */
export function renderExperiments(page) {
  const exp = id => page.record.experiments.find(e => e.id === id);
  const sections = [];
  const w01 = exp('EXP-W01'), w02 = exp('EXP-W02');
  if (w01 && w02) {
    const rows = [...rowsOf(w01, page, 'EXP-W01'), ...rowsOf(w02, page, 'EXP-W02')].sort((a, b) => b.successes - a.successes || a.label.localeCompare(b.label));
    sections.push(['task-set', 'The whole task set: local and cloud on the same seeds.', 'EXP-W01 measured the local brains and EXP-W02 the cloud ones, on the same seeds, worlds, tasks, harness and brain version, so they share one chart.', rows, true, [w01, w02], 'task', 'Finished per task family, out of the episodes each family got.']);
  }
  for (const [id, key, head, text] of [['EXP-W03', 'instructions-h4', 'Following a person\'s instruction, with more episodes.', 'Only the instruction task, on five times as many seeds, on the bench as it was (harness h4).'],
    ['EXP-W04', 'instructions-h5', 'The same question after the bench fix.', 'The instruction task on new seeds, after the shop-price fix (harness h5). These rows are never compared with the ones above as one measurement, so they get their own chart.']]) {
    const e = exp(id);
    if (e) sections.push([key, head, text, rowsOf(e, page), false, [e], 'world', 'Finished per world, out of the episodes each world got.']);
  }
  return sections.map(([key, head, text, rows, withExperiment, exps, kind, caption]) => {
    const kinds = rows.some(r => r.breakdown?.kind) ? breakdown(rows, 'kind', page.notes, 'Finished per kind of instruction.') : '';
    return `<section class="company-section company-width bench-section" id="${key}" aria-labelledby="${key}-title"><div class="company-section-heading"><h2 id="${key}-title">${escape(head)}</h2><p>${escape(text)}</p></div>${legend(page.notes.labels)}${chart(rows, { id: key, caption: `Share of tasks finished, per brain, ${exps.map(e => e.id).join(' and ')}.` })}${table(rows, page.notes, { withExperiment })}${breakdown(rows, kind, page.notes, caption)}${kinds}${exps.map(e => experimentNotes(e, page)).join('')}</section>`;
  }).join('\n    ');
}

export function renderIntro({ notes }) {
  return `<span class="technical">${escape(notes.label.toUpperCase())} · ${escape(notes.title.toUpperCase())}</span><h1 id="lab-title">${escape(notes.title)}.</h1><p class="company-lead"><strong>${escape(notes.question)}</strong> ${escape(notes.oneLine)}</p><div class="company-actions"><a class="button button-primary" href="#findings">What we found</a><a href="../../${RESULTS}">The results as JSON</a></div>`;
}

export const renderAbout = ({ notes }) => `${notes.whatItIs.map(line => `<p>${escape(line)}</p>`).join('')}<p class="lab-boundary">${escape(notes.boundary)}</p>`;
export const renderFindings = page => `<ol class="bench-findings">${page.notes.findings.map(f => `<li><h3>${resolve(f.head, page)}</h3><p>${resolve(f.text, page)}</p></li>`).join('')}</ol>`;
export const renderMethod = ({ notes, record }) => `<ul class="bench-method">${notes.howItWasRun.map(line => { const [head, ...rest] = line.split('. '); return `<li><strong>${escape(head)}.</strong> ${escape(rest.join('. '))}</li>`; }).join('')}</ul><p class="bench-source-note">${escape(notes.sourceAbout)} Commit <code>${escape(record.source.commit)}</code>. <a href="../../${RESULTS}">Read the full record</a>, with the rows each figure was counted from.</p>`;

/**
 * The rendered page's visible text, screened as the publisher screens a dispatch (scripts/lab-dispatch-publish.mjs
 * screenHits, plus this lab's world names): no price or currency amount, no
 * restricted name, place or name from the private test game, anywhere a reader can see. Each text node is screened
 * on its own, with the run of text it sits in.
 */
export function pageTextProblems(html) {
  const text = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n')
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
  return text.split('\n').map(t => t.trim()).filter(Boolean).flatMap(t => benchScreen(t).map(reason => `${reason}: ${JSON.stringify(t.slice(0, 100))}`));
}

/** The rendered lab page, keyed by its dist/ path. */
export function renderBench(root = 'site') {
  const page = readBench(root);
  let html = readFileSync(join(root, TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--BENCH_INTRO-->': renderIntro(page), '<!--BENCH_ABOUT-->': renderAbout(page), '<!--BENCH_FINDINGS-->': renderFindings(page), '<!--BENCH_EXPERIMENTS-->': renderExperiments(page), '<!--BENCH_METHOD-->': renderMethod(page) })) {
    if (!html.includes(marker)) throw new Error(`${TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${TEMPLATE}: unresolved content marker`);
  const money = pageTextProblems(html);
  if (money.length) throw new Error(`${TEMPLATE}: the rendered page fails the screen:\n  ${money.join('\n  ')}`);
  return { pages: { 'labs/brain-bench/index.html': html } };
}
