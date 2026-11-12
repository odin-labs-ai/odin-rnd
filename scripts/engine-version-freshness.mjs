// Engine version freshness (.github/workflows/engine-version-freshness.yml). The home page's card 001 tells a reader
// which bce-engine release to take: its "Release & evidence" link and its Release field. When bce activated 0.6.3 the
// card said 0.6.2 for a day (fixed by #210), because nothing compared it with the engine. This does, daily and on
// every pull request that touches the card.
//
// The expected version is bce main's `.engine-pin.json` "pin" (the activated release), read over HTTPS from the public
// repository. npm `latest` for bce-engine must agree with it; when the two differ, bce is mid-release: the card may state
// either answer (a notice says so), but a card that lags BOTH, or that the check cannot find, still fails. The grace is
// bounded by the two live answers, not by time, so a long disagreement never hides a card older than both.
//
// Only the places a reader uses to choose an install are read. Dated and historical mentions are left alone on purpose:
// the experiments pinned to bce-engine 0.3.1 (card 004's "Ground truth", package.json, the experiment records) say what
// a past run used, not what to install today.
//
//   node scripts/engine-version-freshness.mjs                 (network: raw.githubusercontent.com, registry.npmjs.org)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIN_URL = 'https://raw.githubusercontent.com/blueprint-conformance/bce/main/.engine-pin.json';
export const NPM_LATEST_URL = 'https://registry.npmjs.org/bce-engine/latest';
const SEMVER = '[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?';
const IS_SEMVER = new RegExp(`^${SEMVER}$`);

/** Card 001 (the engine card) of the home page, from its <article> to its </article>; null when it is not there. */
export function card001(html) {
  const at = html.indexOf('<div class="project-number">001<span>');
  if (at < 0) return null;
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  return start < 0 || end < 0 ? null : html.slice(start, end);
}

/** The places a reader reads the version to install. Each must yield at least one version, and every one must match. */
export const PLACES = [
  { file: 'site/index.html', where: 'card 001 "Release & evidence" link', scope: card001, pattern: new RegExp(`href="https://github\\.com/blueprint-conformance/bce/releases/tag/v(${SEMVER})"`, 'g') },
  { file: 'site/index.html', where: 'card 001 Release field', scope: card001, pattern: new RegExp(`<dt>Release</dt><dd>v(${SEMVER})</dd>`, 'g') },
];

/** Every version each place states: [{ file, where, versions }]. `read(file)` returns the file's text. */
export function readPlaces(read, places = PLACES) {
  return places.map(({ file, where, scope, pattern }) => {
    const text = scope(read(file)) ?? '';
    return { file, where, versions: [...text.matchAll(pattern)].map(m => m[1]) };
  });
}

/** Every way the places disagree with `expected`, a version or a list of acceptable versions (empty when they all state one). */
export function freshnessProblems(found, expected) {
  const accepted = [expected].flat();
  const want = accepted.join(' or ');
  const why = accepted.length > 1 ? 'bce is mid-release: main .engine-pin.json pin or npm latest' : 'bce main .engine-pin.json pin, which npm latest matches';
  const problems = [];
  for (const { file, where, versions } of found) {
    if (!versions.length) problems.push({ file, message: `${file}, ${where}: no bce-engine version found. The place moved or its wording changed; update PLACES in scripts/engine-version-freshness.mjs so the check reads what readers read.` });
    for (const v of new Set(versions)) if (!accepted.includes(v)) problems.push({ file, message: `${file}, ${where}: found ${v}, expected ${want} (${why}).` });
  }
  return problems;
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res.json();
}

/** The whole check. Returns the exit code; writes GitHub Actions annotations through `out` and `err`. */
export async function run({ root = '.', fetchImpl = fetch, out = console.log, err = console.error } = {}) {
  const pin = (await getJson(fetchImpl, PIN_URL))?.pin;
  const latest = (await getJson(fetchImpl, NPM_LATEST_URL))?.version;
  for (const [name, v] of [['bce main .engine-pin.json pin', pin], ['npm latest for bce-engine', latest]]) {
    if (typeof v !== 'string' || !IS_SEMVER.test(v)) { err(`::error title=engine version freshness::${name} is ${JSON.stringify(v)}, not a version`); return 1; }
  }
  const found = readPlaces(file => readFileSync(join(root, file), 'utf8'));
  const midRelease = pin !== latest;
  if (midRelease) out(`::notice title=engine version freshness::bce is mid-release: main pins ${pin}, npm latest is ${latest}. The card may state either until the two agree; a card older than both still fails.`);
  const problems = freshnessProblems(found, midRelease ? [pin, latest] : pin);
  for (const { file, message } of problems) err(`::error file=${file},title=engine version freshness::${message}`);
  if (problems.length) return 1;
  for (const { file, where, versions } of found) out(`${file}, ${where}: ${[...new Set(versions)].join(', ')}`);
  out(midRelease
    ? `engine version freshness: every place states ${pin} or ${latest} (bce is mid-release: main pin or npm latest)`
    : `engine version freshness: every place states ${pin}, the activated bce-engine (pin and npm latest agree)`);
  return 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await run().catch(e => { console.error(`::error title=engine version freshness::${e.message}`); return 1; });
}
