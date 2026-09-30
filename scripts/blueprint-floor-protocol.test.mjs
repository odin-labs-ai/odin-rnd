import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOCABULARY, judge } from '../experiments/blueprint-floor/adapter.mjs';
import { FLAG_HANDLING, FLAGS_QUESTION, FOLDING_SENTENCE, upperRanges, checkFlags, upperCaseLiterals, unverifiableFlags, CONTRACT_FILES, PROMPT_FILES, assertOpaqueIdsDistinct, opaqueId, ruleIdFor, buildAdjudicatorPrompt, buildTranslatorPrompt, downgrade, mechanicalChecks, parseAnswer, profileFor, validateAdjudicatorOutput, validateTranslatorOutput } from '../experiments/blueprint-floor/protocol.mjs';
import { loadRules, loadSelection } from './blueprint-floor-rules.mjs';

// EXP 007 WO-1-03: the census protocol. Blindness (R2-3), the output schemas, the downgrade rule, and the mechanical
// checks run on canned answers. No model is called: every "answer" here is a string written in this file.

const LONG = { timeout: 600_000 };
const selection = loadSelection();
const allRules = [...selection.plugins.flatMap(p => loadRules(p.plugin).rules), ...['positive', 'negative'].flatMap(f => JSON.parse(readFileSync(`experiments/blueprint-floor/controls/${f}.json`, 'utf8')).rules)];

/** A rule whose only readable fields are the four the builders may read; touching any other field throws. */
const guarded = rule => new Proxy(rule, { get(target, key) {
  if (typeof key === 'symbol' || ['ruleId', 'text', 'inputKind', 'flags', 'context'].includes(key)) return target[key];
  throw new Error(`the prompt builder read the forbidden field ${String(key)}`);
} });

