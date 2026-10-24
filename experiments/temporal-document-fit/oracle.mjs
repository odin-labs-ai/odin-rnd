import {digest} from './fixtures.mjs';
// Independent evidence checks: never infer correctness from agreement of the two stores.
export function verifySnapshot(snapshot,{baseline=[],expected=[]}={}) {
  const errors=[]; const bases=new Map(baseline.map(r=>[`${r.tenantId}/${r.id}`,r.version]));
  const records=new Map(snapshot.records.map(r=>[`${r.tenantId}/${r.id}`,r]));
  const receipts=new Map(), operations=new Map(), sequences=new Map();
  for(const receipt of snapshot.receipts){const key=`${receipt.tenantId}/${receipt.opId}`;if(receipts.has(key))errors.push(`duplicate receipt:${key}`);receipts.set(key,receipt);}
  for(const event of snapshot.events){
    const key=`${event.tenantId}/${event.opId}`,recordKey=`${event.tenantId}/${event.id}`,sequenceKey=`${recordKey}/${event.sequence}`;
    operations.set(key,(operations.get(key)||0)+1); if(sequences.has(sequenceKey))errors.push(`duplicate sequence:${sequenceKey}`); sequences.set(sequenceKey,event);
    const receipt=receipts.get(key);if(!receipt)errors.push(`event without receipt:${key}`);
    else if(receipt.id!==event.id || receipt.result.version!==event.sequence)errors.push(`receipt/event disagreement:${key}`);
    if(!records.has(recordKey))errors.push(`event without record:${recordKey}`);
  }
  for(const [key,receipt] of receipts){if(operations.get(key)!==1)errors.push(`event multiplicity:${key}:${operations.get(key)||0}`);if(receipt.result.status!=='applied')errors.push(`non-applied receipt:${key}`);}
  for(const [key,record] of records){const start=bases.get(key)||0;for(let version=start+1;version<=record.version;version++)if(!sequences.has(`${key}/${version}`))errors.push(`missing accepted version:${key}/${version}`);const last=snapshot.events.filter(e=>`${e.tenantId}/${e.id}`===key).map(e=>e.sequence);if(last.some(v=>v>record.version))errors.push(`event beyond state:${key}`);}
  // Reconstruct state from the known initial fixture plus recorded accepted operations.
  // This catches corruption/preservation failures even for records untouched by a fault.
  const reconstructed=new Map(baseline.map(r=>[`${r.tenantId}/${r.id}`,structuredClone(r)]));
  const merge=(target,patch)=>{for(const [k,v]of Object.entries(patch)){if(v&&typeof v==='object'&&!Array.isArray(v)&&target[k]&&typeof target[k]==='object'&&!Array.isArray(target[k]))merge(target[k],v);else target[k]=structuredClone(v);}return target;};
  for(const event of [...snapshot.events].sort((a,b)=>a.sequence-b.sequence)){
    const key=`${event.tenantId}/${event.id}`,effect=event.payload||{};let row=reconstructed.get(key);
    if(effect.kind==='create'&&effect.record){row=structuredClone(effect.record);reconstructed.set(key,row);}
    if(!row)continue;
    if(effect.kind==='patch'){const patch=effect.patch||{};if(patch.payload){merge(row.payload,patch.payload);if(Object.hasOwn(patch.payload,'priority')){if(effect.writerVersion===2)row.payload.priorityV2={level:patch.payload.priority};else delete row.payload.priorityV2;}}if(patch.status!==undefined)row.status=patch.status;if(patch.schemaVersion!==undefined)row.schemaVersion=patch.schemaVersion;}
    if(effect.kind==='checkpoint')row.payload.lastCheckpoint=structuredClone(effect.checkpoint);
    row.version=event.sequence;
  }
  for(const [key,wanted]of reconstructed){const row=records.get(key);if(!row){errors.push(`missing baseline or created record:${key}`);continue;}for(const field of ['tenantId','id','status','version','schemaVersion','createdAt','payload'])if(digest(row[field])!==digest(wanted[field]))errors.push(`reconstructed state mismatch:${key}:${field}`);}
  if(baseline.length)for(const key of records.keys())if(!reconstructed.has(key))errors.push(`unintended record:${key}`);
  for(const wanted of expected){const row=records.get(`${wanted.tenantId}/${wanted.id}`);if(!row){errors.push(`missing intended record:${wanted.id}`);continue;}for(const [field,value]of Object.entries(wanted)){if(digest(row[field])!==digest(value))errors.push(`intended state mismatch:${wanted.id}:${field}`);}}
  return {ok:errors.length===0,errors,records:snapshot.records.length,events:snapshot.events.length,receipts:snapshot.receipts.length};
}
export function negativeControl(snapshot,options){if(!snapshot.events.length)throw new Error('negative control requires an event');const corrupted=structuredClone(snapshot);corrupted.events.push(structuredClone(corrupted.events[0]));const verdict=verifySnapshot(corrupted,options);return {detected:!verdict.ok,errors:verdict.errors};}
export function stableSnapshot(snapshot){return digest({records:[...snapshot.records].sort((a,b)=>`${a.tenantId}/${a.id}`.localeCompare(`${b.tenantId}/${b.id}`)),events:[...snapshot.events].sort((a,b)=>`${a.tenantId}/${a.id}/${a.sequence}`.localeCompare(`${b.tenantId}/${b.id}/${b.sequence}`)),receipts:[...snapshot.receipts].sort((a,b)=>`${a.tenantId}/${a.opId}`.localeCompare(`${b.tenantId}/${b.opId}`))});}
