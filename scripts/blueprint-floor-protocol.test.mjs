import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOCABULARY } from '../experiments/blueprint-floor/adapter.mjs';
import { CONTRACT_FILES, PROMPT_FILES, assertOpaqueIdsDistinct, opaqueId, ruleIdFor, buildAdjudicatorPrompt, buildTranslatorPrompt, downgrade, mechanicalChecks, parseAnswer, profileFor, validateAdjudicatorOutput, validateTranslatorOutput } from '../experiments/blueprint-floor/protocol.mjs';
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

// Words a prompt may never carry: every plugin name, every stratum or control word. And no segment of the rule's own id.
const PLUGIN_NAMES = selection.plugins.map(p => p.plugin);
const STRATUM_WORDS = ['primary', 'secondary', 'stratum', 'control', 'controls', 'positive', 'negative', 'calibration', 'tier'];
// Generic words that are segments of some ruleIds but are part of the fixed, identical text every prompt of a profile carries
// (the contract and the system prompts): they name no plugin, source or stratum. Each is listed with where it appears.
const TEMPLATE_WORDS = { path: 'contract: path globs and file_path', bash: 'contract: the Bash tool example', verdict: 'adjudicator system prompt: its verdict field', typescript: 'contract: the base is a TypeScript service', message: 'contract: the final message file', money: 'contract: the base tree lists src/domain/money.ts' };

test('blindness (refute r1 B2): every prompt of every rule shows an opaque id and no ruleId segment, plugin name or stratum word', () => {
  const ids = assertOpaqueIdsDistinct(allRules.map(r => r.ruleId));
  assert.equal(ids.length, 188);
  const mech = { schemaOk: true, vocabularyOk: true, validate: { ok: true }, teeth: { pass: true }, translatorClass: 'partial', classAfterMechanical: 'partial' };
  const system = Object.values(PROMPT_FILES).map(f => readFileSync(f, 'utf8'));
  const word = w => new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i');
  for (const r of allRules) {
    const oid = opaqueId(r.ruleId);
    assert.match(oid, /^item-[a-f0-9]{12}$/);
    assert.equal(ruleIdFor(oid, allRules.map(x => x.ruleId)), r.ruleId);
    const translator = buildTranslatorPrompt(r).user;
    const adjudicator = buildAdjudicatorPrompt(r, JSON.stringify({ ruleId: oid, class: 'partial' }), mech).user;
    for (const [role, msg] of [['translator', translator], ['adjudicator', adjudicator]]) {
      assert(msg.includes(`id: ${oid}`), `${r.ruleId} ${role}: the opaque id`);
      assert(!msg.includes(r.ruleId), `${r.ruleId} ${role}: the ruleId`);
      // Everything shown except the rule's own verbatim text (which is the plugin's words and may use any word).
      const shown = [msg.split(`<<<RULE\n${r.text}\nRULE>>>`).join(' '), ...system].join('\n');
      for (const seg of r.ruleId.split('/').filter(s => s.length >= 3 && !(s.toLowerCase() in TEMPLATE_WORDS))) assert(!word(seg).test(shown), `${r.ruleId} ${role}: segment ${seg}`);
      for (const name of PLUGIN_NAMES) assert(!word(name).test(shown), `${r.ruleId} ${role}: plugin name ${name}`);
      for (const w of STRATUM_WORDS) assert(!word(w).test(shown), `${r.ruleId} ${role}: stratum word ${w}`);
    }
  }
  // The template words are the same for every rule of a profile, so they carry nothing about the rule.
  assert.deepEqual(Object.keys(TEMPLATE_WORDS).filter(w => !word(w).test(system.join('\n') + readFileSync(CONTRACT_FILES['plugin-surface'], 'utf8'))), [], 'every template word really is in the fixed text');
  const plugin = allRules.filter(r => !r.ruleId.startsWith('control/0') || Number(r.ruleId.slice(8)) >= 8);
  const template = r => buildTranslatorPrompt(r).user.split('RULE>>>')[1];
  assert.equal(new Set(plugin.map(template)).size, 1, 'every plugin-surface rule sees the identical contract');
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
const OID = opaqueId('test/sudo');
const answer = over => JSON.stringify({ ruleId: OID, class: 'expressible', constraints: [{ id: 'no-sudo', type: 'forbiddenPattern', severity: 'high', pattern: '\\bsudo\\b', path: '.floor/command.txt' }], coverage: 'any sudo in the command', residual: null, probes: { violating: { tool_name: 'Bash', tool_input: { command: 'sudo ls' } }, compliant: { tool_name: 'Bash', tool_input: { command: 'ls' } } }, rationale: 'A literal token check.', ...over });

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
  assert.equal(bad({ ruleId: 'test/sudo' }).ok, false, 'the answer echoes the opaque id, never the ruleId');
  assert.equal(validateAdjudicatorOutput({ ruleId: OID, verdict: 'dispute', proposedClass: 'partial', reason: 'x' }, rule).ok, true);
  assert.equal(validateAdjudicatorOutput({ ruleId: OID, verdict: 'maybe', proposedClass: 'partial', reason: 'x' }, rule).ok, false);
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
