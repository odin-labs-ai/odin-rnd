// The odin-rnd harness kernel: OUR kernel implementing a subset of Cordis semantics (github.com/cordiverse/cordis, used
// as the semantic reference only; it is not a dependency and nothing here claims its guarantees).
//
//   - A component is { name, inject, provides, emits, inverses, apply }. It is ACTIVE only while every key it injects
//     has a provider; otherwise the census reports it `inactive: missing <key>` and its apply never runs.
//   - apply(ctx, config) changes the runtime ONLY through ctx: ctx.effect(do, undo, {keys}) runs `do` and pushes `undo`;
//     ctx.provide(key, value) is an effect whose undo withdraws the key. Deactivation runs the undo stack LIFO.
//   - Keys are typed. `internal` keys (services, runtime state) carry an inverse. `emission` keys (an ffr event, a spend
//     line, a verdict, a commit) are append-only history: ctx.record(key, row) appends, nothing ever removes it, and a
//     correction is a new row with `supersedes`. An inverse that touches an emission key is ill-typed: load refuses it
//     with the key named. Revert the runtime, never history.
//   - Withdrawing a provider deactivates its dependents first (transitively), then the provider.
//   - load / unload / reconfigure at runtime; reconfigure re-applies the same code with a new config. There is no code
//     hot module replacement: a module is imported once and never re-imported.
//   - Every lifecycle operation is serialised and appended to the lifecycle log (harness-lifecycle.jsonl when loaded
//     from a harness.json with a log path).
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KEY_KINDS = Object.freeze(['internal', 'emission']);
export const HARNESS_SCHEMA = 'odin-rnd.harness.v1';
const NAME = /^[a-z][a-zA-Z0-9._-]*$/;

export class KernelError extends Error {}

const list = (v, what, name) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some(k => typeof k !== 'string' || !NAME.test(k))) throw new KernelError(`${name}: ${what} must be an array of key names`);
  return [...new Set(v)];
};

/** A frozen component spec. Declares what it injects, provides, emits, and which internal keys its inverses touch. */
export function defineComponent({ name, inject, provides, emits, inverses, apply, ...rest }) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new KernelError(`component name ${JSON.stringify(name)} is invalid`);
  if (typeof apply !== 'function') throw new KernelError(`${name}: apply must be a function`);
  const unknown = Object.keys(rest);
  if (unknown.length) throw new KernelError(`${name}: unknown spec field(s) ${unknown.join(', ')}`);
  return Object.freeze({
    name, apply,
    inject: Object.freeze(list(inject, 'inject', name)),
    provides: Object.freeze(list(provides, 'provides', name)),
    emits: Object.freeze(list(emits, 'emits', name)),
    inverses: Object.freeze(list(inverses, 'inverses', name)),
  });
}

function typeErrors(spec, keys) {
  const kind = k => keys[k] ?? 'internal';
  const errs = [];
  for (const k of spec.inverses) if (kind(k) === 'emission') errs.push(`${spec.name}: an inverse touches emission key ${k} (append-only; correct it forward with supersedes)`);
  for (const k of spec.provides) if (kind(k) === 'emission') errs.push(`${spec.name}: provides emission key ${k} (an emission is recorded, never provided)`);
  for (const k of spec.emits) if (kind(k) !== 'emission') errs.push(`${spec.name}: emits ${k}, which is not an emission key`);
  return errs;
}

/** The dry plan for specs under a key-kind map: activation order, every component left unsatisfied (and why), type errors. */
export function plan(specs, keys = {}) {
  const provided = new Set();
  const order = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const s of specs) {
      if (order.includes(s.name) || !s.inject.every(k => provided.has(k))) continue;
      order.push(s.name);
      for (const k of s.provides) provided.add(k);
      changed = true;
    }
  }
  const declared = new Set(specs.flatMap(s => s.provides));
  const unsatisfied = {};
  for (const s of specs) {
    if (order.includes(s.name)) continue;
    unsatisfied[s.name] = s.inject.filter(k => !provided.has(k)).map(k => (declared.has(k) ? `blocked ${k}` : `missing ${k}`));
  }
  return { order, unsatisfied, illTyped: specs.flatMap(s => typeErrors(s, keys)) };
}

const deepFreeze = v => {
  if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); }
  return v;
};
const freezeConfig = config => {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new KernelError('a config is a plain object');
  return deepFreeze(structuredClone(config));
};

