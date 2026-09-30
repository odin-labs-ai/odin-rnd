// EXP 007 WO-1-01: extract each plugin's own rules from its files at the pinned commit.
//
// Pure functions over file text. `extractPlugin(name, read)` takes a reader `read(relPath) -> string` over a clone of
// the plugin at its pin and returns the vendored rules record (experiments/blueprint-floor/rules/<plugin>.json).
// Every item of every source set is either a rule or an exclusion with a reason: an item that is neither throws, so
// a new question upstream can never be dropped silently. The CLI is scripts/blueprint-floor-rules.mjs.
import { createHash } from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Parse the JS string literal whose opening quote is at src[i]. Template literals with ${...} are refused. */
export function parseJsString(src, i) {
  const q = src[i];
  if (!['"', "'", '`'].includes(q)) throw new Error(`no string literal at ${i}: ${JSON.stringify(src.slice(i, i + 20))}`);
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const n = src[j + 1];
      const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '`': '`', '$': '$' };
      if (!(n in map)) throw new Error(`unsupported escape \\${n} at ${j}`);
      out += map[n]; j++; continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') throw new Error(`template placeholder at ${j}`);
    if (c === q) return { value: out, end: j + 1 };
    if (c === '\n' && q !== '`') throw new Error(`unterminated string at ${i}`);
    out += c;
  }
  throw new Error(`unterminated string at ${i}`);
}

/** Parse the JS regex literal whose opening slash is at src[i]: { source, flags, end }. */
export function parseRegexLiteral(src, i) {
  if (src[i] !== '/') throw new Error(`no regex literal at ${i}`);
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n') throw new Error(`unterminated regex at ${i}`);
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') {
      const flags = /^[a-z]*/.exec(src.slice(j + 1))[0];
      return { source: src.slice(i + 1, j), flags, end: j + 1 + flags.length };
    }
  }
  throw new Error(`unterminated regex at ${i}`);
}

const skipWs = (src, i) => { while (/\s/.test(src[i])) i++; return i; };
/** The first string literal after `marker` (searched from `from`). */
function stringAfter(src, marker, from) {
  const at = src.indexOf(marker, from);
  if (at < 0) throw new Error(`marker ${marker} not found after ${from}`);
  return { ...parseJsString(src, skipWs(src, at + marker.length)), at };
}
/** The line of the first line containing `needle` (exact substring), from `from`. */
function lineOfText(src, needle, from = 0) {
  const at = src.indexOf(needle, from);
  if (at < 0) throw new Error(`text not found: ${needle.slice(0, 60)}`);
  return lineOf(src, at);
}
/** The line of a JSON string value as serialised in the file (JSON.stringify of the value), after `from`. */
const jsonLine = (src, value, from = 0) => lineOfText(src, JSON.stringify(value), from);

// ------------------------------------------------------------------ the seeded sample (hunch secondary stratum)

/** mulberry32: a small, fixed PRNG so the sample is reproducible anywhere from the seed alone. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The sample: a Fisher-Yates shuffle of 0..n-1 driven by mulberry32(seed); the first `size`, in population order. */
export function sampleIndices(n, size, seed) {
  const rand = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, size).sort((a, b) => a - b);
}
export const SAMPLE = { size: 30, seed: 7007 };

// ------------------------------------------------------------------ per-plugin extractors

const rule = (r) => ({ ruleId: r.ruleId, sourcePath: r.sourcePath, line: r.line, kind: r.kind, text: r.text, flags: r.flags ?? null, context: null, inputKind: r.inputKind, stratum: r.stratum ?? 'primary', withheld: r.withheld ?? {} });
const excluded = (id, sourcePath, line, reason) => ({ id, sourcePath, line, reason });

