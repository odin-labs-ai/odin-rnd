import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stations, validateStationContracts } from './station-contract.mjs';
import { renderStationLinks, renderStations } from './station-render.mjs';
import { setupFactory, setupExperiments } from '../site/assets/app.js';
import { factoryFloor } from './floor.mjs';

const report = JSON.parse(readFileSync('site/data/experiments.json','utf8'));
const reports = ['migration-witness','test-witness','ci-witness'].map(id=>JSON.parse(readFileSync(`site/data/witnesses/${id}.json`,'utf8')));
test('station claims resolve exact observations and reject missing or contradictory evidence', () => {
  assert.equal(validateStationContracts(report,reports).length,stations.length);
  assert.deepEqual(stations.map(s=>s.number),['01','02','03','04','05','06','07']);
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

test('station 06 is pre-registered, never a recorded result, and refuses a page that drifts from its record', () => {
  const triage=stations.find(s=>s.id==='triage');
  assert.equal(triage?.number,'06'); assert.equal(triage.record,'jev-gate');
  assert.notEqual(stations.find(s=>s.id==='gate').record,'jev-gate','Station 03 keeps the id gate');
  const record=JSON.parse(readFileSync('experiments/jev-gate/preregistration.json','utf8'));
  // Pre-registration mode (results null); the measured mode is tested in jev-gate-results-site.test.mjs.
  const html=renderStations(report,reports,undefined,undefined,undefined,undefined,undefined,null);
  const exhibit=html.split('id="station-triage"')[1].split('</article>')[0];
  assert(exhibit.includes('<span>Pre-registered — not yet run</span>'));
  assert.doesNotMatch(exhibit,/Recorded experiment/);
  for(const c of record.criteria) assert(exhibit.includes(c.statement.replaceAll("'",'&#39;')),`Station 06 is missing ${c.id}`);
  assert(exhibit.includes(`${record.corpus.groundTruthRed} RED / ${record.corpus.groundTruthGreen} GREEN`));
  assert(exhibit.includes('href="data/jev-gate/preregistration.json"')&&exhibit.includes(`href="${triage.href}"`));
  for(const mutate of [r=>{r.experiment.stationTitle+='?';},r=>{r.experiment.statusText='Recorded experiment';}]){
    const changed=structuredClone(record); mutate(changed);
    assert.throws(()=>renderStations(report,reports,undefined,undefined,changed,undefined,undefined,null),/differs from the pre-registration/);
  }
  assert.equal(readFileSync('site/data/jev-gate/preregistration.json','utf8'),readFileSync('experiments/jev-gate/preregistration.json','utf8'),'The published copy is the committed record');
});

// Minimal native-event surface: test behavior without a browser or a DOM dependency.
class Element {
  constructor(dataset={}) { this.dataset=dataset; this.attributes=new Map(); this.events=new Map(); this.hidden=false; this.textContent=''; this.animations=[]; this.children=new Map(); this.classes=new Set(); this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)}; }
  querySelector(selector){return this.children.get(selector);}
  setAttribute(key,value){this.attributes.set(key,value);}
  getAttribute(key){return this.attributes.get(key);}
  removeAttribute(key){this.attributes.delete(key);}
  addEventListener(key,fn){this.events.set(key,fn);}
  fire(key,event={}) {event.preventDefault=()=>{event.prevented=true};return this.events.get(key)?.(event);}
  animate(frames,options){const animation={frames,options,canceled:false,cancel(){this.canceled=true}};this.animations.push(animation);return animation;}
}
function fixture({reduced=false,invalid=false,missing=false,hash,observer=false,waapi=true}={}){
  const controls=stations.map(s=>new Element({station:s.id}));
  const exhibits=stations.map(s=>new Element({exhibit:s.id}));
  exhibits.forEach((e,i)=>{e.hidden=i!==0});
  const geometry=stations.map(s=>{const group=new Element({floorStation:s.id});group.children.set('.station-assembly',new Element());group.children.set('.station-marker',new Element());return group;});
  const layers=['floor','services','conveyor','wayfinding','annotation'].map(factoryLayer=>new Element({factoryLayer}));
  const single=new Map(['#station-data','#station-status','#station-unavailable','.factory-drawing','.station-compartment','.floor-art','.station-trace','.drafting-scan','#blueprint-toggle','#factory-replay'].map(key=>[key,new Element()]));
  single.get('#station-data').textContent=invalid?'{broken':JSON.stringify(stations);
  single.get('#station-unavailable').hidden=true;
  const document=new Element();document.querySelector=selector=>single.get(selector);document.querySelectorAll=selector=>({'[data-station]':controls,'[data-exhibit]':missing?exhibits.slice(0,3):exhibits,'[data-floor-station]':geometry,'[data-factory-layer]':layers}[selector]??[]);
  const preference={matches:reduced,addEventListener(key,fn){if(key==='change')this.change=fn;}};
  const environment={matchMedia:()=>preference,location:{hash:hash??''},addEventListener(key,fn){if(key==='hashchange')this.onhash=fn;}};
  if(observer)environment.IntersectionObserver=class{constructor(callback){environment.onIntersection=callback;}observe(element){environment.observed=element;}};
  if(!waapi)for(const element of [...single.values(),...layers,...geometry.flatMap(g=>[g,...g.children.values()]),...exhibits])element.animate=undefined;
  const controller=setupFactory(document,environment);
  return {controls,exhibits,geometry,layers,single,document,controller,environment,preference};
}
test('keyboard station selection preserves control focus, chooses exact content and settles rapid motion',()=>{
  const f=fixture(); const event={key:' '};
  f.controls[1].fire('keydown',event);
  assert(event.prevented);assert.equal(f.controls[1].getAttribute('aria-pressed'),'true');
  assert.deepEqual(f.exhibits.map(e=>e.hidden),stations.map((_,i)=>i!==1));
  const firstMotion=f.geometry[1].querySelector('.station-assembly').animations[0];assert(firstMotion);
  f.controls[2].fire('click');assert(firstMotion.canceled);
  assert.deepEqual(f.exhibits.map(e=>e.hidden),stations.map((_,i)=>i!==2));
  const motionCount=f.geometry[2].querySelector('.station-assembly').animations.length;f.controls[2].fire('click');assert.equal(f.geometry[2].querySelector('.station-assembly').animations.length,motionCount);
  const modified={metaKey:true};f.controls[0].fire('click',modified);assert(!modified.prevented);
  assert.equal(f.controls[2].getAttribute('aria-pressed'),'true');
});
test('a #station-<id> link opens that station on load and on navigation',()=>{
  const f=fixture({hash:'#station-triage'});const i=stations.findIndex(s=>s.id==='triage');
  assert.deepEqual(f.exhibits.map(e=>e.hidden),stations.map((_,j)=>j!==i));
  assert.equal(f.controls[i].getAttribute('aria-pressed'),'true');
  f.environment.location.hash='#station-gate';f.environment.onhash();
  assert.equal(f.exhibits[stations.findIndex(s=>s.id==='gate')].hidden,false);
  f.environment.location.hash='#station-nowhere';f.environment.onhash();
  assert.equal(f.exhibits[stations.findIndex(s=>s.id==='gate')].hidden,false,'An unknown station leaves the selection alone');
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
  assert.equal(f.exhibits[2].hidden,false);assert.equal(f.geometry.flatMap(g=>[...g.children.values()].flatMap(e=>e.animations)).length,0);
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


test('one primary drawing owns every station and separate assembly layers', () => {
  const svg=factoryFloor();
  assert.equal((svg.match(/id="factory-geometry"/g)||[]).length,1);
  assert.equal((svg.match(/data-floor-station=/g)||[]).length,stations.length);
  assert.equal((svg.match(/class="station-assembly"/g)||[]).length,stations.length);
  assert.doesNotMatch(svg,/station-crop|factory-crop-geometry/);
  for(const name of ['floor','services','conveyor','wayfinding','annotation'])assert(svg.includes(`data-factory-layer="${name}"`));
  assert.equal((svg.match(/<g[ >]/g)||[]).length,(svg.match(/<\/g>/g)||[]).length,'semantic layers remain balanced SVG');
});

test('assembly is finite, plays once on entry and only replays on an explicit action', () => {
  const f=fixture({observer:true});
  assert.equal(f.environment.observed,f.single.get('.floor-art'));
  const enter=isIntersecting=>f.environment.onIntersection([{isIntersecting}]);
  enter(true);
  const floor=f.layers[0], count=floor.animations.length;
  assert.equal(count,1);
  assert(f.geometry.every(g=>g.querySelector('.station-assembly').animations.length===1));
  for(const animation of [...f.layers,...f.geometry.map(g=>g.querySelector('.station-assembly'))].flatMap(e=>e.animations)){
    assert(animation.options.duration+animation.options.delay<=1120,'assembly ends within its bounded focal sequence');
    assert.equal(animation.options.fill,'backwards','no filled end state can outlive cancellation');
    assert.equal(animation.options.iterations,undefined,'motion never loops');
  }
  enter(false);assert(floor.animations[0].canceled);
  enter(true);assert.equal(floor.animations.length,count,'returning to the drawing does not replay it');
  f.single.get('#factory-replay').fire('click');assert.equal(floor.animations.length,count+1);
  f.controls[2].fire('click');assert(floor.animations.at(-1).canceled,'selection interrupts assembly');
  assert.equal(f.exhibits[2].hidden,false);
});

test('preference changes and hidden tabs cancel every factory effect while keeping the selected record', () => {
  const f=fixture({observer:true});f.environment.onIntersection([{isIntersecting:true}]);
  f.controls[3].fire('click');f.single.get('#blueprint-toggle').fire('click');
  const sweep=f.single.get('.drafting-scan').animations.at(-1);assert(sweep);
  f.preference.matches=true;f.preference.change();
  assert(sweep.canceled);assert.equal(f.exhibits[3].hidden,false);assert.equal(f.single.get('#factory-replay').hidden,true);
  f.controls[4].fire('click');assert.equal(f.exhibits[4].hidden,false);
  assert.equal(f.geometry[4].querySelector('.station-assembly').animations.length,1,'reduced motion adds no selection animation after its assembly');
  f.preference.matches=false;f.preference.change();f.controls[5].fire('click');
  const selection=f.geometry[5].querySelector('.station-assembly').animations.at(-1);
  f.document.hidden=true;f.document.fire('visibilitychange');assert(selection.canceled);
  f.single.get('#factory-replay').fire('click');assert.equal(f.layers[0].animations.length,1,'hidden document cannot begin a replay');
});

test('reduced motion at load and absent animation APIs retain complete selection and blueprint behavior', () => {
  for(const config of [{reduced:true,observer:true},{waapi:false,observer:true}]){
    const f=fixture(config);f.environment.onIntersection([{isIntersecting:true}]);
    f.controls[6].fire('click');f.single.get('#blueprint-toggle').fire('click');
    assert.equal(f.exhibits[6].hidden,false);assert.equal(f.single.get('.factory-drawing').dataset.view,'blueprint');
    assert.equal(f.layers.flatMap(e=>e.animations).length,0);
    assert.equal(f.single.get('.drafting-scan').animations.length,0);
  }
});
