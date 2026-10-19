import test from 'node:test';
import assert from 'node:assert/strict';
import {invokeMeasured} from './run.mjs';
test('failed driver operation retains original request and latency without changing the rejection',async()=>{
 const original=new Error('injected database refusal');
 const args={tenantId:'tenant-3',id:'session-000003',expectedVersion:7,nextValue:4,path:['tools','tool9','b']};
 const adapter={mutate:async request=>{assert.equal(request,args);throw original;}};
 await assert.rejects(invokeMeasured(adapter,'mutate',args),error=>{
  assert.equal(error,original);assert.deepEqual(error.operation.args,args);assert.equal(error.operation.method,'mutate');assert.ok(error.operation.elapsedMs>=0);return true;
 });
});
test('successful measured call retains returned value and does not manufacture failure metadata',async()=>{
 const result={applied:true,version:8};const measured=await invokeMeasured({mutate:async()=>result},'mutate',{id:'session-1'});
 assert.equal(measured.actual,result);assert.ok(measured.elapsedMs>=0);assert.equal(measured.operation,undefined);
});
