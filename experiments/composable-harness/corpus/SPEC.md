# Corpus spec: 120 synthetic plugin-host configurations

This file is the entire brief for the corpus author. The author works only from this text.

## The world

A *host* registers a list of plugins at boot. Each plugin:

- has a `name` (lowercase, `[a-z][a-z0-9-]*`);
- may **need** zero or more *keys*, which it requires in order to work;
- may **provide** zero or more keys, which other plugins can then use.

A key is a short dotted string such as `store.read` or `q.release`.

### Which plugins are enabled

A config may carry a **profile**: either `null`, or `{ "enabledExtensions": [names…] }`.

- **`profile` is `null`:** every registered plugin is enabled.
- **`profile` is not `null`:** a plugin is enabled when its name is in the **floor** of the config's `floorEpoch`, or when it is in `profile.enabledExtensions`. Names in `enabledExtensions` that are not registered are ignored.

There are two floors, and both are fixed:

- **`FLOOR_PRE`**: `core-01`, `core-02`, … `core-25` (25 names).
- **`FLOOR_CURRENT`**: `FLOOR_PRE` plus `q`, `q-release`, `q-resume` (28 names).

A config's `floorEpoch` is `"pre"` or `"current"`.

The `q` trio has fixed wiring wherever it appears in a registry:

- `q` needs `q.release` and `q.resume`.
- `q-release` provides `q.release`.
- `q-resume` provides `q.resume`.

### When an enabled plugin works

An enabled plugin is **active** when every key it needs is provided by some *active* plugin. Resolve this as a fixpoint: repeatedly activate every enabled plugin whose needs are all met. No key is ever provided by more than one plugin in the same config.

An enabled plugin with an unmet need is **`inactive: missing <key>`**. If several needs are unmet, list them sorted and comma-separated, for example `inactive: missing a.x, missing b.y`. A need counts as unmet when its provider is absent, not enabled, or itself inactive.

A plugin that is not enabled is **`excluded`**.

### Schedule

A config may carry a **schedule** of runtime events, applied in `step` order after boot:

- `{ "step": n, "op": "withdraw", "name": p }`: plugin `p` stops providing its keys from step `n` on, as if it had been removed.
- `{ "step": n, "op": "restore", "name": p }`: `p` comes back.

Statuses are re-resolved after every event. **`expected` is the status after the last event.** `expectedAtBoot` is the status before any event.

## What to produce

Create exactly **120** JSON files, `cfg-001.json` … `cfg-120.json`, plus an `index.json`. Each config file has this shape:

```json
{
  "id": "cfg-001",
  "label": "faulty" | "clean",
  "faultClass": "none" | "<one class below>",
  "floorEpoch": "pre" | "current",
  "registry": [ { "name": "...", "needs": ["..."], "provides": ["..."] } ],
  "profile": null | { "enabledExtensions": ["..."] },
  "intended": ["..."],
  "schedule": [],
  "expectedAtBoot": { "<every registered name>": "active" | "inactive: missing <key>[, missing <key>]" | "excluded" },
  "expected":       { "<every registered name>": "..." },
  "note": "one plain sentence on what this config tests"
}
```

**`intended`** lists the plugins the operator means to be working.

**Labels by construction:**

- **`faulty`:** at least one name in `intended` is *not* `active` in `expected`.
- **`clean`:** every name in `intended` is `active` in `expected`, and the schedule (if any) leaves nothing intended broken at the end.

**60 configs must be faulty and 60 clean.**

### Fault classes

Each faulty config uses exactly one class. Use each class at least 8 times.

1. **`floor-epoch-drop`:** `floorEpoch` is `"pre"`, `intended` contains `q`, and the profile is non-null and does not list `q`. As a result `q` is `excluded`.
   - This is the historical incident shape: the plugin was meant to be always-on, but the old floor did not carry it. Include `q-release` and `q-resume` in the registry too.
   - At least 3 of these configs must be exactly the minimal shape: the registry is the 25 core plugins plus the `q` trio, and the profile lists only non-floor extras.
2. **`missing-dependency-pair`:** `q` is enabled, and `q` needs `q.release` and `q.resume`. One or both of `q-release` and `q-resume` (their providers) is excluded or absent.
   - Example: `floorEpoch: "pre"` with a profile that lists `q` but not its two helpers.
3. **`missing-dependency`:** a non-`q` plugin is enabled, but a key it needs is provided by no enabled plugin.
4. **`transitive-missing`:** A needs a key from B, and B is enabled but inactive because B's own need is unmet.
5. **`provider-withdrawn`:** at boot everything intended is active. A `withdraw` event then removes a provider, so an intended dependent ends up inactive.
6. **`profile-typo`:** the profile names a plugin that is not registered (for example `core-7` instead of `core-07`, or a misspelled extra), and an intended plugin that needs it is left inactive or excluded.

### Clean configs

Clean configs must look like the faulty ones: the same registries and the same mix of epochs and profiles.

Include these near-misses:

- `floorEpoch: "current"` with `q` intended and not in the profile. This is active, because `q` is in `FLOOR_CURRENT` together with its helpers.
- A withdraw that is followed by a restore before the end.
- A profile that is `null`.
- A typo'd name that nothing intended depends on.

### Naming rules

- Use only `core-01` … `core-25`, `q`, `q-release`, `q-resume`, and invented extras.
- Name extras `x-<word>`, built from ordinary English words (`x-ledger`, `x-notes`, `x-palette`).
- Do not use any company, product, person or customer name, and no real software package names.
- Keys are invented dotted words.
- Registries hold 6–40 plugins. Core plugins mostly need and provide nothing. Give a few of them small dependencies so that not every config is trivial.

### index.json

`index.json` lists the following for every config, plus the class counts:

```
{ "id", "label", "faultClass", "file", "sha256": <sha256 of the file's exact bytes> }
```

### Self-check before finishing

Write a small script, `verify.mjs`, in plain Node with no dependencies. It must:

1. Recompute every `expected` and `expectedAtBoot` from the rules above.
2. Check that each label follows from the rules.
3. Check the 60/60 split, the class minimums, and the `index.json` hashes.

Run it and fix the configs until it prints `OK`. Commit nothing; leave the files in the working directory.
