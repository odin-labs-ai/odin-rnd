import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {normalize,assertPrivateFree,sha256,exportEvidence,archiveOwnerArgs,verifyArchiveMembers} from './export-temporal-document-fit.mjs';

test('recursive diagnostics sanitation preserves scientific values',()=>{
 const value={nested:[{serverInfo:{host:'private-host',version:'8.0.15'},fsUsedSize:123,fsTotalSize:456,dataSize:89,path:homedir()+'/runtime/file'}]};
 const clean=normalize(value,[[homedir(),'$HOME']]);
 assert.deepEqual(clean,{nested:[{serverInfo:{host:'local-experiment-host',version:'8.0.15'},dataSize:89,path:'$HOME/runtime/file'}]});
 assertPrivateFree(JSON.stringify(clean),['private-host']);
 assert.throws(()=>assertPrivateFree('/Users/private/file'));
 assert.throws(()=>assertPrivateFree('machine-secret',['machine-secret']));
});
test('export binds normalized bytes, preserves frozen sources and excludes logs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tdf-export-test-'));
 const previousTmpdir=process.env.TMPDIR;
 try {
  // Keep exporter staging directories within this test's cleanup boundary too.
  process.env.TMPDIR=root;
  const repo=join(root,'repo'),source=join(repo,'experiments/temporal-document-fit'),run=join(root,'runtime/runs/main');
 await mkdir(source,{recursive:true});await mkdir(run,{recursive:true});
 const sources={};for(const name of ['PROTOCOL.md','protocol.json']){const bytes=name.endsWith('json')?'{}\n':'# Frozen\n';await writeFile(join(source,name),bytes);sources['experiments/temporal-document-fit/'+name]=sha256(bytes);}
 const manifest={runId:'main',createdAt:'2026-01-01',protocolHash:sources['experiments/temporal-document-fit/protocol.json'],sources,dependencies:{pg:'test'},runtime:{version:'test',provenance:{downloads:{temporal:'https://github.com/temporalio/cli/releases/test'}}},host:{platform:'test'},fixture:{seed:1,hash:'fixture',records:[{}]},measurement:{},diagnostics:{serverInfo:{host:'private-test-host'},fsUsedSize:100}};
 const report={runId:'main',finishedAt:'2026-01-01',cells:[],faults:[],evolutions:[],measuredAttempts:0,measuredCompleted:0,outcome:'inconclusive'};
 await writeFile(join(run,'manifest.json'),JSON.stringify(manifest));await writeFile(join(run,'report.json'),JSON.stringify(report));await writeFile(join(run,'independent-audit.json'),JSON.stringify({outcome:'reviewed'}));await writeFile(join(run,'worker-secret.log'),'DO NOT EXPORT');await writeFile(join(run,'operations.jsonl'),JSON.stringify({serverInfo:{host:'private-test-host'},fsTotalSize:100})+'\n');
 const prior=[];for(let i=0;i<3;i++){const p=join(root,'runtime/runs/prior-'+i);await mkdir(p);await writeFile(join(p,'report.json'),JSON.stringify({...report,runId:'prior-'+i,preflightOnly:true}));await writeFile(join(p,'manifest.json'),JSON.stringify({...manifest,runId:'prior-'+i}));prior.push(p);}
 const reproduction=join(root,'runtime/reproduction/reproduce-test');await mkdir(join(reproduction,'snapshots'),{recursive:true});await writeFile(join(reproduction,'report.json'),JSON.stringify({finishedAt:'2026-01-01'}));await writeFile(join(reproduction,'resources.jsonl'),JSON.stringify({rss:42})+'\n');await writeFile(join(reproduction,'snapshots','state.json'),JSON.stringify({count:1}));await writeFile(join(root,'runtime/reproduction/reproduce-pair.mjs'),'// Exact runner\n');
 const out=join(root,'export');await exportEvidence({run,out,prior,repo,reproduction});
 const evidence=JSON.parse(await readFile(join(out,'evidence-manifest.json')));
 assert.equal(sha256(await readFile(join(out,'raw-evidence.tar.gz'))),evidence.archive.sha256);
 await assert.rejects(access(join(out,'PROTOCOL.md')));assert.equal(JSON.parse(await readFile(join(out,'protocol-summary.json'))).originalProtocolSHA256,manifest.protocolHash);
 const names=execFileSync('tar',['-tzf',join(out,'raw-evidence.tar.gz')],{encoding:'utf8'});assert(!names.includes('worker-secret'));assert(names.includes('main/independent-audit.json'));assert.equal(evidence.files.find(f=>f.path==='protocol-summary.json').originalLocalFile,'$REPO_ROOT/experiments/temporal-document-fit/protocol.json');assert(names.includes('uncounted-prior/prior-2/report.json'));assert(names.includes('uncounted-prior/prior-2/manifest.json'));assert(names.includes('reproduction/reproduce-pair.mjs'));assert(names.includes('reproduction/snapshots/state.json'));assert(names.includes('reproduction/resources.jsonl'));assert.equal(evidence.files.find(f=>f.path==='cells.json').sourceProperty,'$.cells');
 const exportedManifest=execFileSync('tar',['-xOzf',join(out,'raw-evidence.tar.gz'),'main/manifest.json'],{encoding:'utf8'});assert(!exportedManifest.includes('private-test-host'));assert(!exportedManifest.includes('fsUsedSize'));
 const row=evidence.files.find(f=>f.path==='raw-evidence/main/manifest.json');assert.equal(row.originalLocalSHA256,sha256(await readFile(join(run,'manifest.json'))));assert.equal(row.exportedSHA256,sha256(exportedManifest));assert.notEqual(row.originalLocalSHA256,row.exportedSHA256);
 const summary=JSON.parse(await readFile(join(out,'manifest-summary.json')));assert.equal(summary.fixture.recordCount,1);assert(!('records' in summary.fixture));assert(!('downloads' in summary.runtime.provenance));
 await writeFile(join(source,'PROTOCOL.md'),'changed');
 await assert.rejects(exportEvidence({run,out:join(root,'bad-export'),prior,repo}),/Frozen source mismatch/);
 await assert.rejects(access(join(root,'bad-export')));
 } finally {
  if(previousTmpdir===undefined) delete process.env.TMPDIR; else process.env.TMPDIR=previousTmpdir;
  await rm(root,{recursive:true,force:true});
 }
});

test('archive ownership arguments support GNU and BSD tar without mixing flags',()=>{
 assert.deepEqual(archiveOwnerArgs('tar (GNU tar) 1.35'),['--owner=0','--group=0','--numeric-owner']);
 assert.deepEqual(archiveOwnerArgs('bsdtar 3.5.3 - libarchive 3.5.3'),['--uid','0','--gid','0','--uname','root','--gname','root']);
 assert.throws(()=>archiveOwnerArgs('unknown tar'),/Unsupported tar/);
});

test('archive membership rejects AppleDouble extras and non-regular entries',()=>{
 verifyArchiveMembers('main/report.json\n','-rw-r--r-- owner report\n',['main/report.json']);
 assert.throws(()=>verifyArchiveMembers('main/report.json\nmain/._report.json\n','-a\n-b\n',['main/report.json']),/member set/);
 assert.throws(()=>verifyArchiveMembers('main/report.json\n','lrwxr-xr-x link\n',['main/report.json']),/non-regular/);
});
