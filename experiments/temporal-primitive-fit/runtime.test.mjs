import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDurabilitySettings} from './runtime.mjs';
const compliant=()=>Object.entries({fsync:'on',synchronous_commit:'on',full_page_writes:'on',wal_sync_method:'fsync_writethrough'}).map(([name,setting])=>({name,setting,pending_restart:false}));
test('durability preflight rejects nominal acknowledgments with the prior platform flush setting',()=>{
 const old=compliant();old.find(r=>r.name==='wal_sync_method').setting='open_datasync';assert.throws(()=>assertDurabilitySettings(old),/wal_sync_method/);assert.equal(assertDurabilitySettings(compliant()),true);
});
test('durability preflight fails closed for missing, duplicate, disabled or pending settings',()=>{
 for(const alter of [rows=>rows.pop(),rows=>rows.push({...rows[0]}),rows=>{rows[0].setting='off';},rows=>{rows[0].pending_restart=true;}]){const rows=compliant();alter(rows);assert.throws(()=>assertDurabilitySettings(rows),/Durability preflight rejected/);}
});
