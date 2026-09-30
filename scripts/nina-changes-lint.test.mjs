import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PINNED } from './nina-changes-prereg.mjs';

// EXP 006 refute r3 B2: every module the pre-registration pins imports cleanly AND references no undefined identifier.
// The check uses the TypeScript compiler already in the lockfile (bundled by @ts-morph/common under bce-engine's
// ts-morph; no dependency added): a JS program over the pinned modules, reporting only "Cannot find name" (2304) and
// "Cannot find name … Did you mean" (2552). Node's globals are declared; unresolved node: imports are ignored.

const require = createRequire(import.meta.url);
const { Project, ts } = createRequire(require.resolve('bce-engine'))('ts-morph');
const modules = PINNED.filter(f => f.endsWith('.mjs'));
const GLOBALS = 'declare var process: any; declare var Buffer: any; declare var console: any; declare function setTimeout(...a: any[]): any; declare function clearTimeout(...a: any[]): any; declare function structuredClone(v: any): any; declare var URL: any; declare var TextEncoder: any; declare var TextDecoder: any;';

export function undefinedNames(files, extra = {}) {
  const project = new Project({ compilerOptions: { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2023.d.ts'], types: [], skipLibCheck: true }, skipAddingFilesFromTsConfig: true });
  for (const f of files) project.addSourceFileAtPath(f);
  project.createSourceFile('/__globals.d.ts', GLOBALS);
  for (const [name, text] of Object.entries(extra)) project.createSourceFile(name, text);
  const wanted = new Set([...files.map(f => resolve(f)), ...Object.keys(extra)]);
  return project.getPreEmitDiagnostics()
    .filter(d => [2304, 2552].includes(d.getCode()) && d.getSourceFile() && wanted.has(d.getSourceFile().getFilePath()))
    .map(d => `${d.getSourceFile().getFilePath().split('/').slice(-2).join('/')}: ${ts.flattenDiagnosticMessageText(d.getMessageText().compilerObject ?? d.getMessageText(), '\n')}`);
}

test('every pinned module references no undefined identifier (TypeScript "Cannot find name")', { timeout: 300_000 }, () => {
  assert.deepEqual(undefinedNames(modules), []);
});

test('the check catches a free identifier (a synthetic module using an unimported name)', { timeout: 300_000 }, () => {
  const src = readFileSync('experiments/nina-changes/matrix6-attempts.mjs', 'utf8') + '\nconst hex = () => randomBytes(8).toString(\'hex\');\n';
  const found = undefinedNames([], { '/synthetic/attempts.mjs': src });
  assert.ok(found.some(f => /Cannot find name 'randomBytes'/.test(f)), found.join('\n'));
});

test('every pinned module imports cleanly', async () => {
  for (const f of modules) await assert.doesNotReject(import(pathToFileURL(join(process.cwd(), f)).href), f);
});
