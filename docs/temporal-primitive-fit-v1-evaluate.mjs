import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const finitePositive = x => Number.isFinite(x) && x > 0;
const ratio = (a,b) => finitePositive(a) && finitePositive(b) ? a/b : null;
const rep = cell => cell.repetition ?? cell.rep;
const scenarioKey = cell => `${cell.kernel}/${cell.profile}/${cell.size}`;

function validateRun(report, protocol, reproduction) {
  const errors=[];
  if(report.outcome!=='completed'||report.errors?.length)errors.push('run did not complete without errors');
  if(report.mode!==(reproduction?'reproduction':'main'))errors.push('wrong run mode');
  if(report.seed!==(reproduction?protocol.reproductionSeed:protocol.seed))errors.push('wrong fixture seed');
  if(report.sourceFreezeVerified!==true)errors.push('end-of-run source freeze not verified');
  if(report.temporal?.outcome!=='passed'||report.temporal.mutations!==30||report.temporal.attempts!==33)errors.push('Temporal correctness did not pass completely');
  if(report.temporal?.checks?.length!==9||report.temporal.checks.some(c=>c.passed!==true))errors.push('Temporal receipt set invalid');
  for(const design of ['pg-monolithic','pg-split','mongo'])for(const name of ['duplicate-workflow-id-rejected','committed-CAS-reconciled-on-retry','same-code-mutation-history-replay']){
    if(report.temporal?.checks?.filter(c=>c.design===design&&c.check===name&&c.passed===true).length!==1)errors.push(`missing Temporal receipt: ${design}/${name}`);
  }
  if(!report.checks?.length||report.checks.some(c=>c.passed!==true))errors.push('correctness checks missing or failed');
  const expected=[];
  for(const [kernel,k] of Object.entries(protocol.kernels)){
    for(const profile of kernel==='A'?k.profiles:[{id:'attributes'}])for(const size of kernel==='A'?k.sizes:[0])
    for(let r=0;r<(reproduction?protocol.reproduction.repetitions:k.repetitions);r++)for(const design of k.designs)
      expected.push(`${kernel}/${profile.id}/${size}/${r}/${design}`);
  }
  const actual=(report.cells??[]).map(c=>`${scenarioKey(c)}/${rep(c)}/${c.design}`);
  if(actual.length!==expected.length||new Set(actual).size!==actual.length||expected.some(k=>!actual.includes(k)))errors.push('cell matrix incomplete or duplicated');
  for(const cell of report.cells??[]){
    const k=protocol.kernels[cell.kernel];
    if(!k){errors.push('unknown kernel');continue;}
    if(cell.operations!==(cell.kernel==='A'?k.operations:k.queries))errors.push(`wrong denominator: ${cell.label}`);
    if(cell.attempted!==cell.operations||cell.completed!==cell.operations)errors.push(`incomplete operation attempts: ${cell.label}`);
    if(!finitePositive(cell.medianMs)||!finitePositive(cell.p95Ms)||!finitePositive(cell.storageBytes))errors.push(`invalid latency/storage: ${cell.label}`);
    if(cell.kernel==='B'&&(cell.update?.operations!==k.updates||cell.update.attempted!==k.updates||cell.update.completed!==k.updates))errors.push(`missing maintenance denominator: ${cell.label}`);
    if(cell.kernel==='B'&&(!finitePositive(cell.update?.medianMs)||!finitePositive(cell.update?.p95Ms)))errors.push(`invalid maintenance latency: ${cell.label}`);
    const base=cell.kernel==='B'?cell.label.replace(/-query$/,''):cell.label;
    const named=cell.kernel==='A'?['corrupt-snapshot-detected','stale','wrong-tenant','missing','competing-CAS-exactly-one-winner']:['corrupt-snapshot-detected','corrupt-query-detected','full-query-matrix-before','full-query-matrix-after','wrong-tenant-attribute-update'];
    for(const name of named){
      const matches=report.checks?.filter(c=>c.label===base&&c.name===name&&c.passed===true)??[];
      if(matches.length!==1)errors.push(`missing control: ${base}/${name}`);
      if(name.startsWith('full-query-matrix')&&(matches[0]?.positiveCases!==k.queryCases||matches[0]?.negativeCases!==3))errors.push(`incomplete query controls: ${base}/${name}`);
    }
    for(const suffix of cell.kernel==='A'?['','-after-negative']:[''])if(report.checks?.filter(c=>c.label===base+suffix&&c.kind===(cell.kernel==='A'?'sessions':'attributes')&&c.passed===true).length!==1)errors.push(`missing snapshot: ${base+suffix}`);
    if(cell.kernel==='B')for(const group of k.queryGroups)for(const cls of k.queryClasses){
      const stratum=cell.strata?.[`${group}/${cls}`];
      if(!stratum||stratum.count!==k.queries/(k.queryGroups.length*k.queryClasses.length)||!finitePositive(stratum.medianMs)||!finitePositive(stratum.p95Ms))errors.push(`missing query stratum: ${cell.label}/${group}/${cls}`);
    }
  }
  return [...new Set(errors)];
}

