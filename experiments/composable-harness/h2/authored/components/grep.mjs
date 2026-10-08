export default {
  name: 'grep',
  needs: [],
  provides: ['grep'],
  async register(reg, config) {
    // Compiled-pattern cache: pattern string -> RegExp.
    const cache = new Map();
    const service = {
      cache,
      run(pattern, text) {
        if (!cache.has(pattern)) cache.set(pattern, new RegExp(pattern));
        return config.deps.grepRun(pattern, text);
      },
    };
    reg.provide('grep', service);
    return { cache };
  },
  async unregister(reg, handle) {
    reg.withdraw('grep');
    handle.cache.clear();
  },
};
