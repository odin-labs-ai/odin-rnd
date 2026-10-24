#!/usr/bin/env node
// The weekly broker probe (vp-grow-odin-r-d bundle-2 WO-04): a small, recurring measurement of each keyed broker.
//
//   node scripts/broker-probe.mjs probe --week 2026-W43 --out site/data/broker-probe/2026-W43.json
//       For each broker whose key is in the environment (BROKER_PROBE_OPENROUTER_KEY, BROKER_PROBE_EUROUTER_KEY,
//       BROKER_PROBE_REQUESTY_KEY), 20 identical tiny calls to each of 2 fixed models, and one /models catalogue
//       fetch. A broker without a key is recorded as "not keyed", never skipped silently. Per call: HTTP status,
//       latency, served model and whether it is the requested one, the cost the broker reports. The catalogue is
//       compared with the last committed snapshot (site/data/broker-probe/catalogue/<broker>.json, rewritten here):
//       models added or removed and list-price changes. Keys are never written anywhere.
//   node scripts/broker-probe.mjs page [--write]
//       Render site/probe/index.html from site/data/broker-probe/*.json; --write rewrites it, otherwise exit 1 when the
//       committed page differs (the test runs this). A broker is named on the page only when
//       site/data/provider-terms.json allows naming it next to a measured number; otherwise it is Broker A, B or C.
//
// Runs in GitHub Actions on a GitHub-hosted runner (.github/workflows/broker-probe.yml), never on a laptop.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../experiments/broker-same-model/lib.mjs';
import { refusal } from './provider-terms.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'site/data/broker-probe');
export const PAGE = join(ROOT, 'site/probe/index.html');

export const PROBE = {
  callsPerModel: 20,
  prompt: 'Reply with the single word: pong',
  maxTokens: 16,
  timeoutMs: 60000,
  brokers: {
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'BROKER_PROBE_OPENROUTER_KEY' },
    eurouter: { baseUrl: 'https://api.eurouter.ai/api/v1', keyEnv: 'BROKER_PROBE_EUROUTER_KEY' },
    requesty: { baseUrl: 'https://router.requesty.ai/v1', keyEnv: 'BROKER_PROBE_REQUESTY_KEY' },
  },
  models: {
    'claude-haiku-4-5': { openrouter: 'anthropic/claude-haiku-4.5', eurouter: 'claude-haiku-4.5', requesty: 'anthropic/claude-haiku-4-5' },
    'gpt-4o-mini': { openrouter: 'openai/gpt-4o-mini', eurouter: 'gpt-4o-mini', requesty: 'openai/gpt-4o-mini' },
  },
};

const round = (x, d = 6) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const perM = v => { const n = Number(v); return Number.isFinite(n) ? round(n * 1e6, 4) : null; };

