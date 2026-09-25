// WO-06: build the one input every gate receives, and prove Laya will never cut it.
//
//   state    = rules.txt + "\n\n" + <unified diff of the change>     (identical for Jev, Laya and the reviewer)
//   question = gate-question.json, verbatim ({"type": "noul", "instructions": "Does this change break any of these rules?"})
//
// Every state is measured with Laya's real tokenizer BEFORE build_sequence's cut (laya_count.py):
// the state must fit the room left under max_len 1024, the question head must fit its budget
// (<= head_max_len 256), and no option may be cut. An input that would be cut is refused, so
// truncation is impossible rather than merely flagged. A planted too-long input must be refused
// on every build (negative control).
//
//   node experiments/jev-gate/gate-input.mjs            write inputs.json and inputs.sha256 (needs the tokenizer)
//   node experiments/jev-gate/gate-input.mjs --check    rebuild and compare byte for byte
//
// Tokenizer: LAYA_TOKENIZER_PYTHON (default experiments/jev-gate/.venv/bin/python, with tokenizers and
// numpy as pinned in ../laya-vs-jev/requirements.txt) and the pinned Laya files in LAYA_CACHE
// (default ~/.cache/odin-rnd/laya, fetched by ../laya-vs-jev/run.py). No model is loaded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE } from './bce-contract.mjs';

export const INPUTS = join(HERE, 'inputs.json');
export const INPUTS_SHA = join(HERE, 'inputs.sha256');
export const QUESTION_FILE = join(HERE, 'gate-question.json');
export const RULES_FILE = join(HERE, 'rules.txt');
export const CORPUS = join(HERE, 'corpus');
export const OPTION_CAP = 48;
export const MIN_OPTION_BUDGET = 16;
export const NEGATIVE_CONTROL_ID = 'planted-too-long';

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** The pinned state construction. */
export const buildState = (rules, diff) => rules + '\n\n' + diff;

/** A deterministic diff far over the room: a new file of 300 constant lines. */
export function plantedTooLongDiff() {
  const lines = Array.from({ length: 300 }, (_, i) => `+export const rate${String(i).padStart(3, '0')} = ${(i * 7919) % 1000};`);
  return `diff --git a/src/domain/rates.ts b/src/domain/rates.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/domain/rates.ts\n@@ -0,0 +1,${lines.length} @@\n${lines.join('\n')}\n`;
}

/**
 * The pre-cut assertions on one measured input (the Node mirror of laya_count.py's refusal).
 * Returns the list of reasons the input would be cut; empty means it passes through uncut.
 */
export function cutReasons(c, limits) {
  const reasons = [];
  c.optionTokens.forEach((n, i) => { if (n > OPTION_CAP) reasons.push(`option ${i} is ${n} tokens > ${OPTION_CAP}`); });
  if (c.headBudget < MIN_OPTION_BUDGET) reasons.push(`options budget ${c.headBudget} < ${MIN_OPTION_BUDGET}`);
  if (c.headTokens > Math.max(8, c.headBudget) || c.headTokens > limits.headMaxLen) reasons.push(`question head ${c.headTokens} tokens > budget`);
  if (c.stateTokens > c.room) reasons.push(`state ${c.stateTokens} tokens > room ${c.room}`);
  if (c.totalTokens > limits.maxLen) reasons.push(`total ${c.totalTokens} tokens > max_len ${limits.maxLen}`);
  return reasons;
}

export function tokenizerPython() {
  return process.env.LAYA_TOKENIZER_PYTHON || join(HERE, '.venv', 'bin', 'python');
}

export function tokenizerAvailable() {
  const cache = process.env.LAYA_CACHE || join(process.env.HOME || '', '.cache', 'odin-rnd', 'laya');
  return existsSync(tokenizerPython()) && existsSync(join(cache, '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851', 'typed-decisions', 'tokenizer', 'tokenizer.json'));
}

/** Run laya_count.py over {id: state}. */
export function countTokens(question, states) {
  const req = { question, items: Object.entries(states).map(([id, state]) => ({ id, state })) };
  const r = spawnSync(tokenizerPython(), [join(HERE, 'laya_count.py')], { input: JSON.stringify(req), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`laya_count.py failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

export function readCorpus() {
  const labels = JSON.parse(readFileSync(join(HERE, 'labels.json'), 'utf8'));
  return labels.items.map(i => i.id).sort().map(id => ({ id, diff: readFileSync(join(CORPUS, id + '.patch'), 'utf8') }));
}

export function buildInputs() {
  const questionText = readFileSync(QUESTION_FILE, 'utf8');
  const question = JSON.parse(questionText);
  const rules = readFileSync(RULES_FILE, 'utf8');
  const corpus = readCorpus();
  const states = Object.fromEntries(corpus.map(c => [c.id, buildState(rules, c.diff)]));
  states[NEGATIVE_CONTROL_ID] = buildState(rules, plantedTooLongDiff());
  const counted = countTokens(question, states);
  const limits = { maxLen: counted.tokenizer.maxLen, headMaxLen: counted.tokenizer.headMaxLen };

  const neg = counted.items[NEGATIVE_CONTROL_ID];
  if (neg.fits || cutReasons(neg, limits).length === 0) throw new Error('negative control: the planted too-long input was NOT refused');

  const items = corpus.map(({ id, diff }) => {
    const c = counted.items[id];
    const reasons = cutReasons(c, limits);
    if (!c.fits || reasons.length) throw new Error(`${id} would be cut by Laya: ${[...c.reasons, ...reasons].join('; ')}`);
    return { id, patchSha256: sha256(diff), stateSha256: sha256(states[id]), stateTokens: c.stateTokens, totalTokens: c.totalTokens, truncated: false, state: states[id] };
  });
  const any = counted.items[corpus[0].id];
  return {
    schemaVersion: 1,
    note: 'The one input every gate receives. Jev and Laya get state + question; the reviewer gets the same state. Carries no labels.',
    stateConstruction: 'state = rules.txt + "\\n\\n" + diff',
    question: { file: 'gate-question.json', sha256: sha256(questionText) },
    rules: { file: 'rules.txt', sha256: sha256(rules) },
    tokenizer: counted.tokenizer,
    head: { headTokens: any.headTokens, headBudget: any.headBudget, optionTokens: any.optionTokens, room: any.room },
    stats: {
      items: items.length,
      truncated: items.filter(i => i.truncated).length,
      maxStateTokens: Math.max(...items.map(i => i.stateTokens)),
      maxTotalTokens: Math.max(...items.map(i => i.totalTokens)),
      medianStateTokens: [...items.map(i => i.stateTokens)].sort((a, b) => a - b)[Math.floor(items.length / 2)],
    },
    negativeControl: { id: NEGATIVE_CONTROL_ID, stateTokens: neg.stateTokens, room: neg.room, refused: true, reasons: neg.reasons },
    items,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(buildInputs(), null, 2) + '\n';
  const listing = `${sha256(text)}  inputs.json\n`;
  if (process.argv.includes('--check')) {
    const ok = readFileSync(INPUTS, 'utf8') === text && readFileSync(INPUTS_SHA, 'utf8') === listing;
    console.log(ok ? 'inputs.json reproduces byte for byte' : 'inputs.json DIFFERS');
    process.exitCode = ok ? 0 : 1;
  } else {
    writeFileSync(INPUTS, text);
    writeFileSync(INPUTS_SHA, listing);
    const s = JSON.parse(text);
    console.log(JSON.stringify({ ...s.stats, head: s.head, limits: s.tokenizer, negativeControl: s.negativeControl }));
    console.log('inputs sha256: ' + sha256(text));
  }
}
