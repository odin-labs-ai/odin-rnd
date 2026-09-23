import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {runCommand,hashInputs,recordProject} from '../lib.mjs';
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const oracle={ordinary:'4.00',rounding:'1.01','below-threshold':'99.00',threshold:'90.00',validation:'rejected'};
export function parseEvidence(result,expectedIds) {
 const lines=result.stdout.trim().split('\n');
 const markers=lines.filter(s=>s.startsWith('ASSERT|')).map(s=>s.split('|'));
 const summaries=lines.filter(s=>s.startsWith('SUMMARY|')).map(s=>s.split('|'));
 const ids=markers.map(m=>m[1]);
 const failures=markers.filter(m=>m[2]==='FAIL').map(m=>m[1]);
 const complete=ids.length===expectedIds.length&&expectedIds.every(id=>ids.includes(id));
 const valid=markers.length>0&&new Set(ids).size===ids.length&&markers.every(m=>m.length===5&&expectedIds.includes(m[1])&&m[4]===oracle[m[1]]&&['PASS','FAIL'].includes(m[2])&&((m[3]===m[4])===(m[2]==='PASS')))&&summaries.length===1&&summaries[0].length===2&&/^(0|[1-9][0-9]*)$/.test(summaries[0][1])&&Number(summaries[0][1])===failures.length&&result.exitCode===(failures.length?1:0);
 return {markers,failures,complete,valid};
}
export async function runProject({root=defaultRoot,javaHome=process.env.JAVA_HOME}={}) {
 const startedAt=new Date().toISOString(),work=await mkdtemp(path.join(os.tmpdir(),'test-witness-')),commands=[],observations=[];
 const clean=s=>{for(const [a,b] of [[work,'<workdir>'],[root,'<repo>'],[javaHome,'<jdk>']])if(a)s=s.split(a).join(b);return s;};
 async function command(tool,args){const result=await runCommand({executable:javaHome?path.join(javaHome,'bin',tool):tool,args,cwd:work,timeoutMs:15000});const row={id:`command-${commands.length+1}`,executable:tool,args:args.map(clean),cwd:'<workdir>',...result,stdout:clean(result.stdout),stderr:clean(result.stderr)};commands.push(row);return row;}
 try {
 const java=await command('java',['-version']),javac=await command('javac',['-version']);
 const compiled=await command('javac',['-d',work,path.join(root,'demos/test-witness/fixtures/Witness.java')]);
 const required=['ordinary','rounding','below-threshold','threshold','validation'];let detected=0,eligible=0,unresolved=0;
 const cases=[['correct','strong'],...['rounding','threshold','validation'].flatMap(v=>[[v,'weak'],[v,'strong']]),['correct','always-pass'],['rounding','always-pass'],['correct','always-fail'],['correct','missing'],['correct','crash']];
 for(const [variant,suite] of cases){
  const r=compiled.status==='completed'&&compiled.exitCode===0?await command('java',['-cp',work,'Witness',variant,suite]):compiled;
  const evidence=parseEvidence(r,suite==='weak'?['ordinary']:required);
  const {markers,failures,complete}=evidence;
  const infrastructure=r.status!=='completed'||![0,1].includes(r.exitCode)||r===compiled||!evidence.valid;
  let verdict,reason;
  if(suite==='missing'||infrastructure){verdict='inconclusive';reason='Execution or assertion evidence missing; never a detected defect';unresolved++;}
  else if(['always-pass','always-fail'].includes(suite)){verdict='rejected';reason='Unconditional suites cannot qualify: they ignore implementation behavior';}
  else if(!complete){verdict='rejected';reason='Suite lacks the required declared assertions';}
  else if(suite==='weak'){verdict='rejected';reason='Weak suite passes while omitting the assertion for the seeded defect';}
  else if(variant==='correct'){verdict=failures.length===0&&r.exitCode===0?'accepted':'rejected';reason='Correct implementation must pass every declared assertion';}
  else if(suite==='strong') {eligible++;const attributable=failures.length===1&&failures[0]===variant&&r.exitCode===1;verdict=attributable?'accepted':'rejected';if(attributable)detected++;reason='Detection requires precisely the assertion ID assigned to the seeded defect';}
  observations.push({id:`${variant}-${suite}`,caseId:variant,role:variant==='correct'&&suite==='strong'?'baseline':suite==='strong'?'candidate':'negative-control',expected:suite==='strong'?(variant==='correct'?'All five assertions pass':`Only ${variant} assertion fails`):'Cannot qualify as an adequate test suite',actual:{assertionCount:markers.length,assertions:markers.map(m=>({id:m[1],status:m[2],actual:m[3],expected:m[4]})),exitCode:r.exitCode},verdict,reason,commandIds:[compiled.id,r.id].filter((x,i,a)=>a.indexOf(x)===i)});
 }
 const git=await runCommand({executable:'git',args:['rev-parse','HEAD'],cwd:root});
 const inputSha256=await hashInputs({root,relativePaths:['demos/lib.mjs','demos/CONTRACT.md','demos/test-witness/run.mjs','demos/test-witness/fixtures/Witness.java','demos/test-witness/README.md']});
 const positive=observations.filter(o=>o.role==='candidate'||o.role==='baseline');
 const expectedUnresolved=observations.filter(o=>['correct-missing','correct-crash'].includes(o.id));
 const controlsRejected=observations.filter(o=>o.role==='negative-control'&&!expectedUnresolved.includes(o)).every(o=>o.verdict==='rejected');
 const unexpectedUnresolved=observations.some(o=>o.verdict==='inconclusive'&&!expectedUnresolved.includes(o));
 return {schemaVersion:1,project:'test-witness',projectVersion:'0.1.0',mode:'authored-fixtures',startedAt,completedAt:new Date().toISOString(),runtime:{node:process.version,java:(java.stderr||java.stdout).trim(),javac:(javac.stdout||javac.stderr).trim()},sourceRevision:git.stdout.trim(),logsPathNormalized:true,inputSha256,scope:'Five authored invoice assertions and three seeded defects; acceptance of test evidence only.',limitations:['No generated tests or held-out performance evaluation.','No measured time savings or customer ROI.','Trusted local Java fixtures; temporary execution is not a security sandbox.','Hashes establish consistency, not malicious-tamper authenticity.'],observations,commands,metrics:[{id:'defects-detected',numerator:detected,denominator:eligible,unit:'eligible seeded defects',definition:'Strong-suite assertion failures uniquely attributed to rounding, threshold or validation seeds; unresolved excluded.'},{id:'unresolved',numerator:unresolved,denominator:cases.length,unit:'executions',definition:'Missing-assertion and unknown crash controls retained as inconclusive, never detections.'}],experimentVerdict:unexpectedUnresolved?'inconclusive':positive.every(o=>o.verdict==='accepted')&&detected===3&&controlsRejected&&expectedUnresolved.every(o=>o.verdict==='inconclusive')?'passed':'failed'};
 }finally{await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const i=process.argv.indexOf('--out');if(i<0||!process.argv[i+1])throw new Error('Usage: node demos/test-witness/run.mjs --out output.json');const report=await runProject();await recordProject({outputPath:process.argv[i+1],report});console.log(`Test Witness: ${report.experimentVerdict}`);process.exitCode={passed:0,failed:1,inconclusive:2}[report.experimentVerdict];}catch(error){console.error(error.message);process.exitCode=2;}
}
