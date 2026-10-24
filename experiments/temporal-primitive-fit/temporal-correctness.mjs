import assert from 'node:assert/strict';
import {appendFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker,NativeConnection,Runtime,DefaultLogger} from '@temporalio/worker';
import {Client,Connection,WorkflowExecutionAlreadyStartedError} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {createAdapter} from './adapters.mjs';
import {sessionFixtures} from './fixtures.mjs';
import {assertSnapshot,applyMutation} from './oracle.mjs';
export async function temporalCorrectness({out,seed,config}){
 Runtime.install({logger:new DefaultLogger('WARN')});
 const adapters=new Map(),checks=[],attempts=[];const queue=`primitive-${Date.now()}`;
 const native=await NativeConnection.connect({address:'127.0.0.1:17539'}),connection=await Connection.connect({address:'127.0.0.1:17539'});
 const client=new Client({connection,namespace:'default'});
 const worker=await Worker.create({connection:native,namespace:'default',taskQueue:queue,workflowsPath:join(dirname(fileURLToPath(import.meta.url)),'workflows.cjs'),activities:{mutate:async input=>{
  const adapter=adapters.get(input.design);if(!adapter)throw new Error('Unknown correctness arm');const attempt=Context.current().info.attempt;
  const result=await adapter.mutate(input.args);let reconciled=false;
  if(!result.applied){const r=await adapter.read(input.args);assert.ok(r,'Reconciliation missing record');assert.equal(r.version,input.args.expectedVersion+1);assert.equal(r.payload.hot.value,input.args.nextValue);reconciled=true;}
  attempts.push({design:input.design,args:input.args,attempt,result,reconciled});
  await appendFile(join(out,'temporal-attempts.jsonl'),JSON.stringify(attempts.at(-1))+'\n');
  if(input.commitBeforeAck&&attempt===1)throw new Error('Injected committed CAS before activity acknowledgment');
  return {version:input.args.expectedVersion+1,reconciled};
 }},maxConcurrentActivityTaskExecutions:2,shutdownGraceTime:'2 seconds'});
 const running=worker.run();
 try{
  for(const design of ['pg-monolithic','pg-split','mongo']){
   const adapter=await createAdapter({design,config:{...config,sessionProfile:'known-hot'}});adapters.set(design,adapter);const expected=sessionFixtures({count:10,tenants:10,payloadBytes:8192,seed});await adapter.setup({sessions:expected});
   let replayHistory;
   for(let i=0;i<10;i++){
    const r=expected[i],args={tenantId:r.tenantId,id:r.id,expectedVersion:r.version,nextValue:i+100};const workflowId=`${queue}-${design}-${i}`;
    const result=await client.workflow.execute('primitiveMutation',{workflowId,taskQueue:queue,args:[{design,args,commitBeforeAck:i===0}],workflowExecutionTimeout:'90 seconds'});
    assert.equal(result.version,1);assert.equal(result.reconciled,i===0);applyMutation(r,args);
    if(i===0){const history=await client.workflow.getHandle(workflowId).fetchHistory();replayHistory=history;await writeFile(join(out,`temporal-history-${design}.json`),JSON.stringify(history));let duplicateRejected=false;try{await client.workflow.start('primitiveMutation',{workflowId,taskQueue:queue,workflowIdReusePolicy:'REJECT_DUPLICATE',args:[{design,args}]});}catch(error){if(!(error instanceof WorkflowExecutionAlreadyStartedError))throw error;duplicateRejected=true;}assert.ok(duplicateRejected);checks.push({design,check:'duplicate-workflow-id-rejected',passed:true});}
   }
   const actual=await adapter.snapshot();const digest=assertSnapshot(expected,actual);await writeFile(join(out,`temporal-snapshot-${design}.json`),JSON.stringify(actual));checks.push({design,check:'committed-CAS-reconciled-on-retry',passed:true,snapshotHash:digest});
   await Worker.runReplayHistory({workflowsPath:join(dirname(fileURLToPath(import.meta.url)),'workflows.cjs')},replayHistory);checks.push({design,check:'same-code-mutation-history-replay',passed:true});
  }
  const result={outcome:'passed',mutations:30,attempts:attempts.length,checks,scope:'Dedicated isolated records: version and intended value verify a previously applied CAS. This is bounded CAS reconciliation, not a general idempotency receipt protocol; no timings pooled with kernels.'};await writeFile(join(out,'temporal-correctness.json'),JSON.stringify(result,null,2));return result;
 }finally{worker.shutdown();await running;for(const adapter of adapters.values())await adapter.close();await native.close();await connection.close();}
}
