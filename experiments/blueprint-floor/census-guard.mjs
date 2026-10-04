// EXP 007 census guard (WO-2-01). The census runner calls checkCensusRun before any metered call. It refuses unless:
//   - freeze.mjs is set (PREREG_SHA256 and NOT_BEFORE non-null) and the pre-registration on disk hashes to PREREG_SHA256;
//   - every file the pre-registration pins (files, and the engine files under node_modules/bce-engine) hashes to its pin;
//   - now is strictly after NOT_BEFORE (the odin-rnd mergedAt of the pull request that published the record);
//   - the site serves the record byte for byte: the served copy, fetched at run start, hashes to PREREG_SHA256 (the fetch
//     and its sha are recorded; tests stub the fetch, and the default fetch refuses under the Node test runner);
//   - every file on the counted path hashes to its pin in experiments/blueprint-floor/runners.sha256;
//   - the ledger is exactly the committed experiments/blueprint-floor/spend-ledger.jsonl (that path, tracked by git).
// A REHEARSAL (the fake client) checks the same frozen record and pins, but fetches nothing and appends to a scratch
// ledger; its records are marked rehearsal and never publishable.
//   node experiments/blueprint-floor/census-guard.mjs --write-pins     rewrite runners.sha256 from the files on disk
//   node experiments/blueprint-floor/census-guard.mjs [--mode practice|counted]   run the guard (fetches the served copy)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_BEFORE, PREREG_SHA256, SERVED_URL } from './freeze.mjs';
import { LEDGER } from './census-spend.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const DIR = 'experiments/blueprint-floor';
export const PREREG = `${DIR}/preregistration.json`;
export const PINS = `${DIR}/runners.sha256`;
const PLUGINS = ['hunch', 'jev-pref', 'abide', 'limpet', 'jev-belay', 'jev-engineering', 'pi-verdict', 'jev-axi'];
/** Every file on the counted path: EXP 007's runner, guard, gate, ledger and freeze; the pinned protocol, adapter, scorer,
 * prompts, contracts, selection, rule files and controls; the canary prompt and the rehearsal fake (refused by a paid
 * run); and every module outside this directory they import (EXP 005's engine contract, scrub and lint; EXP 006's
 * scrub; check.mjs, which the scrub reads). */
export const RUNNER_FILES = [
  `${DIR}/census-run.mjs`, `${DIR}/census-guard.mjs`, `${DIR}/census-gate.mjs`, `${DIR}/census-spend.mjs`, `${DIR}/freeze.mjs`,
  `${DIR}/protocol.mjs`, `${DIR}/adapter.mjs`, `${DIR}/whitelist.mjs`, `${DIR}/whitelist.json`, `${DIR}/scorer.mjs`,
  `${DIR}/contract.md`, `${DIR}/contract-module-graph.md`, `${DIR}/prompts/translator.md`, `${DIR}/prompts/adjudicator.md`, `${DIR}/prompts/canary.md`,
  `${DIR}/rules/selection.json`, ...PLUGINS.map(p => `${DIR}/rules/${p}.json`),
  `${DIR}/controls/positive.json`, `${DIR}/controls/negative.json`, `${DIR}/controls/practice.json`,
  `${DIR}/fixtures/fake-claude-census.mjs`,
  'experiments/jev-gate/bce-contract.mjs', 'experiments/jev-gate/run_reviewer.mjs', 'experiments/jev-gate/runner-guard.mjs', 'experiments/jev-gate/lint.mjs',
  'experiments/nina-changes/scrub6.mjs', 'scripts/check.mjs',
];

export const codeShas = (root = REPO_ROOT) => Object.fromEntries(RUNNER_FILES.map(rel => [rel, existsSync(join(root, rel)) ? sha256(readFileSync(join(root, rel))) : null]));
export const renderPins = shas => Object.entries(shas).map(([rel, h]) => `${h}  ${rel}\n`).join('');
export function readPins(root = REPO_ROOT) {
  const path = join(root, PINS);
  if (!existsSync(path)) refuse(`${PINS} is missing`);
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}
const canonical = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));
export const sameShas = (a, b) => a !== null && b !== null && canonical(a) === canonical(b);

export class GuardError extends Error { constructor(message) { super(`EXP 007 census guard refused: ${message}`); this.name = 'GuardError'; this.code = 'EGUARD7'; } }
function refuse(message) { throw new GuardError(message); }

const utc = (name, value) => {
  const t = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(t) || !/Z$/.test(value)) refuse(`${name} ${value} is not an ISO 8601 UTC time`);
  return t;
};

