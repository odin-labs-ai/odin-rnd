import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseDemo } from './transcript.mjs';
const walk = dir => readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(dir+'/'+entry.name):[dir+'/'+entry.name]);
const files=walk('dist');
const publicRepos = new Set(['odin-labs-ai/odin-rnd','odin-labs-ai/bce-paper-artifacts','blueprint-conformance/bce']);
for(const file of files.filter(file=>/\.(html|css|js|json|svg)$/.test(file))){
  const body=readFileSync(file,'utf8');
  assert(!/136\.243\.18\.36|77\.42\.80\.233|10\.0\.0\.3|redrocket|3d3d|fleetcare|monkeyvision|rabobank|googletagmanager|google-analytics|hotjar|segment\.com|botToken|\/Users\//i.test(body),'Private or tracking content in '+file);
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
for(const run of report.runs){
  assert.equal(createHash('sha256').update(run.transcript).digest('hex'),run.transcriptSha256);
  assert.deepEqual(parseDemo(run.transcript,run.id,run.processExitCode),{passed:run.passed,cleanScore:run.cleanScore,driftScore:run.driftScore,violation:run.violation,processExitCode:run.processExitCode});
  assert(run.passed,'Failed experiment may not be published as a passing observation');
}
console.log('PASS: local links, anchors, public export boundary, transcript digests and real experiment verdicts. '+files.length+' static files.');
