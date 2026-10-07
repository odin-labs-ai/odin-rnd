// EXP 009 arm H2: the same six components, written blind on a plain registry with hand-written unregister
// (h2/authored/, frozen; never edited). This file is the harness side only: it supplies `config.deps` from the SAME
// EXP 005/008 code the kernel components use, so H1 and H2 differ in lifecycle handling alone:
//   lintRun(item)            EXP 005's line-regex linter (heuristic-lint predict) -> 'REJECT' | 'ACCEPT'
//   grepRun(pattern, text)   EXP 005's keyword grep (heuristic-grep predict) on text; `pattern` is the label H2 caches
//   readout(model, item)     model.complete("item:<sha>\n<state>"): mlx_gate.py's HTTP mode, EXP 008's readout. The tag
//                            keeps the prompt's first 64 characters unique per item (H2's prefix-cache key; every
//                            state begins with the same rules text) and is stripped by the server before evaluation.
//   bus                      an EventEmitter; the harness emits 'pin-changed' after a pin-swap reconfigure.
//
// One H2 trial runs from an empty registry: register the trial's entering set, run its steps (decisions compared with
// R0, reported as mismatches: H2's registry never cascades, by design, so they decide nothing), then unregister every
// component by hand in reverse order and observe. S1's residue is every probe that differs from the observation taken
// before the trial, plus anything left in the registry or on the bus.
//
// TMPDIR. H2's own (Node) temp directories land in the observed scratch root: this process's TMPDIR points there
// during each trial. The model server child is NOT H2's code; the harness supplies it, the same mlx_gate.py H1's
// kernel component runs, and it gets the TMPDIR H1's child and every R0 child get (`childTmp`). Its runtime creates a
// per-user cache directory in TMPDIR on import and never removes it ($TMPDIR/torchinductor_<user>, from
// `import mlx_lm`); with the scratch TMPDIR inherited, that directory showed as `outside.scratch` residue in 10/10
// practice trials, an artifact H1 is never exposed to (practice run 1, 2026-10-03; NOTES.md).
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../h2/authored/registry.mjs';
import h2lint from '../h2/authored/components/lint.mjs';
import h2grep from '../h2/authored/components/grep.mjs';
import h2model from '../h2/authored/components/mlx.model.mjs';
import h2gate from '../h2/authored/components/yesno-gate.mjs';
import h2memo from '../h2/authored/components/memo-cache.mjs';
import h2spend from '../h2/authored/components/spend-counter.mjs';
import { predict as lintPredict } from '../../../scripts/jev-gate-heuristic-lint.mjs';
import { predict as grepPredict } from '../../../scripts/jev-gate-heuristic-grep.mjs';
import { Kernel } from '../../../harness/kernel.mjs';
import { observe, residue, warmUp } from '../probes/observe.mjs';
import { round6 } from '../components/yesno-gate.mjs';

const THRESHOLD = JSON.parse(readFileSync(new URL('../../latent-handoff/readout.json', import.meta.url), 'utf8')).rejectThreshold;
const GATE_PY = fileURLToPath(new URL('../components/mlx_gate.py', import.meta.url));
const FAKE = fileURLToPath(new URL('../fixtures/fake-mlx.mjs', import.meta.url));
export const GREP_PATTERN = 'exp005-heuristic-grep';
export const H2 = Object.freeze({ lint: h2lint, grep: h2grep, 'mlx.model': h2model, 'yesno-gate': h2gate, 'memo-cache': h2memo, 'spend-counter': h2spend });

const freePort = () => new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

export function makeDeps() {
  return {
    lintRun: item => (lintPredict(item.state) ? 'REJECT' : 'ACCEPT'),
    grepRun: (_pattern, text) => (grepPredict(text) ? 'REJECT' : 'ACCEPT'),
    async readout(model, item) {
      const body = await model.complete(`item:${item.sha}\n${item.state}`, {});
      if (!body.ok) throw new Error(`readout: ${body.error}`);
      const p = round6(body.pYesBin);
      return { decision: p >= THRESHOLD ? 'yes' : 'no', p };
    },
    bus: new EventEmitter(),
  };
}

/**
 * The H2 config for a scheduled component (the schedule's config, mapped through the run environment). `childTmp` is
 * the TMPDIR the model server child runs with: the one H1's and R0's children get, never H2's scratch root.
 */
