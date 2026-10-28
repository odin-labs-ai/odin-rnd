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
    for (const figure of ['€ 4 a month', '$12', 'USD 30', '15 euros', '&#36;12', '&#x24;12', '&dollar;12', '&euro;4', '%2412', '&#36;&#49;2', '$&#49;2', '&dollar;&#49;2']) {
      refuses(dir, BAR, page, s => s.replace('</main>', () => `<p>${figure}</p>\n</main>`), 'no-money-figure-on-a-lab-page');
    }
    for (const price of ['$0.30', '\\u00240.30', '\\u20ac4', '\\u0024\\u0030.30', '$\\u0030.30']) {
      refuses(dir, BAR, record, s => `${s}\n"price": "${price}"\n`, 'no-money-figure-in-a-lab-record');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lane commit cited by hand, not through laneCite, is refused in a builder, a lab page and a lab record', () => {
  const rule = 'a-lane-commit-is-cited-only-through-lanecite';
  const bare = 'private commit <code>d02ee74b</code>, cited by hash, on a pushed branch that is not yet part of the private main';
  const dir = copyOf([...BUILDERS, 'site/labs', 'site/data/labs', '.github/workflows']);
  try {
    assert.equal(grade(dir, BAR).verdict, 'pass');
    refuses(dir, BAR, 'scripts/lab-rogue.mjs', s => `${s}\nexport const handCite = \`${bare}\`;\n`, rule);
    refuses(dir, BAR, 'site/labs/rogue/index.html', s => s.replace('</main>', `<p>${bare}</p>\n</main>`), rule);
    refuses(dir, BAR, 'site/data/labs/rogue/record.json', s => `${s}\n"note": "not yet part of the private main"\n`, rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a workflow job on anything but one approved GitHub-hosted label is refused', () => {
  const file = '.github/workflows/publish.yml', hosted = '    runs-on: ubuntu-latest\n';
  const rule = 'public-workflows-run-on-hosted-runners-only';
  const dir = copyOf(['site/labs', 'site/data/labs', '.github/workflows']);
  try {
    assert.ok(readFileSync(join(dir, file), 'utf8').includes(hosted), `${file} has a hosted job to rewrite`);
    for (const runner of [
      '    runs-on: [self-hosted, linux, x64, hetzner, ci-heavy]\n',
      '    runs-on: self-hosted\n',
      '    runs-on:\n      - self-hosted\n',
      '    runs-on: ${{ matrix.os }}\n',
      '    runs-on: { group: Default }\n',
      '    "runs-on": self-hosted\n',
      "    'runs-on': self-hosted\n",
      '    runs-on: ubuntu-private\n',
      '    runs-on: *runner\n',
    ]) refuses(dir, BAR, file, s => s.replace(hosted, runner), rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a .yaml workflow, a flow-style job, an escaped key and a reusable workflow from another repository are refused too', () => {
  const dir = copyOf(['site/labs', 'site/data/labs', '.github/workflows']);
  const extra = '.github/workflows/extra.yaml';
  try {
    writeFileSync(join(dir, extra), 'name: extra\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n');
    assert.equal(grade(dir, BAR).verdict, 'pass', 'a hosted .yaml workflow passes');
    refuses(dir, BAR, extra, s => s.replace('runs-on: ubuntu-latest', 'runs-on: self-hosted'), 'public-workflows-run-on-hosted-runners-only');
    refuses(dir, BAR, extra, s => s.replace("jobs:\n  a:\n    runs-on: ubuntu-latest\n", 'jobs: { a: { runs-on: self-hosted } }\n  b:\n    runs-on: ubuntu-latest\n'), 'public-workflows-run-on-hosted-runners-only');
    for (const call of ['    uses: some-org/some-repo/.github/workflows/build.yml@main\n', '    "uses": some-org/some-repo/.github/workflows/build.yml@main\n', "    'uses': 'some-org/some-repo/.github/workflows/build.yml@main'\n"]) {
      refuses(dir, BAR, extra, s => s.replace("    runs-on: ubuntu-latest\n    steps:\n      - run: true\n", () => call), 'public-workflows-call-no-reusable-workflow-from-another-repository');
    }
    refuses(dir, BAR, extra, s => s.replace("jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n", () => 'jobs: { call: { uses: some-org/some-repo/.github/workflows/build.yml@main } }\n'), 'public-workflows-call-no-reusable-workflow-from-another-repository');
    // A YAML escape can spell runs-on without the substring; no workflow here needs an escape, so any is refused.
    refuses(dir, BAR, extra, s => s.replace('runs-on: ubuntu-latest', '"\\u0072uns-on": self-hosted'), 'public-workflows-carry-no-escaped-characters');
    refuses(dir, BAR, extra, s => s.replace('runs-on: ubuntu-latest', '"runs\\x2don": self-hosted'), 'public-workflows-carry-no-escaped-characters');
    // An escaped slash, or a double-quoted scalar that escapes its line break right after a character, rebuilds a path the other rules read literally.
    const call = "    runs-on: ubuntu-latest\n    steps:\n      - run: true\n";
    for (const hidden of [
      '    uses: "some-org\\/some-repo\\/.github\\/workflows\\/build.yml@main"\n',
      '    uses: "some-org/some-re\\\n      po/.github/workflows/build.yml@main"\n',
      '    "ru\\\n      ns-on": self-hosted\n',
    ]) refuses(dir, BAR, extra, s => s.replace(call, () => hidden), 'public-workflows-carry-no-escaped-characters');
    // A shell continuation (a space before the backslash) is not an escape and passes.
    const path = join(dir, extra), original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace('      - run: true\n', () => '      - run: |\n          echo one \\\n            two\n'));
    assert.equal(grade(dir, BAR).verdict, 'pass', 'a shell line continuation passes');
    writeFileSync(path, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pinned hosted label with comments passes, and a comment naming a self-hosted runner is not a job', () => {
  const file = '.github/workflows/publish.yml', hosted = '    runs-on: ubuntu-latest\n';
  const dir = copyOf(['site/labs', 'site/data/labs', '.github/workflows']);
  try {
    const path = join(dir, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(hosted, "    # never runs-on: self-hosted, this repo is public\n    runs-on: 'ubuntu-24.04'  # pinned\n"));
    assert.equal(grade(dir, BAR).verdict, 'pass', 'a quoted pinned hosted label with comments passes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
