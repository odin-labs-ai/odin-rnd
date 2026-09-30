// EXP 007 WO-1-03: the census protocol as code: the prompt builders (what a translator and an adjudicator see), the
// output schemas, and the mechanical checks that can only lower a class. protocol.md states the same in prose.
//
// Blindness (R2-3, refute r1 B2): a builder reads exactly four fields of a rule, {ruleId, text, inputKind, flags}, and the
// prompt shows the ruleId only as an opaque id (opaqueId below). Every other field
// (withheld, the source line, the stratum, abide's check.type, any label) is never read here, and a test proves it by
// handing the builders a rule whose other fields throw when touched. No case, label or result reaches a prompt.
// No model is called here; the runner that spawns one is bundle 2's.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES, INPUT_KINDS, VOCABULARY, buildBlueprint, checkVocabulary, runFloor, teeth, validateBlueprint } from './adapter.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const DIR = 'experiments/blueprint-floor';
export const PROMPT_FILES = { translator: `${DIR}/prompts/translator.md`, adjudicator: `${DIR}/prompts/adjudicator.md` };
export const CONTRACT_FILES = { 'plugin-surface': `${DIR}/contract.md`, 'typescript-module-graph': `${DIR}/contract-module-graph.md` };
const read = rel => readFileSync(join(HERE, '..', '..', rel), 'utf8');
export const sha256 = text => createHash('sha256').update(text).digest('hex');

// The positive controls are the only rules graded on the module graph (R2-6); every other rule is plugin-surface.
const POSITIVE_CONTROL_IDS = new Set(JSON.parse(read(`${DIR}/controls/positive.json`)).rules.map(r => r.ruleId));
export const profileFor = ruleId => (POSITIVE_CONTROL_IDS.has(ruleId) ? 'typescript-module-graph' : 'plugin-surface');
export const roleFor = ruleId => (POSITIVE_CONTROL_IDS.has(ruleId) ? 'control' : 'plugin');

/** The only fields of a rule any prompt may carry. */
export function promptFields(rule) {
  const { ruleId, text, inputKind, flags } = rule;
  if (typeof ruleId !== 'string' || typeof text !== 'string' || !INPUT_KINDS.includes(inputKind)) throw new Error('a rule needs ruleId, text and a known inputKind');
  return { ruleId, text, inputKind, flags: typeof flags === 'string' ? flags : null };
}

// Opaque prompt ids (refute r1 B2): a prompt never carries the ruleId, which names the plugin, the source and the stratum.
// It carries item-<first 12 hex of sha256("exp007-census-v1:" + ruleId)>; the runner maps it back with ruleIdFor.
export const OPAQUE_PREFIX = 'exp007-census-v1:';
export const opaqueId = ruleId => `item-${sha256(OPAQUE_PREFIX + ruleId).slice(0, 12)}`;
/** The ruleId behind an opaque id, among `ruleIds`; throws on no match or a collision. */
export function ruleIdFor(id, ruleIds) {
  const hits = ruleIds.filter(r => opaqueId(r) === id);
  if (hits.length !== 1) throw new Error(`opaque id ${id} maps to ${hits.length} rules`);
  return hits[0];
}
/** Every opaque id of a census is distinct (checked before any run). */
export function assertOpaqueIdsDistinct(ruleIds) {
  const ids = ruleIds.map(opaqueId);
  if (new Set(ids).size !== ids.length) throw new Error('two rules share an opaque id');
  return ids;
}

const ruleBlock = ({ ruleId, text, inputKind, flags }) => [
  `id: ${opaqueId(ruleId)}`,
  `input kind: ${inputKind}`,
  ...(flags !== null ? [`this rule is a regular expression; its flags: ${flags === '' ? '(none)' : flags}`] : []),
  'rule text (verbatim, between the markers):',
  '<<<RULE',
  text,
  'RULE>>>',
].join('\n');