export async function h2Config(name, config, env, deps, ledgerDir, childTmp) {
  if (name === 'mlx.model') {
    const p = env.pins[config.pin];
    const port = await freePort();
    const python = process.env.LH_PYTHON || join(process.env.HOME ?? '', 'ai-env', 'bin', 'python');
    const dir = p.modelDir?.replace(/^<cache>\//, `${join(process.env.HOME ?? '', '.cache', 'odin-rnd')}/`);
    const server = p.fake
      ? { command: process.execPath, args: [FAKE, '--model-key', p.modelKey, '--prefix-cache', '4', '--http', String(port)], port, env: { TMPDIR: childTmp } }
      : { command: python, args: [GATE_PY, '--model-dir', dir, '--model-key', p.modelKey, '--prefix-cache', '4', '--http', String(port)], port, env: { TMPDIR: childTmp } };
    return { pin: p.modelKey, server, readyPath: '/health', readyTimeoutMs: 300_000, deps };
  }
  if (name === 'yesno-gate') return { deps, stratum: 'S' };
  if (name === 'spend-counter') return { deps, flushMs: 1000, ledgerPath: join(ledgerDir, 'h2-spend.jsonl') };
  return { deps };
}

/** H2's decisions for one item, in H1's vocabulary (REJECT/ACCEPT, p to 6 dp). */
export async function evaluateH2(reg, item) {
  const it = { id: item.id, sha: item.stateSha256, state: item.state };
  const out = {};
  if (reg.has('lint')) out.lint = await reg.get('lint').run(it);
  if (reg.has('grep')) out.grep = reg.get('grep').run(GREP_PATTERN, it.state);
  if (reg.has('gate')) {
    const r = await reg.get('gate').decide(it);
    out.yesno = { decision: r.decision === 'yes' ? 'REJECT' : 'ACCEPT', p: r.p };
    if (reg.has('spend')) reg.get('spend').add('yesno', 0);
  }
  return out;
}

const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));

/**
 * H2 trials. Each trial's `startState` (from schedule()) is the loaded set entering it, registered first. Returns rows { arm: 'H2', trial, residue, mismatches, errors, divergences: [] }.
 * `childTmp(scratch)` gives the model child's TMPDIR; the default is the TMPDIR in effect before H2 starts (H1's and
 * R0's). A test passes `scratch => scratch` as the negative control that reproduces the artifact.
 */
export async function runH2({ schedule, env, r0, scratchRoot, onTrial = () => {}, childTmp }) {
  const rows = [];
  const tmpBefore = process.env.TMPDIR;
  const runtimeTmp = tmpdir();
  const childTmpFor = childTmp ?? (() => runtimeTmp);
  await warmUp(); // O's warm-up rule: once per observer process, before its first observation
  try {
    for (const t of schedule) {
      const scratch = join(scratchRoot, `h2-${t.index}`, 'scratch');
      const ledgerDir = join(scratchRoot, `h2-${t.index}`, 'ledger');
      mkdirSync(scratch, { recursive: true });
      mkdirSync(ledgerDir, { recursive: true });
      process.env.TMPDIR = scratch; // H2's own temp directories land in the observed scratch root
      const world = { scratch, baseGlobals: Object.keys(globalThis) };
      const ctmp = childTmpFor(scratch);
      const empty = new Kernel();
      const before = await observe(empty, world);
      const deps = makeDeps();
      const reg = createRegistry();
      const loaded = [];
      const row = { arm: 'H2', trial: t.index, residue: [], mismatches: 0, errors: [], divergences: [] };
      const attempt = async (what, fn) => { try { await fn(); } catch (e) { row.errors.push(`${what}: ${e.message}`); } };
      for (const [name, config] of Object.entries(t.startState ?? {})) {
        loaded.push([name, config]);
        await attempt(`register ${name}`, async () => reg.register(H2[name], await h2Config(name, config, env, deps, ledgerDir, ctmp)));
      }
      for (const s of t.steps) {
        if (s.kind === 'op') {
          if (s.op === 'load') { loaded.push([s.name, s.config]); await attempt(`register ${s.name}`, async () => reg.register(H2[s.name], await h2Config(s.name, s.config, env, deps, ledgerDir, ctmp))); }
          if (s.op === 'unload') { loaded.splice(loaded.findIndex(([n]) => n === s.name), 1); await attempt(`unregister ${s.name}`, () => reg.unregister(s.name)); }
          if (s.op === 'reconfigure') {
            loaded[loaded.findIndex(([n]) => n === s.name)][1] = s.config;
            await attempt(`reconfigure ${s.name}`, async () => reg.reconfigure(s.name, await h2Config(s.name, s.config, env, deps, ledgerDir, ctmp)));
            if (s.pinSwap) deps.bus.emit('pin-changed');
          }
        } else {
          let mine = null;
          await attempt(`evaluate ${s.item.id}`, async () => { mine = canon(await evaluateH2(reg, s.item)); });
          const ref = canon(JSON.parse(await r0(loaded.map(x => [...x]), s.item)).decisions);
          if (mine !== ref) row.mismatches += 1;
        }
      }
      for (const { name } of [...reg.list()].reverse()) await attempt(`unregister ${name}`, () => reg.unregister(name));
      const after = await observe(empty, world);
      row.residue = residue(before, after);
      if (reg.list().length) row.residue.push('h2.registry');
      if (deps.bus.listenerCount('pin-changed')) row.residue.push('h2.bus');
      rows.push(row);
      onTrial(row);
    }
  } finally {
    if (tmpBefore === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = tmpBefore;
  }
  return rows;
}
