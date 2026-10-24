import {Worker,NativeConnection,Runtime,DefaultLogger} from '@temporalio/worker';
import {Context,ApplicationFailure} from '@temporalio/activity';
import {appendFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAdapter,authorize,schemaDefinitions} from './adapters.mjs';
import {fixtures,projection,digest,SEED} from './fixtures.mjs';
import {correctnessSuite,evolutionStart,evolutionFinish,timingOracle} from './suites.mjs';
import {verifySnapshot,stableSnapshot} from './oracle.mjs';
const root=dirname(fileURLToPath(import.meta.url)),out=process.env.TDF_OUTPUT;
if(!out||!process.env.TDF_QUEUE)throw new Error('Worker must be launched by experiment runner');
mkdirSync(join(out,'snapshots'),{recursive:true});
const adapters=new Map();
async function adapterFor(arm){if(!['postgres','mongodb'].includes(arm))throw new Error('Unknown arm');if(!adapters.has(arm))adapters.set(arm,await createAdapter(arm));return adapters.get(arm);}
const log=record=>appendFileSync(join(out,'activity-attempts.jsonl'),JSON.stringify({...record,at:new Date().toISOString()})+'\n');
async function execute(input){
 const attempt=Context.current().info.attempt;const adapter=authorize(await adapterFor(input.arm),input.identity);const start=performance.now();
 try{
  const result=await adapter[input.method](...input.args);const dbMs=performance.now()-start;
  log({arm:input.arm,label:input.label,opId:input.opId||input.args[0]?.opId,method:input.method,attempt,dbMs,status:result?.status||'read'});
  if(input.fault==='commit-before-ack'&&attempt===1)throw new Error('Injected failure after database commit before activity acknowledgment');
  if(input.fault==='worker-crash'&&!existsSync(join(out,'worker-crash.marker'))){writeFileSync(join(out,'worker-crash.marker'),JSON.stringify({attempt,arm:input.arm,result}));process.exit(77);}
  return {result:projection(result),dbMs,attempt};
 }catch(error){log({arm:input.arm,label:input.label,method:input.method,attempt,error:error.message,code:error.code});
  if(['VALIDATION','TERMINAL','OP_ID_REUSE','CHECKPOINT_ORDER','UNAUTHORIZED','FORBIDDEN'].includes(error.code))throw ApplicationFailure.nonRetryable(error.message,error.code);
  throw error;
 }
}
async function control(input){
 const adapter=await adapterFor(input.arm);
 if(input.action==='reset'){await adapter.reset(fixtures(input.seed));return {seed:input.seed,fixtureHash:digest(fixtures(input.seed)),count:1000};}
 if(input.action==='index')return await adapter.evolve({phase:'add-index'});
 if(input.action==='diagnostics')return {schemaDefinitions,diagnostics:await adapter.diagnostics()};
 if(input.action==='evolution-start')return await evolutionStart(adapter,input.seed);
 if(input.action==='evolution-batch')return await adapter.evolve({phase:'backfill-v2',batchSize:100,maxBatches:1});
 if(input.action==='evolution-finish')return await evolutionFinish(adapter,input.evidence,input.resumed);
 if(input.action==='correctness')return await correctnessSuite(adapter);
 if(input.action==='snapshot'){
  const snapshot=await adapter.inspectInvariants(),name=`${input.label}-${input.arm}.json`;
  writeFileSync(join(out,'snapshots',name),JSON.stringify(snapshot));
  const oracle=input.timing?timingOracle(snapshot,input.seed):verifySnapshot(snapshot,{baseline:fixtures(input.seed??SEED),expected:input.expected||[]});
  return {file:`snapshots/${name}`,hash:stableSnapshot(snapshot),oracle};
 }
 throw new Error('Unknown control action');
}
Runtime.install({logger:new DefaultLogger('WARN')});
const connection=await NativeConnection.connect({address:'127.0.0.1:17239'});
const worker=await Worker.create({connection,namespace:'default',identity:'tdf-worker',taskQueue:process.env.TDF_QUEUE,workflowsPath:join(root,'workflows.cjs'),activities:{execute,control},maxConcurrentActivityTaskExecutions:20,maxConcurrentWorkflowTaskExecutions:20,shutdownGraceTime:'2 seconds'});
const running=worker.run();process.send?.({ready:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>worker.shutdown());
try{await running;}finally{for(const adapter of adapters.values())await adapter.close();await connection.close();}
