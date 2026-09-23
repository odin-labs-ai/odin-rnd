import { mkdir, rm, readFile, readdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { recordingProvenance } from './recording-provenance.mjs';
import { hashInputs, recordProject } from '../demos/lib.mjs';
import { projects, generatorInputs, validateReport, validateRecords, digest } from './witness-records.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'site/data/witnesses');
await mkdir(output,{recursive:true});
const runId=randomUUID(), startedAt=new Date().toISOString();
const previousFiles = await readdir(output);
// Archive the complete prior failed or interrupted recording before overwriting any receipt.
// Generated UUID directory names never trust paths or run IDs from old records.
const priorIncomplete = !previousFiles.includes('manifest.json') || previousFiles.some(file=>file==='failed-run.json'||file.endsWith('-failure.json'));
if (priorIncomplete && previousFiles.length) {
 const archive=path.join(root,'.ai/witness-failures',runId); await mkdir(archive,{recursive:true});
 const receiptNames = new Set(['manifest.json','failed-run.json',...projects.flatMap(project=>[`${project}.json`,`${project}-failure.json`])]);
 for (const file of previousFiles) if(receiptNames.has(file)) await rename(path.join(output,file),path.join(archive,file));
}
// Invalidate publication before any execution, including an early infrastructure failure.
await rm(path.join(output,'manifest.json'),{force:true});
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const status=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
const workingTree={dirty:status.length>0,description:status.length?'Uncommitted working tree; base revision does not identify these edits. Input hashes identify executed sources.':'Clean at run start; input hashes identify executed sources.'};
const provenance=recordingProvenance();
const manifest={schemaVersion:1,runId,startedAt,sourceRevision,workingTree,...provenance,status:'running',generatorInputSha256:await hashInputs({root,relativePaths:generatorInputs}),records:{},integrityScope:'Consistency of source inputs and raw records, not authentication against an attacker replacing all artifacts.'};
let failed=false;
for(const project of projects){
 try {
  const {runProject}=await import(`../demos/${project}/run.mjs`);
  const report={...await runProject({root}),sourceRevision,workingTree,runId,...provenance};
  const outputPath=path.join(output,`${project}.json`);
  await recordProject({outputPath,report}); // Keep actual failed discrimination inspectable.
  validateReport(report);
  manifest.records[project]={sha256:digest(await readFile(outputPath)),completedAt:report.completedAt};
  console.log(`${project}: ${report.experimentVerdict} (${report.commands.length} actual commands)`);
 } catch(error){ failed=true; console.error(`${project}: recording failed (${error.name})`); await recordProject({outputPath:path.join(output,`${project}-failure.json`),report:{schemaVersion:1,project,runId,status:'failed',errorType:error.name,recordedAt:new Date().toISOString()}}); }
}
manifest.completedAt=new Date().toISOString();
if(failed){ await recordProject({outputPath:path.join(output,'failed-run.json'),report:{...manifest,status:'failed'}}); process.exitCode=1; }
else {
 manifest.status='passed';
 await validateRecords({root,manifestOverride:manifest});
 await recordProject({outputPath:path.join(output,'manifest.json'),report:manifest});
}
