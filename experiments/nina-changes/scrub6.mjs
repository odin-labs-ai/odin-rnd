// EXP 006 scrub and lint at write time (I8, R3-6). Every record EXP 006 writes goes through scrubPaths6, then lint6.
// scrubPaths6 = EXP 005's scrubPaths (run_reviewer.mjs SCRUB_RULES, unchanged) after ONE new rule for EXP 006's own
// run-dir prefix: any path ending in a run dir `…/nina-changes-reviewer-XXXXXX` collapses to <ws>, as EXP 005's rule 1
// does for `jev-gate-reviewer-`. lint6 then refuses a record that still carries a home path, a macOS temp bucket, the
// operator's session uid, or a restricted term (the fingerprints check.mjs keeps, read from its source, never copied).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { scrubPaths } from '../jev-gate/run_reviewer.mjs';
import { REPO_ROOT } from '../jev-gate/runner-guard.mjs';
import { scanSecrets } from '../jev-gate/lint.mjs';

export const RUN_PREFIX6 = 'nina-changes-reviewer-';
export const SCRUB_RULE6 = [/(?:\/[^\s"'\\/<>]+)*\/nina-changes-reviewer-[A-Za-z0-9]{6}/g, '<ws>'];
export const scrubPaths6 = text => scrubPaths(String(text).replace(SCRUB_RULE6[0], SCRUB_RULE6[1]));
export const scrubRecord6 = value => JSON.parse(scrubPaths6(JSON.stringify(value)));

// check.mjs keeps restricted terms only as fingerprints; they are read from its source so there is one list.
const restricted = (() => {
  const src = readFileSync(join(REPO_ROOT, 'scripts', 'check.mjs'), 'utf8');
  const m = /^const restrictedFingerprints = (\{.*\});$/m.exec(src);
  if (!m) throw new Error('scripts/check.mjs no longer declares restrictedFingerprints on one line');
  return Object.entries(JSON.parse(m[1])).map(([size, digests]) => [Number(size), new Set(digests)]);
})();
const hasRestricted = text => {
  const lower = text.toLowerCase();
  for (const [len, blocked] of restricted) for (let i = 0; i <= lower.length - len; i += 1) if (blocked.has(createHash('sha256').update(lower.slice(i, i + len)).digest('hex'))) return true;
  return false;
};

/** Findings for a record's text: private paths / credentials (EXP 005 lint), the session uid, restricted terms. */
export function lint6(text, name = 'record') {
  const findings = scanSecrets(text, name).map(f => `${f.kind} at ${f.where}`);
  if (/claude-\d{2,}/.test(text)) findings.push('an operator session uid (claude-<digits>)');
  if (/\/Users\//.test(text)) findings.push('a home path');
  if (hasRestricted(text)) findings.push('a restricted term');
  return findings;
}

/** Scrub, lint, and refuse to return a record that still leaks. */
export function publicRecord6(value, name) {
  const scrubbed = scrubRecord6(value);
  const findings = lint6(JSON.stringify(scrubbed, null, 2), name);
  if (findings.length) throw new Error(`${name}: refusing to write a record that leaks: ${[...new Set(findings)].slice(0, 5).join('; ')}`);
  return scrubbed;
}
