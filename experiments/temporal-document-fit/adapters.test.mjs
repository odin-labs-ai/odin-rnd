import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,validateJSON,requestHash,createAdapter,authorize,nativePayloadChanges,postgresPayloadExpression,mongoRecordUpdate} from './adapters.mjs';

const fixture=(id='record-1',tenantId='tenant-0')=>({tenantId,id,status:'open',version:0,schemaVersion:1,createdAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z',payload:{priority:2,unknown:{keep:true},agent:{model:'model-a'}}});
const request=(opId,extra={})=>({tenantId:'tenant-0',id:'record-1',expectedVersion:0,patch:{payload:{newField:'value'}},opId,...extra});

test('canonical request identity ignores key order but preserves null, absence and arrays',()=>{
  assert.equal(canonical({b:2,a:{z:1,y:[null,3]}}),canonical({a:{y:[null,3],z:1},b:2}));
  assert.equal(requestHash({a:1,b:2}),requestHash({b:2,a:1}));
  assert.notEqual(requestHash({a:null}),requestHash({}));
  assert.notEqual(requestHash({a:[1,2]}),requestHash({a:[2,1]}));
});
test('shared validation rejects data which JSON or BSON would silently alter',()=>{
  for(const v of [NaN,Infinity,Number.MAX_SAFE_INTEGER+1,undefined,new Date(),{a:undefined},JSON.parse('{"__proto__":{}}'),{'a.b':1},{'$set':2}]) assert.throws(()=>validateJSON(v),{code:'VALIDATION'});
  const cyclic={};cyclic.a=cyclic;assert.throws(()=>canonical(cyclic),{code:'VALIDATION'});
  validateJSON({a:null,b:[1,1.5,true,'ok']});
});
test('native writes target changed leaves, replace missing parents and arrays, and remove derived keys',()=>{
  const old={payload:{agent:{model:'a',keep:true},priorityV2:{level:2},tags:['a'],nullable:null}};
  const next={...old,status:'open',version:1,schemaVersion:1,updatedAt:'2026-10-19T00:00:00.000Z',payload:{agent:{model:'b',keep:true},tags:['b','c'],nullable:{new:true},newParent:{child:1}}};
  const changes=nativePayloadChanges(old.payload,next.payload);
  assert.deepEqual(changes.map(c=>c.path),[['priorityV2'],['agent','model'],['tags'],['nullable'],['newParent']]);
  const pg=postgresPayloadExpression(changes,8);
  assert.match(pg.sql,/#- \$8::text\[\]/);assert.match(pg.sql,/jsonb_set/);
  assert.deepEqual(pg.values[1],['agent','model']);assert.equal(pg.values[2],'"b"');
  const mongo=mongoRecordUpdate(old,next);
  assert.equal(mongo.$set['payload.agent.model'],'b');assert.equal(mongo.$set.payload,undefined);
  assert.equal(mongo.$set['payload.agent.keep'],undefined);assert.deepEqual(mongo.$set['payload.tags'],['b','c']);
  assert.deepEqual(mongo.$set['payload.newParent'],{child:1});assert.deepEqual(mongo.$unset,{'payload.priorityV2':''});
});
test('factory refuses other databases before opening a connection',async()=>{
  for(const [arm,config] of [['postgres',{port:5432}],['postgres',{database:'production'}],['mongodb',{port:27017}],['mongodb',{uri:'mongodb://example.com'}]]) await assert.rejects(createAdapter(arm,config),{code:'ENDPOINT'});
});
test('independent identity authorization prevents direct ID, mutation, list, query and history escape',()=>{
  const raw=new Proxy({}, {get(){return ()=>assert.fail('Database must not be reached');}});
  const a=authorize(raw,'tenant-0');
  assert.throws(()=>a.get('tenant-1','record-1'),{code:'AUTHORIZATION'});
  assert.throws(()=>a.create(fixture('record-1','tenant-1'),'create'),{code:'AUTHORIZATION'});
  for(const method of ['patch','appendCheckpoint','listOpen','history','queryPayload']) assert.throws(()=>a[method]({tenantId:'tenant-1'}),{code:'AUTHORIZATION'});
});

for(const arm of ['postgres','mongodb']) test(`${arm}: native transactional contract, evolution and negative controls`,{skip:process.env.TDF_DATABASE_TESTS!=='1'},async t=>{
  const a=await createAdapter(arm);t.after(()=>a.close());
  await t.test('receipt replay precedes version checks; mismatched replay and abort have no effects',async()=>{
    await a.reset([fixture()]);
    assert.deepEqual(await a.patch(request('once')),{status:'applied',version:1});
    assert.deepEqual(await a.patch(request('once')),{status:'duplicate',version:1});
    await assert.rejects(a.patch(request('once',{patch:{payload:{newField:'changed'}}})),{code:'OP_ID_REUSE'});
    await assert.rejects(a.patch(request('abort',{expectedVersion:1,abortBeforeCommit:true})),{code:'INJECTED_ABORT'});
    const snapshot=await a.inspectInvariants();assert.equal(snapshot.ok,true);assert.equal(snapshot.records[0].version,1);assert.equal(snapshot.events.length,1);assert.equal(snapshot.receipts.length,1);
  });
  await t.test('simultaneous stale writers have one winner; checkpoint and terminal rules enforced',async()=>{
    await a.reset([fixture()]);
    const results=await Promise.all([a.patch(request('writer-a')),a.patch(request('writer-b'))]);
    assert.deepEqual(results.map(r=>r.status).sort(),['applied','conflict']);
    await assert.rejects(a.appendCheckpoint({tenantId:'tenant-0',id:'record-1',expectedVersion:1,checkpoint:{sequence:1},opId:'bad-seq'}),{code:'CHECKPOINT_ORDER'});
    assert.equal((await a.appendCheckpoint({tenantId:'tenant-0',id:'record-1',expectedVersion:1,checkpoint:{sequence:2,label:'checkpoint'},opId:'checkpoint'})).version,2);
    assert.equal((await a.get('tenant-0','record-1')).payload.lastCheckpoint.sequence,2);
    await a.patch(request('approve',{expectedVersion:2,patch:{status:'approved'}}));
    await a.patch(request('complete',{expectedVersion:3,patch:{status:'completed'}}));
    await assert.rejects(a.patch(request('late',{expectedVersion:4})),{code:'TERMINAL'});
    assert.equal((await a.inspectInvariants()).events.length,4);
  });
  await t.test('optional data preservation, explicit null, indexed equality and pagination',async()=>{
    const r2=fixture('record-2');r2.payload.agent.model=null;
    const r3=fixture('record-3');delete r3.payload.agent.model;
    await a.reset([fixture(),r2,r3,fixture('record-4','tenant-1')]);
    await a.patch(request('old-writer',{patch:{payload:{agent:{other:'preserved'}}}}));
    assert.equal((await a.get('tenant-0','record-1')).payload.agent.model,'model-a');
    for(const stage of ['before','after']) {
      if(stage==='after') await a.evolve({phase:'add-index'});
      assert.deepEqual((await a.queryPayload({tenantId:'tenant-0',path:'agent.model',value:'model-a'})).map(r=>r.id),['record-1']);
      assert.deepEqual((await a.queryPayload({tenantId:'tenant-0',path:'agent.model',value:null})).map(r=>r.id),['record-2']);
    }
    const page=await a.listOpen({tenantId:'tenant-0',limit:2});
    assert.deepEqual(page.map(r=>r.id),['record-1','record-2']);
    assert.deepEqual((await a.listOpen({tenantId:'tenant-0',after:page[1]})).map(r=>r.id),['record-3']);
  });
  await t.test('native nested writes preserve siblings and distinguish exact scalar/array/object queries',async()=>{
    const r=fixture();r.payload.agent.keep={deep:'untouched'};r.payload.tags=['a'];r.payload.nullable=null;
    const arrayRow=fixture('record-2');arrayRow.payload.agent.model=['model-a'];
    await a.reset([r,arrayRow]);
    await a.patch(request('native-path',{patch:{payload:{agent:{model:'model-b'},tags:['b','c'],nullable:{child:1},newParent:{deep:{child:true}}}}}));
    const actual=await a.get(r.tenantId,r.id);
    assert.deepEqual(actual.payload.agent.keep,{deep:'untouched'});assert.deepEqual(actual.payload.tags,['b','c']);
    assert.deepEqual(actual.payload.nullable,{child:1});assert.deepEqual(actual.payload.newParent,{deep:{child:true}});
    assert.deepEqual((await a.queryPayload({tenantId:'tenant-0',path:'agent.model',value:'model-a'})).map(x=>x.id),[]);
    assert.deepEqual((await a.queryPayload({tenantId:'tenant-0',path:'agent.model',value:['model-a']})).map(x=>x.id),['record-2']);
    assert.deepEqual((await a.queryPayload({tenantId:'tenant-0',path:'agent.keep',value:{deep:'untouched'}})).map(x=>x.id),['record-1']);
  });
  await t.test('guarded backfill survives concurrent old writes, interruption and repetition',async()=>{
    await a.reset([fixture(),fixture('record-2'),fixture('record-3')]);
    let changed=false;
    const first=await a.evolve({phase:'backfill-v2',batchSize:1,maxBatches:1,beforeBatch:async items=>{
      if(!changed){changed=true;await a.patch(request('concurrent-old',{id:items[0].id,patch:{payload:{priority:7,extra:'keep'}}}));}
    }});
    assert.equal(first.conflicts,1);assert.equal(first.interrupted,true);
    await a.evolve({phase:'backfill-v2',batchSize:1});
    const r=await a.get('tenant-0','record-1');assert.equal(r.payload.priorityV2.level,7);assert.equal(r.payload.extra,'keep');assert.equal(r.payload.unknown.keep,true);
    assert.equal((await a.evolve({phase:'backfill-v2'})).applied,0);
    await a.patch(request('old-again',{expectedVersion:r.version,patch:{payload:{priority:9}}}));
    assert.equal(Object.hasOwn((await a.get('tenant-0','record-1')).payload,'priorityV2'),false);
    await a.evolve({phase:'backfill-v2'});
    assert.equal((await a.get('tenant-0','record-1')).payload.priorityV2.level,9);
    assert.equal((await a.inspectInvariants()).ok,true);
  });
  await t.test('payload limit, unsafe keys, absent record and cross-tenant mutation cannot mutate',async()=>{
    await a.reset([fixture()]);
    await assert.rejects(a.patch(request('oversize',{patch:{payload:{blob:'x'.repeat(65537)}}})),{code:'VALIDATION'});
    await assert.rejects(a.patch(request('unsafe',{patch:{payload:JSON.parse('{"__proto__":1}')}})),{code:'VALIDATION'});
    assert.deepEqual(await a.patch(request('missing',{tenantId:'tenant-1'})),{status:'not_found',version:null});
    assert.equal((await a.inspectInvariants()).events.length,0);
  });
  await t.test('concurrent identical operation and create deduplicate exactly once',async()=>{
    await a.reset([]);
    const r=fixture();
    const results=await Promise.all([a.create(r,'create-once'),a.create(r,'create-once')]);
    assert.deepEqual(results.map(r=>r.status).sort(),['applied','duplicate']);
    await assert.rejects(a.create({...r,payload:{changed:1}},'create-once'),{code:'OP_ID_REUSE'});
    const snapshot=await a.inspectInvariants();assert.equal(snapshot.ok,true);assert.equal(snapshot.events.length,1);assert.equal(snapshot.records[0].version,1);
  });
});
