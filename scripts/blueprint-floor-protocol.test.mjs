import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOCABULARY } from '../experiments/blueprint-floor/adapter.mjs';
import { CONTRACT_FILES, PROMPT_FILES, buildAdjudicatorPrompt, buildTranslatorPrompt, downgrade, mechanicalChecks, parseAnswer, profileFor, validateAdjudicatorOutput, validateTranslatorOutput } from '../experiments/blueprint-floor/protocol.mjs';
import { loadRules, loadSelection } from './blueprint-floor-rules.mjs';

// EXP 007 WO-1-03: the census protocol. Blindness (R2-3), the output schemas, the downgrade rule, and the mechanical
// checks run on canned answers. No model is called: every "answer" here is a string written in this file.

const LONG = { timeout: 600_000 };
const selection = loadSelection();
const allRules = [...selection.plugins.flatMap(p => loadRules(p.plugin).rules), ...['positive', 'negative'].flatMap(f => JSON.parse(readFileSync(`experiments/blueprint-floor/controls/${f}.json`, 'utf8')).rules)];

/** A rule whose only readable fields are the four the builders may read; touching any other field throws. */
const guarded = rule => new Proxy(rule, { get(target, key) {
  if (typeof key === 'symbol' || ['ruleId', 'text', 'inputKind', 'flags'].includes(key)) return target[key];
  throw new Error(`the prompt builder read the forbidden field ${String(key)}`);
} });

test('blindness: the builders read only {ruleId, text, inputKind, flags} of every census rule', () => {
  const mech = { schemaOk: true, vocabularyOk: true, validate: { ok: true }, teeth: { pass: true }, translatorClass: 'partial', classAfterMechanical: 'partial' };
  for (const r of allRules) {
    const t = buildTranslatorPrompt(guarded(r));
    assert(t.user.includes(`<<<RULE\n${r.text}\nRULE>>>`), r.ruleId);
    const a = buildAdjudicatorPrompt(guarded(r), '{"ruleId":"x"}', mech);
    assert(a.user.includes(r.text), r.ruleId);
  }
  assert.equal(allRules.length, 145 + 30 + 13);
});

test('blindness: no withheld field, no abide type, no case and no label reaches any translator prompt', () => {
  for (const r of allRules) {
    const { user } = buildTranslatorPrompt(r);
    for (const [key, value] of Object.entries(r.withheld)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (text.length >= 12 && !r.text.includes(text) && !r.ruleId.includes(text)) assert(!user.includes(text), `${r.ruleId}: withheld ${key} is in the prompt`);
    }
    if (r.ruleId.startsWith('abide/')) {
      assert(!new RegExp(`"type":\\s*"${r.withheld.check.type}"`).test(user), r.ruleId);
      if (r.withheld.check.question) assert(!user.includes(r.withheld.check.question.instructions), `${r.ruleId}: abide's model question leaked`);
    }
    assert(!/\b(GREEN|RED)\b|label/.test(user.replace(r.text, '')), `${r.ruleId}: a label word outside the rule text`);
    assert(!/results\.json|labels\.json|corpus/.test(user), r.ruleId);
  }
});

test('the prompt is the pinned system prompt file plus a user message built from the four fields and the contract', () => {
  const r = loadRules('pi-verdict').rules.find(x => x.ruleId === 'pi-verdict/bash/sudo');
  const t = buildTranslatorPrompt(r);
  assert.equal(t.systemPromptFile, PROMPT_FILES.translator);
  assert.match(t.user, /this rule is a regular expression; its flags: i/);
  assert(t.user.endsWith(readFileSync(CONTRACT_FILES['plugin-surface'], 'utf8')));
  const limpet = buildTranslatorPrompt(loadRules('limpet').rules[0]).user;
  assert(!limpet.includes('regular expression; its flags'));
  assert.deepEqual(buildTranslatorPrompt(r), buildTranslatorPrompt(structuredClone(r)), 'deterministic');
  // Positive controls see the module-graph contract; negative controls and plugin rules the plugin-surface one.
  assert.equal(profileFor('control/01'), 'typescript-module-graph');
  assert.equal(profileFor('control/08'), 'plugin-surface');
  assert(buildTranslatorPrompt(allRules.find(x => x.ruleId === 'control/01')).user.endsWith(readFileSync(CONTRACT_FILES['typescript-module-graph'], 'utf8')));
});

test('each contract lists exactly its role\'s vocabulary, and names the refused types', () => {
  const accepted = file => [...readFileSync(file, 'utf8').split('## The constraint types you may use')[1].matchAll(/^- `(\w+)`:/gm)].map(m => m[1]);
  assert.deepEqual(accepted(CONTRACT_FILES['plugin-surface']).sort(), [...VOCABULARY.plugin].sort());
  assert.deepEqual(accepted(CONTRACT_FILES['typescript-module-graph']).sort(), [...VOCABULARY.control].sort());
  assert.match(readFileSync(CONTRACT_FILES['plugin-surface'], 'utf8'), /including `customPolicy`/);
  // The base layout in the contract is the base tree's real file list.
  const listed = readFileSync(CONTRACT_FILES['plugin-surface'], 'utf8').split('```')[1].trim().split('\n');
  assert.equal(listed.length, 22);
  assert(listed.every(f => readFileSync(`experiments/jev-gate/base/${f}`)));
});

