const {proxyActivities,defineSignal,setHandler,condition}=require('@temporalio/workflow');
const {execute}=proxyActivities({startToCloseTimeout:'30 seconds',retry:{maximumAttempts:3,initialInterval:'1 second',maximumInterval:'2 seconds'}});
const {control}=proxyActivities({startToCloseTimeout:'30 seconds',retry:{maximumAttempts:1}});
exports.operation=async function operation(input){const start=Date.now();const result=await execute(input);return {...result,temporalMs:Date.now()-start};};
exports.control=async function controlWorkflow(input){return await control(input);};
exports.batch=async function batch({operations,concurrency,arm,label}){
  const results=new Array(operations.length);let cursor=0;
  await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<operations.length){const i=cursor++,start=Date.now();try{results[i]={index:i,...await execute({arm,...operations[i],label}),temporalMs:Date.now()-start};}catch(error){results[i]={index:i,error:error.message,temporalMs:Date.now()-start};}}}));
  return results;
};
const approval=defineSignal('approval');
exports.approval=async function approvalWorkflow(input){let deliveries=0;const accepted=new Set();setHandler(approval,signal=>{if(signal.identity!==input.identity||signal.tenantId!==input.identity)return;deliveries++;accepted.add(signal.opId);});await condition(()=>deliveries>=2);const result=await execute({...input,method:'patch',args:[{tenantId:input.identity,id:input.id,expectedVersion:0,patch:{status:'approved'},opId:'approve-once'}]});return {deliveries,uniqueApprovals:accepted.size,result};};

exports.evolution=async function evolutionWorkflow({arm,seed}){
 const evidence=await control({arm,seed,action:'evolution-start'});
 const resumed={scanned:0,applied:0,conflicts:0,batches:0,interrupted:false};let complete=false;
 for(let i=0;i<12;i++){const batch=await control({arm,action:'evolution-batch'});for(const key of ['scanned','applied','conflicts','batches'])resumed[key]+=batch[key];if(!batch.interrupted){complete=true;break;}}
 if(!complete)throw new Error('Backfill exceeded bounded batch count');
 return await control({arm,action:'evolution-finish',evidence,resumed});
};
