import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderWitness } from './witness-render.mjs';
import { validateReport, validateRecords } from './witness-records.mjs';
// Disposable test-only copies. Actual Java execution creates initial evidence; no public recording is invented.
test('record integrity and source freshness fail closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'witness-record-test-'));
 try {
  for(const dir of ['demos','scripts','.github']) await cp(new URL(`../${dir}`,import.meta.url),path.join(root,dir),{recursive:true});
  execFileSync('git',['init','-q',root]); execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','test fixture']);
  execFileSync(process.execPath,['scripts/run-roi-demos.mjs'],{cwd:root,env:{...process.env,GITHUB_ACTIONS:'false'},stdio:'pipe'});
  await validateRecords({root});
  const file=path.join(root,'site/data/witnesses/test-witness.json'),original=await readFile(file);
  await writeFile(file,Buffer.concat([original,Buffer.from(' ')])); await assert.rejects(validateRecords({root}),/Corrupt report/); await writeFile(file,original);
  const report=JSON.parse(original);
  const page = '<body><!--WITNESS_META--><!--WITNESS_METRICS--><!--WITNESS_BENCH--><!--WITNESS_TABLE--></body>';
  assert.match(renderWitness(page,report),/id="witness-data"/);
  assert.match(renderWitness(page,report),/local reproduction/);
  for(const o of report.observations) assert(renderWitness(page,report).includes(`id="observation-${o.id}"`));
  const ci={...report,environment:'GitHub Actions',workflowRun:'https://github.com/odin-labs-ai/odin-rnd/actions/runs/123',workflowAttempt:2};
  assert.match(renderWitness(page,ci),/runs\/123\/attempts\/2/);
  assert.doesNotMatch(renderWitness(page,ci),/Recorded local fixture/);
  const manifest=JSON.parse(await readFile(path.join(root,'site/data/witnesses/manifest.json')));
  await assert.rejects(validateRecords({root,manifestOverride:{...manifest,environment:'GitHub Actions',workflowRun:ci.workflowRun,workflowAttempt:2}}),/provenance mismatch/);
  assert.throws(()=>renderWitness(page.replace('<!--WITNESS_META-->',''),report),/Missing or duplicate WITNESS_META/);
  assert.throws(()=>renderWitness(page.replace('<!--WITNESS_META-->','<!--WITNESS_META--><!--WITNESS_META-->'),report),/Missing or duplicate WITNESS_META/);
  const missing=structuredClone(report); missing.observations.pop(); assert.throws(()=>validateReport(missing));
  const changed=structuredClone(report); changed.observations[1].verdict='accepted'; assert.throws(()=>validateReport(changed),/Changed classification/);
  const command=structuredClone(report); command.commands.pop(); assert.throws(()=>validateReport(command),/Missing command/);
  const duplicate=structuredClone(report); duplicate.observations[1].id=duplicate.observations[0].id; assert.throws(()=>validateReport(duplicate),/Duplicate/);
  const fixture=path.join(root,'demos/test-witness/fixtures/Witness.java'); await writeFile(fixture,(await readFile(fixture,'utf8'))+'\n// changed source\n'); await assert.rejects(validateRecords({root}),/Source inputs changed/);
  await rm(file); await assert.rejects(validateRecords({root}),/ENOENT/);
  // An execution failure removes the prior successful manifest and retains a failed-run receipt.
  assert.throws(()=>execFileSync(process.execPath,['scripts/run-roi-demos.mjs'],{cwd:root,env:{...process.env,JAVA_HOME:path.join(root,'missing-jdk')},stdio:'pipe'}));
  await assert.rejects(readFile(path.join(root,'site/data/witnesses/manifest.json')),/ENOENT/);
  assert.equal(JSON.parse(await readFile(path.join(root,'site/data/witnesses/failed-run.json'))).status,'failed');
  // Preserve opaque transcript bytes, including a sentinel, across the next successful execution.
  const failedReceipt = Buffer.from((await readFile(file,'utf8')) + '\nFAILURE_TRANSCRIPT_SENTINEL\n');
  await writeFile(file,failedReceipt);
  const previous = new Map();
  for (const name of await readdir(path.join(root,'site/data/witnesses'))) previous.set(name,await readFile(path.join(root,'site/data/witnesses',name)));
  execFileSync(process.execPath,['scripts/run-roi-demos.mjs'],{cwd:root,env:{...process.env,GITHUB_ACTIONS:'false'},stdio:'pipe'});
  await validateRecords({root});
  const archives = await readdir(path.join(root,'.ai/witness-failures'));
  const matching=[];
  for(const archive of archives) { try { const bytes=await readFile(path.join(root,'.ai/witness-failures',archive,'test-witness.json')); if(bytes.equals(failedReceipt)) matching.push(archive); } catch(error) { if(error.code!=='ENOENT') throw error; } }
  assert.equal(matching.length,1,'Failed transcript retained byte-for-byte exactly once');
  for(const [name,bytes] of previous) assert.deepEqual(await readFile(path.join(root,'.ai/witness-failures',matching[0],name)),bytes,`Archived ${name} unchanged`);
 } finally {await rm(root,{recursive:true,force:true});}
});
