// Lab 11's scorer, shared by the runner (run.mjs), the record's vendor and the site build, so a reply is scored the
// same way everywhere. A reply is the model's text; the truth is the fixture's file list and its test suite's result.
//
//   readable   the reply holds one JSON object with a list of strings `files` and a `tests` of PASS, FAIL or UNKNOWN
//   invented   the named paths that are not files of the fixture (after "./" and the folder name are stripped)
//   wrongPass  the reply says PASS while the suite failed
//   verdict    PASS, FAIL or UNKNOWN as the reply says it; null when unreadable
//
// The harness's check (the harnessed arm only) refuses a reply that names an invented file or whose verdict is not the
// suite's own result; it is deterministic, so what it lets through is right by construction, not by the model.

export const VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'];

/** The first JSON object in the text: a fenced block, or the outermost braces. */
function firstObject(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const from = c.indexOf('{'), to = c.lastIndexOf('}');
    if (from < 0 || to <= from) continue;
    try { const v = JSON.parse(c.slice(from, to + 1)); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}

export const normalisePath = p => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/^fixture\//, '');

/** Score one reply against the truth { files: [...paths], suite: 'PASS'|'FAIL' }. */
export function scoreReply(text, truth) {
  const obj = firstObject(String(text ?? ''));
  const files = obj?.files, tests = typeof obj?.tests === 'string' ? obj.tests.trim().toUpperCase() : null;
  if (!obj || !Array.isArray(files) || files.some(f => typeof f !== 'string') || !VERDICTS.includes(tests)) {
    return { readable: false, named: 0, invented: 0, verdict: null, wrongPass: false };
  }
  const known = new Set(truth.files);
  // A path that is empty after normalising ("", "./", "fixture/") names no file of the project: it counts as invented,
  // never dropped, so the harness's check cannot be passed with one.
  const named = [...new Set(files.map(normalisePath))];
  const invented = named.filter(p => !p || !known.has(p)).length;
  return { readable: true, named: named.length, invented, verdict: tests, wrongPass: tests === 'PASS' && truth.suite !== 'PASS' };
}

/** The harness's check: why it refuses a scored reply (empty when it accepts). */
export function harnessRefusals(score, truth) {
  if (!score.readable) return ['the reply is not one JSON object with files and tests'];
  const out = [];
  if (score.invented > 0) out.push('it names a file that is not in the repository');
  if (score.verdict !== truth.suite) out.push(`the test suite's result is ${truth.suite}, not ${score.verdict}`);
  return out;
}
