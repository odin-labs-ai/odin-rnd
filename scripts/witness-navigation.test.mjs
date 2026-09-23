import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservation } from '../site/assets/witness-navigation.mjs';
test('station deep link opens and selects its exact recorded observation',()=>{
  const id='shared-bug-baseline:round-half-cent',events=[];
  const details={tagName:'DETAILS',open:false,scrollIntoView:options=>events.push(options)};
  const select={disabled:false,options:[{value:id}],dispatchEvent:event=>events.push(event.type)};
  const document={getElementById:key=>key==='witness-choice'?select:key===`observation-${id}`?details:null};
  assert.equal(openObservation(`#observation-${encodeURIComponent(id)}`,document),true);
  assert.equal(select.value,id); assert.equal(details.open,true); assert.equal(events[0],'change');
  for(const hash of ['#recording','#observation-unknown','#observation-%E0%A4']) assert.equal(openObservation(hash,document),false);
  select.disabled=true; assert.equal(openObservation(`#observation-${id}`,document),false);
});
