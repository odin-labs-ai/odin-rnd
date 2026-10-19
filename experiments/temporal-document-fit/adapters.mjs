import { createHash } from 'node:crypto';

export class AdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterError'; this.code = code; }
}
const fail = (code, message) => { throw new AdapterError(code, message); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function validateJSON(value) {
  const active = new Set();
  function walk(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) fail('VALIDATION', 'Unsafe numeric value');
      return;
    }
    if (!Array.isArray(v) && !plain(v)) fail('VALIDATION', 'Only plain JSON values are supported');
    if (active.has(v)) fail('VALIDATION', 'Cyclic JSON');
    active.add(v);
    for (const k of Object.keys(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k) || k.startsWith('$') || k.includes('.') || k.includes('\0')) fail('VALIDATION', 'Unsafe JSON key');
      walk(v[k]);
    }
    active.delete(v);
  }
  walk(value);
  return value;
}
export function canonical(value) {
  validateJSON(value);
  const encode = v => Array.isArray(v) ? `[${v.map(encode).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode(v[k])}`).join(',')}}` : JSON.stringify(v);
  return encode(value);
}
export const requestHash = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = v => JSON.parse(canonical(v));
function payload(v) {
  if (!plain(v)) fail('VALIDATION', 'Payload must be an object');
  validateJSON(v);
  if (Buffer.byteLength(canonical(v)) > 65536) fail('VALIDATION', 'Payload exceeds 64 KiB');
  return v;
}
function key(v) { if (typeof v !== 'string' || !/^[A-Za-z0-9_:@-]{1,200}$/.test(v)) fail('VALIDATION', 'Invalid identifier'); return v; }
function int(v) { if (!Number.isSafeInteger(v) || v < 0) fail('VALIDATION', 'Invalid version'); return v; }
function timestamp(v) { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) fail('VALIDATION', 'Invalid timestamp'); return new Date(v).toISOString(); }
function record(r) {
  validateJSON(r); key(r.tenantId); key(r.id); int(r.version); int(r.schemaVersion);
  if (!['open', 'approved', 'completed'].includes(r.status)) fail('VALIDATION', 'Invalid status');
  payload(r.payload);
  return {tenantId:r.tenantId,id:r.id,status:r.status,version:r.version,schemaVersion:r.schemaVersion,createdAt:timestamp(r.createdAt),updatedAt:timestamp(r.updatedAt),payload:clone(r.payload)};
}
function merge(a, b) {
  const out = clone(a);
  for (const [k,v] of Object.entries(b)) out[k] = plain(v) && plain(out[k]) ? merge(out[k],v) : clone(v);
  return out;
}
// Compile changes only below parents that already exist as objects. New/type-changed
// parents are assigned atomically, so jsonb_set never relies on implicit parent creation.
export function nativePayloadChanges(oldPayload, nextPayload) {
  payload(oldPayload); payload(nextPayload);
  const changes=[];
  function diff(oldValue,nextValue,path) {
    for(const k of Object.keys(oldValue)) if(!Object.hasOwn(nextValue,k)) changes.push({path:[...path,k],remove:true});
    for(const [k,v] of Object.entries(nextValue)) {
      if(!Object.hasOwn(oldValue,k)) changes.push({path:[...path,k],value:v});
      else if(plain(oldValue[k]) && plain(v)) diff(oldValue[k],v,[...path,k]);
      else if(canonical(oldValue[k])!==canonical(v)) changes.push({path:[...path,k],value:v});
    }
  }
  diff(oldPayload,nextPayload,[]);
  return changes;
}
export function postgresPayloadExpression(changes, startIndex=1) {
  let sql='payload';const values=[];
  for(const change of changes) {
    const pathIndex=startIndex+values.length;values.push(change.path);
    if(change.remove) sql=`(${sql} #- $${pathIndex}::text[])`;
    else {const valueIndex=startIndex+values.length;values.push(canonical(change.value));sql=`jsonb_set(${sql},$${pathIndex}::text[],$${valueIndex}::jsonb,true)`;}
  }
  return {sql,values};
}
export function mongoRecordUpdate(oldRecord,nextRecord) {
  const $set={status:nextRecord.status,version:nextRecord.version,schemaVersion:nextRecord.schemaVersion,updatedAt:nextRecord.updatedAt};
  const $unset={};
  for(const change of nativePayloadChanges(oldRecord.payload,nextRecord.payload)) {
    const field=`payload.${change.path.join('.')}`;
    if(change.remove) $unset[field]=''; else $set[field]=change.value;
  }
  return Object.keys($unset).length?{$set,$unset}:{$set};
}
function limit(n=100) { if (!Number.isInteger(n) || n < 1 || n > 10000) fail('VALIDATION','Invalid limit'); return n; }
function pathParts(path) {
  const p = Array.isArray(path) ? path : typeof path === 'string' ? path.split('.') : [];
  if (!p.length || p.some(k => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || ['constructor','prototype','__proto__'].includes(k))) fail('VALIDATION','Invalid payload path');
  return p;
}
function mutation(kind, req) {
  validateJSON(req); key(req.tenantId); key(req.id); key(req.opId);
  if (kind !== 'create') int(req.expectedVersion);
  if (kind === 'patch') {
    if (!plain(req.patch) || Object.keys(req.patch).some(k => !['payload','status','schemaVersion'].includes(k))) fail('VALIDATION','Invalid patch fields');
    if (req.patch.payload !== undefined) payload(req.patch.payload);
    if (req.writerVersion !== undefined && ![1,2].includes(req.writerVersion)) fail('VALIDATION','Invalid writer version');
  }
  if (kind === 'checkpoint' && (!plain(req.checkpoint) || req.checkpoint.sequence !== req.expectedVersion+1)) fail('CHECKPOINT_ORDER','Checkpoint sequence must equal next version');
  const {abortBeforeCommit, fault, ...content} = req;
  return requestHash({kind,...content});
}
function nextRecord(kind, req, old) {
  if (kind === 'create') { const r=record(req.record); if (r.version !== 0) fail('VALIDATION','Create starts at version zero'); return {...r,version:1}; }
  if (old.status === 'completed') fail('TERMINAL','Completed record rejects business mutations');
  const out = clone(old);
  if (kind === 'checkpoint') out.payload.lastCheckpoint = clone(req.checkpoint);
  else {
    if (req.patch.status !== undefined) {
      const next = {open:'approved',approved:'completed'}[old.status];
      if (req.patch.status !== old.status && req.patch.status !== next) fail('VALIDATION','Forbidden status transition');
      out.status=req.patch.status;
    }
    if (req.patch.payload) out.payload=merge(out.payload,req.patch.payload);
    if (req.patch.schemaVersion !== undefined) out.schemaVersion=int(req.patch.schemaVersion);
    if (req.patch.payload && Object.hasOwn(req.patch.payload,'priority')) {
      if (!Number.isSafeInteger(req.patch.payload.priority)) fail('VALIDATION','Priority must be a safe integer');
      if (req.writerVersion === 2) out.payload.priorityV2={level:req.patch.payload.priority};
      else delete out.payload.priorityV2;
    }
  }
  out.version=old.version+1; out.updatedAt=timestamp(req.updatedAt ?? new Date().toISOString());
  return record(out);
}
export const schemaDefinitions = {
  postgres: `CREATE SCHEMA IF NOT EXISTS tdf_experiment;
CREATE TABLE tdf_experiment.records (tenant_id text NOT NULL,id text NOT NULL,status text NOT NULL,version integer NOT NULL,schema_version integer NOT NULL,created_at text NOT NULL,updated_at text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(tenant_id,id));
CREATE INDEX records_open ON tdf_experiment.records(tenant_id,status,created_at,id);
CREATE TABLE tdf_experiment.receipts (tenant_id text NOT NULL,op_id text NOT NULL,id text NOT NULL,hash text NOT NULL,result jsonb NOT NULL,kind text NOT NULL,PRIMARY KEY(tenant_id,op_id));
CREATE TABLE tdf_experiment.events (tenant_id text NOT NULL,id text NOT NULL,sequence integer NOT NULL,op_id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(tenant_id,id,sequence),UNIQUE(tenant_id,op_id));`,
  postgresE2: `CREATE INDEX IF NOT EXISTS records_model ON tdf_experiment.records(tenant_id,(payload #> '{agent,model}'));`,
  mongodb: {records:[{key:{tenantId:1,id:1},unique:true},{key:{tenantId:1,status:1,createdAt:1,id:1}}],receipts:[{key:{tenantId:1,opId:1},unique:true}],events:[{key:{tenantId:1,id:1,sequence:1},unique:true},{key:{tenantId:1,opId:1},unique:true}]},
  mongodbE2: {tenantId:1,'payload.agent.model':1},
};
const fromPg = r => r && ({tenantId:r.tenant_id,id:r.id,status:r.status,version:r.version,schemaVersion:r.schema_version,createdAt:r.created_at,updatedAt:r.updated_at,payload:r.payload});
const cleanMongo = r => { if (!r) return null; const {_id,...rest}=r; return rest; };