function comparison(cells, mongoDesign, pgDesign, metric, protocol, reproduction){
  const m=cells.filter(c=>c.design===mongoDesign).sort((a,b)=>rep(a)-rep(b));
  const p=cells.filter(c=>c.design===pgDesign).sort((a,b)=>rep(a)-rep(b));
  const pairs=m.map((mc,i)=>{
    const pc=p[i],mm=metric==='mixed'?mc:mc.strata?.[metric],pm=metric==='mixed'?pc:pc?.strata?.[metric];
    return {repetition:rep(mc),medianRatio:ratio(mm?.medianMs,pm?.medianMs),p95Ratio:ratio(mm?.p95Ms,pm?.p95Ms),storageRatio:ratio(mc.storageBytes,pc?.storageBytes),maintenanceRatio:mc.kernel==='B'?ratio(mc.update?.medianMs,pc?.update?.medianMs):1};
  });
  const valid=pairs.length===p.length&&pairs.every(x=>Object.values(x).every(v=>v!==null&&Number.isFinite(v)));
  const d=protocol.decision,bar=1-d.minMedianLatencyReduction;
  const wins=pairs.filter(x=>x.medianRatio!==null&&x.medianRatio<=bar).length;
  const med=valid?median(pairs.map(x=>x.medianRatio)):null;
  const tail=valid?median(pairs.map(x=>x.p95Ratio)):null;
  const storage=valid?Math.max(...pairs.map(x=>x.storageRatio)):null;
  const maintenance=valid?median(pairs.map(x=>x.maintenanceRatio)):null;
  const passed=valid&&wins>=(reproduction?protocol.reproduction.repetitions:d.minWinningRepetitions)&&med<=bar&&tail<=d.maxP95Ratio&&storage<=d.maxStorageRatio&&maintenance<=d.maxMaintenanceMedianRatio;
  return {postgresDesign:pgDesign,passed,pairs,winningRepetitions:wins,medianLatencyRatio:med,medianP95Ratio:tail,maxStorageRatio:storage,medianMaintenanceRatio:maintenance};
}

export function evaluate(main, reproduction, protocol){
  const errors=[...validateRun(main,protocol,false).map(e=>`main: ${e}`),...validateRun(reproduction,protocol,true).map(e=>`reproduction: ${e}`)];
  if(errors.length)return {outcome:'invalid-or-incomplete',errors,scenarios:[],productionAdoption:false};
  const scenarios=[];
  for(const key of [...new Set(main.cells.map(scenarioKey))]){
    const cells=main.cells.filter(c=>scenarioKey(c)===key),repeat=reproduction.cells.filter(c=>scenarioKey(c)===key),kernel=cells[0].kernel;
    const mongo=kernel==='A'?'mongo':'mongo-wildcard',pg=kernel==='A'?['pg-monolithic','pg-split']:['pg-gin','pg-attributes'];
    const metrics=kernel==='A'?['mixed']:['mixed',...protocol.kernels.B.queryGroups.flatMap(g=>protocol.kernels.B.queryClasses.map(c=>`${g}/${c}`))];
    for(const metric of metrics){
      const primary=pg.map(design=>comparison(cells,mongo,design,metric,protocol,false));
      const replicated=pg.map(design=>comparison(repeat,mongo,design,metric,protocol,true));
      const wins=primary.map((c,i)=>c.passed&&replicated[i].passed);
      scenarios.push({scenario:key,metric,outcome:wins.every(Boolean)?'candidate-advantage':wins[0]?'jsonb-only-advantage':'no-demonstrated-advantage',primary,reproduction:replicated});
    }
  }
  return {outcome:scenarios.some(s=>s.outcome==='candidate-advantage')?'candidate-advantage':scenarios.some(s=>s.outcome==='jsonb-only-advantage')?'jsonb-only-advantage':'no-demonstrated-advantage',scenarios,productionAdoption:false,scope:'Prespecified local synthetic primitive screening; every scenario reported. No production-wide, workload-frequency, developer-productivity or operating-cost claim.'};
}

async function cli(){
  const [mainDir,reproDir,out]=process.argv.slice(2);if(!mainDir||!reproDir||!out)throw new Error('Usage: node evaluate.mjs MAIN_RUN REPRODUCTION_RUN OUTPUT.json');
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const sourceRoot=dirname(fileURLToPath(import.meta.url)),protocolBytes=await readFile(join(sourceRoot,'protocol.json'));
  const protocol=JSON.parse(protocolBytes);
  const [main,repro,mm,rm]=await Promise.all([read(join(mainDir,'report.json')),read(join(reproDir,'report.json')),read(join(mainDir,'manifest.json')),read(join(reproDir,'manifest.json'))]);
  if(JSON.stringify(mm.sourceHashes)!==JSON.stringify(rm.sourceHashes)||mm.protocolHash!==rm.protocolHash)throw new Error('Source/protocol mismatch across runs');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  if(sha(protocolBytes)!==mm.protocolHash)throw new Error('Current decision protocol differs from the run');
  if(!mm.sourceHashes['evaluate.mjs'])throw new Error('Evaluator not frozen by the run');
  for(const [file,expected] of Object.entries(mm.sourceHashes)){
    if(file.includes('..')||file.startsWith('/'))throw new Error('Invalid frozen source path');
    if(sha(await readFile(join(sourceRoot,file)))!==expected)throw new Error(`Frozen evaluation source changed: ${file}`);
  }
  const result=evaluate(main,repro,protocol);result.sourceHashes=mm.sourceHashes;result.protocolHash=mm.protocolHash;
  await writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,outcome:result.outcome,scenarios:result.scenarios.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await cli();