test('blindness: the builders read only {ruleId, text, inputKind, flags, context} of every census rule', () => {
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

// Refute r2 B1 / r3 B1: an /i rule is case-insensitive by construction (its input is lower-cased), and no pattern may carry an
// upper-case literal letter. The attacks of refute r3 are replayed here through the real adapter and bce 0.3.1.
const pv = id => loadRules('pi-verdict').rules.find(x => x.ruleId === id);
const sudo = pv('pi-verdict/bash/sudo'), gpf = pv('pi-verdict/bash/git-push-force');
const tcall = command => ({ tool_name: 'Bash', tool_input: { command } });
const fp = (id, pattern) => ({ id, type: 'forbiddenPattern', severity: 'high', pattern, path: '.floor/command.txt' });
const expressible = (rule, constraints, violating, compliant) => JSON.stringify({ ruleId: opaqueId(rule.ruleId), class: 'expressible', constraints, coverage: 'x', residual: null, probes: { violating, compliant }, rationale: 'r' });
const G = ['gi', 't pu', 'sh'].join('');

test('refute r3 B1: the flags check refuses any upper-case literal letter; escapes and group names are not literals', () => {
  assert.deepEqual(FLAG_HANDLING, { i: 'folded', g: 'no-effect', d: 'no-effect' });
  assert.deepEqual(unverifiableFlags('gimsuy'), ['m', 's', 'u', 'y']);
  assert.deepEqual(upperCaseLiterals('\\bsudo\\b'), []);
  assert.deepEqual(upperCaseLiterals('\\B\\W\\S\\D\\b\\d\\w\\s\\n\\r\\t\\f\\v\\0\\x61\\u00e9\\u{1F600}\\cM(?<Name>a)(?<=b)(?<!c)'), []);
  for (const bad of ['\\bS[uU]D[oO]\\b', '\\b(?:sudo|SUDO|SuDo)\\b', '[A-Z]+', '[sS]udo', 'SUDO']) assert(upperCaseLiterals(bad).length > 0, bad);
  assert.equal(checkFlags([fp('a', 'sudo'), { id: 'f', type: 'forbiddenFile', severity: 'high', path: 'X/**' }]).pass, true, 'only patterns are checked');
  assert.match(checkFlags([fp('a', 'SuDo')]).reason, /a \(S D\)/);
});

test('refute r3 B1: r2\'s \\bsudo\\b now holds for an upper-case violating probe (folded); r3 attacks (b) and (c) are downgraded', LONG, async () => {
  assert.equal(sudo.flags, 'i');
  const r2 = await mechanicalChecks(sudo, expressible(sudo, [fp('s', '\\bsudo\\b')], tcall('SUDO ls'), tcall('ls')));
  assert.deepEqual([r2.flags.pass, r2.teeth.pass, r2.failedCheck, r2.classAfterMechanical], [true, true, null, 'expressible'], JSON.stringify(r2.teeth));
  const b = await mechanicalChecks(sudo, expressible(sudo, [fp('s', '\\bS[uU]D[oO]\\b')], tcall('SUDO ls'), tcall('ls')));
  assert.deepEqual([b.failedCheck, b.classAfterMechanical], ['flags', 'not']);
  const c = await mechanicalChecks(sudo, expressible(sudo, [fp('s', '\\b(?:sudo|SUDO|SuDo)\\b')], tcall('sudo ls'), tcall('ls')));
  assert.deepEqual([c.failedCheck, c.classAfterMechanical], ['flags', 'not']);
  const adj = buildAdjudicatorPrompt(sudo, '{}', b).user;
  assert(adj.includes(FLAGS_QUESTION('i')) && /"flags": "fail \(upper-case literal/.test(adj));
});

test('refute r3 B1 (a): two lower-case halves, each reddened alone by its own violating probe, match upper-case forms after folding', LONG, async () => {
  const halves = [fp('f', '\\bgit\\s+push\\b[^;|&]*\\s-f\\b'), fp('force', '\\bgit\\s+push\\b[^;|&]*--force\\b')];
  const ok = await mechanicalChecks(gpf, expressible(gpf, halves, [tcall(`${G} -f origin a`), tcall(`${G} --force origin b`)], tcall(`${G} origin main`)));
  assert.deepEqual([ok.failedCheck, ok.classAfterMechanical], [null, 'expressible'], JSON.stringify(ok.teeth));
  assert.deepEqual(ok.teeth.perConstraint, { f: true, force: true });
  for (const cmd of [`${G.toUpperCase()} -F origin a`, `${G} --FORCE origin b`]) assert.equal((await judge({ constraints: halves, inputKind: 'toolCall', input: tcall(cmd), finalClass: 'expressible', flags: 'i' })).decision, 'fail', cmd);
  const upper = await mechanicalChecks(gpf, expressible(gpf, [fp('f', '\\bgit\\s+push\\b[^;|&]*\\s-F\\b')], tcall(`${G} -F x`), tcall(`${G} x`)));
  assert.deepEqual([upper.failedCheck, upper.classAfterMechanical], ['flags', 'not']);
});

test('refute r3 N2: a vacuous constraint beside a real one is downgraded by per-constraint teeth', LONG, async () => {
  const m = await mechanicalChecks(sudo, expressible(sudo, [fp('real', '\\bsudo\\b'), fp('vacuous', 'zzz-never')], tcall('sudo ls'), tcall('ls')));
  assert.deepEqual([m.failedCheck, m.classAfterMechanical, m.teeth.perConstraint], ['teeth', 'not', { real: true, vacuous: false }]);
  assert.match(m.teeth.reason, /vacuous/);
});

test('refute r3 B1: judge on an /i rule folds the input: "SuDo ls" and "sUDO ls" fail an expressible \\bsudo\\b; without i they pass', LONG, async () => {
  for (const cmd of ['SuDo ls', 'sUDO ls']) {
    assert.equal((await judge({ constraints: [fp('s', '\\bsudo\\b')], inputKind: 'toolCall', input: tcall(cmd), finalClass: 'expressible', flags: 'i' })).decision, 'fail', cmd);
    assert.equal((await judge({ constraints: [fp('s', '\\bsudo\\b')], inputKind: 'toolCall', input: tcall(cmd), finalClass: 'expressible', flags: '' })).decision, 'pass', cmd);
  }
});

test('refute r3 B2: the record\'s adjudicator.input names every part the prompt builder sends', () => {
  const rec = JSON.parse(readFileSync('experiments/blueprint-floor/preregistration.json', 'utf8')).adjudicator.input;
  const mech = { schemaOk: true, vocabularyOk: true, validate: { ok: true }, teeth: { pass: true }, flags: { pass: true }, translatorClass: 'partial', classAfterMechanical: 'partial' };
  const user = buildAdjudicatorPrompt(sudo, '{"a":1}', mech).user;
  // Each part the builder emits, and the words the record uses for it.
  const parts = {
    'id: item-': 'opaque id', 'input kind:': 'input kind', 'its flags:': 'regex flags', '<<<RULE': 'verbatim text', 'Translator answer (verbatim)': 'translator\'s answer verbatim',
    [FLAGS_QUESTION('i')]: 'flag-semantics sentence', 'The stated class to confirm or dispute': 'stated class to confirm or dispute',
  };
  for (const [marker, words] of Object.entries(parts)) { assert(user.includes(marker), marker); assert(rec.includes(words), words); }
  const summary = JSON.parse(user.split('Mechanical checks:\n')[1].split('\n\n')[0]);
  const keyWords = { schemaValid: 'schema', typesInVocabulary: 'vocabulary', checkerValidation: 'checker\'s validation', teeth: 'teeth', flags: 'flags check', translatorClass: 'translator\'s class', classAfterMechanicalChecks: 'class after the checks' };
  assert.deepEqual(Object.keys(summary).sort(), Object.keys(keyWords).sort(), 'a new summary field must be named in the record');
  for (const w of Object.values(keyWords)) assert(rec.includes(w), w);
  assert(rec.includes('system prompt'));
});

test('refute r4 N1: dead alternatives that decode to or name upper case are refused (\\R\\M, \\p{Lu}, \\x44..., Doas)', LONG, async () => {
  for (const p of ['\\bsudo\\b|\\R\\M', '\\bsudo\\b|\\p{Lu}x', '\\bsudo\\b|\\x44\\x4f\\x41\\x53', '\\bsudo\\b|Doas', '\\bsudo\\b|\\u0044', '\\bsudo\\b|\\u{44}', '\\bsudo\\b|\\k<x>']) {
    assert(upperCaseLiterals(p).length > 0, p);
  }
  for (const p of ['\\bsudo\\b|\\R\\M', '\\bsudo\\b|\\p{Lu}x', '\\bsudo\\b|\\x44\\x4f\\x41\\x53', '\\bsudo\\b|Doas']) {
    const m = await mechanicalChecks(sudo, expressible(sudo, [fp('s', p)], tcall('sudo ls'), tcall('ls')));
    assert.deepEqual([m.failedCheck, m.classAfterMechanical], ['flags', 'not'], p);
  }
});

test('refute r4 B1: the /i adjudicator prompt states the folding; a rule with other flags only is asked about them; the reason is shown', () => {
  const mech = { schemaOk: true, vocabularyOk: true, validate: { ok: true }, teeth: { pass: true }, flags: { pass: true, reason: 'every pattern is lower case with no upper-case escape' }, translatorClass: 'expressible', classAfterMechanical: 'expressible' };
  const i = buildAdjudicatorPrompt(sudo, '{}', mech).user;
  assert(i.includes(FOLDING_SENTENCE));
  assert(i.includes('"flags": "pass (every pattern is lower case with no upper-case escape)"'));
  const m = buildAdjudicatorPrompt({ ...sudo, ruleId: 'test/m', flags: 'm' }, '{}', mech).user;
  assert(!m.includes(FOLDING_SENTENCE));
  assert.match(m, /has the flags "m"/);
  assert(!buildAdjudicatorPrompt(loadRules('limpet').rules[0], '{}', mech).user.includes(FOLDING_SENTENCE));
});

test('refute r4 B2: every sentence about case in the translator contract and prompt agrees with the flags check', () => {
  const texts = [CONTRACT_FILES['plugin-surface'], CONTRACT_FILES['typescript-module-graph'], PROMPT_FILES.translator].map(f => readFileSync(f, 'utf8'));
  const all = texts.join('\n');
  assert(!/so write case variants into the pattern itself\)/.test(all), 'the unconditional wording is gone');
  const sentences = all.split(/(?<=\.)\s+/).filter(x => /\bcase\b|lower-cased|upper-case|lower case/i.test(x));
  assert(sentences.length >= 3);
  for (const x of sentences) {
    if (/case variants/.test(x)) assert.match(x, /WITHOUT the i flag/, x);
    if (/lower-cased|lower case/.test(x)) assert.match(x, /i flag|flags include i|lower-cased/, x);
  }
  assert(readFileSync(CONTRACT_FILES['plugin-surface'], 'utf8').includes('"pattern": "\\\\btodo\\\\b"'), 'a lower-case example');
});

test('refute r5 B1: the "Applies to" context is shown to both models, and names no plugin, stratum or rule id', () => {
  const withCtx = allRules.filter(r => r.context);
  assert(withCtx.length >= 150, `${withCtx.length} rules carry a context`);
  const scoped = loadRules('abide').rules.filter(r => r.withheld.scope !== undefined);
  assert.equal(scoped.length, 13);
  for (const r of scoped) assert.match(r.context, /Applies only to files matching: /, r.ruleId);
  const s1 = pv('pi-verdict/path/S1-01'), s0 = pv('pi-verdict/path/S0-01'), bash = pv('pi-verdict/bash/sudo');
  assert.match(s1.context, /resolved absolute path.*It blocks only when the tool writes to that path; reads are not blocked\./);
  assert(!/writes to that path; reads/.test(s0.context), 'S0 blocks reads too');
  assert.equal(bash.context, 'The pattern is tested against the shell command text of a bash tool call.');
  const mech = { schemaOk: true, vocabularyOk: true, validate: { ok: true }, teeth: { pass: true }, flags: { pass: true, reason: 'x' }, translatorClass: 'partial', classAfterMechanical: 'partial' };
  assert(buildTranslatorPrompt(s1).user.includes(`Applies to: ${s1.context}`));
  assert(buildAdjudicatorPrompt(s1, '{}', mech).user.includes(`Applies to: ${s1.context}`));
  assert(!buildTranslatorPrompt(loadRules('abide').rules.find(r => r.context === null)).user.includes('Applies to:'));
  const word = w => new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[-]/g, '\\-')}($|[^A-Za-z0-9])`, 'i');
  for (const r of withCtx) {
    for (const name of PLUGIN_NAMES) assert(!word(name).test(r.context), `${r.ruleId}: plugin name in context`);
    for (const w of STRATUM_WORDS) assert(!word(w).test(r.context), `${r.ruleId}: ${w} in context`);
    for (const seg of r.ruleId.split('/').filter(x => x.length >= 3 && !(x.toLowerCase() in TEMPLATE_WORDS))) assert(!word(seg).test(r.context), `${r.ruleId}: segment ${seg} in context`);
  }
  assert(loadRules('abide').rules.some(r => (r.context ?? '').includes('<tool>-hook.ts')), 'a glob naming the plugin shows <tool>');
});

test('refute r5 adopted: a class range that reaches A-Z without covering a-z is refused; [!-~] is allowed', () => {
  for (const p of ['[@-\\[]', '[\\x40-\\x5b]', '[a-zA-Z]', '[\\u0041-\\u005a]']) assert.equal(checkFlags([fp('a', p)]).pass, false, p);
  for (const p of ['[!-~]', '[a-z0-9_]', '[\\d-z]', 'x[^\\]]y']) assert.equal(checkFlags([fp('a', p)]).pass, true, p);
  assert.deepEqual(upperRanges('[@-\\[]'), [[0x40, 0x5b]]);
});

test('refute r5 adopted: an unverifiable flag with no residual caps the class at not, with a residual at partial', LONG, async () => {
  const m = { ...sudo, ruleId: 'test/m', flags: 'm' };
  const none = await mechanicalChecks(m, JSON.stringify({ ruleId: opaqueId('test/m'), class: 'expressible', constraints: [fp('s', '\\bsudo\\b')], coverage: 'x', residual: null, probes: { violating: tcall('sudo ls'), compliant: tcall('ls') }, rationale: 'r' }));
  assert.deepEqual([none.failedCheck, none.classAfterMechanical], ['flags-unverifiable', 'not']);
});
