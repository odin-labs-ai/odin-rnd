import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateProvenance } from './recording-provenance.mjs';
import { hashInputs } from '../demos/lib.mjs';
export const projects = ['test-witness','migration-witness','ci-witness'];
export const generatorInputs = ['scripts/recording-provenance.mjs','scripts/run-roi-demos.mjs','scripts/witness-records.mjs','scripts/witness-render.mjs','scripts/build.mjs','scripts/check.mjs','.github/workflows/publish.yml'];
export const digest = value => createHash('sha256').update(value).digest('hex');
const string = x => assert(typeof x === 'string' && x.length > 0, 'Required nonempty string');
const unique = xs => { assert(Array.isArray(xs)); xs.forEach(x=>string(x.id)); assert.equal(new Set(xs.map(x=>x.id)).size,xs.length,'Duplicate IDs'); };
export async function sourceInputs(root, project) {
 const walk = async dir => (await Promise.all((await readdir(path.join(root,dir),{withFileTypes:true})).map(e=>e.isDirectory()?walk(`${dir}/${e.name}`):`${dir}/${e.name}`))).flat();
 return ['demos/CONTRACT.md','demos/lib.mjs',...await walk(`demos/${project}`)].sort();
}
export function validateReport(r) {
 assert.equal(r.schemaVersion,1); assert(projects.includes(r.project)); assert.equal(r.projectVersion,'0.1.0'); assert.equal(r.mode,'authored-fixtures'); assert.equal(r.experimentVerdict,'passed','Failed discrimination');
 for(const t of [r.startedAt,r.completedAt]) assert(Number.isFinite(Date.parse(t)),'Invalid date'); assert(Date.parse(r.completedAt)>=Date.parse(r.startedAt));
 assert(/^v22\./.test(r.runtime.node)); assert(/version "21\./.test(r.runtime.java)); assert(/^javac 21\./.test(r.runtime.javac)); string(r.scope); assert(r.limitations.length>0); r.limitations.forEach(string); assert.equal(r.logsPathNormalized,true);
 unique(r.commands); unique(r.observations); unique(r.metrics);
 for(const c of r.commands){ assert(['java','javac'].includes(c.executable)); assert(Array.isArray(c.args)&&c.args.every(x=>typeof x==='string')); string(c.cwd); assert.equal(c.status,'completed','Incomplete execution'); assert(Number.isInteger(c.exitCode)); assert(Number.isFinite(c.durationMs)&&c.durationMs>=0); assert(typeof c.stdout==='string'&&typeof c.stderr==='string'); }
 const byId = new Map(r.commands.map(c=>[c.id,c]));
 for(const o of r.observations){ string(o.caseId); string(o.reason); assert(['baseline','candidate','negative-control','oracle'].includes(o.role)); assert(['accepted','rejected','inconclusive'].includes(o.verdict)); assert(o.expected!==undefined&&o.actual!==undefined); assert(o.commandIds.length>0); assert.equal(new Set(o.commandIds).size,o.commandIds.length); o.commandIds.forEach(id=>assert(byId.has(id),'Missing command reference')); }
 for(const m of r.metrics){ assert(Number.isFinite(m.numerator)&&Number.isFinite(m.denominator)&&m.numerator>=0&&m.denominator>0&&m.numerator<=m.denominator); string(m.unit); string(m.definition); }
 const obs = Object.fromEntries(r.observations.map(o=>[o.id,o]));
 const requireObs = (id,role,verdict) => { const o=obs[id]; assert(o,`Missing observation ${id}`); assert.equal(o.role,role); assert.equal(o.verdict,verdict,`Changed classification ${id}`); return o; };
 let expectedMetrics;
 if(r.project==='test-witness'){
  assert.equal(r.observations.length,12); requireObs('correct-strong','baseline','accepted');
  for(const c of ['rounding','threshold','validation']) { requireObs(`${c}-strong`,'candidate','accepted'); requireObs(`${c}-weak`,'negative-control','rejected'); }
  for(const c of ['correct-always-pass','rounding-always-pass','correct-always-fail']) requireObs(c,'negative-control','rejected');
  for(const c of ['correct-missing','correct-crash']) requireObs(c,'negative-control','inconclusive');
  for(const o of r.observations){ assert.equal(o.actual.assertionCount,o.actual.assertions.length); unique(o.actual.assertions); const execution=byId.get(o.commandIds.at(-1)); assert.equal(o.actual.exitCode,execution.exitCode); for(const a of o.actual.assertions) assert(execution.stdout.includes(`ASSERT|${a.id}|${a.status}|${a.actual}|${a.expected}`),'Assertion missing from receipt'); }
  expectedMetrics={'defects-detected':[3,3],unresolved:[r.observations.filter(o=>o.verdict==='inconclusive').length,12]};
 } else if(r.project==='ci-witness'){
  assert.equal(r.observations.length,32);
  for(const c of ['timezone','locale','order','config']) for(const v of ['baseline','reproducer','corrected','boundary','unrelated','suppressed','regression','unknown']) { const o=requireObs(`${c}-${v}`,v==='baseline'?'baseline':v==='boundary'?'oracle':['reproducer','corrected'].includes(v)?'candidate':'negative-control',v==='unknown'?'inconclusive':['unrelated','suppressed','regression'].includes(v)?'rejected':'accepted'); assert.equal(o.discriminationPassed,true); assert.equal(o.actual,o.expected); }
  expectedMetrics={'controlled-corrections':[4,4],discrimination:[32,32],unresolved:[r.observations.filter(o=>o.role!=='oracle'&&o.verdict==='inconclusive').length,28]};
 } else {
  assert.equal(r.observations.length,41);
  const cases=['round-half-cent','unicode','utc-day-boundary','leap-day','invalid-amount','empty-amount','invalid-date','empty-customer'];
  for(const variant of ['baseline','candidate','semantic-regression','shared-bug-baseline','shared-bug-candidate']) for(const c of cases){ const negative=!['baseline','candidate'].includes(variant); const o=requireObs(`${variant}:${c}`,negative?'negative-control':variant,negative&&['round-half-cent','leap-day'].includes(c)?'rejected':'accepted'); assert.equal(o.verdict,o.actual===o.expected?'accepted':'rejected'); assert.equal(r.runs[variant].actuals[c],o.actual); }
  requireObs('compile-failure','negative-control','inconclusive'); assert.deepEqual(Object.keys(r.controls).sort(),['compileFailureInconclusive','positiveAccepted','semanticRegressionRejected','sharedBugRejectedDespiteEquality'].sort()); assert(Object.values(r.controls).every(v=>v===true));
  expectedMetrics={'declared-preservation':[7,7],'control-discrimination':[4,4],'inconclusive-observations':[1,41]};
 }
 assert.deepEqual(Object.fromEntries(r.metrics.map(m=>[m.id,[m.numerator,m.denominator]])),expectedMetrics,'Metric consistency');
 assert(!/\/Users\/|\/private\/|\/home\/[^<\s]+/.test(JSON.stringify(r)),'Private paths in receipt');
 return r;
}
export async function validateRecords({root=process.cwd(),directory='site/data/witnesses', manifestOverride}={}) {
 const dir=path.resolve(root,directory); const manifest=manifestOverride ?? JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
 validateProvenance(manifest);
 assert.equal(manifest.schemaVersion,1); assert.equal(manifest.status,'passed'); assert.deepEqual(Object.keys(manifest.records).sort(),[...projects].sort());
 assert.deepEqual(manifest.generatorInputSha256,await hashInputs({root,relativePaths:generatorInputs}),'Generator inputs changed');
 assert(/^[a-f0-9]{40}$/.test(manifest.sourceRevision)); assert(typeof manifest.workingTree.dirty==='boolean');
 const reports=[];
 for(const project of projects){ const raw=await readFile(path.join(dir,`${project}.json`)); assert.equal(digest(raw),manifest.records[project].sha256,'Corrupt report digest'); const r=validateReport(JSON.parse(raw)); validateProvenance(r); for(const key of ['environment','workflowRun','workflowAttempt']) assert.equal(r[key],manifest[key],'Recording provenance mismatch'); assert.equal(r.project,project); assert.equal(r.runId,manifest.runId); assert.equal(r.sourceRevision,manifest.sourceRevision); assert.deepEqual(r.workingTree,manifest.workingTree); assert.deepEqual(Object.keys(r.inputSha256).sort(),await sourceInputs(root,project),'Input inventory changed'); assert.deepEqual(r.inputSha256,await hashInputs({root,relativePaths:Object.keys(r.inputSha256)}),'Source inputs changed'); reports.push(r); }
 return {manifest,reports};
}
