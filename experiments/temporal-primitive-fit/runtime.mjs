import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,appendFile,cp,mkdir,stat,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import net from 'node:net';
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function until(fn,ms=120000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(error){last=error;}await delay(100);}throw new Error(`Timed out after ${ms}ms${last?`: ${last.message}`:''}`);}
async function listening(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(500,()=>{socket.destroy();resolve(false);});});}
export class OwnedRuntime{
 constructor(root){this.root=resolve(root);this.data={postgres:join(this.root,'state/postgres'),mongodb:join(this.root,'state/mongo')};this.recordPath=join(this.root,'owned-runtime.json');this.commands=[];}
 async load(){this.owned=JSON.parse(await readFile(this.recordPath,'utf8'));if(this.owned.root!==this.root)throw new Error('Runtime root does not match ownership record');if(this.owned.data)this.data=this.owned.data;for(const path of Object.values(this.data))if(!resolve(path).startsWith(this.root+'/'))throw new Error('Owned data path escaped runtime root');for(const arm of ['postgres','mongodb','temporal'])await this.identity(arm);return this;}
 key(arm){return arm==='mongodb'?'mongoPid':`${arm}Pid`;}
 binary(arm){return join(this.root,{postgres:'postgres/bin/postgres',mongodb:'mongo/bin/mongod',temporal:'temporal/temporal'}[arm]);}
 async identity(arm){const pid=this.owned[this.key(arm)];if(!Number.isSafeInteger(pid)||pid<2)throw new Error(`Missing owned PID: ${arm}`);const {stdout}=await exec('lsof',['-a','-p',String(pid),'-d','txt','-Fn']);if(!stdout.split('\n').includes(`n${this.binary(arm)}`))throw new Error(`Owned PID executable mismatch: ${arm}/${pid}`);{const {stdout:command}=await exec('ps',['-p',String(pid),'-o','command=']);const data=arm==='temporal'?join(this.root,'state/temporal.sqlite'):this.data[arm];if(!command.includes(data)&&!command.includes(data.slice(this.root.length+1)))throw new Error(`Owned PID data directory mismatch: ${arm}/${pid}`);}return pid;}
 async save(){await writeFile(this.recordPath,JSON.stringify({...this.owned,data:this.data},null,2));}
 async command(file,args){this.commands.push({file:file.replace(this.root,'$RUNTIME_ROOT'),args:args.map(x=>x.replaceAll(this.root,'$RUNTIME_ROOT'))});await appendFile(join(this.root,'runtime-commands.jsonl'),JSON.stringify({at:new Date().toISOString(),file,args})+'\n');return exec(file,args,{cwd:this.root,timeout:120000,maxBuffer:1024*1024});}
 async stop(arm){const pid=await this.identity(arm);const mongoLog=join(this.root,'state/mongo.log');const logOffset=arm==='mongodb'?(await stat(mongoLog)).size:0;if(arm==='postgres')await this.command(join(this.root,'postgres/bin/pg_ctl'),['-D',this.data.postgres,'-m','fast','-w','stop']);else process.kill(pid,'SIGTERM');await until(async()=>!await listening({postgres:55739,mongodb:27329,temporal:17539}[arm]));await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});if(arm==='mongodb'){const log=(await readFile(mongoLog)).subarray(logOffset).toString();if(!log.includes('mongod shutdown complete'))throw new Error('MongoDB clean shutdown log evidence missing');this.lastMongoShutdown={pid,processExited:true,cleanShutdownLog:true};}}
 async start(arm){const port={postgres:55739,mongodb:27329}[arm];if(!port)throw new Error('Only owned databases may be restarted');if(await listening(port))throw new Error(`Port collision on ${port}`);
  if(arm==='postgres'){
   await this.command(join(this.root,'postgres/bin/pg_ctl'),['-D',this.data.postgres,'-l',join(this.root,'state/postgres.log'),'-o','-h 127.0.0.1 -p 55739 -k /tmp -c shared_buffers=128MB -c fsync=on -c synchronous_commit=on -c full_page_writes=on -c wal_sync_method=fsync_writethrough','-w','start']);
   this.owned.postgresPid=Number((await readFile(join(this.data.postgres,'postmaster.pid'),'utf8')).split('\n')[0]);
  }else{
   await this.command(this.binary('mongodb'),['--dbpath',this.data.mongodb,'--bind_ip','127.0.0.1','--port','27329','--replSet','primitivefit','--wiredTigerCacheSizeGB','0.25','--logpath',join(this.root,'state/mongo.log'),'--pidfilepath',join(this.root,'state/mongo.pid'),'--fork']);
   this.owned.mongoPid=Number((await readFile(join(this.root,'state/mongo.pid'),'utf8')).trim());
  }
  await this.save();await until(()=>listening(port));await this.identity(arm);
 }
 async restart(arm){await this.stop(arm);await this.start(arm);}
 async coldRestore(arm,label){await this.stop(arm);const original=this.data[arm],copy=join(this.root,'restores',`${label}-${arm}`);await mkdir(join(this.root,'restores'),{recursive:true});try{await stat(copy);throw new Error('Restore target already exists');}catch(error){if(error.code!=='ENOENT')throw error;}await cp(original,copy,{recursive:true,errorOnExist:true,force:false});this.data[arm]=copy;await this.start(arm);return {method:'clean shutdown and complete cold directory copy',...(arm==='mongodb'?{shutdownEvidence:this.lastMongoShutdown}:{}),original:original.replace(this.root,'$RUNTIME_ROOT'),restored:copy.replace(this.root,'$RUNTIME_ROOT')};}
 async durability(){
  if(process.env.PGOPTIONS)throw new Error('Durability preflight rejects nonempty PGOPTIONS');
  await this.identity('postgres');
  const {default:pg}=await import('pg');const client=new pg.Client({connectionString:'postgres://experiment@127.0.0.1:55739/primitive_fit',connectionTimeoutMillis:10000,query_timeout:10000});await client.connect();
  try{const location=await client.query("SHOW data_directory");if(resolve(location.rows[0].data_directory)!==resolve(this.data.postgres))throw new Error("PostgreSQL endpoint does not match owned data directory");const result=await client.query("SELECT name,setting,source,pending_restart FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_sync_method') ORDER BY name");assertDurabilitySettings(result.rows);await this.identity('mongodb');const fallbackWarning='fcntl(F_FULLFSYNC) failed, falling back to fdatasync or fsync';const mongoLog=await readFile(join(this.root,'state/mongo.log'),'utf8');if(mongoLog.includes(fallbackWarning))throw new Error('Owned MongoDB log records full-flush fallback');const {MongoClient}=await import('mongodb');const mongo=new MongoClient('mongodb://127.0.0.1:27329/?replicaSet=primitivefit',{writeConcern:{w:'majority',j:true},serverSelectionTimeoutMS:10000});await mongo.connect();let mongoObserved;try{const commands=await mongo.db('admin').command({getCmdLineOpts:1});const defaults=await mongo.db('admin').command({getDefaultRWConcern:1});const build=await mongo.db('admin').command({buildInfo:1});mongoObserved={version:build.version,fullFlushFallbackLog:{marker:fallbackWarning,observed:false,scope:'Owned complete MongoDB log; absence does not prove actual syscall branch'},writeConcern:{w:'majority',j:true},writeConcernProvenance:'Explicit driver request contract, also frozen in adapters; not a claim about the server default or observed flush syscall',serverDefaultWriteConcern:defaults.defaultWriteConcern??null,serverConfiguration:{replication:commands.parsed?.replication??null,storage:commands.parsed?.storage??null},actualFlushSyscallTraced:false};}finally{await mongo.close();}return{observedAt:new Date().toISOString(),postgres:Object.fromEntries(result.rows.map(row=>[row.name,row.setting])),postgresSettings:result.rows,mongo:mongoObserved,boundary:'PostgreSQL fsync_writethrough is required on this macOS tier; this does not prove equal physical flush behavior, power-loss recovery or production durability.'};}finally{await client.end();}
 }
 async manifest(){const binaries={};for(const arm of ['postgres','mongodb','temporal']){const bytes=await readFile(this.binary(arm));binaries[arm]={file:this.binary(arm).replace(this.root,'$RUNTIME_ROOT'),sha256:createHash('sha256').update(bytes).digest('hex')};}return {binaries,provenance:JSON.parse(await readFile(join(this.root,'runtime-provenance.json'),'utf8')),ports:this.owned.ports};}
 async resources(extraPids=[]){
  const {stdout}=await exec('ps',['-axo','pid=,ppid=,rss=,time=,command=']);const all=stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],rssBytes:+m[3]*1024,cpuTime:m[4]}:null;}).filter(Boolean);
  const owned=new Set([this.owned.postgresPid,this.owned.mongoPid,this.owned.temporalPid,...extraPids]);let changed=true;while(changed){changed=false;for(const p of all)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}
  const processes=all.filter(p=>owned.has(p.pid));const disk=await exec('du',['-sk',this.root]);return {at:new Date().toISOString(),rssBytes:processes.reduce((s,p)=>s+p.rssBytes,0),runtimeDiskBytes:Number(disk.stdout.split(/\s+/)[0])*1024,processes};
 }
 async shutdown(){for(const arm of ['postgres','mongodb','temporal']){try{await this.stop(arm);}catch(error){await appendFile(join(this.root,'shutdown-errors.jsonl'),JSON.stringify({arm,error:error.message})+'\n');}}}
}

