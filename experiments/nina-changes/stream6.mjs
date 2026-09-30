// EXP 006 NDJSON stream parser and harness-failure classification for `claude -p --output-format stream-json
// --verbose` (declared as a difference from EXP 005, which read one JSON object).
//
// The stream is one JSON event per line: a `system` init event, `assistant` events whose content holds `tool_use`
// blocks, `user` events whose content holds `tool_result` blocks (tool_use_id, content, is_error), and a final
// `result` event (subtype, is_error, result, total_cost_usd, num_turns, duration_ms, permission_denials, modelUsage).
import { createHash } from 'node:crypto';

/**
 * EXP 005 amendment-01 zero-patches `harnessFailure`, VERBATIM except the one translation R4-2 states ("missing or
 * unparseable JSON" -> "no parseable final type:"result" line, or an unparseable NDJSON line").
 */
export const HARNESS_FAILURE_DEFINITION = 'A counted run that ends in a timeout, a non-zero client exit, no parseable final `type:"result"` line, or an unparseable NDJSON line, is_error: true, or an empty result. A run with a completed result and no verdict line is a model abstention, not a harness failure.';

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** The text a tool_result carried: a string, or the text blocks of an array (other block types are named). */
export function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => (b?.type === 'text' ? String(b.text ?? '') : `[${b?.type ?? 'block'}]`)).join('\n');
  return content == null ? '' : JSON.stringify(content);
}

/** Parse the stream. Never throws: malformed lines are counted and the caller classifies them. */
export function parseStream(stdout) {
  const lines = String(stdout ?? '').split('\n').filter(l => l.trim());
  const events = [], malformed = [];
  lines.forEach((l, i) => { try { const e = JSON.parse(l); if (e && typeof e === 'object') events.push(e); else malformed.push(i); } catch { malformed.push(i); } });
  const init = events.find(e => e.type === 'system' && e.subtype === 'init') ?? null;
  const last = events.at(-1) ?? null;
  const finalResult = last?.type === 'result' && malformed.every(i => i < lines.length - 1) ? last : null;
  const uses = new Map(), order = [];
  for (const e of events) {
    for (const b of (e.type === 'assistant' ? e.message?.content : null) ?? []) {
      if (b?.type === 'tool_use') { uses.set(b.id, { id: b.id, tool: b.name, input: b.input ?? {}, result: null }); order.push(b.id); }
    }
    for (const b of (e.type === 'user' ? e.message?.content : null) ?? []) {
      if (b?.type === 'tool_result' && uses.has(b.tool_use_id)) uses.get(b.tool_use_id).result = { isError: b.is_error === true, text: resultText(b.content) };
    }
  }
  // A call the permission layer refused is listed in the final result's permission_denials by its tool_use_id.
  // is_error alone is not a refusal: live (phase B discovery) the client also sets it on a git command that ran and
  // printed, when its own cwd-tracking write under the sandbox fails ("Exit code 1 … zsh: operation not permitted").
  const refusedIds = new Set((Array.isArray(finalResult?.permission_denials) ? finalResult.permission_denials : []).map(d => d?.tool_use_id).filter(Boolean));
  const toolCalls = order.map(id => uses.get(id)).map(u => ({ id: u.id, tool: u.tool, input: u.input, isError: u.result ? u.result.isError : null, refused: refusedIds.has(u.id), output: u.result ? u.result.text : null }));
  return { lineCount: lines.length, malformed, events: events.length, init, finalResult, toolCalls };
}

/**
 * The harness-failure rule above, in EXP 005 classifyRun's order: timeout, non-zero exit, no final result line or a
 * malformed line, is_error, empty result. Returns {harnessFailure, out (the final result event or null), parsed}.
 */
export function classifyStreamRun({ timedOut, exitCode, stdout, error = null }) {
  const parsed = parseStream(stdout);
  if (timedOut) return { harnessFailure: 'timeout', out: null, parsed };
  if (error) return { harnessFailure: 'spawn-error', out: null, parsed };
  if (exitCode !== 0) return { harnessFailure: `exit-${exitCode}`, out: parsed.finalResult, parsed };
  if (parsed.malformed.length) return { harnessFailure: 'unparseable-ndjson-line', out: null, parsed };
  if (!parsed.finalResult) return { harnessFailure: 'no-final-result-line', out: null, parsed };
  const out = parsed.finalResult;
  if (out.is_error === true) return { harnessFailure: 'is-error', out, parsed };
  if (typeof out.result !== 'string' || !out.result.trim()) return { harnessFailure: 'empty-result', out, parsed };
  return { harnessFailure: null, out, parsed };
}

/** Which tool outputs a record keeps as text (R2-5): git Bash calls and Read/Grep/Glob. Others keep sha + length only. */
export const keepsOutput = call => ['Read', 'Grep', 'Glob'].includes(call.tool) || (call.tool === 'Bash' && /(^|[\s;&|(])git(\s|$)/.test(String(call.input?.command ?? '')));

/**
 * The recorded form of a run's tool calls, from already-scrubbed calls: tool, input, is_error, output sha256 + byte
 * length, the output text where kept, and a per-call boolean for a change-fingerprint hit (`hit` is injected).
 */
export function recordToolCalls(calls, hit = () => false) {
  return calls.map((c, n) => {
    const out = c.output ?? null;
    return {
      n, tool: c.tool, input: c.input, isError: c.isError, refused: c.refused === true,
      outputSha256: out === null ? null : sha256(out), outputBytes: out === null ? null : Buffer.byteLength(out),
      ...(keepsOutput(c) ? { output: out } : {}),
      fingerprintHit: hit(c),
    };
  });
}
