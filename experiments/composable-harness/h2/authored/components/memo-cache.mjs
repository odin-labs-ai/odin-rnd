export default {
  name: 'memo-cache',
  needs: [],
  provides: ['memo'],
  async register(reg) {
    const map = new Map();
    const service = {
      get: (sha) => map.get(sha),
      set: (sha, value) => {
        map.set(sha, value);
      },
      clear: () => map.clear(),
      keys: () => [...map.keys()],
    };
    reg.provide('memo', service);
    return { map };
  },
  async unregister(reg, handle) {
    handle.map.clear();
    reg.withdraw('memo');
  },
};
