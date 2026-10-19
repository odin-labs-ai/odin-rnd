import assert from 'node:assert/strict';
import {fixtures,digest,SEED,workload,projection} from './fixtures.mjs';
import {verifySnapshot,negativeControl,stableSnapshot} from './oracle.mjs';
import {authorize} from './adapters.mjs';
const errorCode=error=>error.code||error.name;
async function rejects(fn,codes){try{await fn();assert.fail('operation unexpectedly accepted');}catch(error){if(codes)assert(codes.includes(errorCode(error)),`expected ${codes}, got ${errorCode(error)}: ${error.message}`);else assert.notEqual(error.code,'ERR_ASSERTION');}}
const request=(row,opId,patch,expectedVersion=row.version)=>({tenantId:row.tenantId,id:row.id,expectedVersion,patch,opId});
export async function evolutionStart(adapter,seed=SEED){
  const base=fixtures(seed);await adapter.reset(base);const evidence={seed,tasks:[]};
  const row=base[0];const optional=request(row,'E1-add-model',{payload:{agent:{model:'model-new'}}});await adapter.patch(optional);
  await adapter.patch(request(row,'E1-old-writer',{payload:{legacyNote:'old-client'}},1));
  const updated=await adapter.get(row.tenantId,row.id);
  assert.equal(updated.payload.agent.model,'model-new');assert.deepEqual(updated.payload.unknown,row.payload.unknown);assert.equal(updated.payload.legacyNote,'old-client');
  assert.equal(Object.hasOwn((await adapter.get(base[3].tenantId,base[3].id)).payload,'agent'),false);
  assert.equal((await adapter.get(base[2].tenantId,base[2].id)).payload.agent.model,null);
  evidence.tasks.push({id:'E1',passed:true,applicationSteps:['new optional field write','old client unrelated patch','old/new projection reads','missing/null distinction'],ddl:false,backfill:false,compatibilityDefects:0});
  const expectedIDs=base.filter(r=>r.tenantId==='tenant-1'&&r.payload.agent?.model==='model-a').map(r=>r.id).sort();
  const query=()=>adapter.queryPayload({tenantId:'tenant-1',path:'agent.model',value:'model-a',limit:1000});
  const before=await query();assert.deepEqual(before.map(r=>r.id).sort(),expectedIDs);
  const beforeDiagnostics=await adapter.diagnostics();const indexResult=await adapter.evolve({phase:'add-index'});
  const after=await query();assert.deepEqual(after.map(r=>r.id).sort(),expectedIDs);
  const afterDiagnostics=await adapter.diagnostics();
  evidence.tasks.push({id:'E2',passed:true,expectedIDs,beforeCount:before.length,afterCount:after.length,indexResult,beforeDiagnostics,afterDiagnostics,applicationSteps:['native tenant/model equality predicate','one native index creation'],compatibilityDefects:0});
  let concurrent;
  const interrupted=await adapter.evolve({phase:'backfill-v2',batchSize:10,maxBatches:1,beforeBatch:async(items,index)=>{if(index===0&&items.length){const candidate=items[0];concurrent={tenantId:candidate.tenantId,id:candidate.id,priority:4};await adapter.patch({...request(candidate,'E3-concurrent-old',{payload:{priority:4,concurrentNote:'preserved'}}),writerVersion:1});}}});
  assert(interrupted.interrupted,'backfill must be interrupted');
  return {...evidence,interrupted,concurrent};
}
export async function evolutionFinish(adapter,evidence,resumed){
  const base=fixtures(evidence.seed),{interrupted,concurrent}=evidence;
  const repeat=await adapter.evolve({phase:'backfill-v2',batchSize:100,maxBatches:1});assert.equal(repeat.applied,0);assert.equal(repeat.interrupted,false);
  const snapshot=await adapter.inspectInvariants();
  for(const record of snapshot.records){assert.equal(record.payload.priorityV2.level,record.payload.priority);assert.equal(record.payload.unknown.preserve,base.find(r=>r.id===record.id).payload.unknown.preserve);}
  const concurrentRow=await adapter.get(concurrent.tenantId,concurrent.id);assert.equal(concurrentRow.payload.priority,4);assert.equal(concurrentRow.payload.concurrentNote,'preserved');
  // An old writer after a complete migration invalidates the derived value; a mixed reader falls back.
  await adapter.patch({...request(concurrentRow,'E3-old-after-backfill',{payload:{priority:2}}),writerVersion:1});
  const legacy=await adapter.get(concurrent.tenantId,concurrent.id);assert.equal(Object.hasOwn(legacy.payload,'priorityV2'),false);assert.equal(legacy.payload.priorityV2?.level??legacy.payload.priority,2);
  await adapter.patch({...request(legacy,'E3-new-writer',{payload:{priority:3}}),writerVersion:2});
  const modern=await adapter.get(concurrent.tenantId,concurrent.id);assert.equal(modern.payload.priorityV2.level,3);assert.equal(modern.payload.priority,3);
  const final=await adapter.inspectInvariants();const invariant=verifySnapshot(final,{baseline:base});assert(invariant.ok,invariant.errors.join('\n'));
  evidence.tasks.push({id:'E3',passed:true,interrupted,resumed,repeat,concurrent,applicationSteps:['dual-compatible priority writer','guarded batch backfill','interrupt after one batch','concurrent old writer','resume','idempotent repeat','old-write invalidation','mixed reader fallback','legacy reader rollback'],compatibilityDefects:0,invariant});
  return evidence;
}
export async function correctnessSuite(adapter){
  const base=fixtures(),row=base[0],cases=[];await adapter.reset(base);
  async function check(name,fn){await fn();cases.push({name,passed:true});}
  const original=request(row,'same-operation',{payload:{test:{value:1}}});
  await check('duplicate operation',async()=>{assert.equal((await adapter.patch(original)).status,'applied');const duplicate=await adapter.patch(original);assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.version,1);});
  await check('operation key payload mismatch',()=>rejects(()=>adapter.patch({...original,patch:{payload:{test:{value:2}}}}),['OP_ID_REUSE']));
  await check('optimistic version conflict',async()=>{const results=await Promise.all(['writer-a','writer-b'].map(opId=>adapter.patch(request(row,opId,{payload:{winner:opId}},1))));assert.deepEqual(results.map(x=>x.status).sort(),['applied','conflict']);});
  await check('forbidden direct terminal transition',()=>rejects(()=>adapter.patch(request(base[1],'skip-approval',{status:'completed'})),['VALIDATION']));
  await check('terminal mutation rejection',async()=>{await adapter.patch(request(row,'approve',{status:'approved'},2));await adapter.patch(request(row,'complete',{status:'completed'},3));await rejects(()=>adapter.patch(request(row,'after-complete',{payload:{forbidden:true}},4)),['TERMINAL']);});
  await check('abort before commit',async()=>{const before=stableSnapshot(await adapter.inspectInvariants());await rejects(()=>adapter.patch({...request(base[1],'abort',{payload:{never:true}}),abortBeforeCommit:true}));assert.equal(stableSnapshot(await adapter.inspectInvariants()),before);});
  await check('out-of-order checkpoint',()=>rejects(()=>adapter.appendCheckpoint({tenantId:base[1].tenantId,id:base[1].id,expectedVersion:0,checkpoint:{sequence:9},opId:'wrong-order'}),['CHECKPOINT_ORDER']));
  await check('payload limit',()=>rejects(()=>adapter.patch(request(base[1],'too-large',{payload:{blob:'x'.repeat(65537)}})),['VALIDATION']));
  await check('cross-tenant read/write/list/history',async()=>{const wrong=authorize(adapter,'tenant-other');for(const fn of [()=>wrong.get(row.tenantId,row.id),()=>wrong.patch(original),()=>wrong.history({tenantId:row.tenantId,id:row.id,limit:10}),()=>wrong.listOpen({tenantId:row.tenantId,limit:10})])await rejects(fn);});
  await check('positive get and list pagination',async()=>{const found=await adapter.get(base[1].tenantId,base[1].id);assert.deepEqual(found.payload,base[1].payload);assert.equal(await adapter.get('tenant-1','absent'),null);const expected=base.filter(r=>r.tenantId==='tenant-1').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));const first=await adapter.listOpen({tenantId:'tenant-1',limit:7});assert.deepEqual(first.map(r=>r.id),expected.slice(0,7).map(r=>r.id));const last=first.at(-1);const next=await adapter.listOpen({tenantId:'tenant-1',limit:7,after:{createdAt:last.createdAt,id:last.id}});assert.deepEqual(next.map(r=>r.id),expected.slice(7,14).map(r=>r.id));});
  await check('positive history pagination',async()=>{const first=await adapter.history({tenantId:row.tenantId,id:row.id,limit:2});assert.deepEqual(first.map(e=>e.sequence),[1,2]);const next=await adapter.history({tenantId:row.tenantId,id:row.id,limit:2,afterSequence:2});assert.deepEqual(next.map(e=>e.sequence),[3,4]);assert.deepEqual(next.map(e=>e.opId),['approve','complete']);});
  const snapshot=await adapter.inspectInvariants();const invariant=verifySnapshot(snapshot,{baseline:base,expected:[{tenantId:row.tenantId,id:row.id,version:4,status:'completed'},{tenantId:base[1].tenantId,id:base[1].id,version:0,payload:base[1].payload}]});assert(invariant.ok,invariant.errors.join('\n'));
  const negative=negativeControl(snapshot,{baseline:base});assert(negative.detected);cases.push({name:'deliberate duplicate-event negative control',passed:true,...negative});
  return {cases,invariant};
}
export function timingOracle(snapshot,seed=SEED){
  const base=fixtures(seed),intended=structuredClone(base);
  for(const operation of [...workload({warmup:true,seed}),...workload({seed})]){
    const record=intended[operation.index];if(operation.method==='patch'){record.payload.observation={counter:operation.args[0].patch.payload.observation.counter};record.version++;}
    if(operation.method==='appendCheckpoint'){record.payload.lastCheckpoint=operation.args[0].checkpoint;record.version++;}
  }
  return verifySnapshot(snapshot,{baseline:base,expected:intended.map(({tenantId,id,status,version,schemaVersion,payload})=>({tenantId,id,status,version,schemaVersion,payload}))});
}
export function verifyTimingRows(rows,seed=SEED){
 const records=fixtures(seed),operations=workload({seed}),errors=[];
 const allowed=new Map(records.map(r=>[r.id,[projection(r)]]));
 for(const op of workload({warmup:true,seed})){if(!['patch','appendCheckpoint'].includes(op.method))continue;const row=structuredClone(records[op.index]);if(op.method==='patch')row.payload.observation=op.args[0].patch.payload.observation;else row.payload.lastCheckpoint=op.args[0].checkpoint;row.version=1;allowed.set(row.id,[projection(row)]);}
 for(const op of operations){if(!['patch','appendCheckpoint'].includes(op.method))continue;const row=structuredClone(records[op.index]);if(op.method==='patch')row.payload.observation=op.args[0].patch.payload.observation;else row.payload.lastCheckpoint=op.args[0].checkpoint;row.version=1;allowed.get(row.id).push(projection(row));}
 const validProjection=row=>row&&allowed.get(row.id)?.some(expected=>digest(row)===digest(expected));
 const modified=new Map();for(const op of operations){if(op.method==='patch')modified.set(op.index,{...records[op.index].payload,observation:op.args[0].patch.payload.observation});if(op.method==='appendCheckpoint')modified.set(op.index,{...records[op.index].payload,lastCheckpoint:op.args[0].checkpoint});}
 rows.forEach((row,i)=>{const op=operations[i],record=records[op.index];if(row.error){errors.push(`${i}: activity error`);return;}const value=row.result;
  if(op.method==='get'){if(!validProjection(value)||value?.id!==record.id||value?.tenantId!==record.tenantId||!new Set([digest(record.payload),...(modified.has(op.index)?[digest(modified.get(op.index))]:[])]).has(value.payloadHash))errors.push(`${i}: get content mismatch`);}
  else if(['patch','appendCheckpoint'].includes(op.method)){if(value?.status!=='applied'||value?.version!==1)errors.push(`${i}: expected single applied mutation`);}
  else {if(!Array.isArray(value)||!value.every(validProjection))errors.push(`${i}: returned row content mismatch`);let expected=records.filter(r=>r.tenantId===op.identity);if(op.method==='queryPayload')expected=expected.filter(r=>r.payload.agent?.model==='model-a');expected=expected.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,op.args[0].limit);const actualIDs=value?.map(r=>r.id),wantedIDs=expected.map(r=>r.id);if(op.method==='queryPayload'){actualIDs?.sort();wantedIDs.sort();}if(digest(actualIDs)!==digest(wantedIDs))errors.push(`${i}: returned projection mismatch`);}
 });return {ok:!errors.length,errors,checked:rows.length};
}
