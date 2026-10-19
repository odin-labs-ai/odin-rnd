import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,mkdir,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAdapter} from './adapters.mjs';
import {sessionFixtures,attributeFixtures,queryFixtures,negativeQueryFixtures,distributedPaths,clone,hash} from './fixtures.mjs';
import {assertSnapshot,assertQuery,applyMutation,expectedQuery} from './oracle.mjs';
import {OwnedRuntime} from './runtime.mjs';
import {temporalCorrectness} from './temporal-correctness.mjs';
const root=dirname(fileURLToPath(import.meta.url)),exec=promisify(execFile);
function storageBytes(d){return d.stats?Number(d.stats.storageSize)+Number(d.stats.indexSize):d.sizes.reduce((sum,r)=>sum+Number(r.total_bytes),0);}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
export async function invokeMeasured(adapter,method,args){
 const started=performance.now();
 try{return{actual:await adapter[method](args),elapsedMs:performance.now()-started};}
 catch(error){const failure=error instanceof Error?error:new Error(String(error));failure.operation={method,args,elapsedMs:performance.now()-started};throw failure;}
}
export function quantile(values,q){const a=[...values].sort((x,y)=>x-y);return a[Math.max(0,Math.ceil(a.length*q)-1)]??0;}
export function orderFor(designs,repetition){const offset=repetition%designs.length;return [...designs.slice(offset),...designs.slice(0,offset)];}
async function pool(count,concurrency,fn){let failure;const results=await Promise.allSettled(Array.from({length:concurrency},async(_,lane)=>{for(let i=lane;i<count;i+=concurrency){if(failure)return;try{await fn(i,lane);}catch(error){failure??=error;throw error;}}}));if(failure)throw failure;}
export async function run(){
 const mode=process.argv.includes('--reproduce')?'reproduction':process.argv.includes('--smoke')?'smoke':'main';
 const protocol=await json(join(root,'protocol.json'));let freeze,hasFrozenSource=true;try{freeze=await json(join(root,'frozen-source.json'));}catch(error){if(error.code!=='ENOENT'||!process.argv.includes('--preflight')&&!process.argv.includes('--smoke'))throw error;hasFrozenSource=false;freeze={};for(const file of (await readdir(root)).filter(f=>/\.(mjs|cjs|json|md|yaml)$/.test(f)&&f!=='frozen-source.json'))freeze[file]=sha(await readFile(join(root,file)));}
 const sourceHashes={};for(const [file,expected] of Object.entries(freeze.files??freeze)){if(file.includes('..')||file.startsWith('/'))throw new Error('Invalid frozen path');const actual=sha(await readFile(join(root,file)));assert.equal(actual,expected,`Frozen source changed: ${file}`);sourceHashes[file]=actual;}
 for(const file of ['run.mjs','runtime.mjs','adapters.mjs','fixtures.mjs','oracle.mjs','protocol.json','PROTOCOL.md','temporal-correctness.mjs','workflows.cjs'])assert.ok(sourceHashes[file],`Freeze missing ${file}`);
 const runtimeRoot=process.env.TPF_RUNTIME_ROOT;if(!runtimeRoot)throw new Error('TPF_RUNTIME_ROOT required');
 const runtime=await new OwnedRuntime(runtimeRoot).load();const durabilityObserved=await runtime.durability();if(process.argv.includes('--preflight')){console.log(JSON.stringify({outcome:'preflight-passed',counted:false,hasFrozenSource,sourceHashes,durabilityObserved,runtime:await runtime.manifest()}));return;}const out=join(runtime.root,'runs',`${mode}-${new Date().toISOString().replaceAll(':','-')}`);await mkdir(out,{recursive:true});await mkdir(join(out,'snapshots'));
 const started=Date.now(),seed=mode==='reproduction'?protocol.reproductionSeed:protocol.seed;if(seed==null)throw new Error('Protocol seed required');
 const report={mode,seed,durabilityObserved,startedAt:new Date(started).toISOString(),outcome:'running',cells:[],checks:[],errors:[]};
 const manifest={protocolHash:sha(await readFile(join(root,'protocol.json'))),sourceHashes,mode,seed,durabilityObserved,runtime:await runtime.manifest(),fixtures:[],limits:protocol.limits};await save(join(out,'manifest.json'),manifest);
 let adapter,resourceError,sampling=false;const resources=[];
 async function sample(){if(sampling)return;sampling=true;try{const r=await runtime.resources([process.pid]);resources.push(r);await appendFile(join(out,'resources.jsonl'),JSON.stringify(r)+'\n');if(r.rssBytes>protocol.limits.rssBytes||r.runtimeDiskBytes>protocol.limits.diskBytes||Date.now()-started>protocol.limits.elapsedMs)throw new Error('Frozen runtime resource/time limit exceeded');}catch(e){resourceError=e;}finally{sampling=false;}}
 function guard(){if(resourceError)throw resourceError;if(Date.now()-started>protocol.limits.elapsedMs)throw new Error('Elapsed time limit exceeded');}
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{resourceError=new Error(`Run interrupted by ${signal}`);});
 const timer=setInterval(sample,2000);await sample();
 const host={at:new Date().toISOString(),platform:os.platform(),release:os.release(),arch:os.arch(),cpus:os.cpus().length,load:os.loadavg(),memoryBytes:os.totalmem(),node:process.version};try{host.power=(await exec('pmset',['-g','therm'])).stdout;}catch{host.power='unavailable';}await save(join(out,'host-context.json'),host);
 const config={pgUrl:'postgres://experiment@127.0.0.1:55739/primitive_fit',mongoUrl:'mongodb://127.0.0.1:27329/?replicaSet=primitivefit'};
 const reps=k=>mode==='smoke'?1:mode==='reproduction'?(protocol.reproduction?.repetitions??1):k.repetitions;
 async function timed(label,count,concurrency,operation){const rows=[],t=performance.now();let failure;try{await pool(count,concurrency,async(i,lane)=>{guard();if(performance.now()-t>protocol.limits.cellTimeoutMs)throw new Error('Frozen cell timeout exceeded');try{const detail=await operation(i,lane);rows.push({cell:label,index:i,lane,...detail});}catch(error){rows.push({cell:label,index:i,lane,...error.operation,error:error.message});throw error;}});}catch(error){failure=error;}const elapsedMs=performance.now()-t;if(elapsedMs>protocol.limits.cellTimeoutMs)failure??=new Error('Frozen cell timeout exceeded at pool completion');for(const row of rows){try{row.verify?.();}catch(error){row.oracleError=error.message;failure??=error;}delete row.verify; if(row.fullResult!==undefined){row.resultHash=hash(row.fullResult);delete row.fullResult;}}rows.sort((a,b)=>a.index-b.index);await appendFile(join(out,'operations.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');if(failure)throw failure;const strata={};for(const row of rows){const key=row.query?`${row.query.group}/${row.query.class??row.query.op}`:row.method;(strata[key]??=[]).push(row.elapsedMs);}return{strata:Object.fromEntries(Object.entries(strata).map(([key,values])=>[key,{count:values.length,medianMs:quantile(values,.5),p95Ms:quantile(values,.95)}])),label,attempted:rows.length,completed:rows.filter(r=>!r.error&&!r.oracleError).length,operations:count,elapsedMs,throughput:count/elapsedMs*1000,medianMs:quantile(rows.map(r=>r.elapsedMs),.5),p95Ms:quantile(rows.map(r=>r.elapsedMs),.95)};}
 async function snapshot(expected,kind,label){const actual=await adapter.snapshot({kind});let digest,oracleError;try{digest=assertSnapshot(expected,actual);}catch(error){oracleError=error;digest=hash(actual);}const projection=kind==='sessions'?actual.map(r=>({...r,payload:{...r.payload,cold:{utf8Bytes:Buffer.byteLength(r.payload.cold),sha256:sha(Buffer.from(r.payload.cold))}}})):actual;await save(join(out,'snapshots',label+'.json'),{kind,representation:kind==='sessions'?'cold-body-digest-projection':'full-attributes',fullSnapshotHash:digest,projectionHash:hash(projection),rows:projection,...(oracleError?{oracleError:oracleError.message}:{})}); report.checks.push({label,kind,hash:digest,passed:!oracleError});if(oracleError)throw oracleError;}
 try{
 for(const kernel of ['A','B']){
  const k=protocol.kernels[kernel];if(!k)continue;
  for(const profile of kernel==='A'?k.profiles:[{id:'attributes'}])for(const size of kernel==='A'?k.sizes:[0])for(let rep=0;rep<reps(k);rep++)for(const design of orderFor(k.designs,rep)){
   guard();const label=`${kernel}-${profile.id}-${size}-r${rep}-${design}`;adapter=await createAdapter({design,config:{...config,sessionProfile:profile.id}});
   const records=kernel==='A'?sessionFixtures({count:k.count,tenants:k.tenants,payloadBytes:size,seed,sessionProfile:profile.id}):attributeFixtures({...k,seed});
   manifest.fixtures.push({label,count:records.length,hash:hash(records)});await adapter.setup(kernel==='A'?{sessions:records}:{attributes:records});const expected=clone(records);const corrupt=clone(expected);if(kernel==='A')corrupt[0].version++;else corrupt[0].attrs.corruption=1;assert.throws(()=>assertSnapshot(expected,corrupt));report.checks.push({label,name:'corrupt-snapshot-detected',passed:true});
   if(kernel==='A'){
    // Each lane owns disjoint records; version progression remains serial per record.
    const preconditioningStarted=performance.now();let preconditioningOperations=0;
    if(profile.id!=='known-hot')for(const path of distributedPaths())await pool(k.activeRecords??10,k.concurrency,async i=>{const r=expected[i],args={tenantId:r.tenantId,id:r.id,expectedVersion:r.version,nextValue:1000+preconditioningOperations++,path};assert.deepEqual(await adapter.mutate(args),applyMutation(r,args));});
    const preconditioning={operations:preconditioningOperations,elapsedMs:performance.now()-preconditioningStarted};await snapshot(expected,'sessions',label+'-preconditioned');
    const laneCursor=Array(k.concurrency).fill(0);
    const operation=async(i,lane)=>{const n=laneCursor[lane]++,idx=lane,r=expected[idx];
     if((Math.floor(i/k.concurrency)%10)>=Math.round(profile.updateFraction*10)){const wanted=clone(r),{actual,elapsedMs}=await invokeMeasured(adapter,'read',{tenantId:r.tenantId,id:r.id});return{method:'read',id:r.id,tenantId:r.tenantId,elapsedMs,fullResult:actual,verify:()=>assert.deepEqual(actual,wanted)};}
     const args={tenantId:r.tenantId,id:r.id,expectedVersion:r.version,nextValue:n+1,...(profile.id==='known-hot'?{}:{path:distributedPaths()[(i+Math.floor(i/k.concurrency)*7)%64]})};
     const wanted=applyMutation(r,args),{actual,elapsedMs}=await invokeMeasured(adapter,'mutate',args);return{method:'mutate',...args,result:actual,elapsedMs,verify:()=>assert.deepEqual(actual,wanted)};
    };
    await pool(mode==='smoke'?10:k.warmup,k.concurrency,async(i,lane)=>{const r=await operation(i,lane);r.verify();});
    const result=await timed(label,mode==='smoke'?20:k.operations,k.concurrency,operation);
    await snapshot(expected,'sessions',label);
    const r=expected[0];for(const [name,args] of [['stale',{tenantId:r.tenantId,id:r.id,expectedVersion:r.version-1,nextValue:1}],['wrong-tenant',{tenantId:`tenant-${(Number(r.tenantId.split('-')[1])+1)%k.tenants}`,id:r.id,expectedVersion:r.version,nextValue:1}],['missing',{tenantId:r.tenantId,id:'missing-session',expectedVersion:0,nextValue:1}]]){assert.deepEqual(await adapter.mutate({...args,...(profile.id==='known-hot'?{}:{path:distributedPaths()[0]})}),{applied:false,version:null});report.checks.push({label,name,passed:true});}
    const contenders=[10101,20202].map(nextValue=>({tenantId:r.tenantId,id:r.id,expectedVersion:r.version,nextValue,...(profile.id==='known-hot'?{}:{path:distributedPaths()[0]})}));const races=await Promise.all(contenders.map(args=>adapter.mutate(args)));assert.equal(races.filter(result=>result.applied).length,1);applyMutation(r,contenders[races.findIndex(result=>result.applied)]);report.checks.push({label,name:'competing-CAS-exactly-one-winner',passed:true});await snapshot(expected,'sessions',label+'-after-negative');const diagnostics=await adapter.diagnostics();report.cells.push({...result,kernel,phase:'mixed-session',profile:profile.id,size,rep,repetition:rep,design,preconditioning,storageBytes:storageBytes(diagnostics),diagnostics});
   }else{
    const queries=queryFixtures({records:expected,limit:k.queryLimit});for(const q of [...queries,...negativeQueryFixtures()])assertQuery(expected,{...q,limit:null},await adapter.query({...q,limit:null}));report.checks.push({label,name:'full-query-matrix-before',positiveCases:queries.length,negativeCases:negativeQueryFixtures().length,passed:true});const answers=queries.map(q=>expectedQuery(expected,q));const positive=queries.find(q=>expectedQuery(expected,q).length);assert.ok(positive,'Query set requires positive results');assert.throws(()=>assertQuery(expected,positive,[]));report.checks.push({label,name:'corrupt-query-detected',passed:true});
    const query=async i=>{const qi=i%queries.length,q=queries[qi],{actual,elapsedMs}=await invokeMeasured(adapter,'query',q);return{method:'query',query:q,elapsedMs,fullResult:actual,count:actual.length,verify:()=>assert.deepEqual(actual,answers[qi])};};
    await pool(mode==='smoke'?10:k.warmup,k.concurrency,async i=>{const r=await query(i);r.verify();});
    const result=await timed(label+'-query',mode==='smoke'?20:k.queries,k.concurrency,query);
    const update=await timed(label+'-update',mode==='smoke'?10:k.updates,k.concurrency,async i=>{const r=expected[i%expected.length],key=`k${String((i*13)%k.keyCount).padStart(3,'0')}`,value=(i*19)%1000;const args={tenantId:r.tenantId,id:r.id,key,value};const {actual,elapsedMs}=await invokeMeasured(adapter,'updateAttribute',args);r.attrs[key]=value;return{method:'updateAttribute',...args,elapsedMs,result:actual,verify:()=>assert.deepEqual(actual,{applied:true})};});
    for(const q of [...queries,...negativeQueryFixtures()])assertQuery(expected,{...q,limit:null},await adapter.query({...q,limit:null}));report.checks.push({label,name:'full-query-matrix-after',positiveCases:queries.length,negativeCases:negativeQueryFixtures().length,passed:true});const first=expected[0];assert.deepEqual(await adapter.updateAttribute({tenantId:`tenant-${(Number(first.tenantId.split('-')[1])+1)%k.tenants}`,id:first.id,key:'k000',value:999}),{applied:false});report.checks.push({label,name:'wrong-tenant-attribute-update',passed:true});await snapshot(expected,'attributes',label);
    const diagnostics=await adapter.diagnostics({query:queries.find(q=>q.group==='withheld'&&q.op==='range')??queries[0]});report.cells.push({...result,kernel,phase:'query',profile:profile.id,size,rep,repetition:rep,design,update,storageBytes:storageBytes(diagnostics),diagnostics});
   }
   await adapter.close();adapter=null;await save(join(out,'report.json'),report);await save(join(out,'manifest.json'),manifest);await sample();guard();
  }
 }
 report.temporal=await temporalCorrectness({out,seed,config});guard();report.outcome='completed';
 }catch(error){report.outcome='failed';report.errors.push({message:error.message,stack:error.stack});process.exitCode=1;}
 finally{clearInterval(timer);while(sampling)await new Promise(resolve=>setTimeout(resolve,25));if(adapter)await adapter.close().catch(()=>{});await sample();if(resourceError&&!report.errors.some(e=>e.message===resourceError.message)){report.errors.push({message:resourceError.message});report.outcome='failed';process.exitCode=1;}try{const names=(await readdir(root)).filter(f=>/\.(mjs|cjs|json|md|yaml)$/.test(f)&&f!=='frozen-source.json').sort();assert.deepEqual(names,Object.keys(sourceHashes).sort(),'Source file set changed or freeze incomplete');for(const [file,expected] of Object.entries(sourceHashes))assert.equal(sha(await readFile(join(root,file))),expected,`Source drift: ${file}`);report.sourceFreezeVerified=hasFrozenSource;}catch(error){report.sourceFreezeVerified=false;report.outcome='failed';report.errors.push({message:error.message});process.exitCode=1;}try{report.durabilityObservedEnd=await runtime.durability();assert.deepEqual(report.durabilityObservedEnd.postgres,durabilityObserved.postgres,'PostgreSQL durability drift');assert.deepEqual(report.durabilityObservedEnd.postgresSettings,durabilityObserved.postgresSettings,'PostgreSQL durability source or pending-state drift');assert.deepEqual(report.durabilityObservedEnd.mongo,durabilityObserved.mongo,'MongoDB configuration or contract drift');report.durabilityVerified=true;}catch(error){report.durabilityVerified=false;report.outcome='failed';report.errors.push({message:error.message});process.exitCode=1;}report.elapsedMs=Date.now()-started;if(report.elapsedMs>protocol.limits.elapsedMs){report.outcome='failed';report.errors.push({message:'Elapsed time limit exceeded at finalization'});process.exitCode=1;}report.resources={samples:resources.length,maxRssBytes:Math.max(...resources.map(r=>r.rssBytes)),maxDiskBytes:Math.max(...resources.map(r=>r.runtimeDiskBytes))};await save(join(out,'manifest.json'),manifest);await save(join(out,'report.json'),report);}
 console.log(JSON.stringify({out,outcome:report.outcome,cells:report.cells.length,errors:report.errors.map(e=>e.message)}));return{out,report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
