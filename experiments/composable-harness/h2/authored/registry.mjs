// Plain registry: keys + components, no automatic cascade.
export function createRegistry() {
  const keys = new Map();
  // name -> { component, config, handle, status }
  const components = new Map();

  const reg = {
    provide(key, value) {
      if (keys.has(key)) throw new Error(`key already provided: ${key}`);
      keys.set(key, value);
    },
    withdraw(key) {
      keys.delete(key);
    },
    get(key) {
      return keys.get(key);
    },
    has(key) {
      return keys.has(key);
    },
    async register(component, config) {
      const name = component.name;
      if (components.has(name)) throw new Error(`component already registered: ${name}`);
      const missing = (component.needs || []).filter((k) => !keys.has(k)).sort();
      if (missing.length > 0) {
        components.set(name, {
          component,
          config,
          handle: undefined,
          status: 'skipped: ' + missing.map((k) => `missing ${k}`).join(', '),
        });
        return undefined;
      }
      const handle = await component.register(reg, config);
      components.set(name, { component, config, handle, status: 'registered' });
      return handle;
    },
    async unregister(name) {
      const entry = components.get(name);
      if (!entry) return;
      if (entry.status === 'registered') {
        await entry.component.unregister(reg, entry.handle, entry.config);
      }
      components.delete(name);
    },
    async reconfigure(name, config) {
      const entry = components.get(name);
      if (!entry) throw new Error(`unknown component: ${name}`);
      const { component } = entry;
      await reg.unregister(name);
      return reg.register(component, config);
    },
    list() {
      return [...components.entries()].map(([name, e]) => ({ name, status: e.status }));
    },
  };
  return reg;
}
