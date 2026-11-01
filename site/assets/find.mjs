// The /find/ page: search and filter everything the site publishes.
// No dependencies and no requests beyond ../data/index.json, read relative to the page. The pure functions
// (filter, paramsFromSearch, searchFromParams) carry the behaviour and are tested in scripts/find-page.test.mjs;
// the page wiring below only runs in a browser that has the find form. Without JavaScript, or when the index
// cannot be read, the build's static list stays as it is.

/** URL keys, in the order searchFromParams writes them. `q` and `date` hold one value; the rest hold several. */
export const KEYS = Object.freeze(['q', 'type', 'stage', 'outcome', 'topic', 'date']);
const MULTI = new Set(['type', 'stage', 'outcome', 'topic']);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const TYPE_LABELS = Object.freeze({ experiment: 'Experiment', lab: 'Lab', note: 'Field note', update: 'Update', tool: 'Tool' });
export const OUTCOME_LABELS = Object.freeze({ supported: 'Supported', refuted: 'Refuted', mixed: 'Mixed' });
/** Stage words as the rest of the site writes them; an unknown stage falls back to humanize(). */
export const STAGE_LABELS = Object.freeze({ 'pre-registered': 'Pre-registered', results: 'Results', amendment: 'Amendment', erratum: 'Erratum', recorded: 'Recorded', measured: 'Measured', running: 'Running', note: 'Field note', tool: 'Tool' });
const stageLabel = stage => STAGE_LABELS[stage] ?? humanize(stage);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Lower case, accents removed, runs of whitespace collapsed: "Résumé  Café" -> "resume cafe". */
export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A fresh, empty parameter set. */
export function emptyParams() {
  return { q: '', type: [], stage: [], outcome: [], topic: [], date: '' };
}

/** Coerces any object into a clean parameter set; unknown keys are dropped, duplicates and blanks removed. */
export function cleanParams(input = {}) {
  const params = emptyParams();
  for (const key of KEYS) {
    const value = input?.[key];
    if (MULTI.has(key)) {
      const list = (Array.isArray(value) ? value : value == null ? [] : [value])
        .flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean);
      params[key] = [...new Set(list)];
    } else if (key === 'date') {
      const month = String(value ?? '').trim();
      params.date = MONTH.test(month) ? month : '';
    } else {
      params.q = String(value ?? '').replace(/\s+/g, ' ').trim();
    }
  }
  return params;
}

/** Reads `?q=&type=&stage=&outcome=&topic=&date=`; repeated keys (or commas) give several values. */
export function paramsFromSearch(search = '') {
  const url = new URLSearchParams(String(search).replace(/^\?/, ''));
  const raw = {};
  for (const key of KEYS) {
    const values = url.getAll(key);
    if (values.length) raw[key] = MULTI.has(key) ? values : values[0];
  }
  return cleanParams(raw);
}

/** Writes a parameter set back as a query string ('' when nothing is set), keys in a fixed order. */
export function searchFromParams(params = {}) {
  const clean = cleanParams(params);
  const url = new URLSearchParams();
  for (const key of KEYS) {
    if (MULTI.has(key)) for (const value of clean[key]) url.append(key, value);
    else if (clean[key]) url.append(key, clean[key]);
  }
  const text = url.toString();
  return text ? `?${text}` : '';
}

/** True when no filter or query is set. */
export function isEmpty(params) {
  const clean = cleanParams(params);
  return !clean.q && !clean.date && ['type', 'stage', 'outcome', 'topic'].every(key => !clean[key].length);
}

/**
 * The items that match: every set facet must match (AND), any selected value within a facet may match (OR).
 * The query is split into words; each word must appear in the title, summary or topics, ignoring case and accents.
 * Input order is kept.
 */
