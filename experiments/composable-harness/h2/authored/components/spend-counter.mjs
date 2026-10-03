import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export default {
  name: 'spend-counter',
  needs: [],
  provides: ['spend'],
  async register(reg, config) {
    const rowsArr = [];
    const service = {
      add(kind, usd) {
        rowsArr.push({ kind, usd, at: Date.now() });
      },
      total() {
        return rowsArr.reduce((s, r) => s + r.usd, 0);
      },
      rows() {
        return rowsArr.map((r) => ({ ...r }));
      },
    };
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spend-counter-'));
    const state = { flushed: 0, chain: Promise.resolve(), seq: 0 };

    // Appends rows not yet written to the ledger. The batch is first written to a
    // partial file in tmpDir, then appended to the ledger and the partial removed.
    const flushOnce = async () => {
      const all = service.rows();
      const pending = all.slice(state.flushed);
      if (pending.length === 0) return;
      const body = pending.map((r) => JSON.stringify(r)).join('\n') + '\n';
      const partial = path.join(tmpDir, `partial-${state.seq++}.jsonl`);
      await fs.writeFile(partial, body);
      await fs.appendFile(config.ledgerPath, await fs.readFile(partial));
      await fs.rm(partial, { force: true });
      state.flushed = all.length;
    };
    const flush = () => {
      state.chain = state.chain.then(flushOnce, flushOnce);
      return state.chain;
    };
    const timer = setInterval(() => {
      flush().catch(() => {});
    }, config.flushMs);

    reg.provide('spend', service);
    return { timer, tmpDir, flush, state };
  },
  async unregister(reg, handle) {
    clearInterval(handle.timer);
    try {
      await handle.flush();
    } finally {
      await fs.rm(handle.tmpDir, { recursive: true, force: true });
      reg.withdraw('spend');
    }
  },
};
