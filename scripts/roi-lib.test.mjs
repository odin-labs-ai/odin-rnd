import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runCommand,hashInputs,recordProject} from '../demos/lib.mjs';
test('execution preserves status and bounds output',async()=>{
 let r=await runCommand({executable:process.execPath,args:['-e','process.exit(7)']});assert.equal(r.exitCode,7);assert.equal(r.status,'completed');
 r=await runCommand({executable:'/nonexistent-java'});assert.equal(r.status,'spawn-error');
 r=await runCommand({executable:process.execPath,args:['-e','setInterval(()=>console.log("x".repeat(1000)),1)'],maxOutputBytes:100});assert.equal(r.status,'output-limit');assert.ok(Buffer.byteLength(r.stdout)<=100);
});
test('timeout terminates descendants',async()=>{
 const r=await runCommand({executable:process.execPath,args:['-e',`const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`],timeoutMs:300});assert.equal(r.status,'timeout');const pid=Number(r.stdout.trim());assert.ok(pid>0);await new Promise(resolve=>setTimeout(resolve,100));assert.throws(()=>process.kill(pid,0));
});
test('hash path boundaries and atomic records',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'roi-helper-'));try{
 await writeFile(path.join(dir,'input'),'a');await symlink('/etc/hosts',path.join(dir,'escape'));
 assert.match((await hashInputs({root:dir,relativePaths:['input']})).input,/^[a-f0-9]{64}$/);
 for(const p of ['/etc/hosts','../hosts','escape'])await assert.rejects(hashInputs({root:dir,relativePaths:[p]}));
 const outputPath=path.join(dir,'record.json');await recordProject({outputPath,report:{ok:true}});assert.deepEqual(JSON.parse(await readFile(outputPath,'utf8')),{ok:true});await assert.rejects(recordProject({outputPath,report:{path:'/Users/private/file'}}));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('UTF8 split across writes preserves independent raw streams',async()=>{
 const source=`const b=Buffer.from('€界');process.stdout.write(b.subarray(0,1));process.stderr.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(1,4));process.stderr.write(b.subarray(2,5));setTimeout(()=>{process.stdout.write(b.subarray(4));process.stderr.write(b.subarray(5));},50)},50)`;
 const r=await runCommand({executable:process.execPath,args:['-e',source]});assert.equal(r.status,'completed');assert.equal(r.stdout,'€界');assert.equal(r.stderr,'€界');
});

test('Test Witness rejects corrupted assertion and summary evidence',async()=>{
 const {parseEvidence}=await import('../demos/test-witness/run.mjs');
 const good='ASSERT|ordinary|PASS|4.00|4.00\nSUMMARY|0\n';
 assert.equal(parseEvidence({stdout:good,exitCode:0},['ordinary']).valid,true);
 for(const stdout of [good.replace('|PASS|','|BOGUS|'),good.replaceAll('4.00','5.00'),good.replace('|4.00|4.00','|3.00|4.00'),good.replace('SUMMARY|0','SUMMARY|1'),good+good,good.replace('SUMMARY|0','SUMMARY|0|extra'),good.replace('|PASS|4.00|4.00','|FAIL|4.00|4.00')])assert.equal(parseEvidence({stdout,exitCode:0},['ordinary']).valid,false,stdout);
 assert.equal(parseEvidence({stdout:good,exitCode:1},['ordinary']).valid,false);
});
