import {createHash} from 'node:crypto';
export const SEED=20261019;
export const ordered = value => value===null || typeof value!=='object' ? value : Array.isArray(value) ? value.map(ordered) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));
export const digest = value => createHash('sha256').update((JSON.stringify(ordered(value)) ?? 'undefined')).digest('hex');
export function fixtures(seed=SEED) {
  return Array.from({length:1000},(_,i)=>({tenantId:`tenant-${i%10}`,id:`record-${String(i).padStart(4,'0')}`,status:'open',version:0,schemaVersion:1,createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),updatedAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),payload:{kind:i%2?'session':'work-order',priority:i%5,unknown:{preserve:`value-${seed}-${i}`},tags:['synthetic',`group-${i%7}`],...(i%3===0?{}:{agent:{model:i%3===1?'model-a':null}}),padding:'x'.repeat(1024+(i*97+seed)%6144)}}));
}
export function workload({warmup=false,seed=SEED}={}) {
  const records=fixtures(seed); const length=warmup?100:1000;
  return Array.from({length},(_,i)=>{
    const slot=i%10, group=Math.floor(i/10), base=warmup?0:100;
    const index=slot===6||slot===7||slot===8?base+group*3+(slot-6):base+(i*17)%(warmup?100:900);
    const record=records[index], identity=record.tenantId;
    const opId=`${warmup?'warm':'counted'}-${i}`;
    if(slot<4) return {method:'get',args:[identity,record.id],identity,index,opId};
    if(slot<6) return {method:'listOpen',args:[{tenantId:identity,limit:10}],identity,index,opId};
    if(slot<8) return {method:'patch',args:[{tenantId:identity,id:record.id,expectedVersion:0,patch:{payload:{observation:{counter:i}}},opId}],identity,index,opId};
    if(slot===8) return {method:'appendCheckpoint',args:[{tenantId:identity,id:record.id,expectedVersion:0,checkpoint:{sequence:1,cursor:`cursor-${i}`},opId}],identity,index,opId};
    return {method:'queryPayload',args:[{tenantId:identity,path:'agent.model',value:'model-a',limit:100}],identity,index,opId};
  });
}
export function projection(value) {
  if(Array.isArray(value)) return value.map(projection);
  if(value?.payload && value.id) return {tenantId:value.tenantId,id:value.id,status:value.status,version:value.version,schemaVersion:value.schemaVersion,payloadHash:digest(value.payload)};
  return value;
}
export function summary(values) {
  if(!values.length) return {n:0}; const sorted=[...values].sort((a,b)=>a-b);
  const q=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
  return {n:values.length,min:sorted[0],p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1),mean:values.reduce((a,b)=>a+b,0)/values.length};
}