export class Kernel {
  /**
   * keys: { [key]: 'internal' | 'emission' } (an undeclared key is internal). sinks: { [emissionKey]: row => void },
   * where ctx.record appends. log: line => void, the lifecycle log (it is always also kept in kernel.lifecycle).
   */
  constructor({ keys = {}, sinks = {}, log = null } = {}) {
    for (const [k, v] of Object.entries(keys)) if (!KEY_KINDS.includes(v)) throw new KernelError(`key ${k}: kind ${v} is not ${KEY_KINDS.join('|')}`);
    for (const k of Object.keys(sinks)) if (keys[k] !== 'emission') throw new KernelError(`sink ${k}: not an emission key`);
    this.keys = Object.freeze({ ...keys });
    this.sinks = sinks;
    this.entries = new Map(); // name -> { spec, config, state, reason, stack }
    this.services = new Map(); // key -> { provider, value }
    this.emissions = new Map(); // key -> rows: history, never truncated by any lifecycle op
    this.lifecycle = [];
    this.logLine = log;
    this.seq = 0;
    this.queue = Promise.resolve();
  }

  kind(key) { return this.keys[key] ?? 'internal'; }

  // Every lifecycle op starts after the previous one settles, so a dispose and an activation never interleave.
  serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  note(op, name, extra = {}) {
    const line = { seq: ++this.seq, op, component: name, ...extra };
    this.lifecycle.push(line);
    this.logLine?.(line);
  }

  /** Register a component (refused if ill-typed, a duplicate name, or a second provider of a key), then settle. */
  load(spec, config = {}) {
    return this.serial(async () => {
      if (!spec || typeof spec.apply !== 'function' || !Object.isFrozen(spec)) throw new KernelError('load needs a defineComponent spec');
      if (this.entries.has(spec.name)) throw new KernelError(`${spec.name}: already loaded`);
      const errs = typeErrors(spec, this.keys);
      if (errs.length) throw new KernelError(`ill-typed: ${errs.join('; ')}`);
      for (const k of spec.provides) {
        const other = [...this.entries.values()].find(e => e.spec.provides.includes(k));
        if (other) throw new KernelError(`${spec.name}: ${k} is already provided by ${other.spec.name}`);
      }
      this.entries.set(spec.name, { spec, config: freezeConfig(config), state: 'inactive', reason: null, stack: [] });
      this.note('load', spec.name);
      await this.settle();
    });
  }

  /** Deactivate (dependents first) and remove. The emissions it recorded stay. */
  unload(name) {
    return this.serial(async () => {
      this.must(name);
      await this.deactivate(name, 'unloading');
      this.entries.delete(name);
      this.note('unload', name);
      await this.settle();
    });
  }

  /** Deactivate (dependents first), swap the config, re-apply the same code, then re-activate the dependents. */
  reconfigure(name, config = {}) {
    return this.serial(async () => {
      const e = this.must(name);
      const next = freezeConfig(config);
      await this.deactivate(name, 'reconfiguring');
      e.config = next;
      if (e.state === 'failed') e.state = 'inactive';
      this.note('reconfigure', name);
      await this.settle();
    });
  }

  /** Unload everything, latest-loaded first. */
  dispose() {
    return this.serial(async () => {
      for (const name of [...this.entries.keys()].reverse()) {
        if (!this.entries.has(name)) continue;
        await this.deactivate(name, 'disposing');
        this.entries.delete(name);
        this.note('unload', name);
      }
    });
  }

  must(name) {
    const e = this.entries.get(name);
    if (!e) throw new KernelError(`${name}: not loaded`);
    return e;
  }

  /** Activate, in load order, every inactive component whose injects are all provided, until nothing changes. */
  async settle() {
    for (let changed = true; changed;) {
      changed = false;
      for (const e of this.entries.values()) {
        if (e.state !== 'inactive') continue;
        const missing = e.spec.inject.filter(k => !this.services.has(k));
        if (missing.length) { e.reason = missing.map(k => `missing ${k}`).join(', '); continue; }
        await this.activate(e);
        changed = true;
      }
    }
  }

  async activate(e) {
    const ctx = this.context(e);
    e.state = 'activating';
    try {
      await e.spec.apply(ctx.api, e.config);
      ctx.close();
      for (const k of e.spec.provides) if (this.services.get(k)?.provider !== e.spec.name) throw new KernelError(`declared ${k} but did not provide it`);
      e.state = 'active';
      e.reason = null;
      this.note('activate', e.spec.name);
    } catch (err) {
      ctx.close();
      let undoErr = null;
      try { await this.unwind(e); } catch (u) { undoErr = u; }
      e.state = 'failed';
      e.reason = `failed: ${err.message}${undoErr ? `; ${undoErr.message}` : ''}`;
      this.note('fail', e.spec.name, { reason: e.reason });
    }
  }

