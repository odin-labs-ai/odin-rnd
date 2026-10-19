import assert from 'node:assert/strict';
import {Connection,Client,WorkflowIdReusePolicy} from '@temporalio/client';
import {Worker,Runtime,DefaultLogger} from '@temporalio/worker';
import {fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir,appendFile,stat} from 'node:fs/promises';
import {openSync,closeSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {OwnedRuntime,until} from './runtime.mjs';
import {fixtures,workload,digest,summary,SEED} from './fixtures.mjs';
import {verifyTimingRows} from './suites.mjs';
import {sendApproval} from './authorization.mjs';
const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
const runtimeRoot=resolve(process.env.TDF_RUNTIME_ROOT||join(here,'../../../local-runtime/temporal-document-fit'));
const runId=`run-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const out=join(runtimeRoot,'runs',runId),queue=`tdf-${runId}`;
const protocol=JSON.parse(await readFile(join(here,'protocol.json'),'utf8'));
const sanitise=value=>JSON.parse(JSON.stringify(value).replaceAll(runtimeRoot,'$RUNTIME_ROOT').replaceAll(here,'$SOURCE_ROOT').replaceAll(os.homedir(),'$HOME'));
await mkdir(out,{recursive:true});
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(sanitise(value),null,2)+'\n');
const runtime=new OwnedRuntime(runtimeRoot);
let worker,workerLog,client,connection,monitor,budgetError,monitorBusy=false,stopRequested=false;
let frozenSources;let sequence=0,completedMeasured=0;const started=Date.now(),cells=[],faults=[],evolutions=[],resourceSamples=[];
const errors=[];const report={runId,startedAt:new Date(started).toISOString(),protocolHash:createHash('sha256').update(await readFile(join(here,'protocol.json'))).digest('hex'),outcome:'inconclusive',thesis:'unresolved',cells,faults,evolutions,errors};
async function startWorker(){
 workerLog=openSync(join(out,`worker-${Date.now()}.log`),'a');worker=fork(join(here,'worker.mjs'),[],{cwd:here,env:{...process.env,TDF_OUTPUT:out,TDF_QUEUE:queue},stdio:['ignore',workerLog,workerLog,'ipc']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker startup timeout')),60000);worker.once('message',message=>{if(message.ready){clearTimeout(timer);resolve();}});worker.once('exit',code=>{clearTimeout(timer);reject(new Error(`Worker exited during startup: ${code}`));});});
}
async function stopWorker(){if(worker&&worker.exitCode===null){worker.kill('SIGTERM');try{await until(()=>worker.exitCode!==null||worker.signalCode!==null,15000);}catch{worker.kill('SIGKILL');await until(()=>worker.exitCode!==null||worker.signalCode!==null,5000);}}if(workerLog!==undefined){closeSync(workerLog);workerLog=undefined;}}
function checkBudget(){if(budgetError)throw budgetError;if(Date.now()-started>protocol.limits.wholeRunSeconds*1000)throw new Error('Whole-run 30 minute limit exceeded');}
async function bounded(promise,milliseconds,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} exceeded ${milliseconds}ms`)),milliseconds);})]);}finally{clearTimeout(timer);}}
async function startWorkflow(name,input,id){checkBudget();return client.workflow.start(name,{taskQueue:queue,workflowId:id||`${runId}-${sequence++}-${name}`,args:[input],workflowExecutionTimeout:'120 seconds',workflowIdReusePolicy:WorkflowIdReusePolicy.REJECT_DUPLICATE});}
async function invoke(name,input,ms=120000){const handle=await startWorkflow(name,input);try{return await bounded(handle.result(),ms,name);}catch(error){try{await handle.terminate('Experiment operation failed or reached its bound');}catch{}throw error;}}
const control=(arm,action,extra={})=>invoke('control',{arm,action,...extra});
const operation=(arm,method,args,extra={})=>invoke('operation',{arm,method,args,identity:typeof args[0]==='string'?args[0]:args[0].tenantId,...extra});
function expectPass(receipt){assert(receipt.oracle.ok,receipt.oracle.errors.join('\n'));}
async function fault(name,arm,fn){const time=Date.now();try{const evidence=await bounded(fn(),120000,name);faults.push({name,arm,passed:true,recoveryMs:Date.now()-time,evidence});}catch(error){faults.push({name,arm,passed:false,recoveryMs:Date.now()-time,error:error.message,classification:'adapter or harness defect; investigate before attributing to database'});throw error;}finally{await save('faults.json',faults);}}
async function writeManifest(){
 const files=(await readdir(here)).filter(f=>/\.(mjs|cjs|json|yaml|md)$/.test(f));const sources={};for(const file of files)sources[`experiments/temporal-document-fit/${file}`]=createHash('sha256').update(await readFile(join(here,file))).digest('hex');
 frozenSources=sources;
 const packageJSON=JSON.parse(await readFile(join(here,'package.json'),'utf8'));
 const diagnostics={};for(const arm of ['postgres','mongodb'])diagnostics[arm]=await control(arm,'diagnostics');
 await save('manifest.json',{runId,createdAt:new Date().toISOString(),protocol,protocolHash:report.protocolHash,sources,dependencies:packageJSON.dependencies,runtime:await runtime.manifest(),host:{platform:os.platform(),release:os.release(),arch:os.arch(),cpus:os.cpus().length,totalMemoryBytes:os.totalmem(),node:process.version},fixture:{seed:SEED,hash:digest(fixtures()),records:fixtures()},diagnostics,commands:{install:'PATH=/path/to/node22/bin:$PATH pnpm install --frozen-lockfile',run:'TDF_RUNTIME_ROOT=/path/to/owned/runtime pnpm experiment',launch:'Native processes are validated against local owned-runtime.json; exact normalized launch commands are in runtime-commands.json.'},measurement:{databaseMs:'await database adapter call only; excludes projection hashing and telemetry',temporalMs:'workflow activity schedule to activity result, includes workflow-task scheduling; excludes workflow client start overhead',resourceIsolation:'Observed owned process RSS; unrestricted host, no cgroup guarantee',publicExport:'Do not publish worker logs, raw ownership records, or unredacted local paths'}});
}
async function runFaults(arm){
 await control(arm,'reset',{seed:SEED});const base=fixtures(),row=base[1];
 const intended=[];const accepted=(opId,index)=>intended.push({tenantId:base[index].tenantId,id:base[index].id,version:1,status:'open',payload:{...base[index].payload,faultMarker:opId}});const snapshot=label=>control(arm,'snapshot',{label,expected:intended});
 const req=(opId,index=1)=>({tenantId:base[index].tenantId,id:base[index].id,expectedVersion:0,patch:{payload:{faultMarker:opId}},opId});
 await fault('commit before activity acknowledgment failure',arm,async()=>{const result=await operation(arm,'patch',[req('commit-before-ack')],{fault:'commit-before-ack'});assert.equal(result.attempt,2);assert.equal(result.result.status,'duplicate');accepted('commit-before-ack',1);const state=await snapshot('after-commit-before-ack');expectPass(state);return {result,snapshot:state};});
 await fault('worker restart and activity retry',arm,async()=>{
  const marker=join(out,'worker-crash.marker');if(existsSync(marker)){const {rename}=await import('node:fs/promises');await rename(marker,join(out,`worker-crash-${arm}-previous.marker`));}
  const handle=await startWorkflow('operation',{arm,method:'patch',args:[req('worker-crash',2)],identity:base[2].tenantId,fault:'worker-crash'});
  await until(()=>existsSync(marker),30000);await until(()=>worker.exitCode!==null,15000);if(workerLog!==undefined){closeSync(workerLog);workerLog=undefined;}await startWorker();
  const result=await handle.result();assert.equal(result.result.status,'duplicate');assert(result.attempt>=2);accepted('worker-crash',2);const state=await snapshot('after-worker-restart');expectPass(state);return {result,snapshot:state};
 });
 await fault('connectivity interruption',arm,async()=>{
  await runtime.stop(arm);const offset=(await readFile(join(out,'activity-attempts.jsonl'),'utf8')).length;
  const handle=await startWorkflow('operation',{arm,method:'patch',args:[req('connection-retry',3)],identity:base[3].tenantId});
  await until(async()=>{const text=(await readFile(join(out,'activity-attempts.jsonl'),'utf8')).slice(offset);return text.includes('"error"');},20000);
  await runtime.start(arm);const result=await handle.result();assert(result.attempt>=2);assert.equal(result.result.status,'applied');accepted('connection-retry',3);const state=await snapshot('after-connection-retry');expectPass(state);return {result,snapshot:state};
 });
 await fault('owned database restart durability',arm,async()=>{const before=await snapshot('before-database-restart');await runtime.restart(arm);const after=await snapshot('after-database-restart');expectPass(after);assert.equal(after.hash,before.hash);return {before,after};});
 await fault('workflow start acknowledgment loss and duplicate start',arm,async()=>{
  const id=`${runId}-${arm}-dedup`,input={arm,method:'patch',args:[req('workflow-dedup',4)],identity:base[4].tenantId};
  const handle=await startWorkflow('operation',input,id);let rejected=false;try{await startWorkflow('operation',input,id);}catch(error){rejected=error.name==='WorkflowExecutionAlreadyStartedError';}assert(rejected,'server must reject duplicate workflow ID');const result=await client.workflow.getHandle(id).result();assert.equal(result.result.status,'applied');accepted('workflow-dedup',4);const state=await snapshot('after-workflow-dedup');expectPass(state);return {workflowId:id,duplicateStartRejected:rejected,reattachedResult:result,snapshot:state};
 });
 await fault('duplicate approval signal',arm,async()=>{const input={arm,identity:base[5].tenantId,id:base[5].id};const handle=await startWorkflow('approval',input);const signal={identity:input.identity,tenantId:input.identity,opId:'approval-same'};await sendApproval(handle,input.identity,input.identity,signal);await sendApproval(handle,input.identity,input.identity,signal);const result=await handle.result();assert.equal(result.uniqueApprovals,1);assert.equal(result.result.result.version,1);intended.push({tenantId:base[5].tenantId,id:base[5].id,version:1,status:'approved',payload:base[5].payload});const state=await snapshot('after-duplicate-signal');expectPass(state);return {result,snapshot:state};});
 await fault('cross-tenant workflow signal',arm,async()=>{const input={arm,identity:base[6].tenantId,id:base[6].id};const handle=await startWorkflow('approval',input);let rejected=false;try{await sendApproval(handle,'tenant-other',input.identity,{identity:input.identity,tenantId:input.identity,opId:'forbidden'});}catch(error){rejected=error.code==='FORBIDDEN';}assert(rejected,'spoofed request identity must not authorize the caller');for(let i=0;i<2;i++)await sendApproval(handle,input.identity,input.identity,{tenantId:input.identity,opId:'allowed'});const result=await handle.result();assert.equal(result.deliveries,2);assert.equal(result.uniqueApprovals,1);intended.push({tenantId:base[6].tenantId,id:base[6].id,version:1,status:'approved',payload:base[6].payload});const state=await snapshot('after-cross-tenant-signal');expectPass(state);return {wrongTenantRejected:true,spoofedBodyIdentityRejected:true,result,snapshot:state};});
 await fault('workflow history replay',arm,async()=>{const handle=await startWorkflow('operation',{arm,method:'get',args:[row.tenantId,row.id],identity:row.tenantId});await handle.result();const history=await handle.fetchHistory();await Worker.runReplayHistory({workflowsPath:join(here,'workflows.cjs')},history);await writeFile(join(out,`replay-${arm}.json`),JSON.stringify(sanitise(history)));return {historyEvents:history.events.length,replayed:true};});
 await fault('quiescent backup and isolated restore',arm,async()=>{const before=await snapshot('before-cold-restore');await stopWorker();const restore=await runtime.coldRestore(arm,runId);await startWorker();const after=await snapshot('after-cold-restore');expectPass(after);assert.equal(before.hash,after.hash);return {before,after,restore};});
}
try{
 await runtime.load();
 Runtime.install({logger:new DefaultLogger('WARN')});
 connection=await Connection.connect({address:'127.0.0.1:17239'});client=new Client({connection,namespace:'default',identity:'tdf-client'});
 monitor=setInterval(async()=>{if(monitorBusy||stopRequested)return;monitorBusy=true;try{const sample=await runtime.resources([process.pid,...(worker&&worker.exitCode===null?[worker.pid]:[])]);resourceSamples.push(sample);const sourceDisk=await exec('du',['-sk',here]);sample.totalExperimentDiskBytes=sample.runtimeDiskBytes+Number(sourceDisk.stdout.split(/\s+/)[0])*1024;await appendFile(join(out,'resources.jsonl'),JSON.stringify(sample)+'\n');if(sample.rssBytes>protocol.limits.combinedProcessRssBytes||sample.totalExperimentDiskBytes>protocol.limits.experimentDiskBytes||Date.now()-started>1800000){budgetError=new Error('Experiment memory, disk, or wall-time cap exceeded');await save('budget-overrun.json',{error:budgetError.message,sample});stopRequested=true;await stopWorker();await runtime.shutdown();}}catch(error){budgetError=error;}finally{monitorBusy=false;}},2000);
 await startWorker();
 for(const arm of ['postgres','mongodb'])await control(arm,'reset',{seed:SEED});
 await writeManifest();
 if(process.argv.includes('--smoke')){report.smokeOnly=true;for(const arm of ['postgres','mongodb']){const correctness=await control(arm,'correctness');faults.push(...correctness.cases.map(c=>({...c,arm})));const evolution=await invoke('evolution',{arm,seed:SEED});evolutions.push({arm,...evolution});}await save('faults.json',faults);await save('evolution.json',evolutions);report.note='Explicitly uncounted integration smoke; no timing cells or fault-process tests.';}
 else if(process.argv.includes('--preflight')){report.preflightOnly=true;report.outcome='inconclusive';report.note='No counted operations. Dependencies, owned processes, workflow worker, database connections and manifest verified.';}
 else{
  for(const arm of ['postgres','mongodb']){const result=await control(arm,'correctness');for(const c of result.cases)faults.push({...c,arm});await save('faults.json',faults);await runFaults(arm);}
  for(let repeat=0;repeat<5;repeat++){
   const seed=SEED+repeat,arms=repeat%2?['mongodb','postgres']:['postgres','mongodb'];
   for(const arm of arms){const result=await invoke('evolution',{arm,seed});evolutions.push({repeat:repeat+1,arm,...result});await save('evolution.json',evolutions);}
   for(const concurrency of [1,10])for(const arm of arms){
    checkBudget();const label=`repeat-${repeat+1}-c${concurrency}-${arm}`;await control(arm,'reset',{seed});await control(arm,'index');const diagnostics=await control(arm,'diagnostics');
    const warm=await invoke('batch',{arm,label:`${label}-warmup`,operations:workload({warmup:true,seed}),concurrency});assert(warm.every(r=>!r.error),'warmup failure');
    const cellStarted=Date.now();let rows;try{rows=await invoke('batch',{arm,label,operations:workload({seed}),concurrency},120000);}catch(error){const attempts=(await readFile(join(out,'activity-attempts.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.label===label);cells.push({repeat:repeat+1,arm,concurrency,label,planned:1000,attempted:new Set(attempts.map(row=>row.opId)).size,completed:0,databaseCompleted:new Set(attempts.filter(row=>!row.error).map(row=>row.opId)).size,error:error.message,partial:true,note:'Workflow was terminated; database completions are not acknowledged workflow results.'});throw error;}
    const elapsedMs=Date.now()-cellStarted,completed=rows.filter(r=>!r.error).length;completedMeasured+=completed;
    const operations=workload({seed});await appendFile(join(out,'operations.jsonl'),rows.map((result,i)=>JSON.stringify({repeat:repeat+1,concurrency,arm,label,operation:operations[i],...result})).join('\n')+'\n');
    const returnedProjectionOracle=verifyTimingRows(rows,seed);assert(returnedProjectionOracle.ok,returnedProjectionOracle.errors.join('\n'));const snapshot=await control(arm,'snapshot',{label,timing:true,seed});expectPass(snapshot);
    const byOperation={};for(const method of Object.keys(protocol.localTier.operationMix)){const selected=rows.filter((r,i)=>operations[i].method===method&&!r.error);byOperation[method]={dbMs:summary(selected.map(r=>r.dbMs)),temporalMs:summary(selected.map(r=>r.temporalMs))};}
    cells.push({repeat:repeat+1,arm,concurrency,label,seed,attempted:1000,completed,errors:1000-completed,elapsedMs,throughputPerSecond:completed/(elapsedMs/1000),activityRetries:rows.reduce((s,r)=>s+Math.max(0,(r.attempt||1)-1),0),byOperation,returnedProjectionOracle,snapshot,diagnostics});await save('cells.json',cells);assert.equal(completed,1000,'cell contains failed operations');
    console.log(`${label}: ${completed}/1000, ${elapsedMs}ms`);
   }
  }
  assert.equal(cells.length,20);assert.equal(completedMeasured,20000);assert.equal(evolutions.length,10);
  checkBudget();assert(!budgetError);for(const [file,hash]of Object.entries(frozenSources)){const current=createHash('sha256').update(await readFile(join(here,file.split('/').at(-1)))).digest('hex');assert.equal(current,hash,`Frozen source changed: ${file}`);}report.outcome='mechanisms-supported';report.thesis='unresolved';report.compatibilityObservation='Both stores satisfied these shared application semantics; this does not establish a MongoDB evolution-effort advantage or equivalence of independent developer effort.';
 }
}catch(error){errors.push({message:error.message,name:error.name,causes:[error.cause?.message,error.cause?.cause?.message,error.cause?.cause?.cause?.message].filter(Boolean),classification:budgetError?'environment failure':'adapter or harness defect pending diagnosis'});report.outcome='inconclusive';console.error(error.message);process.exitCode=1;}
finally{
 clearInterval(monitor);await until(()=>!monitorBusy,10000).catch(error=>{budgetError=error;});if(budgetError){report.outcome='inconclusive';report.thesis='unresolved';errors.push({message:budgetError.message,classification:'environment failure'});}await stopWorker().catch(error=>errors.push({message:error.message}));await connection?.close();report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;report.measuredAttempts=cells.reduce((sum,c)=>sum+c.attempted,0);report.measuredCompleted=completedMeasured;report.resourceSummary={samples:resourceSamples.length,maximumRssBytes:Math.max(0,...resourceSamples.map(s=>s.rssBytes)),maximumDiskBytes:Math.max(0,...resourceSamples.map(s=>s.totalExperimentDiskBytes||s.runtimeDiskBytes))};report.limitations=['Synthetic local mechanism tier only; no production adoption verdict','Single-node PostgreSQL and single-member MongoDB replica set; no HA or failover','Temporal CLI SQLite dev server; production Temporal persistence untested','Shared unrestricted host; local latencies descriptive only','Five paired repetitions do not support population tail claims','Source change steps are task observations, not general developer productivity'];await save('runtime-commands.json',runtime.commands);await save('report.json',report);console.log(JSON.stringify({runId,outcome:report.outcome,measuredCompleted:completedMeasured,output:out}));
}
