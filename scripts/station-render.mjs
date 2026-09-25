import { stations, validateStationContracts, recordedAssertions } from './station-contract.mjs';
import { escape } from './witness-render.mjs';
import { readFileSync } from 'node:fs';
import { renderLayaExhibit, loadLaya, assertBenchCurrent, pagePath } from './laya-bench.mjs';
const pre = text => `<pre tabindex="0">${escape(text)}</pre>`;
const row = (label, value, state='') => `<div class="record-comparison ${state}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const receiptLink = (station,id,label) => `<a href="projects/${station.project}/#observation-${escape(id)}">${escape(label)}</a>`;
export function renderStations(report, reports, laya = loadLaya(), page = readFileSync(pagePath, 'utf8')) {
  validateStationContracts(report,reports);
  assertBenchCurrent(page, laya);
  return stations.map((station,index) => {
    let body;
    if(station.record==='laya'){
      if(!laya) throw new Error('Decision station requires the committed Laya record');
      body=renderLayaExhibit(laya);
    }else if(index===0){
      const r=report.runs.find(r=>r.id===station.recipe), binding=r.sourceBinding;
      if(!binding) throw new Error('Opened Blueprint requires exact released fixture source binding');
      const diffs=binding.changedPaths.map(path=>{
        const clean=binding.clean.find(f=>f.path===path), drift=binding.drift.find(f=>f.path===path);
        if(!clean||!drift)throw new Error('Missing exact fixture file '+path);
        return `<h4>${escape(path)}</h4><p>Conforming fixture</p>${pre(clean.text)}<p>Drifted fixture</p>${pre(drift.text)}<p><a href="${escape(clean.sourceUrl)}">Conforming source</a> / <a href="${escape(drift.sourceUrl)}">Drifted source</a></p>`;
      }).join('');
      body=`<p class="artifact-label">An unchanged architectural rule</p>${pre(r.violation+'\ndomain → app: forbidden')}<div class="record-comparisons">${row('Conforming tree','GREEN / '+r.cleanScore,'accepted')}${row('Reverse import','RED / '+r.driftScore,'rejected')}</div><p class="station-implication">The domain imports the application layer. The engine identifies the forbidden edge in <code>order.ts:1</code>.</p><details class="station-source"><summary>Inspect the source change</summary><p>The packaged comparison changes the files below. It is not a one-line-only causal experiment.</p>${diffs}<details><summary>Read the unchanged blueprint</summary>${pre(binding.blueprint.text)}<a href="${escape(binding.blueprint.sourceUrl)}">Exact released blueprint</a></details></details><p class="station-provenance">BCE ${escape(report.engine.version)} · ${escape(report.completedAt.slice(0,10))}<br><a href="data/experiments.json">Recording, source hashes and environment</a></p>`;
    }else{
      const record=reports.find(r=>r.project===station.project);
      const obs=station.observations.map(id=>record.observations.find(o=>o.id===id));
      if(index===1){
        body=`<p class="artifact-label">One half-cent invoice. Two implementations.</p><div class="record-comparisons">${row('Before',obs[0].actual)}${row('After',obs[1].actual)}${row('Independent expectation',obs[0].expected,'accepted')}</div><p class="station-implication">Equality preserves this bug. Both versions are rejected by the declared expectation.</p><div class="station-receipts">${receiptLink(station,obs[0].id,'Inspect before')}${receiptLink(station,obs[1].id,'Inspect after')}</div>`;
      }else if(index===2){
        const assertion=obs[1].actual.assertions.find(a=>a.id==='rounding');
        body=`<p class="artifact-label">The assertion that changes the answer</p>${pre(`rounding: expected ${assertion.expected}\n          actual ${assertion.actual} → ${assertion.status}`)}<div class="record-comparisons">${row('Weak suite','PASS · defect missed','rejected')}${row('Strong suite','FAIL · defect detected','accepted')}${row('Always-pass suite','REJECTED · ignores behavior','rejected')}</div><p class="station-implication">Here, a failing assertion is the useful result. A green test alone cannot qualify the suite.</p><div class="station-receipts">${obs.map(o=>receiptLink(station,o.id,o.id.replace('rounding-','')+' receipt')).join('')}</div>`;
      }else{
        const outputs=obs.map(o=>recordedAssertions(record,o).assertions);
        const extract=(assertions,id)=>{const a=assertions.find(a=>a.id===id);return `${a.status} · ${a.actual} / expected ${a.expected}`};
        body=`<p class="artifact-label">Target fixed. Required checks retained.</p><div class="record-comparisons">${row('Corrected / target.locale',extract(outputs[0],'target.locale'),'accepted')}${row('Corrected / regression.total',extract(outputs[0],'regression.total'),'accepted')}${row('Regression / target.locale',extract(outputs[1],'target.locale'),'accepted')}${row('Regression / regression.total',extract(outputs[1],'regression.total'),'rejected')}</div><p class="station-implication">Both fix the target. The second still fails the retained total check and is rejected.</p><div class="station-receipts">${receiptLink(station,obs[0].id,'Corrected receipt')}${receiptLink(station,obs[1].id,'Rejected receipt')}</div>`;
      }
      body+=`<p class="station-provenance">Authored Java fixtures · ${escape(record.completedAt.slice(0,10))} · ${escape(record.environment ?? 'local reproduction')}<br><a href="data/witnesses/${station.project}.json">Recording and source provenance</a></p>`;
    }
    return `<article class="station-exhibit" id="station-${station.id}" data-exhibit="${station.id}"${index?' hidden':''}><div class="compartment-heading"><span>${station.number} / ${station.label}</span><span>Recorded experiment</span></div><h2>${escape(station.title)}</h2>${body}<a class="station-full" href="${station.href}">Open full experiment <span aria-hidden="true">↗</span></a></article>`;
  }).join('');
}
export const renderStationLinks = () => stations.map((s,i)=>`<a href="${s.href}" data-station="${s.id}"${!i?' aria-current="true"':''}><span>${s.number}</span>${s.label}</a>`).join('');
