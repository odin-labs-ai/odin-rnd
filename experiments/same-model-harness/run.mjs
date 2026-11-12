#!/usr/bin/env node
// Lab 11's runner: the same local model, asked the same question about the same fixture, bare and with a harness.
//
//   OLLAMA_URL=<your Ollama server's address> node experiments/same-model-harness/run.mjs \
//     --models qwen2.5:7b,qwen3:30b-a3b --runs 10 --out experiments/same-model-harness/runs/<date>/rows.jsonl
//
// The task comes in two variants: open (task-open.txt: the model may answer UNKNOWN for the test result) and forced
// (task-forced.txt: PASS or FAIL only, the shape of a coding agent's closing report). Both arms get the identical task
// (the variant's text with the diff) and the identical fixture. The harnessed arm also gets the
// output of three tools the harness ran on the fixture (harness.txt): the file list, a search for the changed function
// and the real test run with its exit status. Each reply is scored by score.mjs. In the harnessed arm the harness then
// checks the reply (an invented file, or a verdict that is not the suite's result, is refused) and asks once more with
// the reason; that second answer is recorded as attempt 2. The first answer is the model's result in both arms.
//
// Cells run one after the other, never in parallel, and a cell is refused (and written down as refused) when the
// machine's one-minute load is above --max-load (default 40). Every call records its wall time and the load before it.
// The model's own default sampling settings are used, with a different seed per run; qwen3 models run with thinking off.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessRefusals, scoreReply } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, 'fixture');
const sha256 = b => createHash('sha256').update(b).digest('hex');

/** Every file of the fixture, relative and sorted. */
export function fixtureFiles(dir = FIXTURE) {
  const out = [];
  (function walk(d) { for (const name of readdirSync(d).sort()) { const p = join(d, name); if (name === '__pycache__') continue; if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split('\\').join('/')); } })(dir);
  return out.sort();
}

