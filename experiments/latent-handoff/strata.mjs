// EXP 008 (latent-handoff) strata builder, bundle 3 WO-02.
//
// One deterministic builder makes three contexts per item, for the 60 sha-asserted EXP 005 items and the 140 EXP 008-X
// items (corpus-x/, sha-asserted the same way):
//   S = rules + diff                      (byte-identical to the EXP 005 gate state)
//   M = rules + base/ + diff
//   L = rules + base/ + distractor + diff  padded with a pinned, MIT-licensed public file (lodash 4.17.21) to about
//                                          16K tokens; the distractor sits BEFORE the diff so the change stays
//                                          adjacent to the gate question. The padding share is disclosed per item.
// EXP 005 files are read, never written. Before anything else the builder asserts corpus.sha256 (a83b222a…), every
// file it lists except labels.json (never opened here), inputs.json and the EXP 005 lint it reuses; one mutated byte
// stops the build.
// Every context must pass the EXP 005 leakage lint (lint.mjs), and every L context must be 16K ±10% tokens under
// BOTH pinned tokenizers (Qwen3, Llama-3), or the build fails.
//
//   node experiments/latent-handoff/strata.mjs [--out <dir>]   writes strata-manifest.json + <dir>/<id>.<S|M|L>.txt
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const JEV_DIR = join(REPO, 'experiments', 'jev-gate');
export const MANIFEST_PATH = join(HERE, 'strata-manifest.json');
const PYTHON = process.env.LH_PYTHON || join(homedir(), 'ai-env', 'bin', 'python');
const CACHE_ROOT = process.env.LH_MODEL_CACHE || join(homedir(), '.cache', 'odin-rnd', 'latent-handoff');

// EXP 005 pins (reused by sha, never edited).
export const EXP005 = Object.freeze({
  corpusSumsSha256: 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9', // corpus.sha256 itself
  inputsSha256: '6bfb2b8d52376cbd22c8a34f5f986fe67ad68a0c587da862ba6b56e77e966a34', // inputs.json
  lintSha256: 'df4485c7c7c7f515c5a484ec10df3400c59e2558c9cc67d1956aa6d40f9f38c9', // lint.mjs (EXP 006 runners.sha256)
});

// EXP 008-X (WO-03): the 140 new items. Only the gate-facing files are opened (corpus-x.json and the patches); the
// labels and the author manifest ride on the pinned corpus-x.sha256 and are never read here.
export const CORPUS_X_DIR = join(HERE, 'corpus-x');
export const CORPUS_X_SUMS_SHA256 = 'f0199c9d0209900012c25c28fe1e2ef755de725e09cc3411b6260d923e47b77e';

export function assertCorpusX(dir = CORPUS_X_DIR, rules) {
  const sumsBytes = readFileSync(join(dir, 'corpus-x.sha256'));
  if (sha256(sumsBytes) !== CORPUS_X_SUMS_SHA256) fail(`corpus-x.sha256 hashes to ${sha256(sumsBytes)}, pinned ${CORPUS_X_SUMS_SHA256}`);
  const pins = new Map(sumsBytes.toString('utf8').trim().split('\n').map(l => {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
    if (!m) fail(`corpus-x.sha256: bad line ${l}`);
    return [m[2], m[1]];
  }));
  const read = rel => {
    const bytes = readFileSync(join(dir, rel));
    if (sha256(bytes) !== pins.get(rel)) fail(`corpus-x/${rel} hashes to ${sha256(bytes)}, corpus-x.sha256 pins ${pins.get(rel)}`);
    return bytes.toString('utf8');
  };
  const index = JSON.parse(read('corpus-x.json'));
  return index.items.map(it => {
    const diff = read(`corpus/${it.id}.patch`);
    if (sha256(`${rules}\n\n${diff}`) !== it.stateSha256) fail(`${it.id}: state sha differs from corpus-x.json`);
    return { id: it.id, diff };
  });
}

export const DISTRACTOR = Object.freeze({
  file: 'distractor/lodash-4.17.21-head2500.js',
  sha256: '52f2358d3c8eccc8f030fab6acf868f46b8b88045898589391f1630d2e1ed95c',
  license: 'MIT (distractor/LICENSE, sha256 f71e8ed126b46346494aad5486874cd8f0aafe95092ed67d2e3cb6110f939abc)',
  source: 'https://raw.githubusercontent.com/lodash/lodash/f299b52f39486275a9e6483b60a410e06520c538/lodash.js',
  upstreamSha256: '4c04561befdf653aef017a42ac5addf68ea943cdfca6bdee5ce04e04e8139f54',
  excerpt: 'the first 2500 lines of the upstream file, unmodified',
  header: '=== vendor/lodash.js ===\n',
});

