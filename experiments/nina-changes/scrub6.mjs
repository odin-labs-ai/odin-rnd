// EXP 006 scrub and lint at write time (I8, R3-6). Every record EXP 006 writes goes through scrubPaths6, then lint6.
// scrubPaths6 = EXP 005's scrubPaths (run_reviewer.mjs SCRUB_RULES, unchanged) after ONE new rule for EXP 006's own
// run-dir prefix: any path ending in a run dir `…/nina-changes-reviewer-XXXXXX` collapses to <ws>, as EXP 005's rule 1
// does for `jev-gate-reviewer-`. lint6 then refuses a record that still carries a home path, a macOS temp bucket, the
// operator's session uid, or a restricted term (the fingerprints check.mjs keeps, read from its source, never copied).
// EXP 006 amendment 01 (A1): a DIGEST FIELD is not scanned for restricted terms, because a random sha256 can contain
// one of check.mjs's short fingerprint windows by chance (the dry run's p06 run 2 was refused for exactly that, in
// toolCalls.4.outputSha256). A digest field is a value of exactly 64 lowercase hex characters under a key named
// `sha256` or ending in `Sha256` (outputSha256, resultSha256, promptSha256, fingerprintsSha256, baseLinesSha256,
// prereg6Sha256, parentSha256, amendmentSha256, amendment02Sha256, corpusSha256, hook.sha256, …), or a value of the
// record's top-level `code` map (file -> sha256). Such a value can carry no path, uid or credential shape, and it is
// still linted for those; everything else (keys, prose, outputs, a 64-hex value under any other key) is scanned as before.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { scrubPaths } from '../jev-gate/run_reviewer.mjs';
import { REPO_ROOT } from '../jev-gate/runner-guard.mjs';
import { scanSecrets } from '../jev-gate/lint.mjs';

export const RUN_PREFIX6 = 'nina-changes-reviewer-';
export const SCRUB_RULE6 = [/(?:\/[^\s"'\\/<>]+)*\/nina-changes-reviewer-[A-Za-z0-9]{6}/g, '<ws>'];
// Phase B (sandbox6-only probe): a home path the client TRUNCATED in a tool output (…/Users/<part of a name>) is not
// the full home dir EXP 005's rule 4 matches, so it survived the scrub and lint6 refused the record. After EXP 005's
// rules, any remaining macOS or Linux home prefix (with whatever part of a user name follows) collapses to ~. The
// canary home <ws>/home/probe-user is already <ws>-relative by then and is left alone.
export const HOME_RULE6 = [/\/Users\/[^\s"'\\/<>]*|(?<![\w.~<>-])\/home\/(?!probe-user(?![\w-]))[^\s"'\\/<>]*/g, '~'];
export const scrubPaths6 = text => scrubPaths(String(text).replace(SCRUB_RULE6[0], SCRUB_RULE6[1])).replace(HOME_RULE6[0], HOME_RULE6[1]);
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
export function lint6(text, name = 'record', { restricted: scanRestricted = true } = {}) {
  const findings = scanSecrets(text, name).map(f => `${f.kind} at ${f.where}`);
  if (/claude-\d{2,}/.test(text)) findings.push('an operator session uid (claude-<digits>)');
  if (/\/Users\//.test(text)) findings.push('a home path');
  if (scanRestricted && hasRestricted(text)) findings.push('a restricted term');
  return findings;
}

export const DIGEST6 = /^[0-9a-f]{64}$/;
export const DIGEST_KEY6 = /^sha256$|Sha256$/;
/** A digest field (amendment 01, A1): 64 hex under a sha256-named key, or a value of the top-level `code` map. */
export const isDigestField6 = (path, value) => typeof value === 'string' && DIGEST6.test(value)
  && (DIGEST_KEY6.test(String(path.at(-1) ?? '')) || (path.length === 2 && path[0] === 'code'));
/** The record with every digest field replaced by a placeholder that holds no hex, for the whole-text lint. */
export const DIGEST_PLACEHOLDER6 = '<sha256>';
export function maskDigests6(value, path = []) {
  if (isDigestField6(path, value)) return DIGEST_PLACEHOLDER6;
  if (Array.isArray(value)) return value.map((v, i) => maskDigests6(v, [...path, String(i)]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDigests6(v, [...path, k])]));
  return value;
}
/** Every digest field's value, each linted without the restricted-term scan. */
const digestValues = (value, path = []) => {
  if (isDigestField6(path, value)) return [value];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => digestValues(v, [...path, k]));
  return [];
};

/** Findings for a whole record: the text lint on the record with its digest fields masked, and each digest's own lint. */
export function lintRecord6(value, name = 'record') {
  return [...lint6(JSON.stringify(maskDigests6(value), null, 2), name), ...digestValues(value).flatMap(d => lint6(d, name, { restricted: false }))];
}

/** The JSON paths of the string fields that still leak (names only, never the text), for a refused record. */
export function leakFields(value, path = '') {
  const walk = (v, parts) => {
    if (typeof v === 'string') return (isDigestField6(parts, v) ? lint6(v, 'record', { restricted: false }) : lint6(v)).length ? [parts.join('.') || '(root)'] : [];
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => walk(x, [...parts, k]));
    return [];
  };
  return walk(value, path ? path.split('.') : []);
}

/** Scrub, lint, and refuse to return a record that still leaks. */
export function publicRecord6(value, name) {
  const scrubbed = scrubRecord6(value);
  const findings = lintRecord6(scrubbed, name);
  if (findings.length) throw new Error(`${name}: refusing to write a record that leaks: ${[...new Set(findings)].slice(0, 5).join('; ')}`);
  return scrubbed;
}