/** The translator's messages: the pinned system prompt file and the user message. */
export function buildTranslatorPrompt(rule) {
  const f = promptFields(rule);
  const contract = read(CONTRACT_FILES[profileFor(f.ruleId)]);
  return { systemPromptFile: PROMPT_FILES.translator, user: `${ruleBlock(f)}\n\n${contract}` };
}

/** The adjudicator's messages: the rule, the translator's raw answer and the mechanical results. Nothing else. */
export function buildAdjudicatorPrompt(rule, translatorRaw, mechanical) {
  const f = promptFields(rule);
  if (typeof translatorRaw !== 'string') throw new Error('the adjudicator sees the translator answer as the raw text it returned');
  const m = {
    schemaValid: mechanical.schemaOk,
    typesInVocabulary: mechanical.vocabularyOk,
    checkerValidation: mechanical.validate ? (mechanical.validate.ok ? 'pass' : mechanical.validate.engineLimit ? 'refused by the checker\'s regex guard' : 'fail') : 'not run',
    teeth: mechanical.teeth ? (mechanical.teeth.pass ? 'pass' : `fail (${mechanical.teeth.reason})`) : 'not run',
    ...(f.flags ? { flags: mechanical.flags ? (mechanical.flags.pass ? 'pass' : `fail (${mechanical.flags.reason})`) : 'not run' } : {}),
    translatorClass: mechanical.translatorClass,
    classAfterMechanicalChecks: mechanical.classAfterMechanical,
  };
  return {
    systemPromptFile: PROMPT_FILES.adjudicator,
    user: `${ruleBlock(f)}\n\nTranslator answer (verbatim):\n<<<ANSWER\n${translatorRaw}\nANSWER>>>\n\nMechanical checks:\n${JSON.stringify(m, null, 2)}\n\n${f.flags ? `${FLAGS_QUESTION(f.flags)}\n\n` : ''}The stated class to confirm or dispute: ${m.classAfterMechanicalChecks}`,
  };
}

/** The adjudicator's one sentence on flags, shown only for a regex rule that has flags. */
export const FLAGS_QUESTION = flags => `The rule's regular expression has the flags "${flags}", and the checker compiles every pattern without flags: say whether the constraints preserve what those flags mean on every input, and dispute the class if they do not.`;

// Regex flags (refute r2 B1). How each flag of a source regex is handled by the mechanical checks:
//   i        checked: every forbiddenPattern must still fail the violating probe with its matched text upper-cased and in
//            mixed case, and must still pass the compliant probe with every string's case swapped (checkFlags below);
//   g, d     no effect on whether one line matches from its start (g's lastIndex state and d's indices change no verdict);
//   m, s, u, v, y and any other flag
//            cannot be verified mechanically (the checker matches each line with a flag-free pattern): a rule with one of
//            them can be at most partial by the mechanical rule, recorded as failedCheck "flags-unverifiable".
export const FLAG_HANDLING = { i: 'checked', g: 'no-effect', d: 'no-effect' };
export const unverifiableFlags = flags => [...new Set([...(flags ?? '')])].filter(f => !FLAG_HANDLING[f]);

const upper = s => s.toUpperCase();
const mixed = s => { let k = 0; return [...s].map(ch => (ch.toLowerCase() !== ch.toUpperCase() ? (k++ % 2 ? ch.toLowerCase() : ch.toUpperCase()) : ch)).join(''); };
const swap = s => [...s].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');
/** Apply `fn` to every string VALUE in a probe (keys untouched). */
export const mapStrings = (v, fn) => (typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map(x => mapStrings(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])) : v);
/** Re-case only the text a pattern matches, in every string of the probe. */
export const recaseMatches = (probe, pattern, fn) => mapStrings(probe, s => s.replace(new RegExp(pattern, 'g'), m => fn(m)));
export const CASE_VARIANTS = { upper, mixed, swap };

/**
 * The /i check. For each forbiddenPattern constraint: the violating probe with that pattern's matched text upper-cased, and
 * again in mixed case, must still make the constraint set FAIL; the compliant probe with every string's case swapped must
 * still PASS. Real adapter, real bce 0.3.1.
 */
