import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDemo } from './transcript.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(root + 'site/data/experiments.json', { force: true });
const pkg = JSON.parse(readFileSync(new URL('../node_modules/bce-engine/package.json', import.meta.url)));
if (pkg.version !== '0.3.0') throw new Error('Experiment engine must remain pinned to bce-engine@0.3.0');
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
  return { ...recipe, ...parsed, durationMs: Math.round(performance.now() - started), transcript, transcriptSha256: createHash('sha256').update(transcript).digest('hex') };
});
const report = {
  schemaVersion: 1, engine: { package: pkg.name, version: pkg.version, source: 'https://github.com/blueprint-conformance/bce/tree/9fe4a02d39c05dbdf280b359e9b364de84e1eda8', integrity: 'sha512-KwWyEYOZu70xrQG5JYEyHNhz3eqTalno9d9+KUugytYBiWtHGO7Wpa+X/7xgi9xDc49V7OUchTJtN8Pu8T37iw==' },
  startedAt, completedAt: new Date().toISOString(), node: process.version,
  environment: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local reproduction',
  revision: process.env.GITHUB_SHA || spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  revisionMeaning: 'Base checkout revision. inputFilesSha256 identifies the actual experiment inputs, including local edits.',
  inputFilesSha256: Object.fromEntries(['package.json', 'pnpm-lock.yaml', 'scripts/run-experiments.mjs', 'scripts/transcript.mjs'].map(file => [file, createHash('sha256').update(readFileSync(root + file)).digest('hex')])),
  workflowRun: process.env.GITHUB_ACTIONS === 'true' ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  scope: 'Packaged, author-controlled fixtures. The demo evaluates clean and drifted trees; its overall exit 0 means the discrimination experiment succeeded. The RED gate outcome would exit 1. These runs do not measure agent effectiveness or production reliability.',
  runs,
};
mkdirSync(root + 'site/data', { recursive: true });
writeFileSync(root + 'site/data/experiments.json', JSON.stringify(report, null, 2) + '\n');
for (const run of runs) console.log(`${run.id}: clean ${run.cleanScore} / drift ${run.driftScore}; discrimination ${run.passed ? 'PASS' : 'FAIL'}`);
if (runs.some(run => !run.passed)) process.exitCode = 1;
