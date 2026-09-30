// EXP 007 WO-1-02: the blueprint-floor adapter. It turns one plugin input into a tree bce-engine 0.3.1 can grade, runs
// the released engine on it through EXP 005's scoring contract (bce-contract.mjs: materialise, run, interpret; imported,
// never copied), and answers pass, fail or abstain for one rule. It also runs the engine's own `validate` and the teeth
// check a translated constraint set must pass.
//
// Pins (PLAN-DETAIL R2-6, R3-2, R4-1):
//   - plugin rules: extraction profile plugin-surface with the ast extractor (bce-contract's runCli passes --extractor ast),
//     paths [".floor/**", "src/**/*.ts"] for diff inputs and [".floor/**"] otherwise, minFiles = the count of materialised
//     files the engine resolves for those paths;
//   - positive controls: typescript-module-graph over src/**/*.ts, exactly as EXP 005;
//   - vocabulary: whitelist.json (derived from the installed engine). Anything else is refused with a typed error.
// No model is called here, and nothing here can start one.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFiles } from 'bce-engine';
import { BCE_CLI, assertBceVersion, materialise, scoreTree } from '../jev-gate/bce-contract.mjs';
import { loadWhitelist } from './whitelist.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** EXP 005's base tree: every diff input is a patch against it (its committed layout is in contract.md). */
export const BASE = resolve(HERE, '../jev-gate/base');
export const INPUT_KINDS = ['diff', 'toolCall', 'stopTranscript', 'file'];
export const FLOOR = '.floor';
export const PATHS = { diff: ['.floor/**', 'src/**/*.ts'], toolCall: ['.floor/**'], stopTranscript: ['.floor/**'], file: ['.floor/**'] };
export const CONTROL_PATHS = ['src/**/*.ts'];
export const DECISIONS = ['pass', 'fail', 'abstain'];
export const CLASSES = ['expressible', 'partial', 'not'];

export class AdapterError extends Error { constructor(message, code = 'ADAPTER') { super(message); this.name = 'AdapterError'; this.code = code; } }
/** A constraint whose type is outside the vocabulary. */
export class RefusedConstraintError extends AdapterError { constructor(type, role) { super(`constraint type ${JSON.stringify(type)} is not in the ${role} vocabulary (whitelist.json)`, 'REFUSED_CONSTRAINT'); this.name = 'RefusedConstraintError'; this.type = type; this.role = role; } }
/** A plugin-role call that did not say which flags its rule has (refute r4 N2): folding must never be skipped by omission. */
export class MissingFlagsError extends AdapterError { constructor() { super('a plugin-rule run must pass the rule\'s recorded flags (a string, or null for a rule with none)', 'MISSING_FLAGS'); this.name = 'MissingFlagsError'; } }
/** customPolicy: bce 0.3.1 declares it but evaluate() does not enforce it. */
export class CustomPolicyRefusedError extends RefusedConstraintError { constructor(role) { super('customPolicy', role); this.name = 'CustomPolicyRefusedError'; this.code = 'CUSTOM_POLICY_REFUSED'; this.message = 'customPolicy is refused: bce-engine 0.3.1 declares it but evaluate() does not enforce it'; } }

const whitelist = loadWhitelist();
export const VOCABULARY = { plugin: whitelist.plugin.map(t => t.type), control: whitelist.controls.map(t => t.type) };

/** Refuse any constraint outside the role's vocabulary. Returns the constraints unchanged. */
export function checkVocabulary(constraints, role = 'plugin') {
  if (!Array.isArray(constraints)) throw new AdapterError('constraints must be an array');
  if (!VOCABULARY[role]) throw new AdapterError(`unknown role ${role}`);
  for (const c of constraints) {
    if (!c || typeof c !== 'object') throw new AdapterError('a constraint must be an object');
    if (c.type === 'customPolicy') throw new CustomPolicyRefusedError(role);
    if (!VOCABULARY[role].includes(c.type)) throw new RefusedConstraintError(c.type, role);
  }
  return constraints;
}