function hunch(read) {
  const P = 'packages/core/src/presets.ts', src = read(P);
  const groups = [['recommended', 'hunch:recommended'], ['typescript', 'hunch:typescript'], ['rust', 'hunch:rust']];
  const rules = [];
  const starts = groups.map(([name]) => src.indexOf(`const ${name}: Record<string, RuleEntry> = {`));
  if (starts.some(s => s < 0)) throw new Error('hunch preset group not found');
  const end = src.indexOf('export const presets');
  for (const m of src.matchAll(/^\s*"([^"]+)": concern\(/gm)) {
    const g = starts.findLastIndex(s => s < m.index);
    if (g < 0 || m.index > end) throw new Error(`hunch preset ${m[1]} outside a group`);
    const instr = parseJsString(src, skipWs(src, m.index + m[0].length));
    let i = skipWs(src, instr.end); if (src[i] !== ',') throw new Error('hunch concern shape'); i = skipWs(src, i + 1);
    const message = parseJsString(src, i);
    i = skipWs(src, message.end);
    let files;
    if (src[i] === ',' && src[skipWs(src, i + 1)] === '[') {
      const open = skipWs(src, i + 1), close = src.indexOf(']', open);
      files = JSON.parse(src.slice(open, close + 1));
    }
    rules.push(rule({ ruleId: `hunch/${m[1]}`, sourcePath: P, line: lineOf(src, m.index + m[0].indexOf('"')), kind: 'question', text: instr.value, inputKind: 'diff',
      withheld: { preset: groups[g][1], message: message.value, ...(files ? { files } : {}), level: 'warn', threshold: 0.85, criteria: { true: 'The visible change provides concrete evidence of this problem.', false: 'The concern is absent, or the change is intentional and consistent with the visible contract.' } } }));
  }
  // The shared concern() wrapper's criteria and threshold are asserted to be the ones withheld above.
  if (!src.includes('threshold: 0.85') || !src.includes('"warn", noul({')) throw new Error('hunch concern() wrapper changed');
  // Secondary stratum: the spec rule files, sampled.
  const population = [];
  for (const f of ['bips', 'nips', 'nuts']) {
    const path = `rules/${f}-spec.json`, text = read(path), spec = JSON.parse(text);
    let from = text.indexOf('"rules"');
    for (const [key, v] of Object.entries(spec.rules)) {
      const at = text.indexOf(`${JSON.stringify(key)}: {`, from);
      if (at < 0) throw new Error(`hunch spec key ${key} not found in ${path}`);
      from = at;
      if (typeof v.noul !== 'string') throw new Error(`hunch spec ${key} has no noul text`);
      const { noul, ...rest } = v;
      population.push(rule({ ruleId: `hunch/spec/${f}/${key}`, sourcePath: path, line: lineOf(text, at), kind: 'question', text: noul, inputKind: 'diff', stratum: 'secondary', withheld: rest }));
    }
  }
  const sample = sampleIndices(population.length, SAMPLE.size, SAMPLE.seed).map(i => population[i]);
  return { rules: [...rules, ...sample], excluded: [], secondaryPopulation: { size: population.length, seed: SAMPLE.seed, sampleSize: SAMPLE.size, ruleIds: population.map(r => r.ruleId) }, sources: ['packages/core/src/presets.ts', 'rules/bips-spec.json', 'rules/nips-spec.json', 'rules/nuts-spec.json'] };
}

