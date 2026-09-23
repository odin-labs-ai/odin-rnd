import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDemo } from './transcript.mjs';
const sample = 'GREEN conformant: score 100, exit 0\nRED drift: score 60, would exit 1, violation reverse-import\nbce demo: module-layering discriminates GREEN from RED\n';
test('accepts the real released demo output contract', () => assert.equal(parseDemo(sample, 'module-layering', 0).passed, true));
test('rejects a successful process with missing RED or GREEN', () => {
  assert.equal(parseDemo(sample.replace(/^RED.*\n/m, ''), 'module-layering', 0).passed, false);
  assert.equal(parseDemo(sample.replace(/^GREEN.*\n/m, ''), 'module-layering', 0).passed, false);
});
test('rejects stale recipe identity, command failure and changed transcript format', () => {
  assert.equal(parseDemo(sample, 'configuration-allowlist', 0).passed, false);
  assert.equal(parseDemo(sample, 'module-layering', 1).passed, false);
  assert.equal(parseDemo('success', 'module-layering', 0).passed, false);
});

test('rejects ambiguous duplicate output rather than selecting a convenient verdict', () => {
  assert.equal(parseDemo(sample + sample, 'module-layering', 0).passed, false);
  assert.equal(parseDemo(sample.replace('score 60', 'score 100'), 'module-layering', 0).passed, false);
});

test('binds the displayed rule and source to exact released fixture bytes', async () => {
  const {captureSourceBinding,validateSourceBinding} = await import('./transcript.mjs');
  const {fileURLToPath} = await import('node:url');
  const {execFileSync} = await import('node:child_process');
  const root=fileURLToPath(new URL('../node_modules/bce-engine/', import.meta.url));
  const binding=captureSourceBinding(root);
  const transcript=execFileSync(process.execPath,[root+'dist/cli.js','demo','--recipe','module-layering'],{encoding:'utf8'});
  const run={id:'module-layering',...parseDemo(transcript,'module-layering',0),transcript};
  validateSourceBinding(binding,run,root);
  assert.deepEqual(binding.changedPaths,['packages/app/checkout.ts','packages/domain/order.ts']);
  const altered=structuredClone(binding); altered.drift[2].text='invented source';
  assert.throws(()=>validateSourceBinding(altered,run,root),/binding mismatch/);
  assert.throws(()=>validateSourceBinding(binding,{...run,violation:'another-rule'},root),/claim mismatch/);
  assert.throws(()=>validateSourceBinding(binding,{...run,transcript:transcript.replace('evidence packages/domain/order.ts#L1','evidence packages/domain/order.ts#L2')},root),/location mismatch/);
});