function common(adapter) {
  adapter.create = (r,opId,options={}) => {
    if(!plain(options) || Object.keys(options).some(k=>!['abortBeforeCommit','fault'].includes(k))) fail('VALIDATION','Invalid create options');
    return adapter.mutate('create',{tenantId:r.tenantId,id:r.id,record:r,opId,...options});
  };
  adapter.patch = req => adapter.mutate('patch',req);
  adapter.appendCheckpoint = req => adapter.mutate('checkpoint',req);
  adapter.evolve = async ({phase,batchSize=100,maxBatches=Infinity,limit:batchLimit,beforeBatch}={}) => {
    if (phase === 'add-index') { await adapter.addIndex(); return {phase,indexCreated:true}; }
    if (phase !== 'backfill-v2') fail('VALIDATION','Unknown evolution phase');
    limit(batchSize); maxBatches=batchLimit ?? maxBatches;
    let cursor=null, scanned=0, applied=0, conflicts=0, batches=0;
    while (batches < maxBatches) {
      const items=await adapter.backfillCandidates(batchSize,cursor);
      if (!items.length) return {scanned,applied,conflicts,batches,interrupted:false};
      if (beforeBatch) await beforeBatch(items,batches);
      for (const item of items) {
        const res=await adapter.patch({tenantId:item.tenantId,id:item.id,expectedVersion:item.version,patch:{payload:{priority:item.payload.priority},schemaVersion:2},writerVersion:2,opId:`backfill:${item.id}:${item.version}`});
        if (res.status === 'applied') applied++; else if(res.status === 'conflict') conflicts++;
      }
      scanned+=items.length; batches++; cursor=items.at(-1);
    }
    return {scanned,applied,conflicts,batches,interrupted:true};
  };
  adapter.inspectInvariants = async () => {
    const data=await adapter.snapshot(); const errors=[];
    const seen=new Set();
    for(const e of data.events) {
      const k=`${e.tenantId}/${e.opId}`;
      if(seen.has(k)) errors.push(`duplicate event ${k}`); seen.add(k);
      const receipt=data.receipts.find(r=>r.tenantId===e.tenantId && r.opId===e.opId);
      if(!receipt || receipt.id!==e.id || receipt.result.version!==e.sequence) errors.push(`event receipt mismatch ${k}`);
    }
    for(const r of data.receipts) if(!seen.has(`${r.tenantId}/${r.opId}`)) errors.push(`missing event ${r.opId}`);
    for(const r of data.records) {
      const ev=data.events.filter(e=>e.tenantId===r.tenantId && e.id===r.id);
      if(ev.length && Math.max(...ev.map(e=>e.sequence))!==r.version) errors.push(`latest version mismatch ${r.id}`);
    }
    return {ok:errors.length===0,errors,...data};
  };
  return adapter;
}
function effects(kind,req,next,hash) {
  const result={status:'applied',version:next.version};
  const detail=kind==='patch'?{patch:req.patch,writerVersion:req.writerVersion??1}:kind==='checkpoint'?{checkpoint:req.checkpoint}:{record:req.record};
  return {result,receipt:{tenantId:req.tenantId,opId:req.opId,id:req.id,hash,result,kind},event:{tenantId:req.tenantId,id:req.id,sequence:next.version,opId:req.opId,payload:{kind,...detail}}};
}
function duplicate(receipt,hash) { if(receipt.hash!==hash) fail('OP_ID_REUSE','Operation ID reused with different request'); return {...receipt.result,status:'duplicate'}; }
function assertOwnedConfig(arm,config) {
  const allowed=arm==='postgres'?{host:'127.0.0.1',port:55439,user:'experiment',database:'postgres'}:{host:'127.0.0.1',port:27029,database:'tdf_experiment',replicaSet:'experiment'};
  for(const [k,v] of Object.entries(config)) if(!Object.hasOwn(allowed,k) || v!==allowed[k]) fail('ENDPOINT','Only the isolated experiment endpoint/configuration is permitted');
  return allowed;
}

