#!/usr/bin/env node
// EXP 009 R0: a fresh process for one (loaded set, item). The job arrives on stdin as JSON
// { env, loaded: [[name, config], ...], item: { id, state, stateSha256 } | null }. It loads the infrastructure and the
// set in order, takes the P1 projection, evaluates the item once (when given), disposes, and prints
// { projection, decisions } as one canonical JSON line. It reads no labels.
import { baseKernel, componentConfig, evaluate, projection, SPECS } from './run.mjs';
import { inside } from '../probes/observe.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const job = JSON.parse(input);
const world = { scratch: null, baseGlobals: Object.keys(globalThis) };
const k = await baseKernel(job.env);
const baseline = inside(k, world);
for (const [name, config] of job.loaded) await k.load(SPECS[name], componentConfig(name, config, job.env));
const out = { projection: projection(k, baseline, world), decisions: job.item ? await evaluate(k, job.item) : null };
await k.dispose();
const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
process.stdout.write(`${canon(out)}\n`);
