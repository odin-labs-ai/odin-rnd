import { readFile, writeFile, mkdir, readdir, mkdtemp, copyFile, utimes, chmod, lstat } from 'node:fs/promises';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { tmpdir, homedir, hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function normalize(value, replacements = [], parent = '') {
  if (Array.isArray(value)) return value.map(v => normalize(v, replacements, parent));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !['fsUsedSize','fsTotalSize'].includes(k)).map(([k,v]) => [k, parent === 'serverInfo' && k === 'host' ? 'local-experiment-host' : normalize(v,replacements,k)]));
  if (typeof value === 'string') for (const [from,to] of replacements) value = value.split(from).join(to);
  return value;
}
export function assertPrivateFree(text, forbidden = []) {
  if (/\/(?:Users|home)\/[^\s/"\\]+/.test(text) || forbidden.some(s => s && text.includes(s))) throw new Error('Private path or host remains in export');
}
export function archiveOwnerArgs(version) {
  if (/bsdtar/i.test(version)) return ['--uid','0','--gid','0','--uname','root','--gname','root'];
  if (/GNU tar/i.test(version)) return ['--owner=0','--group=0','--numeric-owner'];
  throw new Error('Unsupported tar implementation: expected GNU tar or bsdtar');
}
export function verifyArchiveMembers(names, modes, expected) {
  const sorted=names.trimEnd().split('\n').filter(Boolean).sort();
  const wanted=[...expected].sort();
  if(JSON.stringify(sorted)!==JSON.stringify(wanted)) throw new Error('Archive member set differs from manifested raw evidence');
  const rows=modes.trimEnd().split('\n').filter(Boolean);
  if(rows.length!==wanted.length || rows.some(line=>!line.startsWith('-'))) throw new Error('Archive contains non-regular entries');
}
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const compact = value => {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !['diagnostics','beforeDiagnostics','afterDiagnostics','downloads'].includes(k)).map(([k,v]) => [k,compact(v)]));
  return value;
};
async function walk(root, prefix = '') {
  const files=[];
  for (const entry of (await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name=join(prefix,entry.name);
    if(entry.isSymbolicLink()) throw new Error('Symlinks are forbidden in evidence');
    if(entry.isDirectory()) files.push(...await walk(root,name)); else files.push(name);
  }
  return files;
}
export async function exportEvidence({run, out, prior = [], reproduction, repo = resolve(dirname(fileURLToPath(import.meta.url)),'..')}) {
  run=resolve(run);out=resolve(out);repo=resolve(repo);
  const runtime=resolve(run,'../..');
  const manifestBytes=await readFile(join(run,'manifest.json')), manifest=JSON.parse(manifestBytes);
  const report=JSON.parse(await readFile(join(run,'report.json'),'utf8'));
  if (!report.finishedAt || report.runId !== manifest.runId) throw new Error('A matching finished report is required');
  if(manifest.sources?.['experiments/temporal-document-fit/protocol.json']!==manifest.protocolHash)throw new Error('Protocol hash does not match frozen source binding');
  if(prior.length!==3 || new Set(prior.map(p=>resolve(p))).size!==3) throw new Error('Exactly three distinct prior uncounted runs are required');
  const forbidden=[homedir(),hostname()];
  const discoverHosts=value=>{if(value&&typeof value==='object'){if(value.serverInfo?.host)forbidden.push(value.serverInfo.host);Object.values(value).forEach(discoverHosts);}};
  discoverHosts(manifest);
  const replacements=[[run,'$RUN_ROOT'],[runtime,'$RUNTIME_ROOT'],[repo,'$REPO_ROOT'],[homedir(),'$HOME'],...forbidden.slice(1).map(h=>[h,'local-experiment-host'])].sort((a,b)=>b[0].length-a[0].length);
  const tarVersion=execFileSync('tar',['--version'],{encoding:'utf8'}).split('\n')[0];
  const ownerArgs=archiveOwnerArgs(tarVersion);
  const policy={json:'Recursively replace local paths and observed hostnames; serverInfo.host becomes local-experiment-host; omit fsUsedSize and fsTotalSize. $REPO_ROOT identifies the repository; preexisting runner $SOURCE_ROOT identifies the experiment directory. Preserve original files locally.',jsonl:'Apply the same normalization to each JSON row.',compact:'Public summary files omit diagnostics, beforeDiagnostics, afterDiagnostics and runtime download URL subtrees. Derived protocol summary substitutes the Temporal documentation homepage for its source-repository URL. Exact protocol sources and complete runtime download provenance remain in the archive with source hashes.',byteIdentical:'Frozen protocol and source files are copied byte for byte after hash verification and privacy scan.',archive:'Sorted tar entries, file mode 0644 and mtime 1970-01-01. Owner metadata: bsdtar uid/gid 0 and root names; GNU tar numeric owner/group 0. COPYFILE_DISABLE=1 suppresses AppleDouble metadata; the exact regular-file member set is checked against the evidence manifest. gzip header mtime 0. Archive SHA binds actual output; cross-tool or cross-platform byte reproducibility is not asserted.'};
  const staging=await mkdtemp(join(tmpdir(),'tdf-public-export-')), raw=join(staging,'raw-evidence');await mkdir(raw);
  const entries=[];
  async function emit(source,dest,{exact=false,derived=false,value,sourceProperty}={}) {
    const original=source?await readFile(source):null;
    let bytes;
    if(exact) bytes=original;
    else if(value!==undefined) bytes=json(normalize(value,replacements));
    else if(source.endsWith('.jsonl')) bytes=Buffer.from(original.toString().split('\n').filter(Boolean).map(line=>JSON.stringify(normalize(JSON.parse(line),replacements))).join('\n')+'\n');
    else bytes=json(normalize(JSON.parse(original),replacements));
    assertPrivateFree(bytes.toString(),forbidden);
    await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);
    entries.push({path:relative(staging,dest),originalLocalFile:source?normalize(source,replacements):null,originalLocalSHA256:original?sha256(original):null,exportedSHA256:sha256(bytes),bytes:bytes.length,transformation:exact?'byte-identical':derived?'derived-summary':'normalized',...(sourceProperty?{sourceProperty}: {})});
  }
  for(const [name,expected] of Object.entries(manifest.sources)){
    if(!name.startsWith('experiments/temporal-document-fit/') || name.includes('..'))throw new Error('Unexpected frozen source path');
    const source=join(repo,name);if((await lstat(source)).isSymbolicLink())throw new Error('Source symlink forbidden');
    if(sha256(await readFile(source))!==expected)throw new Error(`Frozen source mismatch: ${name}`);
    await emit(source,join(raw,'sources',name),{exact:true});
  }
  const protocolFile=join(repo,'experiments/temporal-document-fit/protocol.json');
  const protocol=JSON.parse(await readFile(protocolFile,'utf8'));
  const readableProtocol=compact(protocol);
  if(readableProtocol.sources)readableProtocol.sources=readableProtocol.sources.map(url=>url.startsWith('https://github.com/temporalio/')?'https://docs.temporal.io/':url);
  await emit(protocolFile,join(staging,'protocol-summary.json'),{derived:true,value:{kind:'derived-protocol-summary',originalProtocolSHA256:manifest.protocolHash,originalMarkdownSHA256:manifest.sources['experiments/temporal-document-fit/PROTOCOL.md'],exactSourceInArchive:'sources/experiments/temporal-document-fit/protocol.json',note:'Derived readable summary. Temporal source-repository citation is represented by its documentation homepage; the exact original citation and byte-identical protocol files are retained in raw-evidence.tar.gz. Runtime download URLs, if any, are omitted from readable summaries.',protocol:readableProtocol}});
  const allowed=/^(?:manifest|report|cells|faults|evolution|runtime-commands|budget-overrun|independent-audit|host-context|replay-postgres|replay-mongodb)\.json$|^(?:operations|activity-attempts|resources)\.jsonl$|^snapshots\/[A-Za-z0-9_.-]+\.json$/;
  for(const name of await walk(run))if(allowed.test(name))await emit(join(run,name),join(raw,'main',name));
  for(const path of prior){
    const source=join(resolve(path),'report.json'), previous=JSON.parse(await readFile(source,'utf8'));
    if(!previous.finishedAt || (!previous.preflightOnly&&!previous.smokeOnly) || previous.measuredAttempts!==0)throw new Error('Prior report must be finalized and explicitly uncounted');
    await emit(source,join(raw,'uncounted-prior',basename(resolve(path)),'report.json'));
    await emit(join(resolve(path),'manifest.json'),join(raw,'uncounted-prior',basename(resolve(path)),'manifest.json'));
  }
  if(reproduction){
    reproduction=resolve(reproduction);
    const reproductionReport=JSON.parse(await readFile(join(reproduction,'report.json'),'utf8'));
    if(!reproductionReport.finishedAt)throw new Error('Reproduction report must be finished');
    for(const name of await walk(reproduction))if(/^(?:report|manifest)\.json$|^(?:operations|rows|resources|activity-attempts)\.jsonl$|^snapshots\/[A-Za-z0-9_.-]+\.json$/.test(name))await emit(join(reproduction,name),join(raw,'reproduction',name));
    await emit(join(dirname(reproduction),'reproduce-pair.mjs'),join(raw,'reproduction','reproduce-pair.mjs'),{exact:true});
  }
  for(const [name,value] of Object.entries({'report.json':report,'cells.json':report.cells,'faults.json':report.faults,'evolution.json':report.evolutions})){
    if(value===undefined)throw new Error(`Missing final ${name}`);
    await emit(join(run,'report.json'),join(staging,name),{derived:true,value:compact(value),sourceProperty:({'report.json':'$','cells.json':'$.cells','faults.json':'$.faults','evolution.json':'$.evolutions'})[name]});
  }
  const hostContext=join(run,'host-context.json');
  if((await readdir(run)).includes('host-context.json')) await emit(hostContext,join(staging,'host-context.json'));
  const summary={kind:'derived-manifest-summary',runId:manifest.runId,createdAt:manifest.createdAt,originalManifestSHA256:sha256(manifestBytes),protocolHash:manifest.protocolHash,sourceHashes:manifest.sources,dependencies:manifest.dependencies,runtime:compact(manifest.runtime),host:manifest.host,fixture:{seed:manifest.fixture.seed,hash:manifest.fixture.hash,recordCount:manifest.fixture.records.length},measurement:manifest.measurement,counts:{cells:report.cells.length,faults:report.faults.length,evolutions:report.evolutions.length,measuredAttempts:report.measuredAttempts,measuredCompleted:report.measuredCompleted},note:'Derived summary: full synthetic fixtures, diagnostics and runtime download URLs omitted here; normalized full manifest retained in raw-evidence.tar.gz.'};
  await emit(join(run,'manifest.json'),join(staging,'manifest-summary.json'),{derived:true,value:summary});
  const rawFiles=await walk(raw);for(const name of rawFiles){await chmod(join(raw,name),0o644);await utimes(join(raw,name),0,0);}
  const archive=join(staging,'raw-evidence.tar.gz');
  const tar=execFileSync('tar',[...ownerArgs,'-cf','-','-C',raw,...rawFiles],{maxBuffer:512*1024*1024,env:{...process.env,COPYFILE_DISABLE:'1'}});
  const compressed=execFileSync('gzip',['-n','-c'],{input:tar,maxBuffer:512*1024*1024});await writeFile(archive,compressed);
  verifyArchiveMembers(execFileSync('tar',['-tzf',archive],{encoding:'utf8'}),execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}),entries.filter(e=>e.path.startsWith('raw-evidence/')).map(e=>e.path.slice('raw-evidence/'.length)));
  const evidence={kind:'normalized-public-evidence-export',runId:manifest.runId,transformationPolicy:policy,files:entries,archive:{path:'raw-evidence.tar.gz',sha256:sha256(compressed),bytes:compressed.length,tarImplementation:tarVersion},exporterSHA256:sha256(await readFile(fileURLToPath(import.meta.url)))};
  assertPrivateFree(json(evidence).toString(),forbidden);
  await writeFile(join(staging,'evidence-manifest.json'),json(evidence));
  // Publish only after all validation succeeds; refuse to overwrite existing evidence.
  await mkdir(out,{recursive:false});
  for(const name of await readdir(staging))if(name!=='raw-evidence')await copyFile(join(staging,name),join(out,name));
  return {out,runId:manifest.runId,files:entries.length,archiveBytes:compressed.length};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={prior:[]};
  while(args.length){const key=args.shift();if(!['--run','--out','--prior','--reproduction','--repo'].includes(key)||!args.length)throw new Error('Usage: --run DIR --out NEW_DIR --prior DIR (three times) [--reproduction DIR] [--repo DIR]');const value=args.shift();if(key==='--prior')options.prior.push(value);else options[key.slice(2)]=value;}
  if(!options.run||!options.out)throw new Error('--run and --out are required');
  console.log(JSON.stringify(await exportEvidence(options)));
}
