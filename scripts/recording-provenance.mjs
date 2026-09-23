import assert from 'node:assert/strict';

// Execution context is evidence supplied by the runner, not proof of authenticity.
export function recordingProvenance(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return { environment: 'local reproduction', workflowRun: null, workflowAttempt: null };
  assert.equal(env.GITHUB_REPOSITORY, 'odin-labs-ai/odin-rnd', 'Unexpected recording repository');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ''), 'Missing workflow run ID');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'Missing workflow run attempt');
  return { environment: 'GitHub Actions', workflowRun: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`, workflowAttempt: Number(env.GITHUB_RUN_ATTEMPT) };
}
export function validateProvenance(record) {
  assert(['local reproduction', 'GitHub Actions'].includes(record.environment), 'Unknown recording environment');
  if (record.environment === 'local reproduction') {
    assert.equal(record.workflowRun, null, 'Local recording cannot claim a CI URL');
    assert.equal(record.workflowAttempt, null, 'Local recording cannot claim a CI attempt');
  } else {
    assert(/^https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/actions\/runs\/[1-9]\d*$/.test(record.workflowRun), 'Invalid CI recording URL');
    assert(Number.isSafeInteger(record.workflowAttempt) && record.workflowAttempt > 0, 'Invalid CI attempt');
  }
}
