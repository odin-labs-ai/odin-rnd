# How an input reaches the checker (the materialisation contract, module-graph form)

The checker is bce-engine 0.3.1, a deterministic static checker. It never sees a live system. For this rule each input is a change to a fixed TypeScript repository; the checker grades the repository AFTER the change against a set of constraints. A constraint set says FAIL when any constraint finds a violation, and PASS otherwise.

## The input kind and the files it becomes

### diff (a change to a repository)

Probe input: `{"patch": "<a unified diff>"}`. The patch is applied with `git apply` to the base repository below. The checker builds the import graph of every `src/**/*.ts` file of the post-patch tree (every scanned file is one module; imports, `import type`, `export ... from` and `import()` are edges) and scans those files line by line. Nothing else is scanned.

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

The contents of these files are not part of this contract, so a probe patch that edits an existing file will usually fail to apply. Write probe patches that ADD new files (`--- /dev/null` / `+++ b/<path>`); a new-file patch applies to this base whatever its contents.

## The constraint types you may use

Only the types below are accepted; any other type is refused. Every constraint needs a unique `id`, its `type` and a `severity` (`info`, `low`, `medium`, `high` or `critical`).

- `forbiddenDependency`: FAIL when a module matching `scopePaths` has a direct import edge to `to`. Fields: `to` (`module:<glob of repository paths>`, `package:<npm package>` or `builtin:<node module>`), `scopePaths` (required: globs of the importing files), `from` absent or `"*"`. An import the checker cannot resolve inside the scope also fails. Example: `{"id": "ui-no-db", "type": "forbiddenDependency", "severity": "high", "to": "module:src/db/**", "scopePaths": ["src/ui/**"]}`.
- `requiredDependency`: FAIL when a module matching `scopePaths` has no direct import edge to `to`. Fields: `component` (`"typescriptModule"`), `to`, `scopePaths`. Example: `{"id": "handlers-use-log", "type": "requiredDependency", "severity": "high", "component": "typescriptModule", "to": "module:src/log.ts", "scopePaths": ["src/handlers/**"]}`.
- `requiredComponent`: FAIL when the tree has no module at all. Field: `component` (`"typescriptModule"`). Example: `{"id": "has-modules", "type": "requiredComponent", "severity": "low", "component": "typescriptModule"}`.
- `forbiddenPath`: FAIL when a module's path matches a glob. Field: `path`. Example: `{"id": "no-legacy", "type": "forbiddenPath", "severity": "high", "path": "src/legacy/**"}`.
- `forbiddenFile`: FAIL when a scanned file's path matches a glob. Field: `path`. Example: `{"id": "no-env-file", "type": "forbiddenFile", "severity": "high", "path": "src/**/*.env.ts"}`.
- `forbiddenPattern`: FAIL when a JavaScript regular expression matches any single LINE of a scanned file. Fields: `pattern` (compiled with NO flags), optional `path` (a glob narrowing which files count). The checker refuses a pattern with nested unbounded quantifiers such as `(a+)+`. Example: `{"id": "no-todo", "type": "forbiddenPattern", "severity": "high", "pattern": "\\bTODO\\b", "path": "src/**"}`.

Globs: `**` matches any number of path segments, `*` any characters within one segment, `?` one character.

A constraint set decides only what its constraints can see in the scanned files. Anything that needs the meaning of the text, the intent behind it, the state of the world outside these files, or a judgement of degree is not decided by it.
