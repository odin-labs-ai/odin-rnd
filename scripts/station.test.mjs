import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stations, validateStationContracts } from './station-contract.mjs';
import { renderStationLinks, renderStations } from './station-render.mjs';
import { setupFactory, setupExperiments } from '../site/assets/app.js';

const report = JSON.parse(readFileSync('site/data/experiments.json','utf8'));
const reports = ['migration-witness','test-witness','ci-witness'].map(id=>JSON.parse(readFileSync(`site/data/witnesses/${id}.json`,'utf8')));
test('station claims resolve exact observations and reject missing or contradictory evidence', () => {
  assert.equal(validateStationContracts(report,reports).length,stations.length);
  assert.deepEqual(stations.map(s=>s.number),['01','02','03','04','05']);
  for (const mutate of [
    records => records[0].observations.find(o=>o.id===stations[1].observations[1]).actual = 'a different answer',
    records => records[0].observations.find(o=>o.id===stations[1].observations[0]).verdict = 'accepted',
    records => records[1].observations = records[1].observations.filter(o=>o.id!=='rounding-strong'),
    records => records[1].observations.find(o=>o.id==='rounding-strong').actual.assertions.find(a=>a.id==='rounding').status='PASS',
    records => {const r=records[2],o=r.observations.find(o=>o.id==='locale-regression');r.commands.find(c=>c.id===o.commandIds.at(-1)).stdout=r.commands.find(c=>c.id===o.commandIds.at(-1)).stdout.replace('regression.total|FAIL','regression.total|PASS');},
    records => {const r=records[2],o=r.observations.find(o=>o.id==='locale-corrected');r.commands.find(c=>c.id===o.commandIds.at(-1)).stdout=r.commands.find(c=>c.id===o.commandIds.at(-1)).stdout.replace('actual=4|expected=4','actual=5|expected=4');},
  ]) { const changed=structuredClone(reports); mutate(changed); assert.throws(()=>validateStationContracts(report,changed)); }
});
test('static station links reach actual evidence; Blueprint refuses unbound source', () => {
  const links=renderStationLinks();
  for(const station of stations) assert(links.includes(`href="${station.href}"`));
  assert(!links.includes('role="button"'));
  const unbound=structuredClone(report); delete unbound.runs[0].sourceBinding;
  assert.throws(()=>renderStations(unbound,reports),/exact released fixture source/);
});

