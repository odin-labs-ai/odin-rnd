// EXP 007 WO-1-03: the census protocol as code: the prompt builders (what a translator and an adjudicator see), the
// output schemas, and the mechanical checks that can only lower a class. protocol.md states the same in prose.
//
// Blindness (R2-3, refute r1 B2): a builder reads exactly five fields of a rule, {ruleId, text, inputKind, flags, context}, and the
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

/** The only fields of a rule any prompt may carry (refute r5 B1 added context: the rule's match target and application condition). */
export function promptFields(rule) {
  const { ruleId, text, inputKind, flags, context } = rule;
  if (typeof ruleId !== 'string' || typeof text !== 'string' || !INPUT_KINDS.includes(inputKind)) throw new Error('a rule needs ruleId, text and a known inputKind');
  return { ruleId, text, inputKind, flags: typeof flags === 'string' ? flags : null, context: typeof context === 'string' && context.trim() ? context : null };
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

const ruleBlock = ({ ruleId, text, inputKind, flags, context }) => [
  `id: ${opaqueId(ruleId)}`,
  `input kind: ${inputKind}`,
  ...(context !== null ? [`Applies to: ${context}`] : []),
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
    ...(f.flags ? { flags: mechanical.flags ? `${mechanical.flags.pass ? 'pass' : 'fail'} (${mechanical.flags.reason})` : 'not run' } : {}),
    translatorClass: mechanical.translatorClass,
    classAfterMechanicalChecks: mechanical.classAfterMechanical,
  };
  return {
    systemPromptFile: PROMPT_FILES.adjudicator,
    user: `${ruleBlock(f)}\n\nTranslator answer (verbatim):\n<<<ANSWER\n${translatorRaw}\nANSWER>>>\n\nMechanical checks:\n${JSON.stringify(m, null, 2)}\n\n${f.flags ? `${FLAGS_QUESTION(f.flags)}\n\n` : ''}The stated class to confirm or dispute: ${m.classAfterMechanicalChecks}`,
  };
}

/** The adjudicator's sentence on flags, shown only for a regex rule that has flags (refute r4 B1). For i it states the
 * construction; for any other flag present it asks whether the constraints preserve that flag's meaning. */
export const FOLDING_SENTENCE = 'For this rule the input is lower-cased before the checker runs, and any pattern containing an upper-case letter was already refused; judge the constraints against lower-cased input.';
export const FLAGS_QUESTION = flags => {
  const others = [...new Set([...flags])].filter(f => f !== 'i').join('');
  return [
    ...(flags.includes('i') ? [FOLDING_SENTENCE] : []),
    ...(others ? [`The rule's regular expression ${flags.includes('i') ? 'also has' : 'has'} the flags "${others}", and the checker compiles every pattern without flags: say whether the constraints preserve what those flags mean on every input, and dispute the class if they do not.`] : []),
  ].join(' ');
};

// Regex flags (refute r2 B1, redesigned after refute r3 B1). How each flag of a source regex is handled:
//   i        case-insensitive BY CONSTRUCTION: the adapter lower-cases an /i rule's input before the checker runs (foldsCase in
//            adapter.mjs), and the flags check below refuses any forbiddenPattern with an upper-case literal letter, which could
//            never match folded text;
//   g, d     no effect on whether one line matches from its start (g's lastIndex state and d's indices change no verdict);
//   m, s, u, v, y and any other flag
//            cannot be verified mechanically (the checker matches each line with a flag-free pattern): a rule with one of
//            them cannot stay expressible: an expressible answer (no residual) drops to not, and it reaches partial only when
//            the translator answers partial with a residual; recorded as failedCheck "flags-unverifiable".
export const FLAG_HANDLING = { i: 'folded', g: 'no-effect', d: 'no-effect' };
export const unverifiableFlags = flags => [...new Set([...(flags ?? '')])].filter(f => !FLAG_HANDLING[f]);
const isUpper = ch => ch !== ch.toLowerCase();

/**
 * What an /i rule's pattern may not contain (refute r3 B1, widened in refute r4 N1), because it could never match lower-cased
 * input or cannot be shown not to: every upper-case literal letter, inside or outside a character class (so [A-Z] and [sS]
 * too); a \\x.., \\u.... or \\u{...} escape that decodes to an upper-case letter; an identity escape of a letter (\\R, \\M, ...:
 * any backslash + letter other than the classes and assertions \\b \\B \\d \\D \\w \\W \\s \\S, the controls \\n \\r \\t \\f \\v,
 * \\0, and the code escapes \\x \\u \\c); and any \\p, \\P or \\k escape. Group names ((?<Name>...)) are not literals.
 */
