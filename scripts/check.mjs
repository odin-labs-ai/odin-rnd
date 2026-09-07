import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseDemo } from './transcript.mjs';
const walk = dir => readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(dir+'/'+entry.name):[dir+'/'+entry.name]);
const files=walk('dist');
const publicRepos = new Set(['odin-labs-ai/odin-rnd','odin-labs-ai/bce-paper-artifacts','blueprint-conformance/bce']);
// Fingerprints keep private policy terms out of the public validator source.
// Check every window, preserving case-insensitive substring matching.
const restrictedFingerprints = {"13": ["5731fbf840cf0bfdc5d3d933edd5c3bc5dccb89ac3f3df02fa5ec89866aaa42a"], "12": ["8b0dd65e80ec8e80c5516ad7e7814fb83a7b7f688c0da01ea03cd9ab3782686f", "db8125a5a0a5825896a37524890fe5a4b7608cfc05c1125b0791cc65a61855b4"], "8": ["a9a5126d7cca4ab5eecee72061f1e2060f6022266c74209f9fec62e986adc091", "080ac5c86e07c86491882d68ede609dd9085958b54329bfffed755c8b88cd9a3"], "9": ["94899355c63b8d585e18d8ea77b107c61696b0cc0dc99b17387b328cb4899b9c", "3f1eb95d29d5a58c4500824d9e3925726639c5e77b3cadcc90a6181d92abcfe2"], "4": ["542c6ec5c666e7ba61d6d1a4750847cd4b48fde065782e11fda0787012682f97"]};
const restrictedContent = text => {
  const lower=text.toLowerCase();
  for(const [size, digests] of Object.entries(restrictedFingerprints)){
    const length=Number(size), blocked=new Set(digests);
    for(let i=0;i<=lower.length-length;i++)if(blocked.has(createHash('sha256').update(lower.slice(i,i+length)).digest('hex')))return true;
  }
  return false;
};
for(const file of files.filter(file=>/\.(html|css|js|json|svg)$/.test(file))){
  const body=readFileSync(file,'utf8');
  assert(!restrictedContent(body) && !/googletagmanager|google-analytics|hotjar|segment\.com|botToken|\/Users\//i.test(body),'Restricted or tracking content in '+file);
  for(const match of body.matchAll(/https:\/\/github\.com\/([\w-]+\/[\w.-]+)/g))assert(publicRepos.has(match[1]),'Unexpected public export link '+match[0]);
  if(!file.endsWith('.html'))continue;
  const ids=[...body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'Duplicate id in '+file);
  for(const [,link] of body.matchAll(/(?:href|src)="([^"]+)"/g)){
    if(/^(https?:|mailto:|data:)/.test(link))continue;
    const [path,anchor]=link.split('#');
    const target=resolve(dirname(file),path||'.');
    const actual=(!path?file:(path.endsWith('/')?target+'/index.html':target));
    assert(existsSync(actual),'Missing local asset '+link+' from '+file);
    if(anchor){const dest=readFileSync(actual,'utf8');assert(dest.includes('id="'+anchor+'"'),'Missing anchor '+link);}
  }
}
const report=JSON.parse(readFileSync('dist/data/experiments.json'));
assert.equal(report.engine.version,'0.3.0');
assert.equal(report.runs.length,3);
for(const file of ['package.json','pnpm-lock.yaml','scripts/run-experiments.mjs','scripts/transcript.mjs'])assert.equal(report.inputFilesSha256?.[file],createHash('sha256').update(readFileSync(file)).digest('hex'),'Experiment inputs changed after recording: '+file);
for(const run of report.runs){
  assert.equal(createHash('sha256').update(run.transcript).digest('hex'),run.transcriptSha256);
  assert.deepEqual(parseDemo(run.transcript,run.id,run.processExitCode),{passed:run.passed,cleanScore:run.cleanScore,driftScore:run.driftScore,violation:run.violation,processExitCode:run.processExitCode});
  assert(run.passed,'Failed experiment may not be published as a passing observation');
}
console.log('PASS: local links, anchors, public export boundary, transcript digests and real experiment verdicts. '+files.length+' static files.');
