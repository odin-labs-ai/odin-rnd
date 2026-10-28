// The lab bar as blueprints (docs/lab-bar.md): the released engine grades the real tree, then every rule is planted in
// a disposable copy, must fail naming the planted file, and must pass again once the plant is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('.');
const CLI = join(root, 'node_modules', 'bce-engine', 'dist', 'cli.js');
const KIT = { blueprint: '.ai/blueprints/rnd-labs-kit-boundary.engineering-blueprint.json', extractor: 'ast' };
const BAR = { blueprint: '.ai/blueprints/rnd-labs-bar.engineering-blueprint.json', extractor: 'line-scan' };
const BUILDERS = ['scripts/lab-engine-history.mjs', 'scripts/lab-rogue.mjs', 'scripts/lab-rogue-tamper.mjs'];
const KIT_IMPORT = /^import \{[^}]*\} from '\.\/lab-kit\.mjs';\n/m;

// bce run exits 0 with a pass and 1 with a fail; the report must agree. Anything else throws, never a verdict.
function grade(dir, { blueprint, extractor }) {
  const out = join(mkdtempSync(join(tmpdir(), 'rnd-labs-bar-report-')), 'report.json');
  try {
    const r = spawnSync(process.execPath, [CLI, 'run', '--blueprint', join(dir, blueprint), '--ct-repo', dir, '--no-pin', '--extractor', extractor, '--out', out], { encoding: 'utf8' });
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const agree = (r.status === 0 && report.verdict === 'pass') || (r.status === 1 && report.verdict === 'fail' && report.violations.length > 0);
    if (!agree) throw new Error(`bce run exit ${r.status} disagrees with verdict ${report.verdict}: ${r.stderr}`);
    return report;
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
}

function copyOf(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'rnd-labs-bar-'));
  for (const p of ['.ai/blueprints', 'docs/lab-bar.md', ...paths]) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    cpSync(join(root, p), join(dir, p), { recursive: true });
  }
  return dir;
}

// Plant `change` into `file`, require a fail by `constraint` naming that file, remove it, require a pass again.
function refuses(dir, spec, file, change, constraint) {
  const path = join(dir, file);
  const original = readFileSync(path, 'utf8');
  const planted = change(original);
  assert.notEqual(planted, original, `the plant changes ${file}`);
  writeFileSync(path, planted);
  try {
    const report = grade(dir, spec);
    assert.equal(report.verdict, 'fail', `the plant in ${file} escaped ${constraint}`);
    assert.ok(report.violations.some(v => v.constraintId === constraint && JSON.stringify(v).includes(file)), `${constraint} names ${file}: ${JSON.stringify(report.violations)}`);
  } finally {
    writeFileSync(path, original);
  }
  assert.equal(grade(dir, spec).verdict, 'pass', `removing the plant restores ${file}`);
}

test('both lab-bar blueprints grade the real tree as a pass, over a non-empty surface', () => {
  const kit = grade(root, KIT);
  assert.equal(kit.verdict, 'pass', JSON.stringify(kit.violations));
  assert.equal(kit.coverage.filesScanned, 4, 'the three results-lab builders and the kit are read');
  const bar = grade(root, BAR);
  assert.equal(bar.verdict, 'pass', JSON.stringify(bar.violations));
  assert.ok(bar.coverage.filesScanned >= 10, 'lab pages, lab records and workflows are read');
});

test('a results-lab builder without the kit, or reaching past it to the publisher screen, is refused', () => {
  const dir = copyOf([...BUILDERS, 'scripts/lab-kit.mjs']);
  try {
    assert.equal(grade(dir, KIT).verdict, 'pass');
    for (const file of BUILDERS) {
      assert.match(readFileSync(join(dir, file), 'utf8'), KIT_IMPORT, `${file} imports the kit on one line`);
      refuses(dir, KIT, file, s => s.replace(KIT_IMPORT, ''), 'results-lab-builders-import-the-lab-kit');
      refuses(dir, KIT, file, s => s.replace(KIT_IMPORT, m => `${m}import { screenHits as directScreen } from './lab-dispatch-publish.mjs';\n`), 'results-lab-builders-never-reach-past-the-kit-screen');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a money figure on a lab page or in a lab record is refused', () => {
  const page = 'site/labs/rogue/index.html', record = 'site/data/labs/rogue/record.json';
  const dir = copyOf(['site/labs', 'site/data/labs', '.github/workflows']);
  try {
    assert.equal(grade(dir, BAR).verdict, 'pass');
    for (const figure of ['€ 4 a month', '$12', 'USD 30', '15 euros']) {
      refuses(dir, BAR, page, s => s.replace('</main>', `<p>${figure}</p>\n</main>`), 'no-money-figure-on-a-lab-page');
    }
    refuses(dir, BAR, record, s => `${s}\n"price": "$0.30"\n`, 'no-money-figure-in-a-lab-record');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a workflow job on anything but one GitHub-hosted label is refused; hosted labels and comments pass', () => {
  const file = '.github/workflows/publish.yml', hosted = '    runs-on: ubuntu-latest\n';
  const dir = copyOf(['site/labs', 'site/data/labs', '.github/workflows']);
  try {
    assert.ok(readFileSync(join(dir, file), 'utf8').includes(hosted), `${file} has a hosted job to rewrite`);
    for (const runner of [
      '    runs-on: [self-hosted, linux, x64, hetzner, ci-heavy]\n',
      '    runs-on: self-hosted\n',
      '    runs-on:\n      - self-hosted\n',
      '    runs-on: ${{ matrix.os }}\n',
      '    runs-on: { group: Default }\n',
    ]) refuses(dir, BAR, file, s => s.replace(hosted, runner), 'public-workflows-run-on-hosted-runners-only');
    const path = join(dir, file), original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace(hosted, '    # never a self-hosted runner: this repo is public\n    runs-on: ubuntu-24.04  # pinned\n'));
    assert.equal(grade(dir, BAR).verdict, 'pass', 'a pinned hosted label with comments passes');
    writeFileSync(path, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