const ESCAPE_OK = new Set([...'bBdDwWsSnrtfv0']);
export function upperCaseLiterals(source) {
  const found = [];
  const hit = (at, ch, why) => found.push({ at, ch, why });
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const n = source[i + 1];
      if (n === undefined) break;
      if (n === 'p' || n === 'P' || n === 'k') { hit(i, `\\${n}`, 'property or named-reference escape'); i += 1; continue; }
      if (n === 'x') { const cp = parseInt(source.slice(i + 2, i + 4), 16); if (isUpper(String.fromCodePoint(cp || 0))) hit(i, source.slice(i, i + 4), 'escape decodes to an upper-case letter'); i += 3; continue; }
      if (n === 'u') {
        const braced = source[i + 2] === '{';
        const end = braced ? source.indexOf('}', i + 2) : i + 5;
        const cp = parseInt(braced ? source.slice(i + 3, end) : source.slice(i + 2, i + 6), 16);
        if (Number.isFinite(cp) && isUpper(String.fromCodePoint(cp))) hit(i, source.slice(i, end + 1), 'escape decodes to an upper-case letter');
        i = end; continue;
      }
      if (n === 'c') { i += 2; continue; }
      if (/[A-Za-z]/.test(n) && !ESCAPE_OK.has(n)) { hit(i, `\\${n}`, 'identity escape of a letter'); i += 1; continue; }
      i += 1; continue;
    }
    if (ch === '(' && source.startsWith('(?<', i) && !source.startsWith('(?<=', i) && !source.startsWith('(?<!', i)) { i = source.indexOf('>', i); if (i < 0) break; continue; }
    if (isUpper(ch)) hit(i, ch, 'upper-case literal');
  }
  return found;
}

/**
 * Character-class ranges of a regex source as [lo, hi] code points (escapes \\xHH, \\uHHHH, \\u{...} and single escaped or literal
 * characters decoded; class escapes such as \\d or \\w end no range). Used to refuse a range that reaches upper case.
 */
export function classRanges(source) {
  const ranges = [];
  const atom = (i) => {
    if (source[i] !== '\\') return { cp: source.codePointAt(i), end: i + String.fromCodePoint(source.codePointAt(i)).length };
    const n = source[i + 1];
    if (n === 'x') return { cp: parseInt(source.slice(i + 2, i + 4), 16), end: i + 4 };
    if (n === 'u' && source[i + 2] === '{') { const e = source.indexOf('}', i); return { cp: parseInt(source.slice(i + 3, e), 16), end: e + 1 }; }
    if (n === 'u') return { cp: parseInt(source.slice(i + 2, i + 6), 16), end: i + 6 };
    if (/[dDwWsSpP]/.test(n)) return { cp: null, end: n === 'p' || n === 'P' ? source.indexOf('}', i) + 1 : i + 2 };
    return { cp: n.codePointAt(0), end: i + 2 };
  };
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] !== '[') continue;
    let j = i + 1;
    if (source[j] === '^') j++;
    while (j < source.length && source[j] !== ']') {
      const a = atom(j);
      if (source[a.end] === '-' && source[a.end + 1] !== ']' && a.end + 1 < source.length) {
        const b = atom(a.end + 1);
        if (a.cp !== null && b.cp !== null) ranges.push([a.cp, b.cp]);
        j = b.end;
      } else j = a.end;
    }
    i = j;
  }
  return ranges;
}
/** A range that reaches A-Z is refused unless it also covers all of a-z (so [!-~] is allowed, [@-\\[] is not). */
export const upperRanges = source => classRanges(source).filter(([lo, hi]) => lo <= 0x5a && hi >= 0x41 && !(lo <= 0x61 && hi >= 0x7a));

/** The /i flags check: no forbiddenPattern may carry an upper-case literal letter (the input it sees is lower-cased). */
export function checkFlags(constraints) {
  const bad = constraints.filter(c => c.type === 'forbiddenPattern').map(c => ({ id: c.id, upper: [...upperCaseLiterals(c.pattern ?? '').map(u => u.ch), ...upperRanges(c.pattern ?? '').map(([lo, hi]) => `range ${lo.toString(16)}-${hi.toString(16)}`)] })).filter(x => x.upper.length);
  return bad.length ? { pass: false, bad, reason: `upper-case literal or unverifiable escape in ${bad.map(b => `${b.id} (${b.upper.join(' ')})`).join(', ')}; the input is lower-cased, so it can never match` } : { pass: true, bad: [], reason: 'every pattern is lower case with no upper-case escape' };
}

const ORDER_OF = c => ['not', 'partial', 'expressible'].indexOf(c);
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
    // severity is optional and ignored: the adapter runs every constraint at one severity (refute r8 B2).
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
 * a flag the checks cannot verify drops an expressible answer to not (partial needs the translator's residual). The
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
  // A pinned cap from the rule's source group (refute r6 N4: pi-verdict's write-only path tiers are at most partial).
  if (rule.maxClass && ORDER_OF(translatorClass) > ORDER_OF(rule.maxClass)) return { ...result, failedCheck: 'max-class', maxClass: rule.maxClass, classAfterMechanical: rule.maxClass === 'partial' && typeof out.residual === 'string' && out.residual.trim() ? 'partial' : 'not', engineLimit: false };
  const cannot = unverifiableFlags(f.flags);
  if (cannot.length && translatorClass === 'expressible') return { ...result, failedCheck: 'flags-unverifiable', unverifiableFlags: cannot, classAfterMechanical: typeof out.residual === 'string' && out.residual.trim() ? 'partial' : 'not', engineLimit: false };
  return { ...result, classAfterMechanical: translatorClass, engineLimit: false };
}

export const VOCABULARY_TYPES = VOCABULARY;
