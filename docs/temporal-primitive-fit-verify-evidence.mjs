// Independent post-run audit. Never invoke while counted workloads are active.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [source,mainDir,reproDir,decisionFile]=process.argv.slice(2);
if(!source||!mainDir||!reproDir)throw Error('Usage: node verify-evidence.mjs SOURCE MAIN REPRO [DECISION]');
const read=async f=>JSON.parse(await readFile(f,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const hash=v=>sha(JSON.stringify(sorted(v)));
const normalize=rows=>[...rows].sort((a,b)=>`${a.tenantId}:${a.id}`.localeCompare(`${b.tenantId}:${b.id}`));
const percentile=(rows,p)=>[...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1];
const median=rows=>[...rows].sort((a,b)=>a-b)[Math.floor(rows.length/2)];
const protocolBytes=await readFile(join(source,'protocol.json')),protocol=JSON.parse(protocolBytes);
const {sessionFixtures,attributeFixtures,queryFixtures}=await import(pathToFileURL(join(source,'fixtures.mjs')));
const {evaluate}=await import(pathToFileURL(join(source,'evaluate.mjs')));
const summaries=[];
const excluded=[];
// Audit retained interrupted attempts against their OWN archived source, never current source.
for(const name of await readdir(dirname(mainDir))){
 const prior=join(dirname(mainDir),name);if(prior===mainDir||prior===reproDir)continue;
 let interruption;try{interruption=await read(join(prior,'operator-interruption.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 const priorManifest=await read(join(prior,'manifest.json')),priorReport=await read(join(prior,'report.json'));
 for(const [file,digest]of Object.entries(priorManifest.sourceHashes))assert.equal(sha(await readFile(join(prior,'sources',file))),digest,`Excluded source ${name}/${file}`);
 assert.equal(sha(await readFile(join(prior,'sources','protocol.json'))),priorManifest.protocolHash);
 const priorRows=(await readFile(join(prior,'operations.jsonl'),'utf8')).trim().split('\n').filter(Boolean);
 assert.notEqual(priorReport.outcome,'completed');
 excluded.push({run:name,outcome:priorReport.outcome,cells:priorReport.cells.length,retainedOperationRows:priorRows.length,reason:interruption.reason,sourceFilesVerified:Object.keys(priorManifest.sourceHashes).length,pooledWithCountedRuns:false});
}
function apply(record,args){assert.equal(record.tenantId,args.tenantId);assert.equal(record.id,args.id);assert.equal(record.version,args.expectedVersion);let target=record.payload;for(const part of args.path.slice(0,-1))target=target[part];target[args.path.at(-1)]=args.nextValue;record.version++;}
function queryExpected(records,q){const result=[];for(const r of records){if(r.tenantId!==q.tenantId||!Object.hasOwn(r.attrs,q.key))continue;const v=r.attrs[q.key];const match=q.op==='exists'||q.op==='null'&&v===null||q.op==='eq'&&v===q.value||q.op==='range'&&typeof v==='number'&&v>=q.min&&v<q.max;if(match)result.push({id:r.id,value:v});}result.sort((a,b)=>a.id.localeCompare(b.id));return q.limit==null?result:result.slice(0,q.limit);}
async function audit(dir,mode){
 const report=await read(join(dir,'report.json')),manifest=await read(join(dir,'manifest.json'));
 assert.equal(report.outcome,'completed');assert.equal(report.mode,mode);assert.equal(report.sourceFreezeVerified,true);assert.deepEqual(report.errors,[]);assert.equal(manifest.protocolHash,sha(protocolBytes));
 const requiredDurability={fsync:'on',synchronous_commit:'on',full_page_writes:'on',wal_sync_method:'fsync_writethrough'};
 function verifyDurability(observed){assert(observed,'Missing observed durability');assert.deepEqual(observed.postgres,requiredDurability);assert.equal(observed.postgresSettings.length,4);for(const setting of observed.postgresSettings){assert.equal(setting.pending_restart,false);assert.equal(setting.setting,requiredDurability[setting.name]);}assert.deepEqual(observed.mongo.writeConcern,{w:'majority',j:true});assert.equal(observed.mongo.actualFlushSyscallTraced,false);assert.equal(observed.mongo.fullFlushFallbackLog.observed,false);assert.equal(observed.mongo.version,protocol.runtime.mongodb);}
 verifyDurability(manifest.durabilityObserved);verifyDurability(report.durabilityObserved);assert.deepEqual(manifest.durabilityObserved,report.durabilityObserved);
 verifyDurability(report.durabilityObservedEnd);
 assert.equal(report.durabilityVerified,true);assert.deepEqual(report.durabilityObservedEnd.postgresSettings,report.durabilityObserved.postgresSettings);assert.deepEqual(report.durabilityObservedEnd.mongo,report.durabilityObserved.mongo);
 const freeze=await read(join(source,'frozen-source.json'));assert.deepEqual(manifest.sourceHashes,freeze.files??freeze);
 for(const [file,digest]of Object.entries(manifest.sourceHashes)){assert(!file.includes('..')&&!file.startsWith('/'));assert.equal(sha(await readFile(join(source,file))),digest,file);}
 const rows=(await readFile(join(dir,'operations.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),groups=new Map();
 for(const row of rows){assert(!row.error&&!row.oracleError);assert(Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0);if(!groups.has(row.cell))groups.set(row.cell,[]);groups.get(row.cell).push(row);}
 let snapshotCount=0,queryChecks=0,mutations=0,reads=0;
 async function snapshot(label,expected,kind){const record=await read(join(dir,'snapshots',label+'.json'));assert.equal(record.kind,kind);assert(!record.oracleError);assert.equal(record.projectionHash,hash(record.rows));let projected=expected;if(kind==='sessions')projected=expected.map(r=>({...r,payload:{...r.payload,cold:{utf8Bytes:Buffer.byteLength(r.payload.cold),sha256:sha(r.payload.cold)}}}));assert.deepEqual(normalize(record.rows),normalize(projected),label);assert.equal(record.fullSnapshotHash,hash(normalize(expected)),label);snapshotCount++;return record;}
 function stats(label,cell){const values=groups.get(label);assert(values,`Missing rows ${label}`);assert.equal(values.length,cell.operations);assert.equal(cell.attempted,values.length);assert.equal(cell.completed,values.length);values.sort((a,b)=>a.index-b.index);values.forEach((r,i)=>{assert.equal(r.index,i);assert.equal(r.lane,i%10);});assert.equal(cell.medianMs,percentile(values.map(r=>r.elapsedMs),.5));assert.equal(cell.p95Ms,percentile(values.map(r=>r.elapsedMs),.95));assert.equal(cell.throughput,cell.operations/cell.elapsedMs*1000);for(const [key,stratum]of Object.entries(cell.strata)){const sub=values.filter(r=>(r.query?`${r.query.group}/${r.query.class??r.query.op}`:r.method)===key);assert.equal(sub.length,stratum.count);assert.equal(stratum.medianMs,percentile(sub.map(r=>r.elapsedMs),.5));assert.equal(stratum.p95Ms,percentile(sub.map(r=>r.elapsedMs),.95));}return values;}
 let cachedKey,cachedFixtures;
 for(const cell of report.cells){
  const k=protocol.kernels[cell.kernel],base=cell.kernel==='B'?cell.label.replace(/-query$/,''):cell.label;
  const fixtureKey=`${cell.kernel}/${cell.profile}/${cell.size}`;
  if(fixtureKey!==cachedKey){cachedKey=fixtureKey;cachedFixtures=cell.kernel==='A'?sessionFixtures({count:k.count,tenants:k.tenants,payloadBytes:cell.size,seed:report.seed,sessionProfile:cell.profile}):attributeFixtures({...k,seed:report.seed});}
  const expected=structuredClone(cachedFixtures);assert.equal(manifest.fixtures.find(f=>f.label===base)?.hash,hash(expected));
  const operations=stats(cell.label,cell);
  const d=cell.diagnostics;assert.equal(cell.storageBytes,d.stats?Number(d.stats.storageSize)+Number(d.stats.indexSize):d.sizes.reduce((n,r)=>n+Number(r.total_bytes),0));
  if(cell.kernel==='A'){
   if(cell.profile!=='known-hot')for(let p=0;p<64;p++)for(let i=0;i<k.activeRecords;i++)apply(expected[i],{tenantId:expected[i].tenantId,id:expected[i].id,expectedVersion:expected[i].version,path:['tools',`tool${Math.floor(p/2)}`,p%2?'b':'a'],nextValue:1000+p*k.activeRecords+i});
   await snapshot(base+'-preconditioned',expected,'sessions');
   const profile=k.profiles.find(p=>p.id===cell.profile),cursors=Array(k.concurrency).fill(0);
   function trace(i){const lane=i%k.concurrency,n=cursors[lane]++,r=expected[lane];if(Math.floor(i/k.concurrency)%10>=Math.round(profile.updateFraction*10))return{method:'read',r};const pathIndex=(i+Math.floor(i/k.concurrency)*7)%64;return{method:'mutate',r,args:{tenantId:r.tenantId,id:r.id,expectedVersion:r.version,nextValue:n+1,path:cell.profile==='known-hot'?['hot','value']:['tools',`tool${Math.floor(pathIndex/2)}`,pathIndex%2?'b':'a']}};}
   for(let i=0;i<k.warmup;i++){const t=trace(i);if(t.method==='mutate')apply(t.r,t.args);}
   for(const [i,row]of operations.entries()){const t=trace(i);assert.equal(row.method,t.method);assert.equal(row.id,t.r.id);assert.equal(row.tenantId,t.r.tenantId);if(t.method==='read'){assert.equal(row.resultHash,hash(t.r));reads++;}else{assert.equal(row.expectedVersion,t.args.expectedVersion);assert.equal(row.nextValue,t.args.nextValue);assert.deepEqual(row.path??['hot','value'],t.args.path);apply(t.r,t.args);assert.deepEqual(row.result,{applied:true,version:t.r.version});mutations++;}}
   await snapshot(base,expected,'sessions');
   const after=await read(join(dir,'snapshots',base+'-after-negative.json')),first=after.rows.find(r=>r.id===expected[0].id&&r.tenantId===expected[0].tenantId),path=cell.profile==='known-hot'?['hot','value']:['tools','tool0','a'];let target=first.payload;for(const p of path)target=target[p];assert([10101,20202].includes(target));apply(expected[0],{tenantId:expected[0].tenantId,id:expected[0].id,expectedVersion:expected[0].version,nextValue:target,path});await snapshot(base+'-after-negative',expected,'sessions');
  }else{
   const queries=queryFixtures({records:expected,limit:k.queryLimit}),answers=queries.map(q=>queryExpected(expected,q));
   for(const [i,row]of operations.entries()){assert.deepEqual(row.query,queries[i%queries.length]);assert.equal(row.resultHash,hash(answers[i%queries.length]));assert.equal(row.count,answers[i%queries.length].length);queryChecks++;}
   for(const [i,row]of stats(base+'-update',cell.update).entries()){const r=expected[i%expected.length],key=`k${String((i*13)%k.keyCount).padStart(3,'0')}`,value=(i*19)%1000;assert.equal(row.id,r.id);assert.equal(row.tenantId,r.tenantId);assert.equal(row.key,key);assert.equal(row.value,value);assert.deepEqual(row.result,{applied:true});r.attrs[key]=value;mutations++;}
   await snapshot(base,expected,'attributes');
  }
 }
 assert.equal(groups.size,report.cells.reduce((n,c)=>n+(c.kernel==='B'?2:1),0));
 const resources=(await readFile(join(dir,'resources.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(resources.length,report.resources.samples);assert.equal(Math.max(...resources.map(r=>r.rssBytes)),report.resources.maxRssBytes);assert.equal(Math.max(...resources.map(r=>r.runtimeDiskBytes)),report.resources.maxDiskBytes);assert(report.resources.maxRssBytes<=protocol.limits.rssBytes);assert(report.resources.maxDiskBytes<=protocol.limits.diskBytes);assert(report.elapsedMs<=protocol.limits.elapsedMs);
 const attempts=(await readFile(join(dir,'temporal-attempts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(attempts.length,33);for(const design of ['pg-monolithic','pg-split','mongo']){const a=attempts.filter(r=>r.design===design);assert.equal(a.length,11);assert.equal(a.filter(r=>r.reconciled).length,1);assert.equal(a.filter(r=>r.result.applied).length,10);const expected=sessionFixtures({count:10,tenants:10,payloadBytes:8192,seed:report.seed});for(let i=0;i<10;i++){expected[i].version=1;expected[i].payload.hot.value=i+100;}assert.deepEqual(normalize(await read(join(dir,`temporal-snapshot-${design}.json`))),normalize(expected));}
 summaries.push({mode,rows:rows.length,cells:report.cells.length,snapshots:snapshotCount,queryResultsVerified:queryChecks,mutationsReplayed:mutations,readHashesVerified:reads,sourceFiles:Object.keys(manifest.sourceHashes).length,resourceSamples:resources.length});return report;
}
const main=await audit(mainDir,'main'),reproduction=await audit(reproDir,'reproduction');
const evaluated=evaluate(main,reproduction,protocol);assert.notEqual(evaluated.outcome,'invalid-or-incomplete');
// Independently recalculate every comparison gate; do not merely trust evaluator output.
for(const scenario of evaluated.scenarios){const key=c=>`${c.kernel}/${c.profile}/${c.size}`;let successes=[];for(let j=0;j<2;j++){let both=true;for(const [report,kind]of [[main,'primary'],[reproduction,'reproduction']]){const stated=scenario[kind][j],cells=report.cells.filter(c=>key(c)===scenario.scenario),pg=cells.filter(c=>c.design===stated.postgresDesign).sort((a,b)=>a.rep-b.rep),mongo=cells.filter(c=>c.design.startsWith('mongo')).sort((a,b)=>a.rep-b.rep),ratio=[],tail=[],storage=[],maintenance=[];for(let i=0;i<pg.length;i++){const p=scenario.metric==='mixed'?pg[i]:pg[i].strata[scenario.metric],m=scenario.metric==='mixed'?mongo[i]:mongo[i].strata[scenario.metric];ratio.push(m.medianMs/p.medianMs);tail.push(m.p95Ms/p.p95Ms);storage.push(mongo[i].storageBytes/pg[i].storageBytes);maintenance.push(mongo[i].kernel==='B'?mongo[i].update.medianMs/pg[i].update.medianMs:1);}const d=protocol.decision,bar=1-d.minMedianLatencyReduction,pass=ratio.filter(v=>v<=bar).length>=(kind==='primary'?d.minWinningRepetitions:protocol.reproduction.repetitions)&&median(ratio)<=bar&&median(tail)<=d.maxP95Ratio&&Math.max(...storage)<=d.maxStorageRatio&&median(maintenance)<=d.maxMaintenanceMedianRatio;assert.equal(stated.passed,pass);assert.equal(stated.medianLatencyRatio,median(ratio));assert.equal(stated.medianP95Ratio,median(tail));assert.equal(stated.maxStorageRatio,Math.max(...storage));assert.equal(stated.medianMaintenanceRatio,median(maintenance));both&&=pass;}successes.push(both);}assert.equal(scenario.outcome,successes.every(Boolean)?'candidate-advantage':successes[0]?'jsonb-only-advantage':'no-demonstrated-advantage');}
if(decisionFile){const saved=await read(decisionFile);assert.equal(saved.outcome,evaluated.outcome);assert.deepEqual(saved.scenarios,evaluated.scenarios);}
const result={outcome:'independently-verified',at:new Date().toISOString(),verifierSha256:sha(await readFile(fileURLToPath(import.meta.url))),protocolSha256:sha(protocolBytes),runs:summaries,excludedRuns:excluded,decision:evaluated.outcome,scenarios:evaluated.scenarios.map(s=>({scenario:s.scenario,metric:s.metric,outcome:s.outcome})),limitations:['Cold bytes regenerated from frozen fixtures; every recorded cold digest and full-snapshot hash checked.','Competing CAS winner reconstructed from recorded post-race state; both allowed winner values checked.','Temporal replay execution itself is represented by its recorded receipts; this audit independently verifies resulting states and attempts.']};
const output=join(dirname(fileURLToPath(import.meta.url)),'independent-evidence-audit.json');await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,...result}));
