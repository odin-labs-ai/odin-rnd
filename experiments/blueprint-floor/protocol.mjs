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
import { CLASSES, INPUT_KINDS, VOCABULARY, buildBlueprint, checkVocabulary, teeth, validateBlueprint } from './adapter.mjs';

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

// Regex flags (refute r2 B1, redesigned after refute r3 B1). How each flag of a source regex is handled:
//   i        case-insensitive BY CONSTRUCTION: the adapter lower-cases an /i rule's input before the checker runs (foldsCase in
//            adapter.mjs), and the flags check below refuses any forbiddenPattern with an upper-case literal letter, which could
//            never match folded text;
//   g, d     no effect on whether one line matches from its start (g's lastIndex state and d's indices change no verdict);
//   m, s, u, v, y and any other flag
//            cannot be verified mechanically (the checker matches each line with a flag-free pattern): a rule with one of
//            them can be at most partial by the mechanical rule, recorded as failedCheck "flags-unverifiable".
export const FLAG_HANDLING = { i: 'folded', g: 'no-effect', d: 'no-effect' };
export const unverifiableFlags = flags => [...new Set([...(flags ?? '')])].filter(f => !FLAG_HANDLING[f]);
const isUpper = ch => ch !== ch.toLowerCase();

/**
 * The upper-case literal letters of a regex source: every letter that the pattern would have to match in upper case. Skipped:
 * escape sequences (\B \W \S \D \b \p{...} \P{...} \u.... \u{...} \x.. \cX \k<name> and any other \X), and group names
 * ((?<Name>...)). Everything else counts, inside or outside a character class, so [A-Z] and [sS] are refused too.
 */
export function upperCaseLiterals(source) {
  const found = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const n = source[i + 1];
      if ((n === 'p' || n === 'P' || n === 'u' || n === 'k') && (source[i + 2] === '{' || source[i + 2] === '<')) { i = source.indexOf(source[i + 2] === '{' ? '}' : '>', i + 2); if (i < 0) break; continue; }
      if (n === 'u') { i += 5; continue; }
      if (n === 'x') { i += 3; continue; }
      if (n === 'c') { i += 2; continue; }
      i += 1; continue;
    }
    if (ch === '(' && source.startsWith('(?<', i) && !source.startsWith('(?<=', i) && !source.startsWith('(?<!', i)) { i = source.indexOf('>', i); if (i < 0) break; continue; }
    if (isUpper(ch)) found.push({ at: i, ch });
  }
  return found;
}

/** The /i flags check: no forbiddenPattern may carry an upper-case literal letter (the input it sees is lower-cased). */
export function checkFlags(constraints) {
  const bad = constraints.filter(c => c.type === 'forbiddenPattern').map(c => ({ id: c.id, upper: upperCaseLiterals(c.pattern ?? '').map(u => u.ch) })).filter(x => x.upper.length);
  return bad.length ? { pass: false, bad, reason: `upper-case literal letters in ${bad.map(b => `${b.id} (${b.upper.join('')})`).join(', ')}; the input is lower-cased, so they can never match` } : { pass: true, bad: [], reason: 'every pattern is lower case' };
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
    const violatingOk = v => obj(v) || (Array.isArray(v) && v.length > 0 && v.every(obj));
    if (decides && !(obj(out.probes) && violatingOk(out.probes.violating) && obj(out.probes.compliant))) errors.push(`${out.class} needs probes.violating (an input, or a non-empty list of inputs) and a probes.compliant input`);
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
 * The mechanical checks ($0, code): schema, vocabulary, the checker's own validation, for a regex rule with /i the flags
 * check (no upper-case literal; the input is folded), then teeth through the adapter (per constraint too, folded for /i);
 * a flag the checks cannot verify caps the class at partial. The
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
  if (f.flags && f.flags.includes('i')) {
    result.flags = checkFlags(out.constraints);
    if (!result.flags.pass) return fail('flags');
  }
  result.teeth = await teeth(out.constraints, out.probes, { inputKind: f.inputKind, ruleId: f.ruleId, role, flags: f.flags });
  if (!result.teeth.pass) return fail('teeth');
  const cannot = unverifiableFlags(f.flags);
  if (cannot.length && translatorClass === 'expressible') return { ...result, failedCheck: 'flags-unverifiable', unverifiableFlags: cannot, classAfterMechanical: 'partial', engineLimit: false };
  return { ...result, classAfterMechanical: translatorClass, engineLimit: false };
}

export const VOCABULARY_TYPES = VOCABULARY;