/** One sha256 for the whole fixture: of its sha256sum listing ("<sha256>  <path>\n" per file, sorted by path). */
export function fixtureManifest(dir = FIXTURE) {
  return sha256(fixtureFiles(dir).map(f => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join(''));
}

/** Run the fixture's test suite in a scratch copy; the output with the scratch path replaced by ".". */
export function runSuite(dir = FIXTURE) {
  const scratch = mkdtempSync(join(tmpdir(), 'lab11-'));
  try {
    cpSync(dir, scratch, { recursive: true });
    let out = '', status = 0;
    try { out = execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: scratch, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); }
    catch (e) {
      // Only a test run that completed is ground truth: a launch failure (no python3) or a signal has no exit status.
      if (typeof e.status !== 'number' || e.signal) throw new Error(`the fixture's test suite did not run to completion: ${e.code ?? e.signal ?? e.message}`);
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`; status = e.status;
    }
    if (!/^Ran \d+ tests? in /m.test(out)) throw new Error('the fixture\'s test suite printed no "Ran N tests" line, so it did not run');
    const real = (() => { try { return execFileSync('realpath', [scratch], { encoding: 'utf8' }).trim(); } catch { return scratch; } })();
    const clean = out.split(real).join('.').split(scratch).join('.').replace(/Ran (\d+) tests? in [\d.]+s/, 'Ran $1 tests');
    return { output: clean, status, suite: status === 0 ? 'PASS' : 'FAIL' };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function grepFixture(dir = FIXTURE, needle = 'route_cost') {
  const lines = [];
  for (const f of fixtureFiles(dir)) readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => { if (line.includes(needle)) lines.push(`./${f}:${i + 1}:${line}`); });
  return lines.join('\n');
}

export const VARIANTS = ['open', 'forced'];

export function prompts(variant, dir = FIXTURE) {
  if (!VARIANTS.includes(variant)) throw new Error(`no such variant ${variant}`);
  const diff = readFileSync(join(here, 'change.diff'), 'utf8').trimEnd();
  const task = readFileSync(join(here, `task-${variant}.txt`), 'utf8').replace('{{DIFF}}', () => diff);
  const suite = runSuite(dir);
  const harness = readFileSync(join(here, 'harness.txt'), 'utf8')
    .replace('{{TREE}}', () => fixtureFiles(dir).map(f => `./${f}`).join('\n'))
    .replace('{{GREP}}', () => grepFixture(dir))
    .replace('{{TESTS}}', () => suite.output.trimEnd())
    .replace('{{EXIT}}', () => String(suite.status));
  return { bare: task, harnessed: `${task}${harness}`, suite };
}

async function chat(base, model, messages, seed, timeoutMs) {
  const body = { model, messages, stream: false, format: 'json', keep_alive: '10m', options: { seed, num_predict: 400 } };
  if (/^qwen3/.test(model)) body.think = false;
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: `http ${res.status}: ${json.error ?? ''}`.slice(0, 200), ms: Date.now() - started };
    return { ok: true, text: json.message?.content ?? '', ms: Date.now() - started, evalCount: json.eval_count ?? null, promptEvalCount: json.prompt_eval_count ?? null, loadMs: Math.round((json.load_duration ?? 0) / 1e6) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(e.message).slice(0, 200), ms: Date.now() - started };
  } finally { clearTimeout(timer); }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc), []));
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error('set OLLAMA_URL to your Ollama server\'s address');
  const models = String(args.models ?? '').split(',').filter(Boolean);
  const runs = Number(args.runs ?? 10), maxLoad = Number(args['max-load'] ?? 40), timeoutMs = Number(args.timeout ?? 240000);
  const arms = String(args.arms ?? 'bare,harnessed').split(',');
  const variants = String(args.variants ?? VARIANTS.join(',')).split(',');
  const out = args.out;
  if (!models.length || !out) throw new Error('--models and --out are required');
  mkdirSync(dirname(out), { recursive: true });
  const write = row => appendFileSync(out, `${JSON.stringify(row)}\n`);
  const p = Object.fromEntries(variants.map(v => [v, prompts(v)]));
  const suite = p[variants[0]].suite;
  const truth = { files: fixtureFiles(), suite: suite.suite };
  const tags = await (await fetch(`${base}/api/tags`)).json();
  const version = await (await fetch(`${base}/api/version`)).json();
  write({
    kind: 'session', at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ollama: version.version,
    machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30) },
    fixtureManifest: fixtureManifest(), taskSha256: Object.fromEntries(VARIANTS.map(v => [v, sha256(readFileSync(join(here, `task-${v}.txt`)))])), harnessSha256: sha256(readFileSync(join(here, 'harness.txt'))),
    diffSha256: sha256(readFileSync(join(here, 'change.diff'))), runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), scorerSha256: sha256(readFileSync(join(here, 'score.mjs'))),
    promptSha256: Object.fromEntries(variants.map(v => [v, { bare: sha256(p[v].bare), harnessed: sha256(p[v].harnessed) }])), suite: suite.suite, suiteOutputSha256: sha256(suite.output),
    models: models.map(m => ({ model: m, digest: tags.models?.find(t => t.name === m)?.digest ?? null })), runs, arms, variants, maxLoad,
  });
  for (const model of models) {
    for (const variant of variants) for (const arm of arms) {
      const { bare, harnessed } = p[variant];
      const load1 = loadavg()[0];
      if (load1 > maxLoad) { write({ kind: 'cell-refused', model, variant, arm, load1: +load1.toFixed(2), maxLoad }); console.log(`refused ${model} ${variant} ${arm}: load ${load1.toFixed(1)}`); continue; }
      for (let run = 1; run <= runs; run++) {
        const seed = 1100 + run;
        const messages = [{ role: 'user', content: arm === 'bare' ? bare : harnessed }];
        const before = +loadavg()[0].toFixed(2);
        const r = await chat(base, model, messages, seed, timeoutMs);
        const score = r.ok ? scoreReply(r.text, truth) : null;
        const row = { kind: 'call', model, variant, arm, run, attempt: 1, seed, load1: before, ...r, score };
        if (arm === 'harnessed' && score) row.refusals = harnessRefusals(score, truth);
        write(row);
        console.log(`${model} ${variant} ${arm} #${run}: ${r.ok ? `${score.readable ? score.verdict : 'unreadable'} invented=${score.invented}` : r.error} ${r.ms} ms load ${before}`);
        if (arm === 'harnessed' && score && row.refusals.length) {
          const again = [...messages, { role: 'assistant', content: r.text }, { role: 'user', content: `The harness refused your answer: ${row.refusals.join('; ')}. Answer again with one JSON object in the same shape.` }];
          const before2 = +loadavg()[0].toFixed(2);
          const r2 = await chat(base, model, again, seed, timeoutMs);
          const s2 = r2.ok ? scoreReply(r2.text, truth) : null;
          write({ kind: 'call', model, variant, arm, run, attempt: 2, seed, load1: before2, ...r2, score: s2, refusals: s2 ? harnessRefusals(s2, truth) : null });
        }
      }
    }
    // Unload before the next model, so each model's calls run alone.
    await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
  }
  write({ kind: 'end', at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message); process.exit(1); });
