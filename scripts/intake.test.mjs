import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionPayload, createSubmissionClient, bindIntake } from '../site/assets/intake.mjs';
import { apiOrigin, routeKey, recordActivity, bindActivity, readConfig } from '../site/assets/activity.mjs';
const input = {name:'Example',email:'example@example.invalid',topic:'test-witness',message:'A question',sharingAccepted:true};
const id = '7829ce89-514f-4b32-9f84-86f0f1e4aeb7';
const accepted = () => ({status:202,json:async()=>({status:'accepted',id})});
test('enquiry boundary validates deliberate sharing, bounded fields and actual UTF-8 body size', () => {
  assert.deepEqual(submissionPayload({...input,channel:'evil',trackingId:'no'}), input);
  for (const invalid of [{name:''},{name:'a\u0000b'},{email:'a\u0000b@example.invalid'},{email:'not-email'},{topic:'unexpected'},{message:''},{message:'a'.repeat(5001)},{sharingAccepted:false},{message:'\u0001'.repeat(3000)}]) {
    assert.throws(()=>submissionPayload({...input,...invalid}));
  }
  assert.equal(submissionPayload({...input,message:'<script>@all</script>'}).message,'<script>@all</script>');
});
test('lost response retries original key and payload; 429 during reconciliation cannot issue another key', async () => {
  const calls=[];let generated=0;
  const client=createSubmissionClient('https://intake.example.invalid',{uuid:()=>`request-${++generated}`,fetcher:async(url,options)=>{
    calls.push({url,options});if(calls.length===1)throw new Error('lost response');if(calls.length===2)return {status:429};return accepted();
  }});
  assert.equal((await client.submit(input)).state,'uncertain');
  assert.equal((await client.submit({...input,message:'changed'})).state,'uncertain');
  assert.deepEqual(await client.submit({...input,message:'changed again'}),{state:'accepted',id});
  assert.equal(generated,1);assert.equal(calls.length,3);
  assert.equal(new Set(calls.map(c=>c.options.body)).size,1);
  assert.equal(new Set(calls.map(c=>c.options.headers['Idempotency-Key'])).size,1);
  for(const {url,options} of calls){assert.equal(url,'https://intake.example.invalid/v1/rd/submissions');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');}
  await client.submit(input);assert.equal(calls.length,3);
});
test('duplicate click does not issue concurrent request; first explicit rejection allows correction', async()=>{
  let finish,calls=0;
  const client=createSubmissionClient('https://intake.example.invalid',{uuid:()=>id,fetcher:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const first=client.submit(input);
  assert.equal((await client.submit(input)).state,'pending');assert.equal(calls,1);
  finish({status:422});assert.equal((await first).state,'rejected');assert.equal(client.locked,false);
  const second=client.submit({...input,message:'Corrected'});finish(accepted());assert.equal((await second).state,'accepted');
});
test('a status alone, wrong receipt, key conflict or service failure cannot claim success', async()=>{
  for(const response of [{status:200},{status:503},{status:202,json:async()=>({status:'accepted',id:'<script>'})},{status:202,json:async()=>{throw new Error('bad JSON');}},{status:409}]){
    const client=createSubmissionClient('https://intake.example.invalid',{uuid:()=>id,fetcher:async()=>response});
    const result=await client.submit(input);assert.notEqual(result.state,'accepted');assert.equal(client.locked,true);
  }
});
test('unset or unsafe endpoints cannot transmit form or event data', async()=>{
  let calls=0;const fetcher=async()=>{calls++;return accepted();};
  assert.equal((await createSubmissionClient(null,{fetcher}).submit(input)).state,'unavailable');
  assert.equal(await recordActivity(null,'page_view','home',fetcher),false);
  for(const origin of ['http://example.invalid','https://user:secret@example.invalid','https://example.invalid/path','https://example.invalid/?key=secret','https://example.invalid/#x'])assert.throws(()=>apiOrigin(origin));
  assert.equal(calls,0);
});
test('activity exports only two allowlisted enum fields and never accepted-enquiry client events', async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true};};
  assert.equal(await recordActivity('https://intake.example.invalid','page_view','home',fetcher),true);
  assert.deepEqual(JSON.parse(calls[0].options.body),{event:'page_view',route:'home'});
  assert.equal(await recordActivity('https://intake.example.invalid','enquiry_accepted','home',fetcher),false);
  assert.equal(await recordActivity('https://intake.example.invalid','page_view','?email=example@example.invalid',fetcher),false);
  assert.equal(calls.length,1);
  let failures=0;await recordActivity('https://intake.example.invalid','page_view','home',async()=>{failures++;throw new Error('offline');});assert.equal(failures,1);
  assert.equal(routeKey('/odin-rnd/projects/test-witness/'),'test-witness');
  assert.equal(routeKey('/odin-rnd/journal/why-open-the-floor.html'),'journal-why-open-the-floor');
  assert.equal(routeKey('/odin-rnd/private-person/'),null);
});
function formFixture(origin,fetcher){
  const nodes=new Map();const fields=Object.entries(input).map(([name,value])=>({name,value,checked:value,type:typeof value==='boolean'?'checkbox':'text',disabled:false}));
  const form={hidden:true,elements:{namedItem:name=>fields.find(f=>f.name===name)},addEventListener:(name,fn)=>{form[name]=fn;},setAttribute:(name,value)=>{form[name]=value;}};
  const status={textContent:'',focus(){this.focused=true;}};const button={disabled:false,textContent:''};
  nodes.set('enquiry-form',form);nodes.set('enquiry-status',status);nodes.set('send-enquiry',button);
  bindIntake({getElementById:name=>nodes.get(name)},origin,{fetcher,uuid:()=>id});
  return {form,status,button,fields,submit:()=>form.submit({preventDefault(){}})};
}
test('form preserves entered values and locks ambiguous retry then exposes exact receipt with focus',async()=>{
  let calls=0;const fixture=formFixture('https://intake.example.invalid',async()=>{if(++calls===1)throw new Error('offline');return accepted();});
  assert.equal(fixture.form.hidden,false);assert.equal(fixture.status.textContent,'');await fixture.submit();
  assert.equal(fixture.button.textContent,'Retry this enquiry');assert(fixture.fields.every(f=>f.disabled));
  assert.match(fixture.status.textContent,/could not confirm/);assert.equal(fixture.status.focused,true);
  await fixture.submit();assert.match(fixture.status.textContent,new RegExp(id));assert(fixture.button.disabled);assert.equal(fixture.fields.find(f=>f.name==='message').value,input.message);
  assert.equal(fixture.form['aria-busy'],'false');
});
test('unconfigured form stays hidden and validation error restores editable inputs',async()=>{
  const hidden=formFixture(null,()=>assert.fail('No transmission'));assert.equal(hidden.form.hidden,true);assert.match(hidden.status.textContent,/not available/);
  const editable=formFixture('https://intake.example.invalid',()=>assert.fail('No transmission'));
  editable.fields.find(f=>f.name==='email').value='invalid';await editable.submit();assert(editable.fields.every(f=>!f.disabled));assert.equal(editable.button.disabled,false);assert.match(editable.status.textContent,/email/);
});

