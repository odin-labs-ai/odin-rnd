import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingProvenance, validateProvenance } from './recording-provenance.mjs';
test('local recording cannot inherit stale CI metadata', () => {
  const p = recordingProvenance({GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'});
  validateProvenance(p);
  assert.equal(p.workflowRun,null);
  assert.throws(()=>validateProvenance({...p,workflowRun:'https://github.com/odin-labs-ai/odin-rnd/actions/runs/123'}));
});
test('CI recording requires repository, real run ID and attempt', () => {
  const env = {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'odin-labs-ai/odin-rnd',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
  validateProvenance(recordingProvenance(env));
  for (const patch of [{GITHUB_REPOSITORY:'other/repo'}, {GITHUB_RUN_ID:undefined}, {GITHUB_RUN_ATTEMPT:'0'}]) assert.throws(()=>recordingProvenance({...env,...patch}));
});