  /** Deactivate: first every active component that injects a key this one provides (transitively), then its own stack. */
  async deactivate(name, why) {
    const e = this.entries.get(name);
    if (e.state !== 'active') { if (e.state !== 'failed') e.reason = why; return; }
    const dependents = [...this.entries.values()].filter(d => d.state === 'active' && d !== e && d.spec.inject.some(k => e.spec.provides.includes(k)));
    for (const d of dependents.reverse()) await this.deactivate(d.spec.name, `provider ${name} ${why}`);
    e.state = 'inactive';
    e.reason = why;
    await this.unwind(e);
    this.note('deactivate', name, { why });
  }

  /** Run the undo stack LIFO. Every undo runs even if an earlier one throws; the first error is rethrown after. */
  async unwind(e) {
    let first = null;
    while (e.stack.length) {
      const undo = e.stack.pop();
      try { await undo(); } catch (err) { first ??= err; }
    }
    if (first) throw new KernelError(`${e.spec.name}: an inverse failed: ${first.message}`);
  }

  context(e) {
    const { spec } = e;
    const kernel = this;
    const gen = e.gen = (e.gen ?? 0) + 1; // a ctx outlives its activation only as a refused handle
    let open = true;
    const guard = what => { if (!open) throw new KernelError(`${spec.name}: ctx.${what} after apply returned (make the effect during apply)`); };
    const api = Object.freeze({
      name: spec.name,
      inject: Object.freeze(Object.fromEntries(spec.inject.map(k => [k, kernel.services.get(k).value]))),
      /** Run `does`, then push `undo`. `keys`: the internal keys the inverse touches (each declared in inverses or provides). */
      async effect(does, undo, { keys = [] } = {}) {
        guard('effect');
        if (typeof does !== 'function' || typeof undo !== 'function') throw new KernelError(`${spec.name}: ctx.effect needs (do, undo)`);
        for (const k of keys) {
          if (kernel.kind(k) === 'emission') throw new KernelError(`${spec.name}: ill-typed: an inverse touches emission key ${k}`);
          if (!spec.inverses.includes(k) && !spec.provides.includes(k)) throw new KernelError(`${spec.name}: an inverse touches undeclared key ${k}`);
        }
        const out = await does();
        e.stack.push(undo);
        return out;
      },
      provide(key, value) {
        guard('provide');
        if (!spec.provides.includes(key)) throw new KernelError(`${spec.name}: provides undeclared key ${key}`);
        if (kernel.services.has(key)) throw new KernelError(`${spec.name}: ${key} is already provided`);
        kernel.services.set(key, { provider: spec.name, value });
        e.stack.push(() => { if (kernel.services.get(key)?.provider === spec.name) kernel.services.delete(key); });
        return value;
      },
      /** Append one emission row; never undone. Allowed after apply too (a row per evaluation), never once inactive. */
      record(key, row) {
        if (e.gen !== gen || (e.state !== 'active' && e.state !== 'activating')) throw new KernelError(`${spec.name}: records ${key} while inactive`);
        if (!spec.emits.includes(key)) throw new KernelError(`${spec.name}: records undeclared emission ${key}`);
        const frozen = deepFreeze(structuredClone(row));
        if (!kernel.emissions.has(key)) kernel.emissions.set(key, []);
        kernel.emissions.get(key).push(frozen);
        kernel.sinks[key]?.(frozen);
        return frozen;
      },
    });
    return { api, close() { open = false; } };
  }

  /** A provided service, for a caller outside the kernel (a runner). Throws, naming the key, when nothing provides it. */
  service(key) {
    if (!this.services.has(key)) throw new KernelError(`no provider for ${key}`);
    return this.services.get(key).value;
  }

  /** One row per loaded component: `active`, `inactive: missing <key>`, `inactive: <why>` or `failed: <message>`. */
  census() {
    return [...this.entries.values()].map(e => ({
      name: e.spec.name,
      status: e.state === 'active' ? 'active' : e.state === 'failed' ? e.reason : `inactive: ${e.reason ?? 'not activated'}`,
      inject: [...e.spec.inject],
      provides: [...e.spec.provides],
    }));
  }