export async function checkFlags(constraints, probes, { inputKind, ruleId, role }) {
  const runs = [];
  try {
    for (const c of constraints.filter(x => x.type === 'forbiddenPattern')) {
      for (const [name, fn] of [['upper', upper], ['mixed', mixed]]) {
        const r = await runFloor({ ruleId, constraints, inputKind, input: recaseMatches(probes.violating, c.pattern, fn), role });
        runs.push({ constraint: c.id, probe: `violating-${name}`, label: r.label });
        if (r.label !== 'RED') return { pass: false, runs, reason: `violating probe with /${c.pattern}/'s match in ${name} case is ${r.label}` };
      }
    }
    const r = await runFloor({ ruleId, constraints, inputKind, input: mapStrings(probes.compliant, swap), role });
    runs.push({ probe: 'compliant-swapped', label: r.label });
    if (r.label !== 'GREEN') return { pass: false, runs, reason: `compliant probe with its case swapped is ${r.label}` };
    return { pass: true, runs, reason: 'case variants hold' };
  } catch (e) {
    return { pass: false, runs, reason: `${e.name ?? 'Error'}: ${String(e.message).split('\n')[0]}` };
  }
}

const str = v => typeof v === 'string';
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const TRANSLATOR_FIELDS = ['ruleId', 'class', 'constraints', 'coverage', 'residual', 'probes', 'rationale'];
const words = s => s.trim().split(/\s+/).filter(Boolean).length;

/** Parse a model's text answer: exactly one JSON object (a surrounding code fence is tolerated and recorded). */
export function parseAnswer(raw) {
  if (!str(raw)) return { ok: false, error: 'no text' };
  let text = raw.trim(), fenced = false;
  const m = /^```(?:json)?\n([\s\S]*)\n```$/.exec(text);
  if (m) { text = m[1]; fenced = true; }
  try { const value = JSON.parse(text); return obj(value) ? { ok: true, value, fenced } : { ok: false, error: 'not a JSON object' }; } catch (e) { return { ok: false, error: `not JSON: ${e.message}` }; }
}

/** The translator output schema (WO-1-03), checked in code. */
export function validateTranslatorOutput(out, rule) {
  const errors = [];
  if (!obj(out)) return { ok: false, errors: ['not an object'] };
  const extra = Object.keys(out).filter(k => !TRANSLATOR_FIELDS.includes(k));
  if (extra.length) errors.push(`unknown fields: ${extra.join(', ')}`);
  if (out.ruleId !== opaqueId(rule.ruleId)) errors.push('ruleId differs from the id the prompt gave');
  if (!CLASSES.includes(out.class)) errors.push('class is not expressible, partial or not');
  if (!Array.isArray(out.constraints) || !out.constraints.every(obj)) errors.push('constraints is not an array of objects');
  if (!str(out.coverage)) errors.push('coverage is not a string');
  if (!(out.residual === null || (str(out.residual) && out.residual.trim()))) errors.push('residual is not null or a non-empty string');
  if (!str(out.rationale) || words(out.rationale) > 80) errors.push('rationale is missing or over 80 words');
  if (CLASSES.includes(out.class)) {
    const decides = out.class !== 'not';
    if ((out.class === 'expressible') !== (out.residual === null)) errors.push('residual must be null exactly when class is expressible');
    if (decides && !(Array.isArray(out.constraints) && out.constraints.length)) errors.push(`${out.class} needs constraints`);
    if (!decides && Array.isArray(out.constraints) && out.constraints.length) errors.push('not must have no constraints');
    if (decides && !(obj(out.probes) && obj(out.probes.violating) && obj(out.probes.compliant))) errors.push(`${out.class} needs probes.violating and probes.compliant objects`);
    if (!decides && out.probes !== null) errors.push('not must have probes null');
  }
  if (Array.isArray(out.constraints)) {
    const ids = out.constraints.map(c => c?.id);
    if (ids.some(id => !str(id) || !id) || new Set(ids).size !== ids.length) errors.push('every constraint needs a unique string id');
    if (out.constraints.some(c => !['info', 'low', 'medium', 'high', 'critical'].includes(c?.severity))) errors.push('every constraint needs a severity');
  }
  return { ok: errors.length === 0, errors };
}

