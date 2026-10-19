import test from 'node:test';
import assert from 'node:assert/strict';
import {compact,normalize,assertPrivateFree,validateRunBinding,validateRows} from './export-temporal-primitive-fit.mjs';

test('public summaries remove diagnostics/provenance downloads while normalized archive values preserve measurements',()=>{
 const source={cells:[{medianMs:1.25,diagnostics:{serverInfo:{host:'private-machine'},fsUsedSize:999,storageSize:123}}],runtime:{provenance:{downloads:{server:'https://example.com/release'}}},path:'/Users/private/runtime/report.json'};
 const normalized=normalize(source,[['/Users/private/runtime','$RUNTIME_ROOT']]);
 assert.equal(normalized.cells[0].diagnostics.storageSize,123);
 assert.equal(normalized.cells[0].diagnostics.serverInfo.host,'local-experiment-host');
 assert.equal(normalized.cells[0].diagnostics.fsUsedSize,undefined);
 assertPrivateFree(JSON.stringify(normalized),['private-machine']);
 const summary=compact(normalized);assert.equal(summary.cells[0].medianMs,1.25);assert.equal(summary.cells[0].diagnostics,undefined);assert.equal(summary.runtime.provenance.downloads,undefined);
 assert.equal(source.cells[0].diagnostics.storageSize,123);assert.equal(source.cells[0].diagnostics.serverInfo.host,'private-machine');
});

test('export binding rejects unfinished, unfrozen, mismatched, or unsafe run metadata',()=>{
 const durabilityObserved={postgres:{wal_sync_method:'fsync_writethrough',fsync:'on',synchronous_commit:'on',full_page_writes:'on'}};
 const report={mode:'main',seed:1,outcome:'completed',errors:[],sourceFreezeVerified:true,elapsedMs:100,durabilityObserved};
 const manifest={mode:'main',seed:1,durabilityObserved,protocolHash:'abc',sourceHashes:{'protocol.json':'abc','run.mjs':'def'}};
 validateRunBinding(report,manifest,'main');
 assert.throws(()=>validateRunBinding(report,{...manifest,durabilityObserved:{postgres:{...durabilityObserved.postgres,wal_sync_method:'open_datasync'}}},'main'),/durability evidence mismatch/);
 assert.throws(()=>validateRunBinding(report,{...manifest,durabilityObserved:undefined},'main'),/Missing durability/);
 for(const change of [{outcome:'running'},{sourceFreezeVerified:false},{errors:[{message:'failure'}]},{mode:'smoke'},{seed:2}])assert.throws(()=>validateRunBinding({...report,...change},manifest,'main'));
 assert.throws(()=>validateRunBinding(report,{...manifest,protocolHash:'changed'},'main'));
 assert.throws(()=>validateRunBinding(report,{...manifest,sourceHashes:{...manifest.sourceHashes,'../escape.mjs':'abc'}},'main'));
});

test('raw operation audit rejects lost, duplicate, failed, unknown and out-of-range attempts',()=>{
 const report={cells:[{label:'A-known-hot',operations:2},{label:'B-query',operations:1,update:{label:'B-update',operations:1}}]};
 const rows=[{cell:'A-known-hot',index:0,elapsedMs:1},{cell:'A-known-hot',index:1,elapsedMs:2},{cell:'B-query',index:0,elapsedMs:3},{cell:'B-update',index:0,elapsedMs:4}];
 const encode=value=>value.map(row=>JSON.stringify(row)).join('\n')+'\n';
 assert.deepEqual(validateRows(encode(rows),report),{attempted:4,completed:4,cells:3});
 assert.throws(()=>validateRows(encode(rows.slice(1)),report),/denominator/);
 assert.throws(()=>validateRows(encode([...rows,rows[0]]),report),/Duplicate/);
 for(const change of [{error:'failure'},{oracleError:'wrong result'},{cell:'unregistered'},{index:99},{elapsedMs:-1}])assert.throws(()=>validateRows(encode([{...rows[0],...change},...rows.slice(1)]),report),/Invalid/);
});
