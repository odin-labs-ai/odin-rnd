# H2 spec: six components on a plain registry, with hand-written register and unregister

This file is the entire brief for the H2 author. The author works only from this text.

## The registry

Write `registry.mjs` (ES module, Node 22, no dependencies). It exports `createRegistry()`, which returns:

```
{
  provide(key, value)            // a key may be provided once; a second provide of a live key throws
  withdraw(key)                  // removes the key
  get(key)                       // the value, or undefined
  has(key)
  register(component, config)    // async: checks needs, then calls component.register(reg, config); keeps the handle
  unregister(name)               // async: calls component.unregister(reg, handle, config), then forgets it
  reconfigure(name, config)      // async: unregister(name), then register(component, config)
  list()                         // [{ name, status: 'registered' | 'skipped: missing <key>[, missing <key>]' }]
}
```

**Needs:**

- `register` only calls `component.register` when every key in `component.needs` is present.
- Otherwise it records the component as `skipped: missing <keys sorted, comma-separated>` and calls nothing.
- There is **no** automatic cascade. If a component's provider is unregistered, the dependent is not touched; its owner must handle that by hand.
- That missing cascade is the point of this arm: everything is cleaned up by hand.

## A component module

Each component is its own file. It default-exports an object:

```
{
  name, needs: [keys], provides: [keys],
  async register(reg, config) -> handle,
  async unregister(reg, handle, config)
}
```

`register` creates whatever the component needs. `unregister` must remove **everything** that `register` created:

- provided keys
- timers
- event listeners
- child processes, which must be killed **and** awaited until they exit
- caches
- temporary files
- environment variables it set

`config.deps` carries the pure functions the harness supplies. Call them; never reimplement them.

## The six components

### 1. `lint`

| Needs | Provides |
|---|---|
| nothing | `lint` |

- **Service:** `{ run(item) -> await config.deps.lintRun(item) }`.
- **Resources:** keeps a count of runs in the provided object. Nothing else.

### 2. `grep`

| Needs | Provides |
|---|---|
| nothing | `grep` |

- **Service:** `{ run(pattern, text) -> config.deps.grepRun(pattern, text) }`.
- **Resources:** holds a compiled-pattern cache, a `Map` from pattern string to `RegExp`. It must be empty after unregister.

### 3. `mlx.model`

| Needs | Provides |
|---|---|
| nothing | `model` |

**Config:**

```
{ pin: string,
  server: { command: string, args: string[], port: number, env?: object },
  readyPath: '/health', readyTimeoutMs: number,
  deps }
```

**Register:**

1. Spawn `server.command` with `server.args` as a child process. Do not use a shell, and give it no stdin. Use env = `process.env` plus `server.env`.
2. Poll `http://127.0.0.1:<port><readyPath>` until it returns 200, or until `readyTimeoutMs`. On timeout, kill the child, await its exit, and throw.
3. Provide `model`:

   ```
   { pin,
     async complete(prompt, opts) -> POST http://127.0.0.1:<port>/v1/completions with JSON { prompt, ...opts },
       returning the parsed JSON body,
     prefixKeys() -> [cache keys] }
   ```

**Prefix cache:**

- A `Map` keyed by `pin + '\u0000' + prompt.slice(0, 64)`, holding the last response for that key.
- `complete` consults it first.
- A different pin must never hit an entry made under another pin.

**Unregister:**

- Withdraw `model`.
- Clear the prefix cache.
- Kill the child (SIGTERM, then SIGKILL after 2 s if it is still alive) and **await its exit event**.
- Clear any polling timers.

**Reconfigure** with a new `pin` goes through unregister then register. Afterwards no key from the old pin may remain.

### 4. `yesno-gate`

| Needs | Provides |
|---|---|
| `model`, `memo` | `gate` |

**Service:**

```
{ async decide(item) }
```

- Look up `memo.get(item.sha)`. On a miss, call `config.deps.readout(model, item, config.stratum)`, which returns `{ decision: 'yes' | 'no', p: number }`. Store the result in `memo`, then return it.

**Resources:**

- Listens for `'pin-changed'` events on a shared `EventEmitter` passed as `config.deps.bus`. When it gets one, it calls `memo.clear()`.
- The listener must be removed on unregister.

### 5. `memo-cache`

| Needs | Provides |
|---|---|
| nothing | `memo` |

- **Service:** `{ get(sha), set(sha, value), clear(), keys() -> [shas] }`, backed by a `Map`.
- **Unregister:** clear the `Map` and withdraw `memo`.

### 6. `spend-counter`

| Needs | Provides |
|---|---|
| nothing | `spend` |

- **Service:** `{ add(kind, usd), total(), rows() }`, held in memory. It never touches the network.
- **Resources:**
  - A flush timer (`setInterval`, `config.flushMs`) that appends `rows()` as JSONL to the file `config.ledgerPath`.
  - A temporary directory it creates with `fs.mkdtemp` under `os.tmpdir()` for partial writes.
- **Unregister:** stop the timer, do one final flush, remove the temporary directory, and withdraw `spend`.

## What to produce

The author creates these files in the working directory:

- `registry.mjs`
- `components/lint.mjs`, `components/grep.mjs`, `components/mlx.model.mjs`, `components/yesno-gate.mjs`, `components/memo-cache.mjs`, `components/spend-counter.mjs`
- `selftest.mjs`

`selftest.mjs` must, using fake deps:

1. Register all six components in dependency order.
2. Call each service once.
3. Unregister them all in reverse order.
4. Print `OK`.

Fake deps means:
- a tiny HTTP server, written in the self-test file, that the `mlx.model` child runs (`process.execPath`, plus a script path it writes to the temporary directory);
- a stub `readout`;
- stub `lintRun` and `grepRun`.

Run the self-test and fix the code until it prints `OK`. Commit nothing; leave the files in place.