/** A broker catalogue reduced to { id: { in, out, currency } } with $ (or the broker's currency) per million tokens. */
export function normaliseCatalogue(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const out = {};
  for (const m of list) {
    if (!m || typeof m.id !== 'string') continue;
    if (m.pricing && typeof m.pricing === 'object' && !Array.isArray(m.pricing)) out[m.id] = { in: perM(m.pricing.prompt), out: perM(m.pricing.completion), currency: m.pricing.currency || 'USD' };
    else out[m.id] = { in: perM(m.input_price), out: perM(m.output_price), currency: 'USD' };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Added, removed and re-priced ids between two normalised catalogues; null when there is no earlier snapshot. */
export function catalogueDiff(before, after) {
  if (!before) return null;
  const added = Object.keys(after).filter(id => !(id in before));
  const removed = Object.keys(before).filter(id => !(id in after));
  const repriced = Object.keys(after).filter(id => id in before && (before[id].in !== after[id].in || before[id].out !== after[id].out))
    .map(id => ({ id, before: before[id], after: after[id] }));
  return { added, removed, repriced };
}

export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** Aggregates of one broker's calls for one model. */
export function summarise(calls) {
  const ok = calls.filter(c => c.ok);
  const lat = ok.map(c => c.latencyMs).filter(Number.isFinite);
  const costs = ok.map(c => c.costUsd).filter(Number.isFinite);
  return {
    attempted: calls.length,
    ok: ok.length,
    status5xx: calls.filter(c => c.status >= 500).length,
    otherErrors: calls.filter(c => !c.ok && !(c.status >= 500)).length,
    servedMismatch: ok.filter(c => c.servedMatches === false).length,
    servedModels: [...new Set(ok.map(c => c.servedModel).filter(Boolean))].sort(),
    latencyMsP50: quantile(lat, 0.5),
    latencyMsP95: quantile(lat, 0.95),
    costUsdTotal: round(costs.reduce((a, b) => a + b, 0), 8),
    costReported: costs.length,
  };
}

async function call(broker, modelKey, key, fetchImpl) {
  const spec = PROBE.brokers[broker];
  const body = { model: PROBE.models[modelKey][broker], messages: [{ role: 'user', content: PROBE.prompt }], max_tokens: PROBE.maxTokens, temperature: 0 };
  const t0 = performance.now();
  try {
    const res = await fetchImpl(`${spec.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(PROBE.timeoutMs) });
    const text = await res.text();
    let d = null; try { d = JSON.parse(text); } catch { /* not JSON */ }
    const content = d?.choices?.[0]?.message?.content;
    const served = typeof d?.model === 'string' ? d.model : null;
    const cost = typeof d?.usage?.cost === 'number' && (d.usage.cost_currency == null || String(d.usage.cost_currency).toUpperCase() === 'USD') ? d.usage.cost : null;
    return { status: res.status, ok: res.status === 200 && typeof content === 'string', latencyMs: Math.round(performance.now() - t0), servedModel: served, servedMatches: served ? family(served) === modelKey : null, costUsd: cost };
  } catch (e) {
    return { status: null, ok: false, latencyMs: Math.round(performance.now() - t0), error: e.name, servedModel: null, servedMatches: null, costUsd: null };
  }
}

/** Run the probe. `env` holds the keys, `fetchImpl` is injectable for the test. Returns the week's record. */
export async function probe({ week, env = process.env, fetchImpl = fetch, dataDir = DATA, terms = readTerms(), now = () => new Date().toISOString() }) {
  const record = { schemaVersion: 1, kind: 'odin-rnd.broker-probe', week, startedAt: now(), probe: { callsPerModel: PROBE.callsPerModel, prompt: PROBE.prompt, maxTokens: PROBE.maxTokens, models: Object.keys(PROBE.models) }, brokers: {} };
  for (const broker of Object.keys(PROBE.brokers)) {
    const key = env[PROBE.brokers[broker].keyEnv];
    // A broker whose terms do not (yet) allow a published measurement under its name is not probed at all: nothing is
    // measured that could not be published (site/data/provider-terms.json, scripts/provider-terms.mjs refusal()).
    const held = refusal(terms?.providers?.[broker]);
    if (held) { record.brokers[broker] = { keyed: Boolean(key), held }; continue; }
    if (!key) { record.brokers[broker] = { keyed: false }; continue; }
    const entry = { keyed: true, models: {} };
    for (const modelKey of Object.keys(PROBE.models)) {
      const calls = [];
      for (let i = 0; i < PROBE.callsPerModel; i++) calls.push(await call(broker, modelKey, key, fetchImpl));
      entry.models[modelKey] = summarise(calls);
    }
    try {
      const res = await fetchImpl(`${PROBE.brokers[broker].baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(PROBE.timeoutMs) });
      const cat = normaliseCatalogue(JSON.parse(await res.text()));
      const snapPath = join(dataDir, 'catalogue', `${broker}.json`);
      const before = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')).models : null;
      const diff = catalogueDiff(before, cat);
      entry.catalogue = { status: res.status, models: Object.keys(cat).length, sha256: createHash('sha256').update(JSON.stringify(cat)).digest('hex'), diff: diff && { added: diff.added.length, removed: diff.removed.length, repriced: diff.repriced.length, addedIds: diff.added.slice(0, 50), removedIds: diff.removed.slice(0, 50), repricedIds: diff.repriced.slice(0, 50).map(r => r.id) } };
      entry.catalogue.probeModelPrices = Object.fromEntries(Object.keys(PROBE.models).map(m => [m, cat[PROBE.models[m][broker]] ?? null]));
      if (Object.keys(cat).length) { mkdirSync(dirname(snapPath), { recursive: true }); writeFileSync(snapPath, JSON.stringify({ broker, week, models: cat }, null, 1) + '\n'); }
    } catch (e) {
      entry.catalogue = { status: null, error: e.name };
    }
    record.brokers[broker] = entry;
  }
  // Catalogue disagreement: for each probe model, do the keyed brokers list the same price (in USD)?
  record.catalogueAgreement = Object.fromEntries(Object.keys(PROBE.models).map(m => {
    const prices = Object.entries(record.brokers).filter(([, e]) => e.keyed && e.catalogue?.probeModelPrices?.[m]).map(([b, e]) => [b, e.catalogue.probeModelPrices[m]]);
    const usd = prices.filter(([, p]) => p.currency === 'USD');
    const same = usd.length > 1 && usd.every(([, p]) => p.in === usd[0][1].in && p.out === usd[0][1].out);
    return [m, { listed: prices.length, usdListed: usd.length, agree: usd.length > 1 ? same : null }];
  }));
  record.endedAt = now();
  return record;
}

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Display names: a broker is named only when the terms record allows naming it next to a measured number. */
export function displayNames(brokers, terms) {
  const letters = 'ABCDEFGH';
  const names = {};
  let i = 0;
  for (const b of brokers) {
    const t = terms?.providers?.[b];
    names[b] = t && refusal(t) === null && t.name ? t.name : `Broker ${letters[i]}`;
    i++;
  }
  return names;
}

export function weeks(dataDir = DATA) {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir).filter(f => /^\d{4}-W\d{2}\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
}

export function renderPage(records, terms) {
  const brokers = Object.keys(PROBE.brokers);
  const names = displayNames(brokers, terms);
  const cell = v => (v === null || v === undefined ? '—' : escape(v));
  const rows = records.slice().reverse().map(r => brokers.map(b => {
    const e = r.brokers[b];
    if (e?.held) return `<tr><td>${escape(r.week)}</td><td>${escape(names[b])}</td><td colspan="6">not probed: its terms are under review before any measurement is published</td></tr>`;
    if (!e || !e.keyed) return `<tr><td>${escape(r.week)}</td><td>${escape(names[b])}</td><td colspan="6">not keyed this week</td></tr>`;
    return Object.entries(e.models).map(([m, s]) => `<tr><td>${escape(r.week)}</td><td>${escape(names[b])}</td><td>${escape(m)}</td><td>${s.ok}/${s.attempted}</td><td>${s.status5xx}</td><td>${s.servedMismatch}</td><td>${cell(s.latencyMsP50)} / ${cell(s.latencyMsP95)}</td><td>${e.catalogue?.diff ? `+${e.catalogue.diff.added} −${e.catalogue.diff.removed} ~${e.catalogue.diff.repriced}` : 'first snapshot'}</td></tr>`).join('');
  }).join('')).join('');
  const table = records.length
    ? `<table class="probe-table"><caption>Each row: one broker, one model, one week. Latency is measured from a GitHub-hosted runner.</caption><thead><tr><th scope="col">Week</th><th scope="col">Broker</th><th scope="col">Model</th><th scope="col">Answered</th><th scope="col">5xx</th><th scope="col">Other model served</th><th scope="col">p50 / p95 ms</th><th scope="col">Catalogue change</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>No week has been recorded yet. The first scheduled run writes the first row.</p>';
  const anonymised = brokers.filter(b => names[b].startsWith('Broker ')).length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#102b22">
  <title>Broker probe — Odin R&amp;D</title>
  <meta name="description" content="A weekly probe of the model brokers Odin routes through: failed calls, silent model swaps, latency and catalogue changes, measured the same way every week.">
  <meta property="og:title" content="The weekly broker probe">
  <meta property="og:description" content="Failed calls, silent model swaps, latency and catalogue changes, every week.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://odin-labs-ai.github.io/odin-rnd/probe/">
  <link rel="canonical" href="https://odin-labs-ai.github.io/odin-rnd/probe/">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="../assets/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="../assets/style.css">
  <link rel="stylesheet" href="../assets/company.css">
  <link rel="stylesheet" href="../assets/motion.css">
  <script type="module" src="../assets/motion.mjs"></script>
</head>
<body class="company-page">
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header dark-surface">
    <a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a>
    <nav aria-label="Main navigation"><a href="../#floor">Factory</a><a href="../#experiments">Experiments</a><a href="../updates/">Updates</a><a href="../#journal">Field notes</a><a href="../work-with-us/" data-contact-opened>Work with us</a></nav>
    <a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source <span aria-hidden="true">↗</span></a>
  </header>
  <main id="main">
    <!-- rendered by scripts/broker-probe.mjs page --write from site/data/broker-probe/*.json; do not edit by hand -->
    <section class="company-hero company-width" aria-labelledby="probe-title">
      <div>
        <h1 id="probe-title">The weekly <br>broker probe.</h1>
        <p class="company-lead">Once a week a scheduled job sends ${PROBE.callsPerModel} identical tiny calls to each of ${Object.keys(PROBE.models).length} fixed models through every broker we hold a key for, and fetches each broker's model catalogue. It records calls that fail, calls answered by a different model than the one asked for, latency, and models added, removed or re-priced since the week before.</p>
      </div>
    </section>
    <section class="company-section company-width" id="weeks" aria-labelledby="weeks-title">
      <h2 id="weeks-title">Week by week.</h2>
      <div class="company-prose">
        ${table}
      </div>
    </section>
    <section class="company-section company-width company-split" id="method" aria-labelledby="method-title">
      <h2 id="method-title">How it is measured.</h2>
      <div class="company-prose">
        <p>The prompt is <q>${escape(PROBE.prompt)}</q>, at most ${PROBE.maxTokens} tokens back, temperature 0. A call counts as answered when it returns HTTP 200 with text. A served model counts as the requested one when the model id the broker returns names the same model family. The job runs on a GitHub-hosted runner under the lab's own GitHub identity, with dedicated, spend-capped keys, and only on its schedule or by hand: never on a pull request. The script is <code>scripts/broker-probe.mjs</code>; each week's record is <code>site/data/broker-probe/</code> plus the week, as JSON.</p>
        <p>${anonymised ? `${anonymised} of ${brokers.length} brokers are shown by letter: a broker is named next to a number only when its published terms, as recorded in <code>site/data/provider-terms.json</code>, allow it.` : 'Every broker shown is named under its published terms, as recorded in <code>site/data/provider-terms.json</code>.'} A broker shown as "not keyed" had no dedicated capped key that week; one shown as "not probed" has terms that are still under review, so no call is made to it at all.</p>
        <p>Twenty calls a week cannot show a small error rate, and one runner location is not every location. This page reports what happened; it does not rank brokers.</p>
      </div>
    </section>
  </main>
  <footer class="site-footer"><a class="footer-brand" href="../" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="29" height="32" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><div><a href="https://odin-labs.ai/contact/">Contact Odin</a><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a></div></footer>
</body>
</html>
`;
}

export function readTerms() {
  const p = join(ROOT, 'site/data/provider-terms.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** ISO week of a date, e.g. 2026-W43. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

async function main() {
  const [mode] = process.argv.slice(2);
  const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : f; };
  if (mode === 'probe') {
    const week = arg('week', isoWeek());
    if (!/^\d{4}-W\d{2}$/.test(week)) { console.error('--week wants YYYY-Www'); return 1; }
    const out = arg('out', join(DATA, `${week}.json`));
    const record = await probe({ week });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
    // A week in which no broker could be probed (every one held or without a key) is still a week: its record says so
    // and is published like any other, so the page never goes silently stale.
    const probed = Object.values(record.brokers).filter(b => b.keyed && !b.held).length;
    console.log(`broker-probe: ${week}: ${probed} broker(s) probed -> ${out}`);
    return 0;
  }
  if (mode === 'page') {
    const html = renderPage(weeks(), readTerms());
    if (process.argv.includes('--write')) { mkdirSync(dirname(PAGE), { recursive: true }); writeFileSync(PAGE, html); console.log(`broker-probe: wrote ${PAGE}`); return 0; }
    if (!existsSync(PAGE) || readFileSync(PAGE, 'utf8') !== html) { console.error('broker-probe: site/probe/index.html is not what the data renders (run: node scripts/broker-probe.mjs page --write)'); return 1; }
    return 0;
  }
  console.error('usage: broker-probe.mjs probe [--week YYYY-Www] [--out F] | page [--write]');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(await main());
