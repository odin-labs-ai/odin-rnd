// EXP 009's component set, read from experiments/composable-harness/harness.json through the kernel's own loader
// (parseHarness + resolveHarness): the arms, the schedule and R0 take their components from here, never from a list
// in code. components[0] is infrastructure (loaded before any scheduled operation); the rest are schedulable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHarness, resolveHarness } from '../../../harness/kernel.mjs';

export const HARNESS_JSON = fileURLToPath(new URL('../harness.json', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DOC = parseHarness(JSON.parse(readFileSync(HARNESS_JSON, 'utf8')));
const resolved = await resolveHarness(DOC, { root: REPO_ROOT });
export const INFRASTRUCTURE = Object.freeze(resolved[0]);
export const SPECS = Object.freeze(Object.fromEntries(resolved.slice(1).map(r => [r.spec.name, r.spec])));
export const DEFAULTS = Object.freeze(Object.fromEntries(resolved.slice(1).map(r => [r.spec.name, r.config])));
export const COMPONENTS = Object.freeze(Object.keys(SPECS));
