import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,appendFile,cp,mkdir,stat} from 'node:fs/promises';
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
 async identity(arm){const pid=this.owned[this.key(arm)];if(!Number.isSafeInteger(pid)||pid<2)throw new Error(`Missing owned PID: ${arm}`);const {stdout}=await exec('lsof',['-a','-p',String(pid),'-d','txt','-Fn']);if(!stdout.split('\n').includes(`n${this.binary(arm)}`))throw new Error(`Owned PID executable mismatch: ${arm}/${pid}`);if(arm!=='temporal'){const {stdout:command}=await exec('ps',['-p',String(pid),'-o','command=']);const data=this.data[arm];if(!command.includes(data)&&!command.includes(data.slice(this.root.length+1)))throw new Error(`Owned PID data directory mismatch: ${arm}/${pid}`);}return pid;}
 async save(){await writeFile(this.recordPath,JSON.stringify({...this.owned,data:this.data},null,2));}
 async command(file,args){this.commands.push({file:file.replace(this.root,'$RUNTIME_ROOT'),args:args.map(x=>x.replaceAll(this.root,'$RUNTIME_ROOT'))});await appendFile(join(this.root,'runtime-commands.jsonl'),JSON.stringify({at:new Date().toISOString(),file,args})+'\n');return exec(file,args,{cwd:this.root,timeout:120000,maxBuffer:1024*1024});}
 async stop(arm){const pid=await this.identity(arm);const mongoLog=join(this.root,'state/mongo.log');const logOffset=arm==='mongodb'?(await stat(mongoLog)).size:0;if(arm==='postgres')await this.command(join(this.root,'postgres/bin/pg_ctl'),['-D',this.data.postgres,'-m','fast','-w','stop']);else process.kill(pid,'SIGTERM');await until(async()=>!await listening({postgres:55439,mongodb:27029,temporal:17239}[arm]));await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});if(arm==='mongodb'){const log=(await readFile(mongoLog)).subarray(logOffset).toString();if(!log.includes('mongod shutdown complete'))throw new Error('MongoDB clean shutdown log evidence missing');this.lastMongoShutdown={pid,processExited:true,cleanShutdownLog:true};}}
 async start(arm){const port={postgres:55439,mongodb:27029}[arm];if(!port)throw new Error('Only owned databases may be restarted');if(await listening(port))throw new Error(`Port collision on ${port}`);
  if(arm==='postgres'){
   await this.command(join(this.root,'postgres/bin/pg_ctl'),['-D',this.data.postgres,'-l',join(this.root,'state/postgres.log'),'-o','-h 127.0.0.1 -p 55439 -k /tmp -c shared_buffers=128MB -c fsync=on -c synchronous_commit=on','-w','start']);
   this.owned.postgresPid=Number((await readFile(join(this.data.postgres,'postmaster.pid'),'utf8')).split('\n')[0]);
  }else{
   await this.command(this.binary('mongodb'),['--dbpath',this.data.mongodb,'--bind_ip','127.0.0.1','--port','27029','--replSet','experiment','--wiredTigerCacheSizeGB','0.25','--logpath',join(this.root,'state/mongo.log'),'--pidfilepath',join(this.root,'state/mongo.pid'),'--fork']);
   this.owned.mongoPid=Number((await readFile(join(this.root,'state/mongo.pid'),'utf8')).trim());
  }
  await this.save();await until(()=>listening(port));await this.identity(arm);
 }
 async restart(arm){await this.stop(arm);await this.start(arm);}
 async coldRestore(arm,label){await this.stop(arm);const original=this.data[arm],copy=join(this.root,'restores',`${label}-${arm}`);await mkdir(join(this.root,'restores'),{recursive:true});try{await stat(copy);throw new Error('Restore target already exists');}catch(error){if(error.code!=='ENOENT')throw error;}await cp(original,copy,{recursive:true,errorOnExist:true,force:false});this.data[arm]=copy;await this.start(arm);return {method:'clean shutdown and complete cold directory copy',...(arm==='mongodb'?{shutdownEvidence:this.lastMongoShutdown}:{}),original:original.replace(this.root,'$RUNTIME_ROOT'),restored:copy.replace(this.root,'$RUNTIME_ROOT')};}
 async manifest(){const binaries={};for(const arm of ['postgres','mongodb','temporal']){const bytes=await readFile(this.binary(arm));binaries[arm]={file:this.binary(arm).replace(this.root,'$RUNTIME_ROOT'),sha256:createHash('sha256').update(bytes).digest('hex')};}return {binaries,provenance:JSON.parse(await readFile(join(this.root,'runtime-provenance.json'),'utf8')),ports:this.owned.ports};}
 async resources(extraPids=[]){
  const {stdout}=await exec('ps',['-axo','pid=,ppid=,rss=,time=,command=']);const all=stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],rssBytes:+m[3]*1024,cpuTime:m[4]}:null;}).filter(Boolean);
  const owned=new Set([this.owned.postgresPid,this.owned.mongoPid,this.owned.temporalPid,...extraPids]);let changed=true;while(changed){changed=false;for(const p of all)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}
  const processes=all.filter(p=>owned.has(p.pid));const disk=await exec('du',['-sk',this.root]);return {at:new Date().toISOString(),rssBytes:processes.reduce((s,p)=>s+p.rssBytes,0),runtimeDiskBytes:Number(disk.stdout.split(/\s+/)[0])*1024,processes};
 }
 async shutdown(){for(const arm of ['postgres','mongodb','temporal']){try{await this.stop(arm);}catch(error){await appendFile(join(this.root,'shutdown-errors.jsonl'),JSON.stringify({arm,error:error.message})+'\n');}}}
}