const posixRel = p => p.split('\\').join('/');
/** A repository-relative path that stays inside the tree (GNU or macOS spelling, forward or back slashes). */
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p.length) throw new AdapterError('a path must be a non-empty string');
  const n = posix.normalize(posixRel(p));
  if (n.startsWith('/') || /^[A-Za-z]:\//.test(n) || n === '..' || n.startsWith('../') || n.includes('\0')) throw new AdapterError(`path escapes the tree: ${p}`);
  return n.replace(/^\.\//, '');
}

/** A `+++ ` header's target: tab/date suffix removed, a `b/` prefix stripped; null for a deleted file (/dev/null). */
export const headerTarget = rest => { const p = rest.split('\t')[0].trim(); return p === '/dev/null' ? null : p.replace(/^b\//, ''); };

/**
 * The added lines of a unified diff, per post-image path, hunk-aware (a `+++`-looking added line inside a hunk is content,
 * not a header). Deleted files contribute nothing. Returns [{ path, lines }] in patch order (refute r6 B1, N5).
 */
export function addedByFile(patch) {
  const files = [];
  let cur = null, oldLeft = 0, newLeft = 0;
  for (const line of patch.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue;
      const c = line[0];
      if (c === '+') { newLeft--; if (cur) cur.lines.push(line.slice(1)); }
      else if (c === '-') oldLeft--;
      else { oldLeft--; newLeft--; }
      continue;
    }
    if (line.startsWith('+++ ')) { const t = headerTarget(line.slice(4)); cur = t === null ? null : { path: t, lines: [] }; if (cur) files.push(cur); continue; }
    const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (h) { oldLeft = h[1] === undefined ? 1 : Number(h[1]); newLeft = h[2] === undefined ? 1 : Number(h[2]); }
  }
  return files;
}
/** .floor/added-lines.txt: a `+++ <path>` header per changed (not deleted) file, then its added lines without the `+`. */
export function addedLines(patch) {
  const out = addedByFile(patch).flatMap(f => [`+++ ${f.path}`, ...f.lines]);
  return out.join('\n') + (out.length ? '\n' : '');
}
/** The paths a unified diff touches (both sides), without a/ b/ prefixes. */
export function patchPaths(patch) {
  const paths = new Set();
  for (const m of patch.matchAll(/^(?:---|\+\+\+) (?:[ab]\/)?(\S+)/gm)) if (m[1] !== '/dev/null') paths.add(m[1]);
  for (const m of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) { paths.add(m[1]); paths.add(m[2]); }
  return [...paths];
}

/**
 * Write one input into a fresh staging directory. Returns { dir, patch, files } where `patch` is set for diff inputs (it is
 * applied by the engine contract's materialise step) and `files` lists the .floor files written. The caller removes `dir`.
 *   diff           { patch }                       base tree + .floor/diff.patch + .floor/added-lines.txt + .floor/added/<path>; the patch applies to the base
 *   toolCall       { tool_name, tool_input }       .floor/tool-call.json (the input, pretty-printed) + .floor/command.txt
 *   stopTranscript { transcript: [...], final_message } .floor/transcript.jsonl + .floor/final-message.txt
 *   file           { path, content }               the file at .floor/files/<path>
 */
export function stageInput({ inputKind, input }) {
  if (!INPUT_KINDS.includes(inputKind)) throw new AdapterError(`unknown input kind ${JSON.stringify(inputKind)}`);
  if (!input || typeof input !== 'object') throw new AdapterError('input must be an object');
  const dir = mkdtempSync(join(tmpdir(), 'blueprint-floor-'));
  const put = (rel, text) => { const abs = join(dir, ...safeRelPath(rel).split('/')); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); return safeRelPath(rel); };
  try {
    const files = [];
    let patch;
    if (inputKind === 'diff') {
      if (typeof input.patch !== 'string' || !input.patch.trim()) throw new AdapterError('a diff input needs a non-empty patch');
      const touched = patchPaths(input.patch);
      if (touched.some(p => safeRelPath(p) === FLOOR || safeRelPath(p).startsWith(`${FLOOR}/`))) throw new AdapterError('a diff input may not touch .floor/');
      touched.forEach(safeRelPath);
      cpSync(BASE, dir, { recursive: true });
      files.push(put('.floor/diff.patch', input.patch), put('.floor/added-lines.txt', addedLines(input.patch)));
      // Each changed file's added lines alone, at .floor/added/<post-image path>, so a file-scoped rule can glob them (r6 B1).
      for (const f of addedByFile(input.patch)) files.push(put(`.floor/added/${safeRelPath(f.path)}`, f.lines.join('\n') + (f.lines.length ? '\n' : '')));
      patch = input.patch.endsWith('\n') ? input.patch : input.patch + '\n';
    } else if (inputKind === 'toolCall') {
      if (typeof input.tool_name !== 'string' || !input.tool_input || typeof input.tool_input !== 'object') throw new AdapterError('a toolCall input needs tool_name and a tool_input object');
      const command = typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
      files.push(put('.floor/tool-call.json', JSON.stringify(input, null, 2) + '\n'), put('.floor/command.txt', command));
    } else if (inputKind === 'stopTranscript') {
      if (!Array.isArray(input.transcript) || typeof input.final_message !== 'string') throw new AdapterError('a stopTranscript input needs a transcript array and a final_message string');
      files.push(put('.floor/transcript.jsonl', input.transcript.map(e => JSON.stringify(e)).join('\n') + (input.transcript.length ? '\n' : '')), put('.floor/final-message.txt', input.final_message));
    } else {
      if (typeof input.content !== 'string') throw new AdapterError('a file input needs path and content');
      files.push(put(`.floor/files/${safeRelPath(input.path)}`, input.content));
    }
    return { dir, patch, files };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** A rule whose source regex has the i flag is graded case-insensitively BY CONSTRUCTION (refute r3): its input is folded. */
export const foldsCase = flags => typeof flags === 'string' && flags.includes('i');
export const fold = text => text.toLowerCase();

/**
 * Case-fold a staged input for an /i rule: every .floor file's content and, for a diff, every scanned src/**\/*.ts file of
 * the POST-patch tree are lower-cased (String.prototype.toLowerCase, Unicode default). Paths and file names are not folded.
 * For a diff the patch is applied first (EXP 005's materialise), and the folded post-patch tree replaces the staging dir.
 */
export function foldStaged(staged) {
  let dir = staged.dir;
  if (staged.patch !== undefined) {
    const repo = materialise(staged.dir, staged.patch);
    try {
      dir = mkdtempSync(join(tmpdir(), 'blueprint-floor-folded-'));
      cpSync(repo, dir, { recursive: true, filter: src => !src.split(/[\\/]/).includes('.git') });
    } finally { rmSync(repo, { recursive: true, force: true }); }
    rmSync(staged.dir, { recursive: true, force: true });
  }
  const rels = resolveFiles(dir, staged.patch !== undefined ? PATHS.diff : ['.floor/**']);
  for (const abs of rels) writeFileSync(abs, fold(readFileSync(abs, 'utf8')));
  return { dir, patch: undefined, files: staged.files, folded: true };
}

/** The files the engine will resolve for this input: the minFiles floor (materialised exactly as the run will be). */
export function countScanned(staged, paths) {
  const repo = materialise(staged.dir, staged.patch);
  try { return resolveFiles(repo, paths).length; } finally { rmSync(repo, { recursive: true, force: true }); }
}

/** The blueprint the engine runs for one rule's constraints. */
export function buildBlueprint({ ruleId = 'rule', constraints, inputKind, minFiles, role = 'plugin' }) {
  checkVocabulary(constraints, role);
  const control = role === 'control';
  const paths = control ? CONTROL_PATHS : PATHS[inputKind];
  if (!paths) throw new AdapterError(`unknown input kind ${JSON.stringify(inputKind)}`);
  if (!Number.isInteger(minFiles) || minFiles < 1) throw new AdapterError('minFiles must be a positive integer');
  return {
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: `exp007-${String(ruleId).replace(/[^A-Za-z0-9._-]+/g, '-')}`.slice(0, 120), name: `EXP 007 floor for ${ruleId}`, version: '1.0.0', status: 'approved', ownerRole: 'experiment', stewardRole: 'experiment' },
    intentRefs: [String(ruleId)],
    scope: { repositories: ['odin-labs-ai/odin-rnd'], paths },
    architecture: { components: control ? [{ id: 'typescriptModule', type: 'typescriptModule' }] : [], relationships: [] },
    constraints,
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'experiment', stage: 'ratify' }],
    ...(control ? { minEngineVersion: '0.3.0' } : {}),
    extraction: { profile: control ? 'typescript-module-graph' : 'plugin-surface', paths, minFiles },
  };
}