function jevPref(read) {
  const S = 'packages/jev-pref/src/suites/secrets.js', src = read(S), rules = [];
  const body = src.slice(src.indexOf('export function buildQuestions'), src.indexOf('const QUESTIONS ='));
  const off = src.indexOf('export function buildQuestions');
  for (const m of body.matchAll(/^\s+(sec_\w+): \{\s*\n\s+type: "(\w+)",/gm)) {
    const s = stringAfter(src, 'instructions:', off + m.index);
    rules.push(rule({ ruleId: `jev-pref/secrets/${m[1]}`, sourcePath: S, line: lineOf(src, off + m.index + m[0].indexOf(m[1])), kind: 'question', text: s.value, inputKind: 'diff', withheld: { suite: 'secrets', questionType: m[2], gate: true } }));
  }
  if (rules.length !== 2) throw new Error(`jev-pref secrets suite: expected its 2 questions, found ${rules.length}`);
  const R = 'jev-pref.json', text = read(R), cfg = JSON.parse(text);
  for (const p of cfg.prefs) {
    const { id, question, ...rest } = p;
    rules.push(rule({ ruleId: `jev-pref/prefs/${id}`, sourcePath: R, line: jsonLine(text, question), kind: 'question', text: question, inputKind: 'diff', withheld: rest }));
  }
  return { rules, excluded: [], sources: [S, R] };
}

function abide(read) {
  const A = '.abide/rubric.json', text = read(A), rubric = JSON.parse(text), rules = [];
  const kinds = { edit: 'diff', turn: 'stopTranscript' };
  for (const r of rubric.rules) {
    const { id, text: ruleText, source, when, ...rest } = r;
    const inputKind = when === null || when === undefined ? 'diff' : kinds[when];
    if (!inputKind) throw new Error(`abide rule ${id}: unknown when ${when}`);
    rules.push(rule({ ruleId: `abide/${id}`, sourcePath: A, line: jsonLine(text, ruleText), kind: 'rubric', text: ruleText, inputKind, withheld: { ...rest, when: when ?? null, upstreamSource: source } }));
  }
  return { rules, excluded: [], sources: [A] };
}

function limpet(read) {
  const L = 'rules.md', text = read(L), rules = [];
  let i = 0;
  text.split('\n').forEach((line, n) => {
    if (!line.startsWith('- ')) return;
    rules.push(rule({ ruleId: `limpet/r${i++}`, sourcePath: L, line: n + 1, kind: 'prose', text: line.slice(2), inputKind: 'stopTranscript' }));
  });
  return { rules, excluded: [], sources: [L] };
}

function jevBelay(read, sel) {
  const B = 'belay.mjs', src = read(B);
  const off = src.indexOf('export const QUESTIONS = {');
  const block = src.slice(off, src.indexOf('\n};', off));
  const ids = [...block.matchAll(/^ {2}(\w+): \{$/gm)].map(m => ({ id: m[1], line: lineOf(src, off + m.index + 2) }));
  const reasons = Object.fromEntries(sel.excluded.map(e => [e.id, e.reason]));
  for (const { id } of ids) if (!reasons[id]) throw new Error(`jev-belay question ${id} is neither a rule nor excluded`);
  if (ids.length !== sel.excluded.length) throw new Error('jev-belay exclusion list does not match QUESTIONS');
  return { rules: [], excluded: ids.map(({ id, line }) => excluded(`jev-belay/${id}`, B, line, reasons[id])), sources: [B] };
}

function jevEngineering(read, sel) {
  const P = 'policy.json', text = read(P), policy = JSON.parse(text), rules = [], ex = [];
  const reason = pat => sel.excluded.find(e => e.id === pat).reason;
  let from = text.indexOf('"hard_deny"');
  policy.hard_deny.forEach((h, i) => {
    const at = text.indexOf(`"pattern": ${JSON.stringify(h.pattern)}`, from); if (at < 0) throw new Error('hard_deny pattern not found'); from = at;
    rules.push(rule({ ruleId: `jev-engineering/hard-deny/${String(i + 1).padStart(2, '0')}`, sourcePath: P, line: lineOf(text, at), kind: 'regex', text: h.pattern, flags: '', inputKind: 'toolCall', withheld: { reason: h.reason, engine: 'python re.search' } }));
  });
  let fp = text.indexOf('"fast_path"');
  policy.fast_path.forEach((p, i) => { const at = text.indexOf(JSON.stringify(p), fp); fp = at; ex.push(excluded(`jev-engineering/fast-path/${String(i + 1).padStart(2, '0')}`, P, lineOf(text, at), reason('fast_path/*'))); });
  const qFrom = text.indexOf('"questions"');
  for (const [id, q] of Object.entries(policy.questions)) {
    const { instructions, ...rest } = q;
    rules.push(rule({ ruleId: `jev-engineering/policy/${id}`, sourcePath: P, line: jsonLine(text, instructions, qFrom), kind: 'question', text: instructions, inputKind: 'toolCall', withheld: rest }));
  }
  for (const pack of ['data', 'message', 'money', 'publish', 'shell']) {
    const path = `packs/${pack}.json`, ptext = read(path), p = JSON.parse(ptext);
    for (const [id, q] of Object.entries(p.questions)) {
      const line = jsonLine(ptext, q.instructions);
      if (pack === 'shell') { ex.push(excluded(`jev-engineering/pack/shell/${id}`, path, line, reason('packs/shell.json:*'))); continue; }
      if (id !== 'verdict') { ex.push(excluded(`jev-engineering/pack/${pack}/${id}`, path, line, reason('packs/*.json:non-verdict'))); continue; }
      const { instructions, ...rest } = q;
      rules.push(rule({ ruleId: `jev-engineering/pack/${pack}/${id}`, sourcePath: path, line, kind: 'question', text: instructions, inputKind: 'toolCall', withheld: { pack, ...rest } }));
    }
  }
  // The shell pack is the policy's own questions, verbatim (the reason for its exclusion).
  const shell = JSON.parse(read('packs/shell.json')).questions;
  if (JSON.stringify(shell) !== JSON.stringify(policy.questions)) throw new Error('jev-engineering shell pack no longer repeats policy.json questions');
  return { rules, excluded: ex, sources: [P, ...['data', 'message', 'money', 'publish', 'shell'].map(p => `packs/${p}.json`)] };
}

function piVerdict(read, sel) {
  const V = 'extensions/pi-verdict.ts', src = read(V), rules = [], ex = [];
  const bOff = src.indexOf('const BASH_DANGER_RULES');
  const bEnd = src.indexOf('\n];', bOff);
  for (const m of src.slice(bOff, bEnd).matchAll(/\{ id: "([\w-]+)", pattern: /g)) {
    const at = bOff + m.index, re = parseRegexLiteral(src, at + m[0].length);
    const rs = stringAfter(src, 'reason:', re.end);
    rules.push(rule({ ruleId: `pi-verdict/bash/${m[1]}`, sourcePath: V, line: lineOf(src, at), kind: 'regex', text: re.source, flags: re.flags, inputKind: 'toolCall', withheld: { id: m[1], reason: rs.value, tier: 'bash-deny' } }));
  }
  const tiers = { S0_SECRET: 'deny on read and write', S1_SYSTEM: 'deny on write (gray on read)', S3_GIT_META: 'deny on write' };
  for (const name of ['S0_SECRET', 'S1_SYSTEM', 'S2_USER_RC', 'S3_GIT_META']) {
    const off = src.indexOf(`const ${name} = [`), end = src.indexOf('];', off);
    let i = off + `const ${name} = [`.length, n = 0;
    while (i < end) {
      if (src.startsWith('//', i)) { i = src.indexOf('\n', i); continue; }
      if (src[i] === '/') {
        const re = parseRegexLiteral(src, i), id = `${name.slice(0, 2)}-${String(++n).padStart(2, '0')}`;
        if (name === 'S2_USER_RC') ex.push({ ...excluded(`pi-verdict/path/${id}`, V, lineOf(src, i), sel.excluded[0].reason), text: re.source });
        else rules.push(rule({ ruleId: `pi-verdict/path/${id}`, sourcePath: V, line: lineOf(src, i), kind: 'regex', text: re.source, flags: re.flags, inputKind: 'toolCall', withheld: { tier: `${name}: ${tiers[name]}` } }));
        i = re.end; continue;
      }
      i++;
    }
  }
  const J = 'extensions/jev-adapter.ts', js = read(J);
  const qOff = js.indexOf('export const VERDICT_QUESTIONS = {');
  const q = stringAfter(js, 'instructions:', qOff);
  const crit = js.slice(js.indexOf('criteria:', q.end), js.indexOf('} as const;', q.end));
  rules.push(rule({ ruleId: 'pi-verdict/jev/verdict', sourcePath: J, line: lineOf(js, q.at), kind: 'question', text: q.value, inputKind: 'toolCall', withheld: { type: 'choice', criteria: crit.trim() } }));
  return { rules, excluded: ex, sources: [V, J] };
}

function jevAxi(read, sel) {
  const Q = 'src/recipes/questions.ts', src = read(Q), rules = [], ex = [];
  const sets = [...src.matchAll(/^export const (\w+)\b/gm)].map(m => ({ name: m[1], at: m.index }));
  const setOf = at => sets.filter(s => s.at < at).at(-1).name;
  const kinds = sel.primary.inputKind;
  const include = { GUARD_QUESTIONS: '*', COMMIT_QUESTIONS: '*', PUSH_QUESTIONS: '*', SAFETY_QUESTIONS: '*', PROGRESS_WORKER: ['needs_human', 'worker_stuck', 'work_off_track'] };
  const reasonFor = (set, id) => (sel.excluded.find(e => e.id === `${set}/${id}`) ?? sel.excluded.find(e => e.id === `${set}/*`))?.reason;
  for (const m of src.matchAll(/^ {2}(\w+|\[`\$\{id\}\.(\w+)`\]): \{\n\s+type: "(\w+)",/gm)) {
    const set = setOf(m.index), id = m[2] ?? m[1], line = lineOf(src, m.index);
    const inc = include[set] && (include[set] === '*' || include[set].includes(id));
    if (!inc) {
      const reason = reasonFor(set, id);
      if (!reason) throw new Error(`jev-axi ${set}/${id} is neither a rule nor excluded`);
      ex.push(excluded(`jev-axi/${set}/${id}`, Q, line, reason));
      continue;
    }
    const s = stringAfter(src, 'instructions:', m.index);
    const close = /^ {2}\},?$/m.exec(src.slice(s.end));
    const tail = src.slice(s.end, s.end + close.index);
    const criteria = tail.includes('criteria:') ? tail.slice(tail.indexOf('criteria:') + 'criteria:'.length).trim().replace(/,$/, '') : null;
    rules.push(rule({ ruleId: `jev-axi/${set}/${id}`, sourcePath: Q, line, kind: 'question', text: s.value, inputKind: kinds[set], withheld: { set, type: m[3], ...(criteria ? { criteria } : {}) } }));
  }
  return { rules, excluded: ex, sources: [Q] };
}

export const EXTRACTORS = { hunch, 'jev-pref': jevPref, abide, limpet, 'jev-belay': jevBelay, 'jev-engineering': jevEngineering, 'pi-verdict': piVerdict, 'jev-axi': jevAxi };

/** Canonical sha of the rules array: the sha256 of its JSON (no whitespace). The test recomputes it. */
export const rulesSha256 = rules => sha256(JSON.stringify(rules));

/**
 * The rule's "Applies to" context (refute r5 B1): the factual sentences of every source group of selection.json that the
 * rule belongs to (by ruleId prefix, and abide's `when`), then its own file globs (abide `scope`, hunch `files`). A glob
 * containing the plugin's own name shows it as <tool>, so no prompt names a plugin. null when nothing applies.
 */
export function contextFor(r, sel) {
  const mask = globs => (Array.isArray(globs) ? globs : [globs]).map(g => g.split(sel.plugin).join('<tool>')).join(', ');
  const parts = [];
  for (const c of sel.contexts ?? []) {
    if (c.match && r.ruleId.startsWith(c.match) && (c.when === undefined || c.when === r.withheld.when)) parts.push(c.context);
    else if (c.scope && r.withheld.scope !== undefined) parts.push(c.context.replace('<scope>', mask(r.withheld.scope)));
    else if (c.files && r.withheld.files !== undefined) parts.push(c.context.replace('<files>', mask(r.withheld.files)));
  }
  return parts.length ? parts.join(' ') : null;
}

/** Build the vendored record for one plugin from a reader over its clone at the pin. */
export function extractPlugin(sel, read) {
  const fn = EXTRACTORS[sel.plugin];
  if (!fn) throw new Error(`no extractor for ${sel.plugin}`);
  const out = fn(read, sel);
  for (const r of out.rules) r.context = contextFor(r, sel);
  const license = read('LICENSE');
  const copyright = license.split('\n').find(l => /^Copyright/.test(l.trim()))?.trim();
  if (!/^MIT License/.test(license.trim()) || !copyright) throw new Error(`${sel.plugin}: LICENSE is not MIT or has no copyright line`);
  const ids = out.rules.map(r => r.ruleId);
  if (new Set(ids).size !== ids.length) throw new Error(`${sel.plugin}: duplicate ruleId`);
  const count = s => out.rules.filter(r => r.stratum === s).length;
  return {
    schemaVersion: 1,
    plugin: sel.plugin,
    repo: sel.repo,
    sha: sel.sha,
    license: 'MIT',
    copyright,
    sources: ['LICENSE', ...out.sources].map(path => ({ path, sha256: sha256(read(path)) })),
    counts: { primary: count('primary'), secondary: count('secondary'), excluded: out.excluded.length },
    rulesSha256: rulesSha256(out.rules),
    rules: out.rules,
    excluded: out.excluded,
    ...(out.secondaryPopulation ? { secondaryPopulation: out.secondaryPopulation } : {}),
  };
}
