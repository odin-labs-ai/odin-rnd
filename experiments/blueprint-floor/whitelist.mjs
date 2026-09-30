// EXP 007 WO-1-02: the constraint vocabulary, derived from the installed bce-engine 0.3.1 source (J4, R2-6, R3-2, R4-1).
//
// A type is in the vocabulary only if evaluate() implements it AND grades it statically on the pinned extraction
// profile. Every entry is cited by file:line in the installed engine, and the files' sha256 are recorded, so a
// test can re-derive the list and fail if the engine or the list moves. whitelist.json is this module's output.
//   node experiments/blueprint-floor/whitelist.mjs --write
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
export const ENGINE_DIR = join(REPO_ROOT, 'node_modules', 'bce-engine');
export const whitelistPath = 'experiments/blueprint-floor/whitelist.json';
const ENGINE_FILES = ['package.json', 'src/report.ts', 'src/schema.ts', 'src/extractors.ts', 'dist/cli.js'];
const sha256 = b => createHash('sha256').update(b).digest('hex');

function finder(engineDir) {
  const text = Object.fromEntries(ENGINE_FILES.map(f => [f, readFileSync(join(engineDir, f), 'utf8')]));
  const lines = Object.fromEntries(ENGINE_FILES.map(f => [f, text[f].split('\n')]));
  /** 1-based line of the first line containing `needle` in `file`, after line `after` (1-based, exclusive). */
  const at = (file, needle, after = 0) => {
    const i = lines[file].findIndex((l, n) => n >= after && l.includes(needle));
    if (i < 0) throw new Error(`${file}: "${needle}" not found in the installed engine`);
    return i + 1;
  };
  return { text, at };
}

const PLUGIN_TYPES = ['forbiddenDependency', 'forbiddenFile', 'forbiddenPattern', 'forbiddenEgress'];
const CONTROL_TYPES = ['forbiddenDependency', 'requiredDependency', 'requiredComponent', 'forbiddenPath', 'forbiddenFile', 'forbiddenPattern'];