/** The served copy's bytes, fetched once (10 s); refused under the Node test runner, where the fetch is always stubbed. */
export async function fetchServed(url = SERVED_URL, env = process.env) {
  if (env.NODE_TEST_CONTEXT) throw new Error('the served pre-registration is not fetched under the Node test runner: tests stub fetchServed');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// git as the PATH resolved it when this module loaded (a test may empty PATH afterwards to keep the client unreachable).
const GIT = (process.env.PATH ?? '').split(':').filter(Boolean).map(d => join(d, 'git')).find(p => existsSync(p)) ?? 'git';
/** Is `rel` tracked by git in `root` (committed at least once)? */
export function trackedByGit(root, rel) {
  const r = spawnSync(GIT, ['ls-files', '--error-unmatch', '--', rel], { cwd: root, encoding: 'utf8' });
  return r.status === 0;
}

/** Refuses unless every file `pins` names exists under `root` and hashes to its pin. */
export function checkPinned(pins, root, by) {
  for (const [rel, want] of Object.entries(pins ?? {})) {
    const path = join(root, rel);
    if (!existsSync(path)) refuse(`${by} pins ${rel}, which is missing`);
    const have = sha256(readFileSync(path));
    if (have !== want) refuse(`${by} pins ${rel} at ${want}; it hashes to ${have}`);
  }
}

export const MODES = ['practice', 'counted', 'rehearsal'];

/**
 * The guard. Returns the stamp every record carries: {mode, rehearsal, preregSha256, notBefore, served, code,
 * codeMatchesPins, checkedAt}. `freeze`, `now`, `fetch`, `tracked` and `root` are injectable for tests.
 */
export async function checkCensusRun({ mode, root = REPO_ROOT, now = new Date(), freeze = { PREREG_SHA256, NOT_BEFORE }, fetch: fetchBytes = fetchServed, ledgerPath = join(root, LEDGER), tracked = trackedByGit, servedUrl = SERVED_URL } = {}) {
  if (!MODES.includes(mode)) refuse(`unknown mode ${mode}`);
  const rehearsal = mode === 'rehearsal';
  if (!freeze?.PREREG_SHA256 || !freeze?.NOT_BEFORE) refuse('the census waits for the freeze: PREREG_SHA256 and NOT_BEFORE in freeze.mjs are null');
  if (!/^[0-9a-f]{64}$/.test(freeze.PREREG_SHA256)) refuse('PREREG_SHA256 is not a sha256');
  const nb = utc('NOT_BEFORE', freeze.NOT_BEFORE);
  const ppath = join(root, PREREG);
  if (!existsSync(ppath)) refuse(`${PREREG} is missing`);
  const bytes = readFileSync(ppath);
  const got = sha256(bytes);
  if (got !== freeze.PREREG_SHA256) refuse(`${PREREG} hashes to ${got}, not the frozen ${freeze.PREREG_SHA256}`);
  const prereg = JSON.parse(bytes);
  checkPinned(prereg.files, root, 'the pre-registration');
  checkPinned(Object.fromEntries(Object.entries(prereg.engine?.files ?? {}).map(([f, h]) => [`node_modules/bce-engine/${f}`, h])), root, 'the pre-registration (engine)');
  if (!(now.getTime() > nb)) refuse(`it is ${now.toISOString()}, not after the not-before ${freeze.NOT_BEFORE}`);

  const code = codeShas(root);
  const missing = Object.keys(code).filter(k => code[k] === null);
  if (missing.length) refuse(`counted-path file(s) missing: ${missing.join(', ')}`);
  const pinned = readPins(root);
  const codeMatchesPins = sameShas(pinned, code);
  if (!codeMatchesPins) refuse(`the counted-path code differs from ${PINS} (${[...new Set([...Object.keys(code), ...Object.keys(pinned)])].filter(k => pinned[k] !== code[k]).join(', ') || 'file list'})`);

  let served = null;
  if (!rehearsal) {
    if (resolve(ledgerPath) !== resolve(join(root, LEDGER))) refuse(`a practice or counted run appends to the committed ledger ${LEDGER}`);
    if (!tracked(root, LEDGER)) refuse(`${LEDGER} is not committed (tracked by git)`);
    let servedBytes;
    try { servedBytes = await fetchBytes(servedUrl); } catch (error) { refuse(`the served pre-registration could not be fetched: ${String(error.message).slice(0, 200)}`); }
    const servedSha = sha256(servedBytes);
    served = { url: servedUrl, sha256: servedSha, fetchedAt: new Date().toISOString() };
    if (servedSha !== freeze.PREREG_SHA256) refuse(`the site serves a pre-registration hashing to ${servedSha}, not the frozen ${freeze.PREREG_SHA256}`);
  }
  return { mode, rehearsal, preregSha256: got, notBefore: freeze.NOT_BEFORE, served, code, codeMatchesPins, checkedAt: now.toISOString(), prereg };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--write-pins')) {
    writeFileSync(join(REPO_ROOT, PINS), renderPins(codeShas()));
    console.log(`wrote ${PINS}`);
    process.exit(0);
  }
  try {
    const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'counted';
    const { prereg: _p, code: _c, ...stamp } = await checkCensusRun({ mode });
    console.log(JSON.stringify({ ok: true, ...stamp }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}
