# Lab dispatch schemas

| File | What it checks | Where it comes from |
|------|----------------|---------------------|
| `odin-dispatch-v1.schema.json` | A session manifest as the agent space exports it (`odin-dispatch` v1). `scripts/lab-dispatch-publish.mjs` refuses a manifest that does not match. | Vendored from the private agent-space source repository, file `games/agent_space/dispatch.schema.json` at commit `fb9bbb67d0fa15b52297b0a9cefcc1d442941045` (2026-10-25). |
| `odin-lab-dispatch.schema.json` | The public part of one session, as the publisher writes it to `site/data/labs/agent-space/dispatches/<session>.json`. `scripts/labs.mjs` fails the build on a dispatch that does not match. | Written here. |

## The one edit in the vendored copy

The upstream file is byte-identical to the vendored copy except for one `description` string: the `commit` property's description named the private project. It reads `"the source commit that filmed it"` here. No keyword, type, pattern or requirement differs.

- upstream sha256: `a8f8e3fa3c810fd5efd710e29df7037e4bb8416cb7c05fd1faf8985abe916670`
- vendored sha256: `8189482031c1371135c846e7b1bcfe979ca34035aefbe74894ddb8e7c771543b`

When the upstream schema changes, vendor it again with the same edit (or none, once the upstream wording is neutral), update both hashes and the commit above, and run `node --test scripts/lab-dispatch-publish.test.mjs`.

## Why two schemas

The manifest carries fields the site never publishes (the space's local URL, the source commit, who asked), and its schema requires them. The public dispatch drops them, so it cannot match the manifest's schema. The publisher checks the manifest against the vendored schema; the build checks each published dispatch against the public one, and runs the publisher's screen over it again.
