# How an input reaches the checker (the materialisation contract)

The checker is bce-engine 0.3.1, a deterministic static checker. It never sees a live system. Each input a rule governs is written into a small file tree, and the checker grades that tree against a set of constraints. A constraint set says FAIL when any constraint finds a violation, and PASS otherwise. This contract says exactly which files exist for each input kind, which of them the checker scans, and how a probe input must be written so it can be materialised.

## Input kinds and the files they become

Every path below is relative to the tree root. The checker scans only the files listed under "scanned".

### diff (a change to a repository)

Probe input: `{"patch": "<a unified diff>"}`. The patch is applied with `git apply` to a fixed base repository (below). The tree is the base AFTER the patch, plus:

- `.floor/diff.patch`: the patch text, verbatim.
- `.floor/added-lines.txt`: the added lines only. For each file the patch changes there is a header line `+++ <path>` (the post-change path, without a `b/` prefix or any tab-separated date), followed by each added line of that file, one per line, without its leading `+`. A deleted file contributes nothing.
- `.floor/added/<path>`: for each file the patch changes (not a deleted one), that file's added lines alone, one per line, without the `+`, at its post-change path under `.floor/added/`. Use this to scope a rule to some files: for example `{"id": "scoped-example", "type": "forbiddenPattern", "severity": "high", "pattern": "^\\s*(export\\s+)?interface\\s", "path": ".floor/added/**/*.ts"}` checks only what the change adds to TypeScript files.

Scanned: `.floor/**` and `src/**/*.ts` (the post-patch TypeScript sources). Other files in the tree (package.json, test/) exist but are not scanned.

For a change (diff) rule the checker also scans the project's existing TypeScript sources under src/, which you cannot see and which contain ordinary code (interfaces, `as` casts, console.log, process.env reads, node:http imports). To judge only what the change adds, target `.floor/added-lines.txt`, or `.floor/added/**` with a file glob for a rule that applies to some files only. Each line is matched on its own, so a construct spread over several lines cannot be matched as one.

The base repository (a small TypeScript service), file list:

```
package.json
src/app/index.ts
src/app/issue-invoice.ts
src/app/place-order.ts
src/app/ports.ts
src/app/register-customer.ts
src/config/settings.ts
src/domain/customer.ts
src/domain/errors.ts
src/domain/index.ts
src/domain/invoice.ts
src/domain/money.ts
src/domain/order.ts
src/infra/db/customer-repository.ts
src/infra/db/invoice-repository.ts
src/infra/db/order-repository.ts
src/infra/db/pool.ts
src/infra/http/routes.ts
src/infra/index.ts
src/infra/mail/mailer.ts
src/main.ts
test/order.test.ts
```

The contents of these files are not part of this contract, so a probe patch that edits an existing file will usually fail to apply. Write probe patches that ADD new files (`--- /dev/null` / `+++ b/<path>`); a new-file patch applies to this base whatever its contents. A patch may not touch `.floor/`.

### toolCall (a tool call an agent is about to make)

Probe input: `{"tool_name": "<tool>", "tool_input": {...}}`, the shape a pre-tool-use hook receives (for a shell call, `{"tool_name": "Bash", "tool_input": {"command": "<shell command>"}}`; for a file tool, `tool_input` carries `file_path` and its other fields).

- `.floor/tool-call.json`: the whole input, pretty-printed as JSON with two-space indentation, so each field is on its own line.
- `.floor/command.txt`: `tool_input.command` verbatim when it is a string, else empty.

Scanned: `.floor/**`.

### stopTranscript (an agent session at the moment it stops)

Probe input: `{"transcript": [<one JSON object per event>], "final_message": "<the agent's last message>"}`.

- `.floor/transcript.jsonl`: one JSON object per line, in order.
- `.floor/final-message.txt`: the final message, verbatim.

Scanned: `.floor/**`.

### file (a document handed to a scanner)

Probe input: `{"path": "<relative path>", "content": "<text>"}`.

- `.floor/files/<path>`: the content, verbatim.

Scanned: `.floor/**`.

## The constraint types you may use

Only the types below are accepted; any other type (including `customPolicy`, `requiredDependency`, `requiredComponent`, `forbiddenPath`, `requiredEvidence`, `minimumMetric`, `behavioralInvariant`) is refused. Every constraint needs a unique `id`, its `type` and a `severity` (`info`, `low`, `medium`, `high` or `critical`).

- `forbiddenPattern`: FAIL when a JavaScript regular expression matches any single LINE of a scanned file. Fields: `pattern` (the regex source, compiled with NO flags: there is no case-insensitive or multi-line mode; for a rule WITHOUT the i flag, write case variants into the pattern itself; for a rule WITH the i flag, see Case below: the input is lower-cased, so write the pattern in lower case), optional `path` (a glob narrowing which files count). The checker refuses a pattern with nested unbounded quantifiers such as `(a+)+`. Example without the i flag: `{"id": "no-todo", "type": "forbiddenPattern", "severity": "high", "pattern": "\\bTODO\\b", "path": ".floor/added-lines.txt"}`; the same for a rule with the i flag: `{"id": "no-todo", "type": "forbiddenPattern", "severity": "high", "pattern": "\\btodo\\b", "path": ".floor/added-lines.txt"}`.
- `forbiddenFile`: FAIL when a scanned file's path matches a glob. Field: `path`. Example: `{"id": "no-env-file", "type": "forbiddenFile", "severity": "high", "path": "src/**/*.env.ts"}`.
- `forbiddenDependency`: FAIL when a scanned file contains an import (`import ... from`, `export ... from`, `import x = require(...)`), a dynamic `import(...)` or a `require(...)` whose module specifier equals `to` (or starts with `to/`). The checker reads EVERY scanned file as TypeScript, including the `.floor` files, so this also fires on such text in prose, in a transcript's final message, in a tool call's command, and in the REMOVED lines of `.floor/diff.patch`. Fields: `to`, optional `scopePaths` (globs of the files that count). To judge only what a change adds, scope it to the post-change sources (`src/**`) or to `.floor/added/**`. Example: `{"id": "no-lodash", "type": "forbiddenDependency", "severity": "high", "to": "lodash", "scopePaths": [".floor/added/**"]}`.
- `forbiddenEgress`: FAIL when a scanned file contains a network call (`fetch`, `http.request`, `https.request`, `axios`, `got`) with a literal host that equals `to` or is a subdomain of it. Every scanned file is read as TypeScript, including the `.floor` files, so this also fires on such a call written in prose, a transcript, a tool call's command, or the removed lines of `.floor/diff.patch`. Fields: `to` (a host). It takes no file scope, so it cannot be limited to what a change adds; for that, use a `forbiddenPattern` with `path` set to `.floor/added/**`. Example: `{"id": "no-example-host", "type": "forbiddenEgress", "severity": "high", "to": "api.example.com"}`.

Case: If the rule's flags include i, the input is lower-cased before your constraints are checked; write patterns in lower case.

Globs: `**` matches any number of path segments, `*` any characters within one segment, `?` one character.

A constraint set decides only what its constraints can see in the scanned files. Anything that needs the meaning of the text, the intent behind it, the state of the world outside these files, or a judgement of degree is not decided by it.
