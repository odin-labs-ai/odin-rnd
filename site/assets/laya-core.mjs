// Laya typed decisions in the browser: sequence layout and answer formatting.
// A port of build_sequence/render_options (rl_common.py) and system_one (rl_agent_api.py) from
// huggingface.co/convaiinnovations/laya at 55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851,
// Copyright ConvAI Innovations, Apache-2.0. Changed: ported to JavaScript, one question per call,
// string states and string criteria only.

export const QTYPES = Object.freeze({ choice: 0, score: 1, noul: 2 });
const QTYPE_NAMES = ['choice', 'score', 'noul'];
const MASK = '[MASK]';

const withoutMask = text => String(text).split(MASK).join(' ');

// Python: {c: None for c in crit} when choice criteria arrive as a list.
export function toInternal(question) {
  let crit = question.criteria ?? null;
  if (question.type === 'choice' && Array.isArray(crit)) crit = Object.fromEntries(crit.map(label => [label, null]));
  return { t: question.type, ins: String(question.instructions), crit };
}

export function renderOptions(q) {
  if (q.t === 'choice') return Object.entries(q.crit).map(([key, value]) => (value ? `${key}: ${value}` : key));
  if (q.t === 'score') return q.crit.map((level, index) => `level ${index}: ${level}`);
  const crit = q.crit || {};
  return [`false: ${crit.false || 'no, the statement does not hold'}`, `true: ${crit.true || 'yes, the statement holds'}`];
}

// [CLS] <type> question: instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]
// encode(text) must return token ids without special tokens; special holds cls/sep/mask ids.
export function buildSequence(encode, special, state, q, maxLen, headMaxLen) {
  let headIds = encode(`${q.t} question: ${withoutMask(q.ins)}`);
  let optIds = renderOptions(q).map(option => [special.mask, ...encode(' ' + withoutMask(option)).slice(0, 48)]);
  const length = groups => groups.reduce((sum, group) => sum + group.length, 0);
  let optBudget = headMaxLen - length(optIds);
  if (optBudget < 16) {
    const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
    optIds = optIds.map(group => group.slice(0, per));
    optBudget = headMaxLen - length(optIds);
  }
  headIds = headIds.slice(0, Math.max(8, optBudget));
  const ids = [special.cls, ...headIds, special.sep];
  const markers = [];
  for (const group of optIds) { markers.push(ids.length); ids.push(...group); }
  ids.push(special.sep);
  const room = Math.max(0, maxLen - ids.length - 1);
  const stateIds = encode(withoutMask(state)).slice(0, room);
  return { ids: [...ids, ...stateIds, special.sep].slice(0, maxLen), markers: markers.filter(position => position < maxLen) };
}

export function temperatureBucket(qtype, k) {
  const size = k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+';
  return `${QTYPE_NAMES[qtype]}:${size}`;
}

export function temperature(cfg, qtype, k) {
  return cfg.temperature_by_options?.[temperatureBucket(qtype, k)] ?? cfg.temperature?.[qtype] ?? 1;
}

export function softmax(values) {
  const top = Math.max(...values);
  const exp = values.map(value => Math.exp(value - top));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(value => value / sum);
}

// 1 - normalized entropy, as confidence_from_probs.
export function confidence(p) {
  if (p.length < 2) return 1;
  const entropy = -p.reduce((sum, v) => sum + v * Math.log(Math.min(Math.max(v, 1e-12), 1)), 0);
  return 1 - entropy / Math.log(p.length);
}

const round4 = value => Math.round(value * 1e4) / 1e4;

// logits: the k raw marker scores for one question.
export function formatAnswer(q, logits, cfg) {
  const k = logits.length;
  const p = softmax(Array.from(logits, value => value / temperature(cfg, QTYPES[q.t], k)));
  if (q.t === 'choice') {
    const keys = Object.keys(q.crit);
    return { type: 'choice', choice: keys[p.indexOf(Math.max(...p))], probabilities: Object.fromEntries(keys.map((key, i) => [key, round4(p[i])])), confidence: round4(confidence(p)) };
  }
  if (q.t === 'score') {
    return { type: 'score', score: round4(p.reduce((sum, v, i) => sum + i * v, 0)), legend: Object.fromEntries(q.crit.map((level, i) => [String(i), level])), probabilities: Object.fromEntries(p.map((v, i) => [String(i), round4(v)])), confidence: round4(confidence(p)) };
  }
  return { type: 'noul', noul: round4(p[1]) };
}

// Parse the page form into the Jev-style question shape. Returns {question} or {error}.
export function questionFromForm({ type, instructions, options }) {
  const text = String(instructions || '').trim();
  if (!text) return { error: 'Write the question.' };
  const lines = String(options || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (type === 'noul') return { question: { type: 'noul', instructions: text } };
  if (lines.length < 2) return { error: 'Give at least two options, one per line.' };
  if (lines.length > 20) return { error: 'Give at most 20 options.' };
  if (type === 'score') return { question: { type: 'score', instructions: text, criteria: lines } };
  if (type !== 'choice') return { error: 'Unknown question type.' };
  const criteria = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    const label = (colon > 0 ? line.slice(0, colon) : line).trim();
    if (label in criteria) return { error: `The option “${label}” appears twice.` };
    criteria[label] = colon > 0 ? line.slice(colon + 1).trim() || null : null;
  }
  return { question: { type: 'choice', instructions: text, criteria } };
}
