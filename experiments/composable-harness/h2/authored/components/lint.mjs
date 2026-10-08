export default {
  name: 'lint',
  needs: [],
  provides: ['lint'],
  async register(reg, config) {
    const service = {
      runs: 0,
      async run(item) {
        service.runs += 1;
        return await config.deps.lintRun(item);
      },
    };
    reg.provide('lint', service);
    return { service };
  },
  async unregister(reg, handle) {
    reg.withdraw('lint');
    handle.service.runs = 0;
  },
};
