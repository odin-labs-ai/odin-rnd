import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
export function runCommand({executable,args=[],cwd,timeoutMs=30000,maxOutputBytes=1048576}) {
  if (!(timeoutMs>0) || !(maxOutputBytes>0)) throw new Error('Positive execution bounds required');
  return new Promise(resolve=>{
    const start=Date.now(); let stdout=[],stderr=[],bytes=0,status='completed',settled=false,timer;
    const child=spawn(executable,args,{cwd,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const kill=()=>{try {if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const done=(exitCode)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status,exitCode,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),durationMs:Date.now()-start});};
    const capture=key=>chunk=>{if(settled)return;const remaining=Math.max(0,maxOutputBytes-bytes);bytes+=chunk.length; const value=chunk.subarray(0,remaining);if(key==='stdout')stdout.push(value);else stderr.push(value);if(bytes>maxOutputBytes&&status==='completed'){status='output-limit';kill();}};
    child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
    child.on('error',error=>{status='spawn-error';stderr=[Buffer.from(error.code??'spawn failed')];done(null);});
    child.on('close',code=>done(code));timer=setTimeout(()=>{status='timeout';kill();},timeoutMs);
  });
}
export async function hashInputs({root,relativePaths}) {
  const base=await realpath(root), result={};
  for(const relative of [...relativePaths].sort()) {
    if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw new Error('Input path must be relative without traversal');
    const resolved=await realpath(path.join(base,relative));
    if(!resolved.startsWith(base+path.sep))throw new Error('Input escapes root');
    result[relative]=createHash('sha256').update(await readFile(resolved)).digest('hex');
  }return result;
}
export async function recordProject({outputPath,report}) {
  const contents=JSON.stringify(report,null,2)+'\n';
  if(/\/Users\/|\/home\//.test(contents))throw new Error('Private absolute path in report');
  await mkdir(path.dirname(outputPath),{recursive:true});const temp=outputPath+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,contents,{flag:'wx'});await rename(temp,outputPath);}finally{await unlink(temp).catch(()=>{});}
}
