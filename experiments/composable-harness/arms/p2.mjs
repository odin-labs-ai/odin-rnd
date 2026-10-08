// EXP 009 P2 runner: one blind-authored config (corpus/authored/cfg-NNN.json) on the harness kernel. Pure and $0.
//
// The host's enable rule is the spec's (corpus/SPEC.md): profile null -> every registered plugin; otherwise the
// config's floor plus profile.enabledExtensions. Only ENABLED plugins are loaded: a plugin that is not enabled never
// enters the kernel, so it is absent from the census, which P2 reads as `excluded` (analysis/SPEC.md). Each plugin is a
// kernel component that injects its needs (sorted, so the census lists missing keys sorted, as the spec does) and
// provides its keys. A schedule `withdraw` unloads the plugin (it is then absent = excluded until restored); `restore`
// loads it again. The runner reads `registry`, `profile`, `floorEpoch` and `schedule` only, never `expected` or `label`.
import { Kernel, defineComponent } from '../../../harness/kernel.mjs';

export const FLOOR_PRE = Object.freeze(Array.from({ length: 25 }, (_, i) => `core-${String(i + 1).padStart(2, '0')}`));
export const FLOOR_CURRENT = Object.freeze([...FLOOR_PRE, 'q', 'q-release', 'q-resume']);

export function enabled(config) {
  const names = config.registry.map(p => p.name);
  if (config.profile === null) return names;
  const floor = config.floorEpoch === 'current' ? FLOOR_CURRENT : FLOOR_PRE;
  const want = new Set([...floor, ...(config.profile.enabledExtensions ?? [])]);
  return names.filter(n => want.has(n));
}

const plugin = p => defineComponent({
  name: p.name,
  inject: [...p.needs].sort(),
  provides: p.provides,
  apply(ctx) { for (const k of p.provides) ctx.provide(k, { plugin: p.name, key: k }); },
});

/** { boot: [{ name, status }], end: [{ name, status }] }: the kernel census at boot and after the last event. */
export async function runConfig(config) {
  const specs = new Map(config.registry.map(p => [p.name, plugin(p)]));
  const k = new Kernel();
  try {
    for (const name of enabled(config)) await k.load(specs.get(name));
    const census = () => k.census().map(r => ({ name: r.name, status: r.status }));
    const boot = census();
    for (const ev of [...config.schedule].sort((a, b) => a.step - b.step)) {
      const loadedNow = k.entries.has(ev.name);
      if (ev.op === 'withdraw' && loadedNow) await k.unload(ev.name);
      if (ev.op === 'restore' && !loadedNow && enabled(config).includes(ev.name)) await k.load(specs.get(ev.name));
    }
    return { boot, end: census() };
  } finally {
    await k.dispose();
  }
}