function withBlueprintFile(blueprint, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'blueprint-floor-bp-'));
  const file = join(dir, 'blueprint.json');
  writeFileSync(file, JSON.stringify(blueprint, null, 2) + '\n');
  const done = () => rmSync(dir, { recursive: true, force: true });
  let out;
  try { out = fn(file); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
}

/**
 * The engine's own validation of a blueprint (`bce validate --blueprint`). { ok, engineLimit, message }: engineLimit is
 * true when the only reason is the engine's regex guard refusing a pattern (safeCompilePattern), a separate category.
 */
export function validateBlueprint(blueprint) {
  assertBceVersion();
  return withBlueprintFile(blueprint, file => {
    const r = spawnSync(process.execPath, [BCE_CLI, 'validate', '--blueprint', file], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    const message = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return { ok: r.status === 0, exitCode: r.status, engineLimit: r.status !== 0 && /INVALID or UNSAFE regex/.test(message), message };
  });
}

/** Run the engine on one input. Returns EXP 005's interpretation { label: GREEN|RED, violations, ... } plus minFiles. */
export async function runFloor({ ruleId, constraints, inputKind, input, role = 'plugin', flags }) {
  checkVocabulary(constraints, role);
  if (role === 'plugin' && flags === undefined) throw new MissingFlagsError();
  if (flags !== undefined && flags !== null && typeof flags !== 'string') throw new AdapterError('flags must be a string or null');
  let staged = stageInput({ inputKind, input });
  if (foldsCase(flags)) staged = foldStaged(staged);
  try {
    const minFiles = countScanned(staged, role === 'control' ? CONTROL_PATHS : PATHS[inputKind]);
    if (minFiles < 1) throw new AdapterError('the input materialises no scanned file');
    const blueprint = buildBlueprint({ ruleId, constraints, inputKind, minFiles, role });
    const result = await withBlueprintFile(blueprint, file => scoreTree({ blueprint: file, tree: staged.dir, patch: staged.patch }));
    return { ...result, minFiles, blueprint };
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
}

/**
 * judge: one rule's decision on one input, from its FINAL class (R2-6).
 *   expressible -> pass | fail from the engine;  partial -> fail from the engine, else abstain;  not -> abstain always.
 * A rule whose constraint set is empty abstains.
 */
export async function judge({ ruleId, constraints, inputKind, input, finalClass, role = 'plugin', flags }) {
  if (!CLASSES.includes(finalClass)) throw new AdapterError(`unknown class ${JSON.stringify(finalClass)}`);
  if (role === 'plugin' && flags === undefined) throw new MissingFlagsError();
  if (finalClass === 'not' || !Array.isArray(constraints) || constraints.length === 0) return { decision: 'abstain', violations: [] };
  const r = await runFloor({ ruleId, constraints, inputKind, input, role, flags });
  if (r.label === 'RED') return { decision: 'fail', violations: r.violations };
  return { decision: finalClass === 'expressible' ? 'pass' : 'abstain', violations: [] };
}

/**
 * teeth: PASS iff (1) every violating probe reddens the whole constraint set, (2) the compliant probe does not, and (3)
 * each constraint ALONE reddens at least one violating probe (refute r3 N2: no vacuous constraint rides beside a real
 * one). `violating` is one probe or a non-empty array of probes. Runs through this adapter and the real engine, on the
 * folded input for an /i rule. Any error fails, with its reason.
 */
export async function teeth(constraints, { violating, compliant }, { inputKind, ruleId = 'teeth', role = 'plugin', flags } = {}) {
  if (role === 'plugin' && flags === undefined) throw new MissingFlagsError();
  const set = Array.isArray(constraints) ? constraints : [constraints];
  if (set.length === 0) return { pass: false, reason: 'empty constraint set' };
  const probes = Array.isArray(violating) ? violating : [violating];
  if (probes.length === 0) return { pass: false, reason: 'no violating probe' };
  const run = (cs, input) => runFloor({ ruleId, constraints: cs, inputKind, input, role, flags });
  try {
    const v = [];
    for (const p of probes) v.push((await run(set, p)).label);
    const c = (await run(set, compliant)).label;
    const perConstraint = {};
    if (set.length > 1) {
      for (const k of set) {
        perConstraint[k.id] = false;
        for (const p of probes) if ((await run([k], p)).label === 'RED') { perConstraint[k.id] = true; break; }
      }
    } else perConstraint[set[0].id] = v.includes('RED');
    const lone = Object.entries(perConstraint).filter(([, ok]) => !ok).map(([id]) => id);
    const pass = v.every(l => l === 'RED') && c === 'GREEN' && lone.length === 0;
    const violatingLabel = v.length === 1 ? v[0] : v;
    return { pass, violating: violatingLabel, compliant: c, perConstraint, reason: pass ? 'violating RED, compliant GREEN, every constraint reddens a violating probe alone' : lone.length ? `constraint(s) ${lone.join(', ')} redden no violating probe alone` : `violating ${v.join('/')}, compliant ${c}` };
  } catch (e) {
    return { pass: false, reason: `${e.name ?? 'Error'}: ${String(e.message).split('\n')[0]}` };
  }
}
