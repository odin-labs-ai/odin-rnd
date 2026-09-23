import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recordingProvenance } from './recording-provenance.mjs';
import { parseDemo, engineRelease, captureSourceBinding, validateSourceBinding } from './transcript.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(root + 'site/data/experiments.json', { force: true });
const pkg = JSON.parse(readFileSync(new URL('../node_modules/bce-engine/package.json', import.meta.url)));
if (pkg.version !== engineRelease.version) throw new Error('Experiment engine must match the released pin');
const recipes = [
  { id: 'module-layering', title: 'Can a dependency cross the line?', type: 'TypeScript / direct imports', question: 'A domain module imports the application layer. Does the same blueprint distinguish it from a conforming tree?' },
  { id: 'python-module-layering', title: 'Does the boundary hold in Python?', type: 'Python / direct imports', question: 'The same directional-layer idea, expressed as Python imports. A packaged clean fixture and a reverse import go through the engine.' },
  { id: 'configuration-allowlist', title: 'What happens when configuration widens?', type: 'Configuration / source patterns', question: 'Compare an allowed configuration with a deliberately widened one using the released real-source pattern recipe.' },
];
const startedAt = new Date().toISOString();
const runs = recipes.map(recipe => {
  const started = performance.now();
  const result = spawnSync(process.execPath, [root + 'node_modules/bce-engine/dist/cli.js', 'demo', '--recipe', recipe.id], { cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  const transcript = (result.stdout || '') + (result.stderr || '');
  const parsed = parseDemo(transcript, recipe.id, result.status);
  const sourceBinding = recipe.id === 'module-layering' ? captureSourceBinding(root + 'node_modules/bce-engine') : undefined;
  if(sourceBinding && parsed.passed) validateSourceBinding(sourceBinding, {...recipe,...parsed,transcript}, root + 'node_modules/bce-engine');
  return { ...recipe, ...parsed, ...(sourceBinding ? {sourceBinding} : {}), durationMs: Math.round(performance.now() - started), transcript, transcriptSha256: createHash('sha256').update(transcript).digest('hex') };
});
const report = {
  schemaVersion: 1, engine: { package: pkg.name, version: pkg.version, source: engineRelease.sourceUrl, sourceSha: engineRelease.sourceSha, integrity: engineRelease.integrity },
  startedAt, completedAt: new Date().toISOString(), node: process.version,
  ...recordingProvenance(),
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  revisionMeaning: 'Base checkout revision. inputFilesSha256 identifies the actual experiment inputs, including local edits.',
  inputFilesSha256: Object.fromEntries(['package.json', 'pnpm-lock.yaml', 'scripts/run-experiments.mjs', 'scripts/transcript.mjs', 'scripts/recording-provenance.mjs'].map(file => [file, createHash('sha256').update(readFileSync(root + file)).digest('hex')])),
  scope: 'Packaged, author-controlled fixtures. The demo evaluates clean and drifted trees; its overall exit 0 means the discrimination experiment succeeded. The RED gate outcome would exit 1. These runs do not measure agent effectiveness or production reliability.',
  runs,
};
mkdirSync(root + 'site/data', { recursive: true });
writeFileSync(root + 'site/data/experiments.json', JSON.stringify(report, null, 2) + '\n');
for (const run of runs) console.log(`${run.id}: clean ${run.cleanScore} / drift ${run.driftScore}; discrimination ${run.passed ? 'PASS' : 'FAIL'}`);
if (runs.some(run => !run.passed)) process.exitCode = 1;