// Minimal native-event surface: test behavior without a browser or a DOM dependency.
class Element {
  constructor(dataset={}) { this.dataset=dataset; this.attributes=new Map(); this.events=new Map(); this.hidden=false; this.textContent=''; this.animations=[]; this.classes=new Set(); this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)}; }
  setAttribute(key,value){this.attributes.set(key,value);}
  getAttribute(key){return this.attributes.get(key);}
  removeAttribute(key){this.attributes.delete(key);}
  addEventListener(key,fn){this.events.set(key,fn);}
  fire(key,event={}) {event.preventDefault=()=>{event.prevented=true};return this.events.get(key)?.(event);}
  animate(frames,options){const animation={frames,options,canceled:false,cancel(){this.canceled=true}};this.animations.push(animation);return animation;}
}
function fixture({reduced=false,invalid=false,missing=false}={}){
  const controls=stations.map(s=>new Element({station:s.id}));
  const exhibits=stations.map(s=>new Element({exhibit:s.id}));
  exhibits.forEach((e,i)=>{e.hidden=i!==0});
  const geometry=stations.map(s=>new Element({floorStation:s.id}));
  const single=new Map(['#station-data','#station-status','#station-unavailable','.factory-drawing','.station-compartment','.station-crop','.station-trace','#blueprint-toggle'].map(key=>[key,new Element()]));
  single.get('#station-data').textContent=invalid?'{broken':JSON.stringify(stations);
  single.get('#station-unavailable').hidden=true;
  const document=new Element();document.querySelector=selector=>single.get(selector);document.querySelectorAll=selector=>({'[data-station]':controls,'[data-exhibit]':missing?exhibits.slice(0,3):exhibits,'[data-floor-station]':geometry}[selector]??[]);
  const environment={matchMedia:()=>({matches:reduced,addEventListener(){}})};
  const controller=setupFactory(document,environment);
  return {controls,exhibits,geometry,single,document,controller};
}
test('keyboard station selection preserves control focus, chooses exact content and settles rapid motion',()=>{
  const f=fixture(); const event={key:' '};
  f.controls[1].fire('keydown',event);
  assert(event.prevented);assert.equal(f.controls[1].getAttribute('aria-pressed'),'true');
  assert.deepEqual(f.exhibits.map(e=>e.hidden),stations.map((_,i)=>i!==1));
  assert.equal(f.single.get('.station-crop').getAttribute('viewBox'),stations[1].crop);
  const firstMotion=f.geometry[1].animations[0];assert(firstMotion);
  f.controls[2].fire('click');assert(firstMotion.canceled);
  assert.deepEqual(f.exhibits.map(e=>e.hidden),stations.map((_,i)=>i!==2));
  const motionCount=f.geometry[2].animations.length;f.controls[2].fire('click');assert.equal(f.geometry[2].animations.length,motionCount);
  const modified={metaKey:true};f.controls[0].fire('click',modified);assert(!modified.prevented);
  assert.equal(f.controls[2].getAttribute('aria-pressed'),'true');
});
test('blueprint view is independent of selection and hidden document cancels motion',()=>{
  const f=fixture();f.controls[3].fire('click');f.single.get('#blueprint-toggle').fire('click');
  assert.equal(f.single.get('.factory-drawing').dataset.view,'blueprint');
  assert.equal(f.controls[3].getAttribute('aria-pressed'),'true');assert.equal(f.exhibits[3].hidden,false);
  f.document.hidden=true;f.document.fire('visibilitychange');
  assert(f.single.get('.station-trace').animations.every(a=>a.canceled));
});
test('reduced motion uses the same selected evidence with no animations',()=>{
  const f=fixture({reduced:true});f.controls[2].fire('click');
  assert.equal(f.exhibits[2].hidden,false);assert.equal(f.geometry.flatMap(g=>g.animations).length,0);
  assert.equal(f.single.get('.station-trace').animations.length,0);
});
test('invalid data leaves real links intact and missing exhibits cannot masquerade as a prior result',()=>{
  const bad=fixture({invalid:true});assert.equal(bad.controls[0].getAttribute('role'),undefined);
  assert(bad.exhibits.every(e=>e.hidden));assert.equal(bad.single.get('#station-unavailable').hidden,false);
  const missing=fixture({missing:true});missing.controls[3].fire('click');
  assert(missing.exhibits.slice(0,3).every(e=>e.hidden));assert.equal(missing.single.get('#station-unavailable').hidden,false);
});
test('experiment selection uses the recording pin and clipboard denial offers truthful fallback',async()=>{
  const ids=['#experiment-data','#run-id','#run-title','#run-question','#run-badge','#clean-result','#drift-result','#transcript','#reproduce-command','#run-date','#run-origin','#copy-status','#copy-command','#station-blueprint .station-full'];
  const elements=new Map(ids.map(id=>[id,new Element()]));const controls=report.runs.map(()=>new Element());
  elements.get('#experiment-data').textContent=JSON.stringify(report);
  const doc={querySelector:id=>elements.get(id),querySelectorAll:()=>controls};
  setupExperiments(doc,{navigator:{clipboard:{writeText:async()=>{throw new Error('denied')}}}});
  controls[2].fire('click');assert(elements.get('#reproduce-command').textContent.includes(`bce-engine@${report.engine.version}`));
  assert(elements.get('#reproduce-command').textContent.endsWith(report.runs[2].id));
  await elements.get('#copy-command').fire('click');assert.match(elements.get('#copy-status').textContent,/manually/);
  elements.get('#station-blueprint .station-full').fire('click');assert(elements.get('#reproduce-command').textContent.endsWith('module-layering'));
});
