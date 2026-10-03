// Fence audit for the two blind authors: every tool call's input is scanned for (a) absolute paths
// outside the author's fence (plus the OS temp dir for author B), (b) forbidden terms. Prints a JSON
// summary with counts only (no paths, no transcript text) so it can be committed publicly.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [transcript, fence, allowTmp, label] = process.argv.slice(2);
const raw = readFileSync(transcript, 'utf8');
const calls = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  let row; try { row = JSON.parse(line); } catch { continue; }
  const content = row?.message?.content;
  if (row?.message?.role !== 'assistant' || !Array.isArray(content)) continue;
  // For Write/Edit only the target path is scanned: the author's own code (e.g. a variable named
  // `result`) is output, not a read of a forbidden artifact.
  for (const part of content) if (part.type === 'tool_use') {
    const i = part.input || {};
    const scanned = ['Write', 'Edit', 'NotebookEdit'].includes(part.name) ? { file_path: i.file_path } : i;
    calls.push({ tool: part.name, input: JSON.stringify(scanned) });
  }
}
const allowed = [fence];
if (allowTmp === 'tmp') allowed.push('/var/folders/', '/tmp/', '/private/var/folders/');
const pathRe = /(?:~\/|\/(?:Users|private|var|tmp|opt|etc|home|Volumes)\b)[^\s"'`;|&<>)\\]*/g;
const forbidden = /\b(harness|probes?|results?|odin-rnd|kernel\.mjs|frozen-census|labels\.json|extension-filter|proven-core|odin-suite)\b/i;
let outside = 0, forbiddenHits = 0;
const outsideTools = {};
for (const c of calls) {
  for (const p of c.input.match(pathRe) || []) {
    if (!allowed.some(a => p.startsWith(a))) { outside++; outsideTools[c.tool] = (outsideTools[c.tool] || 0) + 1; }
  }
  if (forbidden.test(c.input.replace(/SPEC\.md/g, ''))) forbiddenHits++;
}
const tools = {};
for (const c of calls) tools[c.tool] = (tools[c.tool] || 0) + 1;
console.log(JSON.stringify({
  author: label,
  transcriptSha256: createHash('sha256').update(raw).digest('hex'),
  toolCalls: calls.length, tools,
  pathsOutsideFence: outside, outsideByTool: outsideTools,
  forbiddenTermCalls: forbiddenHits,
  forbiddenPattern: forbidden.source,
  verdict: outside === 0 && forbiddenHits === 0 ? 'FENCE-HELD' : 'FENCE-BREACHED',
}));