export function validateAdjudicatorOutput(out, rule) {
  const errors = [];
  if (!obj(out)) return { ok: false, errors: ['not an object'] };
  const extra = Object.keys(out).filter(k => !['ruleId', 'verdict', 'proposedClass', 'reason'].includes(k));
  if (extra.length) errors.push(`unknown fields: ${extra.join(', ')}`);
  if (out.ruleId !== opaqueId(rule.ruleId)) errors.push('ruleId differs from the id the prompt gave');
  if (!['confirm', 'dispute'].includes(out.verdict)) errors.push('verdict is not confirm or dispute');
  if (!CLASSES.includes(out.proposedClass)) errors.push('proposedClass is not a class');
  if (!str(out.reason) || words(out.reason) > 80) errors.push('reason is missing or over 80 words');
  return { ok: errors.length === 0, errors };
}

/** One downgrade step (WO-1-03): expressible -> partial if a residual was given, else not; partial -> not. */
export function downgrade(cls, residualGiven) {
  if (cls === 'expressible') return residualGiven ? 'partial' : 'not';
  return 'not';
}

/**
 * The mechanical checks ($0, code): schema, vocabulary, the checker's own validation, teeth through the adapter, and for a
 * regex rule with /i the case check (checkFlags); a flag the checks cannot verify caps the class at partial. The
 * first failing check downgrades the class once and is recorded. A class that is already not is checked for schema only.
 * An answer that is not parseable JSON, or has no valid class, is a harness failure: class error (counted as not).
 */
export async function mechanicalChecks(rule, raw) {
  const f = promptFields(rule);
  const parsed = parseAnswer(raw);
  if (!parsed.ok || !CLASSES.includes(parsed.value.class)) return { translatorClass: 'error', classAfterMechanical: 'error', schemaOk: false, errors: [parsed.ok ? 'no valid class' : parsed.error], failedCheck: 'parse' };
  const out = parsed.value, translatorClass = out.class, role = roleFor(f.ruleId);
  const schema = validateTranslatorOutput(out, f);
  const result = { translatorClass, schemaOk: schema.ok, errors: schema.errors, fenced: parsed.fenced, vocabularyOk: null, validate: null, teeth: null, flags: null, failedCheck: null };
  const fail = check => ({ ...result, failedCheck: check, classAfterMechanical: translatorClass === 'not' ? 'not' : downgrade(translatorClass, typeof out.residual === 'string' && out.residual.trim().length > 0), engineLimit: check === 'validate' && Boolean(result.validate?.engineLimit) });
  if (!schema.ok) return fail('schema');
  if (translatorClass === 'not') return { ...result, classAfterMechanical: 'not', engineLimit: false };
  try { checkVocabulary(out.constraints, role); result.vocabularyOk = true; } catch (e) { result.vocabularyOk = false; result.errors = [...result.errors, e.message]; return fail('vocabulary'); }
  result.validate = validateBlueprint(buildBlueprint({ ruleId: f.ruleId, constraints: out.constraints, inputKind: f.inputKind, minFiles: 1, role }));
  if (!result.validate.ok) return fail('validate');
  result.teeth = await teeth(out.constraints, out.probes, { inputKind: f.inputKind, ruleId: f.ruleId, role });
  if (!result.teeth.pass) return fail('teeth');
  if (f.flags && f.flags.includes('i')) {
    result.flags = await checkFlags(out.constraints, out.probes, { inputKind: f.inputKind, ruleId: f.ruleId, role });
    if (!result.flags.pass) return fail('flags');
  }
  const cannot = unverifiableFlags(f.flags);
  if (cannot.length && translatorClass === 'expressible') return { ...result, failedCheck: 'flags-unverifiable', unverifiableFlags: cannot, classAfterMechanical: 'partial', engineLimit: false };
  return { ...result, classAfterMechanical: translatorClass, engineLimit: false };
}

export const VOCABULARY_TYPES = VOCABULARY;