test('activity binding counts keyboard station and witnessed selection without exporting control values', async()=>{
  const listeners=new Map(), calls=[];
  const doc={addEventListener:(name,fn)=>listeners.set(name,fn)};
  const browser={location:{pathname:'/odin-rnd/projects/test-witness/',search:'?email=private@example.invalid'},fetch:async(url,options)=>{calls.push({url,options});return {ok:true};}};
  bindActivity(doc,browser,'https://intake.example.invalid');
  const control={hasAttribute:name=>name==='data-station',matches:selector=>selector==='[data-station][role="button"]'};
  listeners.get('click')({target:{closest:()=>control}});
  listeners.get('keydown')({key:' ',repeat:false,target:control});
  listeners.get('keydown')({key:' ',repeat:true,target:control});
  listeners.get('change')({isTrusted:true,target:{id:'witness-choice',value:'private free text'}});
  listeners.get('change')({isTrusted:false,target:{id:'witness-choice'}});
  listeners.get('rd-reproduction-copied')();
  const contact={hasAttribute:()=>false,matches:selector=>selector==='[data-contact-opened]'};
  listeners.get('click')({target:{closest:()=>contact}});
  assert.deepEqual(calls.map(c=>JSON.parse(c.options.body)),[
    {event:'page_view',route:'test-witness'},
    ...Array.from({length:3},()=>({event:'experiment_selected',route:'test-witness'})),
    {event:'reproduction_copied',route:'test-witness'},
    {event:'contact_opened',route:'test-witness'},
  ]);
  assert(calls.every(c=>c.options.keepalive===true));
  assert(!JSON.stringify(calls).includes('private'));
  const disabled=[];bindActivity({addEventListener:name=>disabled.push(name)},browser,null);assert.deepEqual(disabled,[]);
});
test('configuration is one exact field, disables cleanly, and refuses extra keys or unsafe destinations',async()=>{
  const config=value=>async()=>({ok:true,json:async()=>value});
  assert.equal(await readConfig(config({apiOrigin:null})),null);
  assert.equal(await readConfig(config({apiOrigin:'https://intake.example.invalid'})),'https://intake.example.invalid');
  for(const value of [{apiOrigin:null,visitorId:'no'}, {}, {apiOrigin:'http://intake.example.invalid'}]) await assert.rejects(readConfig(config(value)));
  await assert.rejects(readConfig(async()=>({ok:false})));
});
test('uncertain request remains immutable after malformed accepted receipt and explicit retry rejection',async()=>{
  const calls=[];let next=0;let keys=0;
  const client=createSubmissionClient('https://intake.example.invalid',{uuid:()=>`key-${++keys}`,fetcher:async(url,options)=>{calls.push(options);return [{status:202,json:async()=>({status:'accepted',id:'invalid'})},{status:422},accepted()][next++];}});
  for (const message of ['original','ignored change']) assert.equal((await client.submit({...input,message})).state,'uncertain');
  assert.equal((await client.submit({...input,message:'ignored again'})).state,'accepted');
  assert.equal(keys,1);assert(calls.every(c=>JSON.parse(c.body).message==='original'));
});