  /**
   * The inside-boundary state, order-insensitive: each component's status, config and undo-stack depth, and each
   * service's provider. Emissions and the lifecycle log are history and stay outside it by design.
   */
  snapshot() {
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return {
      components: [...this.entries.values()].map(e => ({ name: e.spec.name, status: e.state === 'active' ? 'active' : 'inactive', config: e.config, effects: e.stack.length })).sort(byName),
      services: [...this.services.entries()].map(([key, s]) => ({ name: key, provider: s.provider })).sort(byName),
    };
  }
}

// ------------------------------------------------------------------------------------------- the harness.json loader

/** Validate a harness.json document: { schema, keys?, components: [{ module, export?, name?, config? }], log?, note? }. */
export function parseHarness(doc) {
  if (doc?.schema !== HARNESS_SCHEMA) throw new KernelError(`harness.json: schema must be ${HARNESS_SCHEMA}`);
  const extra = Object.keys(doc).filter(k => !['schema', 'keys', 'components', 'log', 'note'].includes(k));
  if (extra.length) throw new KernelError(`harness.json: unknown field(s) ${extra.join(', ')}`);
  const keys = doc.keys ?? {};
  for (const [k, v] of Object.entries(keys)) if (!NAME.test(k) || !KEY_KINDS.includes(v)) throw new KernelError(`harness.json: key ${k} has kind ${v}`);
  if (!Array.isArray(doc.components) || doc.components.length === 0) throw new KernelError('harness.json: components must be a non-empty array');
  const components = doc.components.map((c, i) => {
    if (typeof c?.module !== 'string' || !c.module.endsWith('.mjs') || c.module.startsWith('/') || c.module.split('/').includes('..')) {
      throw new KernelError(`harness.json: components[${i}].module must be a repo-relative .mjs path`);
    }
    return { name: c.name ?? null, module: c.module, export: c.export ?? 'default', config: c.config ?? {} };
  });
  if (doc.log !== undefined && (typeof doc.log !== 'string' || doc.log.startsWith('/') || doc.log.split('/').includes('..'))) throw new KernelError('harness.json: log must be a relative path');
  return { keys, components, log: doc.log ?? null };
}

const modules = new Map(); // a module is imported once per process and never re-imported (no code HMR)

/** Resolve the component spec each entry names; `root` is what module paths are relative to. */
export async function resolveHarness(parsed, { root }) {
  const out = [];
  for (const c of parsed.components) {
    const url = pathToFileURL(resolve(root, c.module)).href;
    if (!modules.has(url)) modules.set(url, await import(url));
    const spec = modules.get(url)[c.export];
    if (!spec || !Object.isFrozen(spec) || typeof spec.apply !== 'function') throw new KernelError(`${c.module}#${c.export} is not a component spec`);
    if (c.name !== null && c.name !== spec.name) throw new KernelError(`${c.module}#${c.export} is ${spec.name}, harness.json says ${c.name}`);
    if (out.some(o => o.spec.name === spec.name)) throw new KernelError(`harness.json: component ${spec.name} listed twice`);
    out.push({ spec, config: c.config });
  }
  return out;
}

/**
 * Load a harness.json into a fresh kernel. dryRun: return the plan only (activation order, unsatisfied with the key
 * named, ill-typed) and apply nothing. strict: refuse, naming the keys, when any component would stay inactive.
 */
export async function loadHarness(path, { root = dirname(path), dryRun = false, strict = false, sinks = {} } = {}) {
  const parsed = parseHarness(JSON.parse(readFileSync(path, 'utf8')));
  const specs = await resolveHarness(parsed, { root });
  const p = plan(specs.map(s => s.spec), parsed.keys);
  if (dryRun) return { plan: p };
  if (p.illTyped.length) throw new KernelError(`ill-typed: ${p.illTyped.join('; ')}`);
  if (strict && Object.keys(p.unsatisfied).length) throw new KernelError(`unsatisfied: ${Object.entries(p.unsatisfied).map(([n, r]) => `${n} (${r.join(', ')})`).join('; ')}`);
  const logPath = parsed.log ? resolve(root, parsed.log) : null;
  const kernel = new Kernel({ keys: parsed.keys, sinks, log: logPath ? line => appendFileSync(logPath, `${JSON.stringify(line)}\n`) : null });
  for (const { spec, config } of specs) await kernel.load(spec, config);
  return { plan: p, kernel };
}