export const TARGET_TOKENS = 16000;
export const TOLERANCE = 0.1;
export const TOKENIZERS = Object.freeze({ qwen3: 'qwen3-1.7b', llama3: 'llama-3.2-3b' });

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = msg => { throw new Error(`strata: ${msg}`); };

/** Assert the EXP 005 inputs by sha; returns the parsed corpus sums. */
export function assertExp005(jevDir = JEV_DIR) {
  const sumsBytes = readFileSync(join(jevDir, 'corpus.sha256'));
  if (sha256(sumsBytes) !== EXP005.corpusSumsSha256) fail(`corpus.sha256 hashes to ${sha256(sumsBytes)}, pinned ${EXP005.corpusSumsSha256}`);
  const sums = sumsBytes.toString('utf8').trim().split('\n').map(l => {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
    if (!m) fail(`corpus.sha256: bad line ${l}`);
    return { sha: m[1], rel: m[2] };
  });
  for (const { sha, rel } of sums) {
    if (rel === 'labels.json') continue; // the answer key is never opened by a context builder; its pin rides on corpus.sha256
    const got = sha256(readFileSync(join(jevDir, rel)));
    if (got !== sha) fail(`${rel} hashes to ${got}, corpus.sha256 pins ${sha}`);
  }
  const inputs = readFileSync(join(jevDir, 'inputs.json'));
  if (sha256(inputs) !== EXP005.inputsSha256) fail(`inputs.json hashes to ${sha256(inputs)}, pinned ${EXP005.inputsSha256}`);
  const lint = readFileSync(join(jevDir, 'lint.mjs'));
  if (sha256(lint) !== EXP005.lintSha256) fail(`lint.mjs hashes to ${sha256(lint)}, pinned ${EXP005.lintSha256}`);
  return { sums, inputs: JSON.parse(inputs.toString('utf8')) };
}

export function renderBase(jevDir, sums) {
  return sums.filter(s => s.rel.startsWith('base/')).map(s => s.rel).sort()
    .map(rel => `=== ${rel} ===\n${readFileSync(join(jevDir, rel), 'utf8')}`).join('\n');
}

/** The default counter: one python process, the pinned tokenizer.json files. */
export function pythonCounter(models) {
  const tokenizers = {};
  for (const [name, key] of Object.entries(TOKENIZERS)) {
    const path = join(CACHE_ROOT, 'hf', key, 'tokenizer.json');
    const want = models.models[key]?.files?.['tokenizer.json'];
    if (!want || sha256(readFileSync(path)) !== want) fail(`${path} does not match its pin in models.json`);
    tokenizers[name] = path;
  }
  const meta = Object.fromEntries(Object.entries(TOKENIZERS).map(([n, key]) => [n, { model: key, tokenizerSha256: models.models[key].files['tokenizer.json'] }]));
  return {
    meta,
    run(request) {
      const r = spawnSync(PYTHON, [join(HERE, 'count_tokens.py')], { input: JSON.stringify({ ...request, tokenizers }), encoding: 'utf8', maxBuffer: 1 << 28 });
      if (r.status !== 0) fail(`count_tokens.py exit ${r.status}: ${r.stderr}`);
      return JSON.parse(r.stdout);
    },
  };
}

/**
 * Build every context and the manifest. `counter.run(request)` answers like count_tokens.py; `lintText` is the EXP 005
 * lint (injected so tests can run without it). Returns { manifest, contexts: Map<"<id>.<S|M|L>", text> }.
 */