/** Re-derive the whitelist from the engine installed at `engineDir`. */
export function deriveWhitelist(engineDir = ENGINE_DIR) {
  const { text, at } = finder(engineDir);
  const version = JSON.parse(text['package.json']).version;
  if (version !== '0.3.1') throw new Error(`bce-engine ${version} is installed; EXP 007 pins 0.3.1`);
  const evalStart = at('src/report.ts', 'export function evaluate(');
  const distEval = at('dist/cli.js', 'const moduleGraphComponentType = profile === "typescript-module-graph"');
  const branch = type => {
    const needle = type === 'requiredDependency' ? `if (c.type === 'requiredDependency')` : `} else if (c.type === '${type}'`;
    const dist = type === 'requiredDependency' ? `if (c.type === "requiredDependency")` : `} else if (c.type === "${type}"`;
    return { evaluate: `src/report.ts:${at('src/report.ts', needle, evalStart)}`, executes: `dist/cli.js:${at('dist/cli.js', dist, distEval)}`, schemaEnum: `src/schema.ts:${at('src/schema.ts', `  '${type}',`)}` };
  };
  const cite = (type, note, extra = {}) => ({ type, ...branch(type), ...extra, note });
  const fdStart = at('src/extractors.ts', 'const constraintForbidden = constraints');
  const reqStart = at('src/report.ts', "const targetType = isHistoricalD6 ? 'apiRouteHandler'");
  const reqEnd = at('src/report.ts', "expected: `at least one '${targetType}' component with a ${edgeType} edge`", reqStart) + 2;
  const skippedElse = at('src/report.ts', 'skipped += 1;', at('src/report.ts', "} else if (c.type === 'behavioralInvariant')"));
  const plugin = [
    cite('forbiddenDependency', 'Fires only on an import or export declaration whose module specifier equals `to` (or starts with `to/`) in a scanned file. The engine itself feeds every forbiddenDependency.to into the extractor\'s forbiddenImports; the adapter adds nothing. It has teeth on src/**/*.ts of a diff tree, not on .floor text files.', { feedsExtractor: `src/extractors.ts:${fdStart}-${fdStart + 2}` }),
    cite('forbiddenFile', 'Matches its path glob against the raw scanned-file set (coverage.scannedFiles).'),
    cite('forbiddenPattern', 'A per-line content regex over every scanned file (coverage.patternScan), optionally narrowed by a path glob. The engine compiles the pattern with no flags, so a flagged plugin regex is expressible only through an equivalent flag-free pattern. A pattern the engine\'s safe-compile guard rejects fails validation (recorded as an engine-limit downgrade).', { compiledWithoutFlags: `src/extractors.ts:${at('src/extractors.ts', 'return { pattern: p, re: new RegExp(p) };')}`, safeCompile: `src/schema.ts:${at('src/schema.ts', 'safeCompilePattern(c.pattern);')}` }),
    cite('forbiddenEgress', 'Sees only a TypeScript-syntactic network call (fetch, http(s).request, axios, got) with a literal host in a scanned source file; it has no teeth on .floor text files.'),
  ];
  const controls = [
    ...plugin.filter(p => p.type !== 'forbiddenEgress'),
    cite('requiredDependency', 'Controls only (typescript-module-graph). Under plugin-surface it grades provides edges on name-detected components and fails closed when there is no target component, so it cannot grade a .floor tree.', { pluginSurfaceFailClosed: `src/report.ts:${reqStart}-${reqEnd}` }),
    cite('requiredComponent', 'Controls only: under plugin-surface a component is name-detected, a heuristic.'),
    cite('forbiddenPath', 'Controls only: it matches extracted components, which plugin-surface detects by name, a heuristic.'),
  ].sort((a, b) => CONTROL_TYPES.indexOf(a.type) - CONTROL_TYPES.indexOf(b.type));
  const excluded = [
    { type: 'behavioralInvariant', reason: 'runtime: graded from served-runtime observations, never statically', evaluate: `src/report.ts:${at('src/report.ts', "} else if (c.type === 'behavioralInvariant')", evalStart)}`, schemaEnum: `src/schema.ts:${at('src/schema.ts', "  'behavioralInvariant',")}` },
    ...['requiredEvidence', 'minimumMetric', 'customPolicy'].map(type => ({ type, reason: 'declared in the schema, but evaluate() has no branch for it: it falls to the skipped arm and enforces nothing', schemaEnum: `src/schema.ts:${at('src/schema.ts', `  '${type}',`)}`, evaluate: `src/report.ts:${skippedElse} (the skipped arm)` })),
  ];
  const moduleGraphRefusesEgress = `src/schema.ts:${at('src/schema.ts', 'forbiddenEgress is not supported by')}`;
  return {
    schemaVersion: 1,
    engine: { package: 'bce-engine', version, files: Object.fromEntries(ENGINE_FILES.map(f => [f, sha256(text[f])])) },
    rule: 'A type is in the vocabulary only if evaluate() implements it and grades it statically on the pinned profile. Plugin rules: plugin-surface profile, ast extractor. Positive controls: typescript-module-graph over src/**/*.ts, exactly as EXP 005.',
    plugin: plugin.sort((a, b) => PLUGIN_TYPES.indexOf(a.type) - PLUGIN_TYPES.indexOf(b.type)),
    controls,
    controlsNote: `forbiddenEgress is not in the controls vocabulary: the engine's schema refuses it under typescript-module-graph (${moduleGraphRefusesEgress}).`,
    excluded,
    refusal: 'A constraint of any type outside the vocabulary is refused by the adapter with a typed error; customPolicy has its own error class because 0.3.1 declares it but does not enforce it.',
    flags: "A regex rule's flags are recorded per rule. forbiddenPattern compiles without flags (see compiledWithoutFlags), so the adapter and the census's mechanical checks stand in for them: an /i rule's input is lower-cased before the checker runs, and a pattern with an upper-case literal letter is refused; g and d change no verdict; any other flag cannot be verified mechanically and caps the rule at partial (protocol.mjs FLAG_HANDLING)."
  };
}

export const loadWhitelist = (root = REPO_ROOT) => JSON.parse(readFileSync(join(root, whitelistPath), 'utf8'));
export const serialiseWhitelist = w => JSON.stringify(w, null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write') { console.error('usage: node experiments/blueprint-floor/whitelist.mjs --write'); process.exit(2); }
  writeFileSync(join(REPO_ROOT, whitelistPath), serialiseWhitelist(deriveWhitelist()));
  console.log(`Wrote ${whitelistPath} from bce-engine at ${ENGINE_DIR}.`);
}