export const PORTS={postgres:55739,mongodb:27329,temporal:17539};
export async function bootstrap(root,sourceRoot){
 const runtime=new OwnedRuntime(root);
 try{await stat(runtime.recordPath);throw new Error('Ownership record already exists; bootstrap refuses reuse');}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const port of Object.values(PORTS))if(await listening(port))throw new Error(`Port collision: ${port}`);
 try{await stat(join(root,'state'));throw new Error('State directory exists; bootstrap refuses reuse');}catch(e){if(e.code!=='ENOENT')throw e;}
 const provenance=JSON.parse(await readFile(join(sourceRoot,'runtime-provenance.json'),'utf8'));
 for(const [arm,record] of Object.entries(provenance.binaries)){
  const digest=createHash('sha256').update(await readFile(join(sourceRoot,record.file))).digest('hex');
  if(digest!==record.sha256)throw new Error(`Source binary digest mismatch: ${arm}`);
 }
 await mkdir(root,{recursive:true});
 for(const directory of ['postgres','mongo','temporal'])await cp(join(sourceRoot,directory),join(root,directory),{recursive:true,errorOnExist:true,force:false});
 await writeFile(join(root,'runtime-provenance.json'),JSON.stringify(provenance,null,2));
 await mkdir(join(root,'state/mongo'),{recursive:true});
 await runtime.command(join(root,'postgres/bin/initdb'),['-D',runtime.data.postgres,'-U','experiment','--auth=trust','--encoding=UTF8','--no-locale']);
 runtime.owned={root:runtime.root,ports:PORTS};
 await runtime.start('postgres');await runtime.start('mongodb');
 const {MongoClient}=await import('mongodb');
 const mongo=new MongoClient('mongodb://127.0.0.1:27329/?directConnection=true');await mongo.connect();
 await mongo.db('admin').command({replSetInitiate:{_id:'primitivefit',members:[{_id:0,host:'127.0.0.1:27329'}]}});
 await until(async()=>Boolean((await mongo.db('admin').command({hello:1})).isWritablePrimary));await mongo.close();
 return finishBootstrap(runtime);
}
export async function finishBootstrap(runtime){
 const root=runtime.root;if(runtime.owned.root!==root)throw new Error('Ownership root mismatch');await runtime.identity('postgres');await runtime.identity('mongodb');
 if(await listening(PORTS.temporal))throw new Error('Temporal port collision');
 const {default:pg}=await import('pg');const client=new pg.Client({connectionString:'postgres://experiment@127.0.0.1:55739/postgres'});await client.connect();try{const exists=await client.query("SELECT 1 FROM pg_database WHERE datname='primitive_fit'");if(!exists.rowCount)await client.query('CREATE DATABASE primitive_fit');}finally{await client.end();}
 const logfile=await open(join(root,'state/temporal.log'),'a');
 const child=spawn(runtime.binary('temporal'),['server','start-dev','--ip','127.0.0.1','--port','17539','--db-filename',join(root,'state/temporal.sqlite'),'--headless'],{detached:true,stdio:['ignore',logfile.fd,logfile.fd]});
 runtime.owned.temporalPid=child.pid;child.unref();await logfile.close();await runtime.save();await until(()=>listening(PORTS.temporal));await runtime.identity('temporal');
 return runtime;
}

export function assertDurabilitySettings(rows){
 const required={fsync:'on',synchronous_commit:'on',full_page_writes:'on',wal_sync_method:'fsync_writethrough'};
 for(const [name,setting] of Object.entries(required)){const matches=rows.filter(row=>row.name===name);if(matches.length!==1||matches[0].setting!==setting||matches[0].pending_restart)throw new Error(`Durability preflight rejected ${name}: requires ${setting} with no pending restart`);}
 return true;
}