export async function build({ jevDir = JEV_DIR, corpusXDir = CORPUS_X_DIR, counter, lintText }) {
  const { sums, inputs } = assertExp005(jevDir);
  const distractor = readFileSync(join(HERE, DISTRACTOR.file));
  if (sha256(distractor) !== DISTRACTOR.sha256) fail(`${DISTRACTOR.file} does not match its pin`);
  const rules = readFileSync(join(jevDir, 'rules.txt'), 'utf8');
  const base = renderBase(jevDir, sums);
  const contexts = new Map();
  const heads = [];
  const source = new Map();
  const all = [
    ...inputs.items.map(item => ({ id: item.id, src: 'exp005', state: item.state, diff: readFileSync(join(jevDir, 'corpus', `${item.id}.patch`), 'utf8') })),
    ...assertCorpusX(corpusXDir, rules).map(x => ({ ...x, src: 'exp008x', state: null })),
  ];
  for (const item of all) {
    const { diff } = item;
    source.set(item.id, item.src);
    const S = `${rules}\n\n${diff}`;
    if (item.state !== null && S !== item.state) fail(`${item.id}: S differs from the EXP 005 gate state`);
    contexts.set(`${item.id}.S`, S);
    contexts.set(`${item.id}.M`, `${rules}\n\n${base}\n\n${diff}`);
    heads.push({ id: item.id, head: `${rules}\n\n${base}\n\n${DISTRACTOR.header}`, tail: `\n\n${diff}` });
  }
  const padded = counter.run({
    target: TARGET_TOKENS, distractor: distractor.toString('utf8'), items: heads,
    count: [...contexts].map(([id, text]) => ({ id, text })),
  });
  const lines = distractor.toString('utf8').split('\n');
  const counts = new Map(padded.counts.map(c => [c.id, c.tokens]));
  const items = [];
  let lintFindings = 0;
  for (const p of padded.items) {
    const h = heads.find(x => x.id === p.id);
    const L = h.head + lines.slice(0, p.lines).join('\n') + h.tail;
    contexts.set(`${p.id}.L`, L);
    for (const [name, n] of Object.entries(p.tokens)) {
      if (Math.abs(n - TARGET_TOKENS) > TARGET_TOKENS * TOLERANCE) fail(`${p.id}.L is ${n} ${name} tokens, outside 16K ±10%`);
    }
    const entry = { id: p.id, source: source.get(p.id), strata: {} };
    for (const s of ['S', 'M', 'L']) {
      const text = contexts.get(`${p.id}.${s}`);
      const findings = lintText(text, `state:${p.id}`);
      lintFindings += findings.length;
      if (findings.length) fail(`${p.id}.${s} fails the EXP 005 lint: ${JSON.stringify(findings[0])}`);
      const tokens = s === 'L' ? p.tokens : counts.get(`${p.id}.${s}`);
      const paddingShare = s === 'L'
        ? Object.fromEntries(Object.entries(p.padTokens).map(([n, v]) => [n, Number((v / p.tokens[n]).toFixed(4))]))
        : Object.fromEntries(Object.keys(tokens).map(n => [n, 0]));
      entry.strata[s] = { sha256: sha256(text), bytes: Buffer.byteLength(text), tokens, paddingShare, ...(s === 'L' ? { distractorLines: p.lines } : {}) };
    }
    items.push(entry);
  }
  const manifest = {
    schemaVersion: 1,
    note: 'EXP 008 (latent-handoff) strata. Rebuild with `node experiments/latent-handoff/strata.mjs`; two builds are byte-identical. Token counts are of the raw context text (no special tokens, no chat template).',
    builder: { strataSha256: sha256(readFileSync(join(HERE, 'strata.mjs'))), countTokensSha256: sha256(readFileSync(join(HERE, 'count_tokens.py'))) },
    exp005: { ...EXP005 },
    tokenizers: counter.meta,
    layout: { S: 'rules + "\\n\\n" + diff', M: 'rules + "\\n\\n" + base/ + "\\n\\n" + diff', L: 'rules + "\\n\\n" + base/ + "\\n\\n" + distractor header + distractor lines + "\\n\\n" + diff' },
    distractor: { ...DISTRACTOR },
    target: { tokens: TARGET_TOKENS, tolerance: TOLERANCE, rule: 'largest distractor line count with mean(qwen3, llama3) <= target' },
    lint: { contexts: items.length * 3, findings: lintFindings },
    items,
  };
  return { manifest, contexts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : join(CACHE_ROOT, 'strata');
  try {
    const models = JSON.parse(readFileSync(join(HERE, 'models.json'), 'utf8'));
    const { lintText } = await import('../jev-gate/lint.mjs');
    const { manifest, contexts } = await build({ counter: pythonCounter(models), lintText });
    mkdirSync(out, { recursive: true });
    for (const [id, text] of contexts) writeFileSync(join(out, `${id}.txt`), text);
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(`${MANIFEST_PATH}.tmp`, json);
    renameSync(`${MANIFEST_PATH}.tmp`, MANIFEST_PATH);
    process.stdout.write(`strata: ${manifest.items.length} items x 3 strata, lint findings ${manifest.lint.findings}, manifest sha256 ${sha256(json)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
