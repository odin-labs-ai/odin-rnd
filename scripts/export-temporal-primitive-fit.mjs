import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,mkdtemp,copyFile,utimes,chmod,lstat,rm} from 'node:fs/promises';
import {resolve,join,relative,dirname,basename} from 'node:path';
import {tmpdir,homedir,hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {sha256,normalize,assertPrivateFree,archiveOwnerArgs,verifyArchiveMembers} from './export-temporal-document-fit.mjs';
export {sha256,normalize,assertPrivateFree};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
export function compact(value){
 if(Array.isArray(value))return value.map(compact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['diagnostics','downloads'].includes(key)).map(([key,v])=>[key,compact(v)]));
 return value;
}
export function validateRunBinding(report,manifest,mode){
 if(report.mode!==mode||manifest.mode!==mode||report.outcome!=='completed'||report.errors?.length||report.sourceFreezeVerified!==true||!(report.elapsedMs>0))throw new Error(`Unfinished or unfrozen ${mode} run`);
 if(report.seed!==manifest.seed)throw new Error('Run/manifest seed mismatch');
 assert.ok(report.durabilityObserved&&manifest.durabilityObserved,'Missing durability evidence');assert.deepEqual(manifest.durabilityObserved,report.durabilityObserved,'Manifest/report durability evidence mismatch');
 if(!manifest.sourceHashes?.['protocol.json']||manifest.protocolHash!==manifest.sourceHashes['protocol.json'])throw new Error('Protocol source binding mismatch');
 for(const name of Object.keys(manifest.sourceHashes))if(!/^[A-Za-z0-9_.-]+$/.test(name))throw new Error('Unsafe frozen source name');
}
export function validateRows(text,report){
 const rows=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const expected=new Map(report.cells.flatMap(c=>[[c.label,c.operations],...(c.update?[[c.update.label,c.update.operations]]:[])]));
 const seen=new Map();
 for(const row of rows){if(!expected.has(row.cell)||row.error||row.oracleError||!Number.isInteger(row.index)||row.index<0||row.index>=expected.get(row.cell)||!(row.elapsedMs>=0))throw new Error('Invalid raw operation row');const key=`${row.cell}/${row.index}`;if(seen.has(key))throw new Error('Duplicate raw operation row');seen.set(key,true);}
 const total=[...expected.values()].reduce((sum,n)=>sum+n,0);if(rows.length!==total)throw new Error('Raw operation denominator mismatch');
 return{attempted:rows.length,completed:rows.length,cells:expected.size};
}
async function walk(root,prefix=''){
 const result=[];for(const e of (await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=join(prefix,e.name);if(e.isSymbolicLink())throw new Error('Evidence symlink forbidden');if(e.isDirectory())result.push(...await walk(root,name));else if(e.isFile())result.push(name);else throw new Error('Non-regular evidence file');}return result;
}
const allowed=/^(?:manifest|report|host-context|temporal-correctness|independent-audit|operator-interruption|durability-diagnosis)\.json$|^(?:operations|resources|temporal-attempts|host-observations)\.jsonl$|^temporal-(?:history|snapshot)-(?:mongo|pg-monolithic|pg-split)\.json$|^snapshots\/[A-Za-z0-9_.-]+\.json$/;
export async function exportEvidence({run,reproduction,evaluation,out,prior=[],repo=resolve(dirname(fileURLToPath(import.meta.url)),'..')}){
 if(!run||!reproduction||!evaluation||!out)throw new Error('Main, reproduction, evaluation and new output directory are required');
 run=resolve(run);reproduction=resolve(reproduction);evaluation=resolve(evaluation);out=resolve(out);repo=resolve(repo);
 if(run===reproduction)throw new Error('Separate reproduction required');
 const sourceRoot=join(repo,'experiments/temporal-primitive-fit'),runtime=resolve(run,'../..');
 const [main,repro,mm,reproManifest,decision]=await Promise.all([readJSON(join(run,'report.json')),readJSON(join(reproduction,'report.json')),readJSON(join(run,'manifest.json')),readJSON(join(reproduction,'manifest.json')),readJSON(evaluation)]);
 validateRunBinding(main,mm,'main');validateRunBinding(repro,reproManifest,'reproduction');assert.deepEqual(mm.sourceHashes,reproManifest.sourceHashes,'Run source hashes differ');assert.notEqual(main.seed,repro.seed,'Reproduction seed must differ');
 const sourceNames=(await readdir(sourceRoot)).filter(f=>/\.(mjs|cjs|json|md|yaml)$/.test(f)&&f!=='frozen-source.json').sort();assert.deepEqual(sourceNames,Object.keys(mm.sourceHashes).sort(),'Source set differs from freeze');
 for(const [name,expected] of Object.entries(mm.sourceHashes)){const file=join(sourceRoot,name);if((await lstat(file)).isSymbolicLink())throw new Error('Frozen source symlink');if(sha256(await readFile(file))!==expected)throw new Error(`Frozen source mismatch: ${name}`);}
 const freeze=await readJSON(join(sourceRoot,'frozen-source.json'));assert.deepEqual(freeze.files??freeze,mm.sourceHashes,'Current freeze differs from run');
 const protocol=await readJSON(join(sourceRoot,'protocol.json'));const {evaluate}=await import(pathToFileURL(join(sourceRoot,'evaluate.mjs')).href);
 const recomputed={...evaluate(main,repro,protocol),sourceHashes:mm.sourceHashes,protocolHash:mm.protocolHash};assert.deepEqual(decision,recomputed,'Evaluation does not match independently recomputed decision');
 if(decision.outcome==='invalid-or-incomplete')throw new Error('Invalid run cannot be published as a finished result');
 const denominators={main:validateRows(await readFile(join(run,'operations.jsonl'),'utf8'),main),reproduction:validateRows(await readFile(join(reproduction,'operations.jsonl'),'utf8'),repro)};
 const priorRoots=prior.map(p=>resolve(p));if(new Set(priorRoots).size!==priorRoots.length||priorRoots.some(p=>[run,reproduction].includes(p)))throw new Error('Prior runs must be distinct excluded runs');
 const hosts=new Set([hostname()]);const collectHosts=value=>{if(value&&typeof value==='object'){if(typeof value.serverInfo?.host==='string')hosts.add(value.serverInfo.host);Object.values(value).forEach(collectHosts);}};
 [main,repro,mm,reproManifest].forEach(collectHosts);
 const forbidden=[homedir(),...hosts];
 const replacements=[[run,'$MAIN_RUN'],[reproduction,'$REPRODUCTION_RUN'],[evaluation,'$EVALUATION_FILE'],...priorRoots.map((p,i)=>[p,`$EXCLUDED_PRIOR_RUN_${i+1}`]),[runtime,'$RUNTIME_ROOT'],[repo,'$REPO_ROOT'],[homedir(),'$HOME'],...[...hosts].map(h=>[h,'local-experiment-host'])].sort((a,b)=>b[0].length-a[0].length);
 const staging=await mkdtemp(join(tmpdir(),'tpf-public-export-'));
 try{
 const raw=join(staging,'raw-evidence');await mkdir(raw);const entries=[];
 async function emit(source,dest,{exact=false,value,derived=false,sourceProperty}={}){
  const original=await readFile(source);let bytes;
  if(exact)bytes=original;
  else if(value!==undefined)bytes=json(normalize(value,replacements));
  else if(source.endsWith('.jsonl'))bytes=Buffer.from(original.toString().split('\n').filter(Boolean).map(line=>JSON.stringify(normalize(JSON.parse(line),replacements))).join('\n')+'\n');
  else bytes=json(normalize(JSON.parse(original),replacements));
  assertPrivateFree(bytes.toString(),forbidden);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);
  entries.push({path:relative(staging,dest),originalLocalFile:normalize(source,replacements),originalLocalSHA256:sha256(original),exportedSHA256:sha256(bytes),bytes:bytes.length,transformation:exact?'byte-identical':derived?'derived-summary':'normalized',...(sourceProperty?{sourceProperty}:{})});
 }
 for(const name of [...sourceNames,'frozen-source.json'])await emit(join(sourceRoot,name),join(raw,'sources',name),{exact:true});
 for(const [label,path] of [['main',run],['reproduction',reproduction]]){
  const names=await walk(path);for(const required of ['manifest.json','report.json','operations.jsonl','resources.jsonl','host-context.json','temporal-correctness.json','temporal-attempts.jsonl'])if(!names.includes(required))throw new Error(`Missing ${label}/${required}`);
  for(const name of names)if(allowed.test(name))await emit(join(path,name),join(raw,label,name));
 }
 const excludedRuns=[];
 for(const path of priorRoots){
  const priorManifest=await readJSON(join(path,'manifest.json')),names=await readdir(path);
  if(priorManifest.mode==='smoke'){
   for(const name of ['manifest.json','report.json'])if(names.includes(name))await emit(join(path,name),join(raw,'uncounted-prior',basename(path),name));
   excludedRuns.push({runId:basename(path),mode:'smoke',pooled:false,scope:'Uncounted smoke metadata only'});continue;
  }
  if(priorManifest.mode!=='main'||!names.includes('operator-interruption.json')||!names.includes('durability-diagnosis.json'))throw new Error('Prior measured run requires explicit interruption and durability diagnosis');
  const priorReport=await readJSON(join(path,'report.json'));if(priorReport.outcome!=='failed'||priorReport.sourceFreezeVerified!==true)throw new Error('Excluded measured run must be finalized failed with verified preserved sources');
  if(priorManifest.protocolHash!==priorManifest.sourceHashes?.['protocol.json'])throw new Error('Excluded prior protocol binding mismatch');
  const archiveRoot=join(path,'sources'),frozen=await readJSON(join(archiveRoot,'frozen-source.json'));assert.deepEqual(frozen.files??frozen,priorManifest.sourceHashes,'Excluded prior freeze differs from manifest');
  const archiveNames=await readdir(archiveRoot);assert.deepEqual(archiveNames.sort(),[...Object.keys(priorManifest.sourceHashes),'frozen-source.json'].sort(),'Excluded prior source archive is incomplete');
  for(const [name,digest] of Object.entries(priorManifest.sourceHashes)){if(!/^[A-Za-z0-9_.-]+$/.test(name))throw new Error('Unsafe prior source filename');const file=join(archiveRoot,name);if((await lstat(file)).isSymbolicLink()||sha256(await readFile(file))!==digest)throw new Error(`Excluded prior source mismatch: ${name}`);await emit(file,join(raw,'excluded-prior',basename(path),'sources',name),{exact:true});}
  await emit(join(archiveRoot,'frozen-source.json'),join(raw,'excluded-prior',basename(path),'sources','frozen-source.json'),{exact:true});
  for(const name of await walk(path))if(allowed.test(name))await emit(join(path,name),join(raw,'excluded-prior',basename(path),name));
  excludedRuns.push({runId:basename(path),mode:'main',outcome:priorReport.outcome,pooled:false,completedCells:priorReport.cells.length,sourceFreezeVerified:true,protocolHash:priorManifest.protocolHash,reason:'Interrupted after a material macOS WAL/journal flush-semantics confound was identified. Complete normalized observed evidence and exact prior source archive are retained; results do not enter amended candidate decisions.'});
 }
 for(const name of (await readdir(runtime)).filter(n=>/^smoke-[0-9]+-interruption\.json$/.test(n)))await emit(join(runtime,name),join(raw,'uncounted-prior',name));
 await emit(evaluation,join(raw,'evaluation.json'));
 const summaries={'report.json':compact(main),'cells.json':compact(main.cells),'reproduction-report.json':compact(repro),'evaluation.json':decision,'summary.json':{excludedRuns,kind:'derived-study-summary',outcome:decision.outcome,productionAdoption:false,runIds:{main:basename(run),reproduction:basename(reproduction)},protocolHash:mm.protocolHash,sourceFreezeVerified:true,counts:denominators,elapsedMs:{main:main.elapsedMs,reproduction:repro.elapsedMs},resources:{main:main.resources,reproduction:repro.resources},checks:{main:main.checks.length,reproduction:repro.checks.length,temporalMain:main.temporal,temporalReproduction:repro.temporal},scenarios:decision.scenarios,note:'Main and distinct-seed reproduction remain separate. Local synthetic screening; no production adoption or universal database ranking.'}};
 for(const [name,value] of Object.entries(summaries))await emit(name==='evaluation.json'?evaluation:join(name==='reproduction-report.json'?reproduction:run,'report.json'),join(staging,name),{derived:true,value});
 await emit(join(sourceRoot,'protocol.json'),join(staging,'protocol-summary.json'),{derived:true,value:{kind:'derived-protocol-summary',originalProtocolSHA256:mm.protocolHash,originalMarkdownSHA256:mm.sourceHashes['PROTOCOL.md'],exactSourceInArchive:'sources/protocol.json',note:'Readable derived summary; exact frozen protocol and all source files are retained in the archive.',protocol:compact(protocol)}});
 await emit(join(run,'manifest.json'),join(staging,'manifest-summary.json'),{derived:true,value:{kind:'derived-manifest-summary',protocolHash:mm.protocolHash,sourceHashes:mm.sourceHashes,fixtures:{main:mm.fixtures,reproduction:reproManifest.fixtures},runtime:compact(mm.runtime),limits:mm.limits,seeds:{main:mm.seed,reproduction:reproManifest.seed},note:'Normalized full manifests and runtime download provenance are retained in the archive.'}});
 const supplementalHostObservations={};
 for(const [label,path] of [['main',run],['reproduction',reproduction]])if((await readdir(path)).includes('host-observations.jsonl')){
  supplementalHostObservations[label]=(await readFile(join(path,'host-observations.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
  await emit(join(path,'host-observations.jsonl'),join(staging,`host-observations-${label}.jsonl`));
 }
 await emit(join(run,'host-context.json'),join(staging,'host-context.json'),{derived:true,value:{kind:'derived-host-context',initial:{main:await readJSON(join(run,'host-context.json')),reproduction:await readJSON(join(reproduction,'host-context.json'))},supplementalHostObservations,observationProvenance:'Supplemental observations were recorded by the operator outside the frozen runner. Exact normalized observation files and original/exported SHA-256 mappings are retained separately.',limitation:'Shared-host load and CPU speed limits can change during measurements. Initial host context alone does not establish a stable clock or isolated benchmark; local timing comparisons remain screening evidence.'}});
 const rawFiles=await walk(raw);for(const name of rawFiles){await chmod(join(raw,name),0o644);await utimes(join(raw,name),0,0);}
 const tarVersion=execFileSync('tar',['--version'],{encoding:'utf8'}).split('\n')[0],archive=join(staging,'raw-evidence.tar.gz');
 const tarPath=join(staging,'raw-evidence.tar');
 execFileSync('tar',[...archiveOwnerArgs(tarVersion),'-cf',tarPath,'-C',raw,...rawFiles],{env:{...process.env,COPYFILE_DISABLE:'1'}});
 execFileSync('gzip',['-n',tarPath]);
 const compressed=await readFile(archive);
 verifyArchiveMembers(execFileSync('tar',['-tzf',archive],{encoding:'utf8'}),execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}),rawFiles);
 const evidence={kind:'normalized-public-primitive-evidence',runIds:{main:basename(run),reproduction:basename(reproduction)},transformationPolicy:{normalized:'Replace local paths and observed hostnames; serverInfo.host becomes local-experiment-host; omit fsUsedSize/fsTotalSize host inventory. Preserve source measurements, owned process resource observations and exact operation denominators.',exact:'Frozen sources and protocol copied byte for byte after hash verification and privacy scan. Compact session snapshots were produced by the frozen runner after full-value oracle checks; exporter does not replace cold bodies or claim compact projections are full payloads.',summaries:'Derived reports omit database diagnostics and runtime download URL subtrees. All normalized diagnostics and original public download provenance remain in the archive.',exclusions:'No worker logs, database state, binaries, credentials, general host inventory or arbitrary runtime files. Uncounted smoke runs contribute manifest/report/interruption metadata only. Explicitly excluded interrupted measured runs retain all curated raw operations, snapshots, resources, host observations, diagnosis/interruption and independently hash-verified original sources; none are pooled with the amended run.',archive:'Sorted regular files; mode 0644, epoch timestamps, owner zero; COPYFILE_DISABLE=1 excludes AppleDouble; exact member set verified; gzip mtime zero. SHA binds actual bytes, not cross-platform reproducibility.'},files:entries,archive:{path:'raw-evidence.tar.gz',sha256:sha256(compressed),bytes:compressed.length,tarImplementation:tarVersion},exporterSHA256:sha256(await readFile(fileURLToPath(import.meta.url))),sanitationHelperSHA256:sha256(await readFile(join(dirname(fileURLToPath(import.meta.url)),'export-temporal-document-fit.mjs')))};
 assertPrivateFree(json(evidence).toString(),forbidden);await writeFile(join(staging,'evidence-manifest.json'),json(evidence));
 await mkdir(out,{recursive:false});for(const name of await readdir(staging))if(name!=='raw-evidence')await copyFile(join(staging,name),join(out,name));
 return{out,files:entries.length,archiveBytes:compressed.length,archiveSHA256:evidence.archive.sha256,outcome:decision.outcome};
 }finally{await rm(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),options={prior:[]};while(args.length){const key=args.shift();if(!['--run','--reproduction','--evaluation','--out','--prior','--repo'].includes(key)||!args.length)throw new Error('Usage: --run DIR --reproduction DIR --evaluation FILE --out NEW_DIR [--prior DIR] [--repo DIR]');const value=args.shift();if(key==='--prior')options.prior.push(value);else options[key.slice(2)]=value;}console.log(JSON.stringify(await exportEvidence(options)));}
