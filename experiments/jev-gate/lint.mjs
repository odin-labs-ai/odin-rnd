// WO-05: leakage lint for gate-facing text (corpus patches, rules.txt, the question).
//
// A gate must not be able to read the answer off the input. The lint refuses:
//   * a family name from corpus-spec.json, as a whole word anywhere (hyphenated or spaced form);
//   * a blueprint rule id, as a whole word anywhere;
//   * a label word (drift, clean, violation, ...) as a whole token in a path, a patch id or a
//     hunk header. Ordinary code such as `cleanup()` passes: tokens split on non-alphanumerics,
//     so `cleanup` is not `clean`;
//   * a private path, an email address or a credential-shaped string, anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from './bce-contract.mjs';

export const LABEL_WORDS = ['drift', 'drifted', 'clean', 'violation', 'violations', 'violates', 'violating', 'red', 'green', 'nearmiss', 'near', 'miss', 'label', 'intent', 'intended', 'allowed', 'forbidden', 'leak'];

const SECRET_PATTERNS = [
  ['private path', /\/Users\/|\/home\/[a-z]|[A-Za-z]:\\Users\\/],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}|\bsk_(?:live|test|ct)_[A-Za-z0-9]{10,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = word => new RegExp(`(?<![A-Za-z0-9_-])${escape(word)}(?![A-Za-z0-9_-])`, 'i');
const tokens = text => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function lintConfig() {
  const spec = JSON.parse(readFileSync(join(HERE, 'corpus-spec.json'), 'utf8'));
  const blueprint = JSON.parse(readFileSync(join(HERE, 'blueprint.json'), 'utf8'));
  const families = [...spec.families.map(f => f.family), ...spec.removedFamilies.map(f => f.family)];
  return { families, ruleIds: blueprint.constraints.map(c => c.id), labelWords: LABEL_WORDS };
}

const isPathLine = line => /^(diff --git |--- |\+\+\+ |rename from |rename to |copy from |copy to )/.test(line);

/** Findings for one gate-facing text. `name` is its file name (checked as an id). */
export function lintText(text, name, cfg = lintConfig()) {
  const findings = [];
  const add = (kind, where, detail) => findings.push({ name, kind, where, detail });
  const phrases = cfg.families.flatMap(f => [f, f.replace(/-/g, ' ')]);
  if (name && !/^c\d{3}\.patch$|^rules\.txt$|^gate-question\.json$|^state:c\d{3}$/.test(name)) add('id', 'name', `not a neutral id: ${name}`);
  if (name) for (const t of tokens(name)) if (cfg.labelWords.includes(t)) add('label word', 'name', t);
  text.split('\n').forEach((line, i) => {
    const where = `line ${i + 1}`;
    for (const p of phrases) if (wholeWord(p).test(line)) add('family name', where, p);
    for (const id of cfg.ruleIds) if (wholeWord(id).test(line)) add('rule id', where, id);
    if (isPathLine(line) || line.startsWith('@@')) {
      for (const t of tokens(line)) if (cfg.labelWords.includes(t)) add('label word', where, t);
    }
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) add(kind, where, line.trim().slice(0, 80));
  });
  return findings;
}

/** Private-path / email / credential scan only (for non-gate files in this directory). */
export function scanSecrets(text, name) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) findings.push({ name, kind, where: `line ${i + 1}`, detail: line.trim().slice(0, 80) });
  });
  return findings;
}
