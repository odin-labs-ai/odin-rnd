import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBrief, bindBrief } from '../site/assets/brief.mjs';

test('brief preserves multiline and injection-like text as plain text, with honest missing values', () => {
  const text = formatBrief({workflow:'  Inspect orders\r\nReview exceptions  ', outcome:'<script>alert("test")</script>\n[example](javascript:alert(1))'});
  assert.ok(text.includes('Inspect orders\nReview exceptions'));
  assert.ok(text.includes('<script>alert("test")</script>'));
  assert.ok(text.includes('Current baseline\nTo agree'));
  assert.ok(text.includes('Nothing has been submitted'));
});
test('requires a nonblank workflow and enforces each field limit', () => {
  for (const workflow of ['', ' \r\n\t']) assert.throws(() => formatBrief({workflow}), /Describe one workflow/);
  assert.doesNotThrow(() => formatBrief({workflow:'a'.repeat(2000)}));
  for (const field of ['workflow','outcome','baseline','samples','constraints']) {
    assert.throws(() => formatBrief({workflow:'Review orders', [field]:'a'.repeat(2001)}), /2,000/);
  }
});
function fixture(writeText = async () => {}) {
  const nodes = new Map();
  for (const id of ['pilot-brief-form','brief-result','brief-output','copy-brief','download-brief','brief-status']) {
    nodes.set(id, {hidden:true,value:'',textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},removeAttribute(name){delete this[name];},focus(){this.focused=true;},select(){this.selected=true;}});
  }
  const form = nodes.get('pilot-brief-form');
  const values = {workflow:'Review orders',outcome:'',baseline:'',samples:'',constraints:''};
  form.elements = {namedItem: name => ({value:values[name]})};
  const revoked = [], blobs = [], events = {};
  const browser = {Blob,URL:{createObjectURL(blob){blobs.push(blob);return 'blob:'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},navigator:{clipboard:{writeText}},addEventListener(name,fn){events[name]=fn;}};
  bindBrief({getElementById:id=>nodes.get(id)},browser);
  return {nodes,form,values,revoked,blobs,events,submit:()=>form.listeners.submit({preventDefault(){}})};
}
test('binding reveals form, exports plain text and invalidates stale exports on edit', async () => {
  const f = fixture();
  assert.equal(f.form.hidden,false);
  f.submit();
  assert.equal(f.nodes.get('brief-result').hidden,false);
  assert.equal(f.blobs[0].type,'text/plain;charset=utf-8');
  assert.equal(await f.blobs[0].text(),f.nodes.get('brief-output').value);
  f.submit();
  assert.deepEqual(f.revoked,['blob:1']);
  f.form.listeners.input();
  assert.deepEqual(f.revoked,['blob:1','blob:2']);
  assert.equal(f.nodes.get('download-brief').href,undefined);
  assert.equal(f.nodes.get('brief-output').value,'');
  assert.equal(f.nodes.get('brief-result').hidden,true);
  f.values.workflow = '';
  f.submit();
  assert.match(f.nodes.get('brief-status').textContent,/Describe one workflow/);
});
test('denied clipboard selects output with honest fallback status', async () => {
  const f = fixture(async () => {throw new Error('Denied');});
  f.submit();
  await f.nodes.get('copy-brief').listeners.click();
  assert.equal(f.nodes.get('brief-output').selected,true);
  assert.equal(f.nodes.get('brief-output').focused,true);
  assert.match(f.nodes.get('brief-status').textContent,/unavailable/);
  assert.equal(f.nodes.get('copy-brief').disabled,false);
});
test('double copy is bounded and async completion cannot overwrite an edit status', async () => {
  let finish, calls = 0;
  const f = fixture(() => {calls++;return new Promise(resolve => {finish=resolve;});});
  f.submit();
  const first = f.nodes.get('copy-brief').listeners.click();
  await f.nodes.get('copy-brief').listeners.click();
  assert.equal(calls,1);
  f.form.listeners.input();
  finish();
  await first;
  assert.match(f.nodes.get('brief-status').textContent,/Brief changed/);
  f.submit();
  f.events.pagehide({persisted:true});
  assert.equal(f.nodes.get('download-brief').href,'blob:2');
  f.events.pagehide({persisted:false});
  assert.equal(f.nodes.get('download-brief').href,undefined);
});
