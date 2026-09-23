import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const engineRelease = Object.freeze({
  name: 'bce-engine', version: '0.3.1',
  integrity: 'sha512-hRWp4UvxWS7XnifOfrjRSxhIhUh8KB8n0I79Kyw6ffgSuH1s3aAwCVNapnsRIOH1rPXzxo/gTMMuyQewzgsrCg==',
  sourceSha: '7fc24fe24c3eb41366be990023ea37b00d2ca3b8',
  sourceUrl: 'https://github.com/blueprint-conformance/bce/tree/7fc24fe24c3eb41366be990023ea37b00d2ca3b8',
});
const hash = text => createHash('sha256').update(text).digest('hex');
// SHA-256 of exact fixture file contents from the verified 0.3.1 npm archive.
const fixtureHashes = {
 'fixtures/typescript-module-layering.blueprint.json': '03eeae9010e12ae9f8a49696423091982075f05b6375cfa35c4d2ee1729650bf',
 'fixtures/typescript-module-surface/conformant/packages/domain/order.ts': 'e32d64da9c685736af8a6d25f089a102e30774c40e0328948df126f7dbab777c',
 'fixtures/typescript-module-surface/drift-reverse-layer/packages/domain/order.ts': 'fa925ecd8450cf92bc62a6c66fee3c4a1f09d6a07c06d67ffe2d76d7c3a43fe3',
 'fixtures/typescript-module-surface/conformant/packages/app/checkout.ts': '2f3f6a8ad32f5e57722abebe2edb82baf8b5105cafeddaffe68c4649bf44d0de',
 'fixtures/typescript-module-surface/drift-reverse-layer/packages/app/checkout.ts': '4b81efad9eba920087d82b7b50a41b28a8fd96627a40bb2051950bbc476b5292',
 'fixtures/typescript-module-surface/conformant/packages/app/view.ts': '4b9748b7aebe0e2eee729dbf04e13b2dae18412c52653492e004ff74809a2b13',
 'fixtures/typescript-module-surface/drift-reverse-layer/packages/app/view.ts': '4b9748b7aebe0e2eee729dbf04e13b2dae18412c52653492e004ff74809a2b13',
};
export function captureSourceBinding(packageRoot) {
 const pkg = JSON.parse(readFileSync(path.join(packageRoot,'package.json')));
 assert.equal(pkg.name,engineRelease.name); assert.equal(pkg.version,engineRelease.version);
 const capture = packagePath => {
  const text = readFileSync(path.join(packageRoot,packagePath),'utf8'), sha256=hash(text);
  assert.equal(sha256,fixtureHashes[packagePath],`Released fixture changed: ${packagePath}`);
  return {packagePath,sourceUrl:`https://github.com/blueprint-conformance/bce/blob/${engineRelease.sourceSha}/${packagePath}`,sha256,text};
 };
 const paths = ['packages/app/checkout.ts','packages/app/view.ts','packages/domain/order.ts'];
 const tree = variant => paths.map(p=>({path:p,...capture(`fixtures/typescript-module-surface/${variant}/${p}`)}));
 const clean=tree('conformant'),drift=tree('drift-reverse-layer');
 return {schemaVersion:1,recipeId:'module-layering',constraintId:'domain-cannot-import-app',location:{path:'packages/domain/order.ts',line:1},package:{...engineRelease},blueprint:capture('fixtures/typescript-module-layering.blueprint.json'),clean,drift,changedPaths:paths.filter((p,i)=>clean[i].sha256!==drift[i].sha256)};
}
export function validateSourceBinding(binding, run, packageRoot) {
 assert(binding,'Missing released source binding');
 assert.deepEqual(binding,captureSourceBinding(packageRoot),'Released source binding mismatch');
 assert.equal(run.id,binding.recipeId,'Fixture/recipe mismatch');
 assert.equal(run.violation,binding.constraintId,'Fixture/claim mismatch');
 assert(run.transcript.includes(`  evidence ${binding.location.path}#L${binding.location.line}\n`),'Fixture/location mismatch');
 assert(run.transcript.includes('  observed forbidden direct import module:packages/domain/order.ts -> module:packages/app/checkout.ts is present\n'),'Fixture/diagnosis mismatch');
 const rule=JSON.parse(binding.blueprint.text).constraints.find(c=>c.id===binding.constraintId);
 assert.equal(rule?.type,'forbiddenDependency');
 return binding;
}
export function parseDemo(transcript, recipe, exitCode) {
  const clean = [...transcript.matchAll(/^GREEN conformant: score (\d+), exit 0$/gm)];
  const drift = [...transcript.matchAll(/^RED drift: score (\d+), would exit 1, violation (.+)$/gm)];
  const completions = [...transcript.matchAll(/^bce demo: (.+) discriminates GREEN from RED$/gm)];
  return {
    passed: exitCode === 0 && clean.length===1 && drift.length===1 && completions.length===1 && completions[0][1]===recipe && Number(clean[0][1])===100 && Number(drift[0][1])<100,
    cleanScore: clean.length===1 ? Number(clean[0][1]) : null,
    driftScore: drift.length===1 ? Number(drift[0][1]) : null,
    violation: drift.length===1 ? drift[0][2] : null,
    processExitCode: exitCode,
  };
}