export function filter(items, params = {}) {
  const clean = cleanParams(params);
  const words = normalize(clean.q).split(' ').filter(Boolean);
  const facet = (key, value) => !clean[key].length || clean[key].includes(value);
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (!facet('type', item.type) || !facet('stage', item.stage) || !facet('outcome', item.outcome)) return false;
    const topics = Array.isArray(item.topics) ? item.topics : [];
    if (clean.topic.length && !topics.some(topic => clean.topic.includes(topic))) return false;
    if (clean.date && !String(item.date ?? '').startsWith(clean.date)) return false;
    if (!words.length) return true;
    const haystack = normalize([item.title, item.summary, ...topics, ...topics.map(t => String(t).replace(/-/g, ' '))].join(' '));
    return words.every(word => haystack.includes(word));
  });
}

/** "2026-10" -> "October 2026". */
export function monthLabel(month) {
  const [year, number] = String(month).split('-');
  return `${MONTH_NAMES[Number(number) - 1] ?? ''} ${year}`.trim();
}

/** "pre-registered" -> "Pre registered"; used for stage and topic slugs. */
export function humanize(slug) {
  const text = String(slug ?? '').replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Only links to a page of this site are rendered. This is the SHAPE half of the rule the site index applies when it is
 * built (scripts/site-index.mjs hrefOnSite): relative to the site root, with no scheme, no leading slash or backslash, no
 * "." or ".." segment, no whitespace or quote, and a page part before any "#". The other half, that the page exists, is
 * checked at build time only (the browser has no page list); every href in index.json has passed it. Anything else is
 * refused, never repaired.
 */
export function safeHref(href) {
  const value = String(href ?? '');
  if (!value || /[\s"<>\\]/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || /(^|\/)\.\.?(\/|#|$)/.test(value)) return null;
  return value.split('#')[0] === '' ? null : value;
}

/**
 * The topic labels of an index read as {items, topics}: {id: label}, only string labels kept. An index that is a
 * bare array, or has no label map, gives {} (the page then shows each topic word with its first letter capitalised).
 */
export function topicLabels(index) {
  const map = index && !Array.isArray(index) && typeof index.topics === 'object' && index.topics ? index.topics : {};
  const labels = {};
  for (const [id, label] of Object.entries(map)) if (typeof label === 'string' && label.trim()) labels[id] = label.trim();
  return labels;
}

/** Distinct values of a field across items, sorted. */
export function facetValues(items, key) {
  const values = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const value = item?.[key];
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string' && v) values.add(v);
  }
  return [...values].sort();
}

// ---------------------------------------------------------------- browser wiring

function newestFirst(a, b) {
  return String(b.date ?? '').localeCompare(String(a.date ?? ''));
}

function element(doc, tag, attributes = {}, text) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkbox(doc, name, value, label) {
  const wrap = element(doc, 'label', { class: 'find-check' });
  const input = element(doc, 'input', { type: 'checkbox', name, value });
  wrap.append(input, element(doc, 'span', {}, label));
  return wrap;
}

function init(doc, win) {
  const form = doc.getElementById('find-form');
  const search = doc.getElementById('find-search');
  if (!form || !search) return;
  const results = doc.getElementById('find-results');
  const count = doc.getElementById('find-count');
  const staticList = doc.getElementById('find-static');
  const dateSelect = doc.getElementById('find-date');
  const filters = doc.getElementById('find-filters');

  doc.addEventListener('keydown', event => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
    event.preventDefault();
    search.focus();
  });

  win.fetch(new URL('../data/index.json', doc.baseURI), { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
    .then(response => { if (!response.ok) throw new Error(`index ${response.status}`); return response.json(); })
    .then(json => {
      const items = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null;
      if (!items) throw new Error('index has no item list');
      start(items.slice().sort(newestFirst), topicLabels(json));
    })
    .catch(() => { /* The static list stays visible; the search form stays hidden. */ });

  function start(items, labels) {
    const topicLabel = topic => labels[topic] ?? humanize(topic);
    for (const key of ['stage', 'topic']) {
      const box = doc.getElementById(`find-${key}-options`);
      const values = facetValues(items, key === 'topic' ? 'topics' : key);
      for (const value of values) box?.append(checkbox(doc, key, value, key === 'topic' ? topicLabel(value) : stageLabel(value)));
      if (!values.length) box?.closest('fieldset')?.setAttribute('hidden', '');
    }
    const months = [...new Set(items.map(item => String(item.date ?? '').slice(0, 7)).filter(m => MONTH.test(m)))].sort().reverse();
    for (const month of months) dateSelect.append(element(doc, 'option', { value: month }, monthLabel(month)));

    let params = paramsFromSearch(win.location.search);
    write(params);
    if (params.date || ['type', 'stage', 'outcome', 'topic'].some(key => params[key].length)) filters?.setAttribute('open', '');

    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('input', () => update(read()));
    form.addEventListener('change', () => update(read()));
    doc.getElementById('find-clear')?.addEventListener('click', () => {
      write(emptyParams());
      update(emptyParams());
      search.focus();
    });
    results.addEventListener('click', event => {
      const chip = event.target?.closest?.('button[data-topic]');
      if (!chip) return;
      const next = { ...read(), topic: [chip.dataset.topic] };
      write(next);
      filters?.setAttribute('open', '');
      update(next);
      count.focus();
    });

    form.hidden = false;
    staticList.hidden = true;
    results.hidden = false;
    render(params);

    function read() {
      const data = new FormData(form);
      return cleanParams({ q: data.get('q'), type: data.getAll('type'), stage: data.getAll('stage'),
        outcome: data.getAll('outcome'), topic: data.getAll('topic'), date: data.get('date') });
    }

    function write(next) {
      const clean = cleanParams(next);
      search.value = clean.q;
      for (const input of form.querySelectorAll('input[type=checkbox]')) input.checked = clean[input.name]?.includes(input.value) ?? false;
      dateSelect.value = months.includes(clean.date) ? clean.date : '';
    }

    function update(next) {
      params = next;
      if (typeof win.history?.replaceState === 'function') {
        win.history.replaceState(null, '', `${win.location.pathname}${searchFromParams(next)}${win.location.hash}`);
      }
      render(next);
    }

    function render(current) {
      const found = filter(items, current);
      const rows = found.map(item => row(item));
      results.replaceChildren(...rows);
      const total = items.length;
      count.textContent = found.length === total && isEmpty(current)
        ? `Showing all ${total} ${total === 1 ? 'entry' : 'entries'}.`
        : found.length
          ? `${found.length} of ${total} ${total === 1 ? 'entry' : 'entries'} match.`
          : 'Nothing matches. Remove a filter or clear them all.';
    }

    function row(item) {
      const li = element(doc, 'li', { class: 'find-result' });
      const meta = element(doc, 'p', { class: 'find-meta' });
      meta.append(element(doc, 'span', { class: 'find-badge', 'data-type': String(item.type ?? '') }, TYPE_LABELS[item.type] ?? humanize(item.type)));
      if (item.date) meta.append(element(doc, 'time', { datetime: String(item.date) }, String(item.date).slice(0, 10)));
      if (item.stage) meta.append(element(doc, 'span', {}, stageLabel(item.stage)));
      if (OUTCOME_LABELS[item.outcome]) meta.append(element(doc, 'span', { class: 'find-outcome' }, OUTCOME_LABELS[item.outcome]));
      const heading = element(doc, 'h3');
      const href = safeHref(item.href);
      if (href) heading.append(element(doc, 'a', { href: `../${href}` }, String(item.title ?? '')));
      else heading.textContent = String(item.title ?? '');
      li.append(heading, meta);
      if (item.summary) li.append(element(doc, 'p', { class: 'find-summary' }, String(item.summary)));
      const topics = Array.isArray(item.topics) ? item.topics.filter(t => typeof t === 'string' && t) : [];
      if (topics.length) {
        const list = element(doc, 'ul', { class: 'find-chips', 'aria-label': 'Topics' });
        for (const topic of topics) {
          const li2 = element(doc, 'li');
          li2.append(element(doc, 'button', { type: 'button', class: 'find-chip', 'data-topic': topic,
            'aria-label': `Show only ${topicLabel(topic).toLowerCase()}` }, topicLabel(topic)));
          list.append(li2);
        }
        li.append(list);
      }
      return li;
    }
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof document.createElement === 'function') {
  init(document, window);
}