test('negative controls: six, one per line of the file, each on the plugin-surface path', () => {
  const text = readFileSync('experiments/blueprint-floor/controls/negative.json', 'utf8').split('\n');
  const neg = JSON.parse(text.join('\n')).rules;
  assert.equal(neg.length, 6);
  for (const r of neg) { assert(text[r.line - 1].includes(r.text), r.ruleId); assert.equal(profileFor(r.ruleId), 'plugin-surface'); }
  const pos = JSON.parse(readFileSync('experiments/blueprint-floor/controls/positive.json', 'utf8')).rules;
  const rules = readFileSync('experiments/jev-gate/rules.txt', 'utf8').split('\n');
  assert.deepEqual(pos.map(r => r.line), [2, 3, 4, 5, 6, 7, 8]);
  for (const r of pos) assert.equal(r.text, rules[r.line - 1]);
});

const rule = { ruleId: 'test/sudo', text: 'Never run sudo.', inputKind: 'toolCall', flags: null };
const answer = over => JSON.stringify({ ruleId: 'test/sudo', class: 'expressible', constraints: [{ id: 'no-sudo', type: 'forbiddenPattern', severity: 'high', pattern: '\\bsudo\\b', path: '.floor/command.txt' }], coverage: 'any sudo in the command', residual: null, probes: { violating: { tool_name: 'Bash', tool_input: { command: 'sudo ls' } }, compliant: { tool_name: 'Bash', tool_input: { command: 'ls' } } }, rationale: 'A literal token check.', ...over });

test('the translator schema: classes, residual iff not expressible, constraints and probes iff it decides, rationale <= 80 words', () => {
  assert.deepEqual(validateTranslatorOutput(JSON.parse(answer({})), rule), { ok: true, errors: [] });
  const bad = over => validateTranslatorOutput(JSON.parse(answer(over)), rule);
  assert.equal(bad({ class: 'maybe' }).ok, false);
  assert.equal(bad({ residual: 'Is it sudo?' }).ok, false, 'expressible with a residual');
  assert.equal(bad({ class: 'partial' }).ok, false, 'partial without a residual');
  assert.equal(bad({ class: 'not', residual: 'Q?' }).ok, false, 'not with constraints');
  assert.equal(bad({ class: 'not', residual: 'Q?', constraints: [], probes: null }).ok, true);
  assert.equal(bad({ rationale: Array(81).fill('w').join(' ') }).ok, false);
  assert.equal(bad({ extra: 1 }).ok, false);
  assert.equal(bad({ ruleId: 'other' }).ok, false);
  assert.equal(validateAdjudicatorOutput({ ruleId: 'test/sudo', verdict: 'dispute', proposedClass: 'partial', reason: 'x' }, rule).ok, true);
  assert.equal(validateAdjudicatorOutput({ ruleId: 'test/sudo', verdict: 'maybe', proposedClass: 'partial', reason: 'x' }, rule).ok, false);
  assert.deepEqual(parseAnswer('```json\n{"a":1}\n```'), { ok: true, value: { a: 1 }, fenced: true });
  assert.equal(parseAnswer('I think {"a":1}').ok, false);
  assert.deepEqual([downgrade('expressible', true), downgrade('expressible', false), downgrade('partial', true)], ['partial', 'not', 'not']);
});

test('mechanical checks on canned answers: a sound answer stays; vacuous teeth, customPolicy, an unsafe regex and garbage lower it', LONG, async () => {
  const ok = await mechanicalChecks(rule, answer({}));
  assert.deepEqual([ok.classAfterMechanical, ok.failedCheck], ['expressible', null], JSON.stringify(ok));
  const vacuous = await mechanicalChecks(rule, answer({ constraints: [{ id: 'v', type: 'forbiddenPattern', severity: 'high', pattern: 'zzz-never', path: '.floor/command.txt' }] }));
  assert.deepEqual([vacuous.classAfterMechanical, vacuous.failedCheck], ['not', 'teeth']);
  const withResidual = await mechanicalChecks(rule, answer({ class: 'partial', residual: 'Is the command privileged some other way?', constraints: [{ id: 'v', type: 'forbiddenPattern', severity: 'high', pattern: 'zzz-never', path: '.floor/command.txt' }] }));
  assert.deepEqual([withResidual.classAfterMechanical, withResidual.failedCheck], ['not', 'teeth']);
  const policy = await mechanicalChecks(rule, answer({ class: 'partial', residual: 'Q?', constraints: [{ id: 'c', type: 'customPolicy', severity: 'high' }] }));
  assert.deepEqual([policy.classAfterMechanical, policy.failedCheck, policy.vocabularyOk], ['not', 'vocabulary', false]);
  const redos = await mechanicalChecks(rule, answer({ constraints: [{ id: 'r', type: 'forbiddenPattern', severity: 'high', pattern: '(a+)+$' }] }));
  assert.deepEqual([redos.classAfterMechanical, redos.failedCheck, redos.engineLimit], ['not', 'validate', true]);
  const garbage = await mechanicalChecks(rule, 'Sure! Here is my answer.');
  assert.deepEqual([garbage.classAfterMechanical, garbage.failedCheck], ['error', 'parse']);
  const not = await mechanicalChecks(rule, answer({ class: 'not', residual: 'Q?', constraints: [], probes: null }));
  assert.deepEqual([not.classAfterMechanical, not.teeth, not.validate], ['not', null, null]);
  const schema = await mechanicalChecks(rule, answer({ residual: 'Q?' }));
  assert.deepEqual([schema.classAfterMechanical, schema.failedCheck], ['partial', 'schema']);
});