export async function createPostgresAdapter(config={}) {
  const settings=assertOwnedConfig('postgres',config);
  const {Pool}=await import('pg');
  const pool=new Pool({...settings,max:12,connectionTimeoutMillis:3000,statement_timeout:20000});
  pool.on('error',()=>{}); // A lost idle connection is replaced by pg; active queries still reject.
  const q=(sql,args=[])=>pool.query(sql,args);
  const adapter={arm:'postgres',
    async reset(records) {
      records=records.map(record);
      const c=await pool.connect();
      try { await c.query('BEGIN'); await c.query('DROP SCHEMA IF EXISTS tdf_experiment CASCADE'); await c.query(schemaDefinitions.postgres);
        for(const r of records) await c.query('INSERT INTO tdf_experiment.records VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[r.tenantId,r.id,r.status,r.version,r.schemaVersion,r.createdAt,r.updatedAt,r.payload]);
        await c.query('COMMIT');
      } catch(e) {await c.query('ROLLBACK'); throw e;} finally {c.release();}
    },
    async get(tenantId,id) {key(tenantId);key(id);return fromPg((await q('SELECT * FROM tdf_experiment.records WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0])??null;},
    async mutate(kind,req) {
      const hash=mutation(kind,req), c=await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${req.tenantId}/op/${req.opId}`]);
        const prior=(await c.query('SELECT * FROM tdf_experiment.receipts WHERE tenant_id=$1 AND op_id=$2',[req.tenantId,req.opId])).rows[0];
        if(prior) {const res=duplicate(prior,hash);await c.query('COMMIT');return res;}
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${req.tenantId}/record/${req.id}`]);
        const old=fromPg((await c.query('SELECT * FROM tdf_experiment.records WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.tenantId,req.id])).rows[0]);
        if((kind==='create' && old) || (old && kind!=='create' && old.version!==req.expectedVersion)) {await c.query('COMMIT');return {status:'conflict',version:old.version};}
        if(!old && kind!=='create') {await c.query('COMMIT');return {status:'not_found',version:null};}
        const next=nextRecord(kind,req,old),{result,receipt,event}=effects(kind,req,next,hash);
        if(kind==='create') await c.query('INSERT INTO tdf_experiment.records VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[next.tenantId,next.id,next.status,next.version,next.schemaVersion,next.createdAt,next.updatedAt,next.payload]);
        else {
          const compiled=postgresPayloadExpression(nativePayloadChanges(old.payload,next.payload),8);
          const updated=await c.query(`UPDATE tdf_experiment.records SET status=$3,version=$4,schema_version=$5,updated_at=$6,payload=${compiled.sql} WHERE tenant_id=$1 AND id=$2 AND version=$7`,[next.tenantId,next.id,next.status,next.version,next.schemaVersion,next.updatedAt,old.version,...compiled.values]);
          if(updated.rowCount!==1) fail('INVARIANT','Guarded PostgreSQL update did not match one record');
        }
        await c.query('INSERT INTO tdf_experiment.receipts VALUES($1,$2,$3,$4,$5,$6)',[receipt.tenantId,receipt.opId,receipt.id,hash,result,kind]);
        await c.query('INSERT INTO tdf_experiment.events VALUES($1,$2,$3,$4,$5)',[event.tenantId,event.id,event.sequence,event.opId,event.payload]);
        if(req.abortBeforeCommit || req.fault==='beforeCommit') fail('INJECTED_ABORT','Injected transaction abort');
        await c.query('COMMIT'); return result;
      } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e;} finally {c.release();}
    },
    async listOpen({tenantId,limit:n=100,after}) { key(tenantId);limit(n); if(after) {timestamp(after.createdAt);key(after.id);} return (await q('SELECT * FROM tdf_experiment.records WHERE tenant_id=$1 AND status=\'open\' AND ($2::text IS NULL OR (created_at,id)>($2,$3)) ORDER BY created_at,id LIMIT $4',[tenantId,after?.createdAt??null,after?.id??null,n])).rows.map(fromPg);},
    async history({tenantId,id,limit:n=100,afterSequence=0}) {key(tenantId);key(id);int(afterSequence);limit(n);return (await q('SELECT tenant_id AS "tenantId",id,sequence,op_id AS "opId",payload FROM tdf_experiment.events WHERE tenant_id=$1 AND id=$2 AND sequence>$3 ORDER BY sequence LIMIT $4',[tenantId,id,afterSequence,n])).rows;},
    async queryPayload({tenantId,path,value,limit:n=100}) {key(tenantId);limit(n);const p=pathParts(path);validateJSON(value);return (await q('SELECT * FROM tdf_experiment.records WHERE tenant_id=$1 AND payload #> $2::text[] = $3::jsonb ORDER BY id LIMIT $4',[tenantId,p,canonical(value),n])).rows.map(fromPg);},
    async addIndex() {await q(schemaDefinitions.postgresE2);},
    async backfillCandidates(n,after) {return (await q("SELECT * FROM tdf_experiment.records WHERE status <> 'completed' AND jsonb_typeof(payload->'priority')='number' AND (NOT payload ? 'priorityV2' OR schema_version<2) AND ($1::text IS NULL OR (tenant_id,id)>($1,$2)) ORDER BY tenant_id,id LIMIT $3",[after?.tenantId??null,after?.id??null,n])).rows.map(fromPg);},
    async snapshot() {return {records:(await q('SELECT * FROM tdf_experiment.records ORDER BY tenant_id,id')).rows.map(fromPg),receipts:(await q('SELECT tenant_id AS "tenantId",op_id AS "opId",id,hash,result,kind FROM tdf_experiment.receipts ORDER BY tenant_id,op_id')).rows,events:(await q('SELECT tenant_id AS "tenantId",id,sequence,op_id AS "opId",payload FROM tdf_experiment.events ORDER BY tenant_id,id,sequence')).rows};},
    async diagnostics() {return {physicalMutationStrategy:'Read locked record and validate shared logical merge; native jsonb_set/#- for changed existing leaves or new bounded subtrees; guarded typed core update',modelingLimitation:'Shared logical evolution and whole-record validation reads limit developer-productivity and read-free native-update claims; database-native changed-path writes are tested',settings:(await q("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','server_version')")).rows,indexes:(await q("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='tdf_experiment'")).rows,storage:(await q("SELECT relname,pg_total_relation_size(oid)::float8 AS total_bytes,pg_indexes_size(oid)::float8 AS index_bytes FROM pg_class WHERE relnamespace='tdf_experiment'::regnamespace AND relkind='r'")).rows,plan:(await q(`EXPLAIN (FORMAT JSON) SELECT * FROM tdf_experiment.records WHERE tenant_id='tenant-0' AND payload #> '{agent,model}'='"model-a"'::jsonb ORDER BY id LIMIT 100`)).rows};},
    async close(){await pool.end();},
  };
  return common(adapter);
}

export async function createMongoAdapter(config={}) {
  assertOwnedConfig('mongodb',config);
  const {MongoClient}=await import('mongodb');
  const client=new MongoClient('mongodb://127.0.0.1:27029/?replicaSet=experiment',{readPreference:'primary',writeConcern:{w:'majority',j:true},serverSelectionTimeoutMS:3000,connectTimeoutMS:3000,maxPoolSize:12});
  await client.connect(); const db=client.db('tdf_experiment');
  const collection=name=>db.collection(name);
  const adapter={arm:'mongodb',
    async reset(records) {
      records=records.map(record);
      await db.dropDatabase();
      for(const name of ['records','events','receipts']) {
        await db.createCollection(name);
        await collection(name).createIndexes(schemaDefinitions.mongodb[name].map((s,i)=>({...s,name:`${name}_${i}`})));
      }
      if(records.length) await collection('records').insertMany(records);
    },
    async get(tenantId,id) {key(tenantId);key(id);return cleanMongo(await collection('records').findOne({tenantId,id}));},
    async mutate(kind,req) {
      const hash=mutation(kind,req);
      for(let race=0;race<3;race++) {
        const session=client.startSession();
        try {
          return await session.withTransaction(async()=>{
            const opt={session};
            const prior=await collection('receipts').findOne({tenantId:req.tenantId,opId:req.opId},opt);
            if(prior) return duplicate(prior,hash);
            const old=cleanMongo(await collection('records').findOne({tenantId:req.tenantId,id:req.id},opt));
            if((kind==='create' && old) || (old && kind!=='create' && old.version!==req.expectedVersion)) return {status:'conflict',version:old.version};
            if(!old && kind!=='create') return {status:'not_found',version:null};
            const next=nextRecord(kind,req,old),{result,receipt,event}=effects(kind,req,next,hash);
            if(kind==='create') await collection('records').insertOne(next,opt);
            else {
              const updated=await collection('records').updateOne({tenantId:req.tenantId,id:req.id,version:old.version},mongoRecordUpdate(old,next),opt);
              if(updated.matchedCount!==1) fail('INVARIANT','Guarded MongoDB update did not match one record');
            }
            await collection('receipts').insertOne(receipt,opt);
            await collection('events').insertOne(event,opt);
            if(req.abortBeforeCommit || req.fault==='beforeCommit') fail('INJECTED_ABORT','Injected transaction abort');
            return result;
          },{readConcern:{level:'snapshot'},writeConcern:{w:'majority',j:true},readPreference:'primary',maxCommitTimeMS:20000});
        } catch(e) {if(e.code!==11000 || race===2) throw e;} finally {await session.endSession();}
      }
    },
    async listOpen({tenantId,limit:n=100,after}) {key(tenantId);limit(n);const filter={tenantId,status:'open'};if(after){timestamp(after.createdAt);key(after.id);filter.$or=[{createdAt:{$gt:after.createdAt}},{createdAt:after.createdAt,id:{$gt:after.id}}];}return (await collection('records').find(filter).sort({createdAt:1,id:1}).limit(n).toArray()).map(cleanMongo);},
    async history({tenantId,id,limit:n=100,afterSequence=0}) {key(tenantId);key(id);int(afterSequence);limit(n);return (await collection('events').find({tenantId,id,sequence:{$gt:afterSequence}}).sort({sequence:1}).limit(n).toArray()).map(cleanMongo);},
    async queryPayload({tenantId,path,value,limit:n=100}) {key(tenantId);limit(n);const field=`payload.${pathParts(path).join('.')}`;validateJSON(value);return (await collection('records').find({tenantId,[field]:{$eq:clone(value),$exists:true},$expr:{$eq:[`$${field}`,{$literal:clone(value)}]}}).sort({id:1}).limit(n).toArray()).map(cleanMongo);},
    async addIndex(){await collection('records').createIndex(schemaDefinitions.mongodbE2,{name:'records_model'});},
    async backfillCandidates(n,after) {const filter={status:{$ne:'completed'},'payload.priority':{$type:'number'},$or:[{'payload.priorityV2':{$exists:false}},{schemaVersion:{$lt:2}}]}; if(after) filter.$and=[{$or:[{tenantId:{$gt:after.tenantId}},{tenantId:after.tenantId,id:{$gt:after.id}}]}];return (await collection('records').find(filter).sort({tenantId:1,id:1}).limit(n).toArray()).map(cleanMongo);},
    async snapshot(){const data={};for(const name of ['records','receipts','events']) data[name]=(await collection(name).find({}).sort(name==='receipts'?{tenantId:1,opId:1}:name==='events'?{tenantId:1,id:1,sequence:1}:{tenantId:1,id:1}).toArray()).map(cleanMongo);return data;},
    async diagnostics(){return {physicalMutationStrategy:'Read snapshot record and validate shared logical merge; native $set/$unset for changed existing leaves or new bounded subtrees; guarded core update',modelingLimitation:'Shared logical evolution and whole-record validation reads limit developer-productivity and read-free native-update claims; database-native changed-path writes are tested',settings:{writeConcern:{w:'majority',j:true},readPreference:'primary',replicaSet:(await db.admin().command({hello:1})).setName},indexes:await collection('records').indexes(),storage:await db.command({dbStats:1}),plan:await collection('records').find({tenantId:'tenant-0','payload.agent.model':{$eq:'model-a',$exists:true},$expr:{$eq:['$payload.agent.model',{$literal:'model-a'}]}}).sort({id:1}).limit(100).explain('queryPlanner')};},
    async close(){await client.close();},
  };
  return common(adapter);
}
export async function createAdapter(arm,config={}) {
  if(arm==='postgres') return createPostgresAdapter(config);
  if(arm==='mongodb' || arm==='mongo') return createMongoAdapter(config);
  fail('VALIDATION','Unknown database arm');
}
export function authorize(adapter,identityTenantId) {
  key(identityTenantId);
  const check=tenantId=>{if(tenantId!==identityTenantId) fail('AUTHORIZATION','Tenant mismatch');};
  return {
    get(tenantId,id){check(tenantId);return adapter.get(tenantId,id);},
    create(r,opId,options){check(r.tenantId);return adapter.create(r,opId,options);},
    ...Object.fromEntries(['patch','appendCheckpoint','listOpen','history','queryPayload'].map(method=>[method,req=>{check(req.tenantId);return adapter[method](req);}]))
  };
}
