# Lab dispatch schemas

| File | What it checks | Where it comes from |
|------|----------------|---------------------|
| `odin-dispatch-v1.schema.json` | A session manifest as the agent space exports it (`odin-dispatch` v1). `scripts/lab-dispatch-publish.mjs` refuses a manifest that does not match. | Vendored from the private agent-space source repository, file `games/agent_space/dispatch.schema.json` at commit `9e8b9b71dcbbdf044c34d2316b873ad4fd9c9c33` (2026-10-25; adds the optional `substitutions` list — fields of the exported proofs replaced by their public label). |
| `odin-dispatch-questions-v1.schema.json` | The questions file a session is filmed from: the space's own format (`odin-dispatch-questions` v1) or this site's intake (`odin-questions` v1). `scripts/lab-intake.mjs` checks the file it writes against it, and `scripts/lab-answer-back.mjs` checks the file it reads. | Vendored from the private agent-space source repository, file `games/agent_space/dispatch-questions.schema.json` at commit `fb9bbb67d0fa15b52297b0a9cefcc1d442941045` (2026-10-25), byte-identical: no edit. sha256 `1304177139465e1ef873093e517932dec181794af6fcd2f689f4d958d689476f`. |
| `odin-lab-dispatch.schema.json` | The public part of one session, as the publisher writes it to `site/data/labs/agent-space/dispatches/<session>.json`. `scripts/labs.mjs` fails the build on a dispatch that does not match. | Written here. |

## The one edit in the vendored dispatch schema

The upstream file is byte-identical to the vendored copy except for one `description` string: the `commit` property's description named the private project. It reads `"the source commit that filmed it"` here. No keyword, type, pattern or requirement differs.

- upstream sha256: `e86ab626903b563c97d6cfd3837ba6c1f27997e7d1986ba2a3fea4f7c0b07a14`
- vendored sha256: `ab6a19e8021056a1b61226e74901265810c36215445396c676ef62aac80f634e`

When the upstream schema changes, vendor it again with the same edit (or none, once the upstream wording is neutral), update both hashes and the commit above, and run `node --test scripts/lab-dispatch-publish.test.mjs`.

The questions schema needed no edit: it names no private project. When it changes upstream, vendor it again, update its commit and hash in the table, and run `node --test scripts/lab-intake.test.mjs scripts/lab-answer-back.test.mjs`.

## Why two dispatch schemas

The manifest carries fields the site never publishes (the space's local URL, the source commit, who asked), and its schema requires them. The public dispatch drops them, so it cannot match the manifest's schema. The publisher checks the manifest against the vendored schema; the build checks each published dispatch against the public one, and runs the publisher's screen over it again.
