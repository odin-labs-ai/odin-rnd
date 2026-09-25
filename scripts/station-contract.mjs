import assert from 'node:assert/strict';

// One correspondence between conceptual machinery and independently recorded cases.
export const stations = [
  { id:'blueprint', number:'01', label:'Blueprint', title:'Can a dependency cross the line?', project:'bce', recipe:'module-layering', href:'#experiments', crop:'210 40 270 220', trace:'M298 65L555 65L795 150' },
  { id:'workcell', number:'02', label:'Workcell', title:'Before and after agree. Both are wrong.', project:'migration-witness', observations:['shared-bug-baseline:round-half-cent','shared-bug-candidate:round-half-cent'], href:'projects/migration-witness/#observation-shared-bug-baseline:round-half-cent', crop:'330 75 270 255', trace:'M474 100L630 100L795 150' },
  { id:'gate', number:'03', label:'Gate', title:'A passing test missed the defect.', project:'test-witness', observations:['rounding-weak','rounding-strong','rounding-always-pass'], href:'projects/test-witness/#observation-rounding-strong', crop:'375 165 225 250', trace:'M438 210L630 210L795 150' },
  { id:'record', number:'04', label:'Record', title:'The target is fixed. What else broke?', project:'ci-witness', observations:['locale-corrected','locale-regression'], href:'projects/ci-witness/#observation-locale-regression', crop:'400 300 175 190', trace:'M462 325L650 325L795 150' },
  { id:'decision', number:'05', label:'Decision', title:'Can an open model take the call?', project:'laya-vs-jev', record:'laya', href:'#laya-bench', crop:'120 180 200 190', trace:'M206 228L206 40L560 40L795 150' },
];
export function recordedAssertions(record, observation) {
  const command = record.commands.find(c => c.id === observation.commandIds.at(-1));
  assert(command && command.status === 'completed', `Missing completed receipt for ${observation.id}`);
  const assertions = command.stdout.split('\n').filter(line => line.startsWith('ASSERT|')).map(line => {
    const [kind, id, status, actual, expected] = line.split('|');
    assert(['PASS','FAIL'].includes(status) && actual?.startsWith('actual=') && expected?.startsWith('expected='), `Malformed assertion for ${observation.id}`);
    return { id, status, actual:actual.slice(7), expected:expected.slice(9) };
  });
  assert.equal(new Set(assertions.map(a => a.id)).size, assertions.length, 'Duplicate assertion IDs');
  return { command, assertions };
}
export function validateStationContracts(report, reports) {
  const run=report.runs.find(r=>r.id==='module-layering');
  assert(run && run.passed && run.violation==='domain-cannot-import-app','Blueprint needs recorded module-layering discrimination');
  assert(run.transcript.includes('packages/domain/order.ts#L1'), 'Blueprint diagnosis must locate the displayed source');
  for(const station of stations.filter(s=>s.observations)) {
    const record=reports.find(r=>r.project===station.project);
    assert(record,`Missing station record ${station.project}`);
    for(const id of station.observations) assert(record.observations.some(o=>o.id===id),`Missing station observation ${id}`);
  }
  const observation=(project,id)=>reports.find(r=>r.project===project).observations.find(o=>o.id===id);
  const before=observation('migration-witness',stations[1].observations[0]);
  const after=observation('migration-witness',stations[1].observations[1]);
  assert.equal(before.actual,after.actual,'Shared-bug comparison must agree');
  assert.notEqual(before.actual,before.expected,'Shared-bug comparison must violate independent expectation');
  assert.equal(before.expected,after.expected);
  assert.equal(before.verdict,'rejected'); assert.equal(after.verdict,'rejected');
  const weak=observation('test-witness','rounding-weak'), strong=observation('test-witness','rounding-strong'), unconditional=observation('test-witness','rounding-always-pass');
  assert.equal(weak.actual.exitCode,0); assert.equal(weak.verdict,'rejected');
  assert(!weak.actual.assertions.some(a=>a.id==='rounding'));
  assert.equal(strong.actual.assertions.find(a=>a.id==='rounding')?.status,'FAIL');
  const rounding=strong.actual.assertions.find(a=>a.id==='rounding');
  assert.notEqual(rounding.actual,rounding.expected);
  assert.equal(strong.actual.exitCode,1);
  assert.equal(strong.verdict,'accepted'); assert.equal(unconditional.verdict,'rejected');
  assert.equal(unconditional.actual.exitCode,0);
  const ci=reports.find(r=>r.project==='ci-witness');
  for (const [id, verdict, totalStatus, exitCode] of [['locale-corrected','accepted','PASS',0],['locale-regression','rejected','FAIL',1]]) {
    const o=observation('ci-witness',id), {command, assertions}=recordedAssertions(ci,o);
    assert.equal(o.verdict,verdict); assert.equal(command.exitCode,exitCode);
    assert.equal(assertions.find(a=>a.id==='target.locale')?.status,'PASS','Locale target must be corrected');
    assert.equal(assertions.find(a=>a.id==='regression.total')?.status,totalStatus,'Retained total check must match narrative');
    for(const assertion of assertions) {
      assert.equal(assertion.status === 'PASS', assertion.actual === assertion.expected, 'Assertion values must support status');
    }
  }
  return stations;
}
