export default {
  name: 'yesno-gate',
  needs: ['model', 'memo'],
  provides: ['gate'],
  async register(reg, config) {
    const model = reg.get('model');
    const memo = reg.get('memo');
    const bus = config.deps.bus;
    const service = {
      async decide(item) {
        const hit = memo.get(item.sha);
        if (hit !== undefined) return hit;
        const result = await config.deps.readout(model, item, config.stratum);
        memo.set(item.sha, result);
        return result;
      },
    };
    const onPinChanged = () => memo.clear();
    bus.on('pin-changed', onPinChanged);
    reg.provide('gate', service);
    return { bus, onPinChanged };
  },
  async unregister(reg, handle) {
    handle.bus.off('pin-changed', handle.onPinChanged);
    reg.withdraw('gate');
  },
};
