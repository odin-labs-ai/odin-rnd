import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBlueprint, resolveExtraction, makeExtractor, evaluate } from 'bce-engine';
import { factoryFloor } from './floor.mjs';
import { stations } from './station-contract.mjs';
import { builtCopy } from './test-build.mjs';

const root = resolve('.');
const blueprint = parseBlueprint(JSON.parse(readFileSync('.ai/blueprints/rnd-factory-surface.engineering-blueprint.json', 'utf8')));
const extraction = resolveExtraction(blueprint.extraction, blueprint.constraints);
const grade = directory => evaluate(blueprint, makeExtractor('line-scan', extraction).extract(directory, 'working-tree'), extraction.profile);

function assertSingleFactory(html) {
  assert.equal([...html.matchAll(/\bid="factory-geometry"/g)].length, 1, 'The home must contain one canonical factory drawing');
  const geometry = [...html.matchAll(/\bdata-floor-station="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(geometry.toSorted(), stations.map(station => station.id).toSorted(), 'Every station appears exactly once in the drawing');
  assert.doesNotMatch(html, /\bstation-crop\b|\bfactory-crop-geometry\b|<!--STATION_CROP-->/, 'A second cropped factory must not return');
}

test('the home uses one factory drawing with every station, and rejects a second copy', () => {
  const template = readFileSync('site/index.html', 'utf8');
  assert.equal([...template.matchAll(/<!--FLOOR-->/g)].length, 1, 'The template has exactly one factory mount');
  const floor = factoryFloor();
  const home = template.replace('<!--FLOOR-->', floor);
  assertSingleFactory(home);
  assert.throws(() => assertSingleFactory(home.replace('</main>', `${floor}</main>`)), /one canonical factory/, 'The assertion discriminates a reintroduced second full drawing');
});

test('the factory surface blueprint grades the real working tree', () => {
  const report = grade(root);
  assert.equal(report.coverage.extractor, 'line-scan');
  assert.equal(report.coverage.filesScanned, 4, 'All four production rendering surfaces are examined');
  assert.equal(report.verdict, 'pass', JSON.stringify(report.violations));
  assert.equal(report.violations.length, 0);
});

test('the same blueprint refuses the legacy crop pipeline in each production surface', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'rnd-factory-contract-'));
  try {
    for (const file of blueprint.extraction.paths) {
      mkdirSync(dirname(join(temporary, file)), { recursive: true });
      writeFileSync(join(temporary, file), readFileSync(join(root, file)));
    }
    assert.equal(grade(temporary).verdict, 'pass');
    const defect = {
      'scripts/build.mjs': "\nhtml = html.replace('<!--STATION_CROP-->', factoryFloor({crop:true}));\n",
      'scripts/floor.mjs': "\nconst duplicateClass = 'factory-svg station-crop';\n",
      'site/index.html': '\n<!--STATION_CROP-->\n',
      'site/assets/app.js': "\nconst duplicate = document.querySelector('.station-crop');\n",
    };
    for (const [file, seeded] of Object.entries(defect)) {
      const path = join(temporary, file);
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, original + seeded);
      const report = grade(temporary);
      assert.equal(report.verdict, 'fail', `The duplicate pipeline escaped the blueprint in ${file}`);
      assert.ok(report.violations.some(violation => violation.component === `file:${file}`), `The refusal names ${file}`);
      writeFileSync(path, original);
      assert.equal(grade(temporary).verdict, 'pass', `Removing the seeded defect restores ${file}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('the real disposable build contains one factory and exposes a double mount in the builder', { timeout: 600_000 }, () => {
  const built=builtCopy();
  const output=join(built,'dist/index.html');
  assertSingleFactory(readFileSync(output,'utf8'));
  const builder=join(built,'scripts/build.mjs');
  const source=readFileSync(builder,'utf8');
  const mount="html = html.replace('<!--FLOOR-->', factoryFloor());";
  assert.equal(source.split(mount).length,2,'the mutation targets the actual build mount exactly once');
  try {
    // This duplicate uses none of the legacy crop strings: the finished-output check must catch it.
    writeFileSync(builder,source.replace(mount,mount.replace('factoryFloor()','factoryFloor() + factoryFloor()')));
    // The builder is a bound witness input: regenerate real records for this disposable mutation.
    execFileSync(process.execPath,['scripts/run-roi-demos.mjs'],{cwd:built,stdio:'pipe'});
    execFileSync(process.execPath,['scripts/build.mjs'],{cwd:built,stdio:'pipe'});
    assert.throws(()=>assertSingleFactory(readFileSync(output,'utf8')),/one canonical factory/);
  } finally {
    writeFileSync(builder,source);
  }
});
