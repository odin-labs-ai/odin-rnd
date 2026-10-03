# How an input reaches the checker (the materialisation contract)

The checker is bce-engine 0.3.1, a deterministic static checker. It never sees a live system. Each input a rule governs is written into a small file tree, and the checker grades that tree against a set of constraints. A constraint set says FAIL when any constraint finds a violation, and PASS otherwise. This contract says exactly which files exist for each input kind, which of them the checker reads, and how a probe input must be written so it can be materialised.

## Input kinds and the files they become

Every path below is relative to the tree root. The checker reads only the files listed under "Read by the checker".

### diff (a change to a repository)

Probe input: `{"patch": "<a unified diff>"}`. The patch is applied with `git apply` to a fixed base repository (below). The tree is the base AFTER the patch, plus:

- `.floor/diff.patch`: the patch text, verbatim.
- `.floor/added-lines.txt`: the added lines only. For each file the patch changes there is a header line `+++ <path>` (the post-change path, without a `b/` prefix or any tab-separated date), followed by each added line of that file, one per line, without its leading `+`. A deleted file contributes nothing.
- `.floor/added/<path>`: for each file the patch changes (not a deleted one), that file's added lines alone, one per line, without the `+`, at its post-change path under `.floor/added/`. Use this to scope a rule to some files [m32, m33]: for example `{"id": "scoped-example", "type": "forbiddenPattern", "severity": "high", "pattern": "^\\s*(export\\s+)?interface\\s", "path": ".floor/added/**/*.ts"}` checks only what the change adds to TypeScript files.

Read by the checker: `.floor/**` and `src/**/*.ts` (the post-patch TypeScript sources) [m29, m34]. Other files in the tree (package.json, test/, and a changed file outside src/) are not read, except through their `.floor` copies [m36, m37].

For a change (diff) rule the checker also reads the project's existing TypeScript sources under src/, which you cannot see and which contain ordinary code (interfaces, `as` casts, console.log, process.env reads, node:http imports) [m34, m50, m51, m52, m53]. To judge only what the change adds, target `.floor/added-lines.txt` [m29], or `.floor/added/**` with a file glob for a rule that applies to some files only [m32, m33]. A pattern is matched against one line at a time, so a construct spread over several lines is not matched as one [m31].

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

Read by the checker: `.floor/**` [m35].

### stopTranscript (an agent session at the moment it stops)

Probe input: `{"transcript": [<one JSON object per event>], "final_message": "<the agent's last message>"}`.

- `.floor/transcript.jsonl`: one JSON object per line, in order.
- `.floor/final-message.txt`: the final message, verbatim.

Read by the checker: `.floor/**` [m03, m40].

### file (a document handed to a scanner)

Probe input: `{"path": "<relative path>", "content": "<text>"}`.

- `.floor/files/<path>`: the content, verbatim.

Read by the checker: `.floor/**` [m39].

## The constraint types you may use

Only the types below are accepted; any other type (including `customPolicy`, `requiredDependency`, `requiredComponent`, `forbiddenPath`, `requiredEvidence`, `minimumMetric`, `behavioralInvariant`) is refused. Every constraint needs a unique `id`, its `type` and the field its type is graded on (below); a constraint without it is refused. A `severity` may be given but is ignored: every constraint is run at one severity.

- `forbiddenPattern`: FAIL when a JavaScript regular expression matches any single LINE of a read file [m29, m31]. Fields: `pattern` (required; the regex source, compiled with NO flags: there is no case-insensitive or multi-line mode [m30]; for a rule WITHOUT the i flag, write case variants into the pattern itself; for a rule WITH the i flag, see Case below: the input is lower-cased, so write the pattern in lower case), optional `path` (a glob narrowing which files count [m32, m33]). The checker refuses a pattern with nested unbounded quantifiers such as `(a+)+` [m54]. Example without the i flag: `{"id": "no-todo", "type": "forbiddenPattern", "pattern": "\\bTODO\\b", "path": ".floor/added-lines.txt"}`; the same for a rule with the i flag: `{"id": "no-todo", "type": "forbiddenPattern", "pattern": "\\btodo\\b", "path": ".floor/added-lines.txt"}`.
- `forbiddenFile`: FAIL when the path of a read file matches a glob [m37]; a file the checker does not read never matches [m36]. Field: `path` (required). Example: `{"id": "no-env-file", "type": "forbiddenFile", "path": ".floor/added/**/*.env"}`.
- `forbiddenDependency`: FAIL when a read file contains, where the text parses as TypeScript code, an import (`import ... from` [m10], `export ... from` [m47], `import x = require(...)` [m48]), a dynamic `import(...)` [m49] or a `require(...)` [m07] whose module specifier equals `to` or starts with `to/` [m10, m11]. Every read file is parsed as TypeScript, the `.floor` files included, so this fires on such code in plain prose [m01], in a final message [m03], in a command [m07], and in the REMOVED lines of `.floor/diff.patch` [m15]. It does not fire inside comments or string literals [m13, m14], so never from a value in `transcript.jsonl` or `tool-call.json` [m05, m06], from a quoted shell argument [m08] or a quoted phrase in a message [m04]; in prose, an apostrophe earlier on the line starts a string literal and hides the rest of that line [m02]. A type-only import never fires [m12]; installing a package is not an import [m09]. Fields: `to` (required), optional `scopePaths` (globs of the files that count). To judge only what a change adds, scope it to the post-change sources (`src/**`) or to `.floor/added/**` [m16, m17]. Example: `{"id": "no-lodash", "type": "forbiddenDependency", "to": "lodash", "scopePaths": [".floor/added/**"]}`.
- `forbiddenEgress`: FAIL when a read file contains, where the text parses as TypeScript code, a network call with a literal host that equals `to` or is a subdomain of it [m18, m25]. The calls it recognises: `fetch(...)` [m18], `http.request(...)` [m19], a bare `request(...)` [m20], `axios.get(...)` [m21], `new Client(...)` [m22] and `got(...)` [m23]. It does not fire on a shell command such as curl [m24], on a different host that merely ends with the same letters [m26], inside a string literal such as a quoted shell argument [m28], or when the host is not a literal [m38]. Every read file is parsed as TypeScript, the `.floor` files included, so such a call written in plain prose also fires [m27]. Field: `to` (required, a host). It takes no file scope: every read file counts [m27]. To judge only what a change adds, use a `forbiddenPattern` with `path` set to `.floor/added/**` [m32]. Example: `{"id": "no-example-host", "type": "forbiddenEgress", "to": "api.example.com"}`.

Case: If the rule's flags include i, the input is lower-cased before your constraints are checked; write patterns in lower case [m45]. For an i-flagged rule all read text, including code identifiers, is lower-cased, so for example `new Client(...)` no longer fires while `fetch` and `http.request` still do [m41, m42, m43]; file paths are not folded [m44].

Globs: `**` matches any number of path segments, `*` any characters within one segment, `?` one character [m32, m33, m37, m46].

A constraint set decides only what its constraints can see in the files the checker reads. Anything that needs the meaning of the text, the intent behind it, the state of the world outside these files, or a judgement of degree is not decided by it.
