// EXP 007 amendment 01: the validator, the published copy and the field note's "Amendment 01" section.
//   node scripts/blueprint-floor-amendment.mjs --check   validate the record against its pin, its parent and the files
//   node scripts/blueprint-floor-amendment.mjs --pin     write experiments/blueprint-floor/amendment-01.sha256
// The record states the incident, the eligibility rule and the one re-call; it shows no census result. The build copies it
// byte for byte to site/data/blueprint-floor/amendment-01.json and adds its dated section to the EXP 007 note.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlePath, resultWords } from './blueprint-floor-note.mjs';

export { articlePath };
const D = 'experiments/blueprint-floor';
export const recordPath = `${D}/amendment-01.json`;
export const pinPath = `${D}/amendment-01.sha256`;
export const publishedPath = 'site/data/blueprint-floor/amendment-01.json';
export const parentPath = `${D}/preregistration.json`;
export const DECISION_VERBATIM = 'Amend, then re-call once (Recommended)';
export const MESSAGE = 'You\'ve hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message · your weekly limit resets Oct 9 at 3am (Europe/Amsterdam)';
export const PREFIX = 'You\'ve hit your monthly spend limit';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const REQUIRED = ['schemaVersion', 'kind', 'experiment', 'id', 'title', 'authoredOn', 'parent', 'decision', 'incident', 'eligibility', 'recall', 'unchanged', 'onlyChange', 'attempt1Code', 'notBefore', 'disclosures'];

/** The pins of the counted-path code at the attempt-1 commit, read from git (the commit is in this repository's history). */
export function attempt1Pins(commit, root = '.') {
  const text = execFileSync('git', ['show', `${commit}:${D}/runners.sha256`], { cwd: root, encoding: 'utf8' });
  return Object.fromEntries(text.split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}

/** Every fact the record states that the files can confirm. Returns the record. */
export function validateAmendment(record, { parentSha256, root = '.', verifyHistory = false } = {}) {
  for (const f of REQUIRED) assert(f in record, `amendment 01 has no ${f}`);
  assert.equal(record.kind, 'amendment');
  assert.equal(record.experiment, 'EXP 007');
  assert.equal(record.id, 'amendment-01');
  assert.equal(record.parent.file, parentPath);
  assert.equal(record.parent.sha256, parentSha256, 'amendment 01 names the published pre-registration as its parent');
  assert.equal(record.decision.verbatim, DECISION_VERBATIM, 'the founder decision is quoted verbatim');
  assert.equal(record.incident.message, MESSAGE, 'the incident message is quoted verbatim');
  const e = record.eligibility;
  assert.equal(e.message, MESSAGE);
  assert.equal(e.messagePrefix, PREFIX);
  assert(e.message.startsWith(e.messagePrefix));
  assert.equal(e.messageSha256, sha256(e.message));
  assert.equal(e.harnessFailure, 'nonzero-exit');
  assert.deepEqual(record.incident.affected, { translatorCalls: 37, secondarySample: 30, secondaryOf: 30, primary: 7, primaryOf: 145, controls: 0, adjudicatorCallsSkipped: 37 });
  assert.equal(Object.keys(record.attempt1Code).length, 34);
  assert(Object.values(record.attempt1Code).every(h => /^[0-9a-f]{64}$/.test(h)));
  // The history check needs the attempt-1 commit, so it runs in --check and the tests, not in the build (a fresh copy
  // or a shallow CI clone has no history); the record itself is pinned by its sha256 either way.
  if (verifyHistory) assert.deepEqual(record.attempt1Code, attempt1Pins(record.incident.attempt1Commit, root), 'attempt1Code is the counted-path pins at the attempt-1 commit');
  assert(record.unchanged.some(x => /scorer/.test(x)), 'the scorer is named unchanged');
  assert.equal(record.disclosures.length, 3);
  const text = JSON.stringify(record);
  assert(!resultWords.test(text.replace(/\bpasses\b/g, '')), 'amendment 01 states no result');
  assert(!/expressible share is|median (expressible )?share (is|was) \d/i.test(text), 'amendment 01 states no result');
  return record;
}

/** The record on disk: pinned, valid, its parent the pinned pre-registration, its site copy byte-identical. */
export function checkAmendment(root = '.', { verifyHistory = false } = {}) {
  const bytes = readFileSync(join(root, recordPath));
  const pinned = existsSync(join(root, pinPath)) ? readFileSync(join(root, pinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}`);
  const parentSha256 = sha256(readFileSync(join(root, parentPath)));
  const record = validateAmendment(JSON.parse(bytes), { parentSha256, root, verifyHistory });
  if (existsSync(join(root, publishedPath))) assert.equal(sha256(readFileSync(join(root, publishedPath))), sha256(bytes), `${publishedPath} is not byte-identical to ${recordPath}`);
  return { record, sha256: sha256(bytes), bytes };
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;

/** The note's dated "Amendment 01" section, from the record. It shows no census result. */
export function renderSection(record, recordSha256) {
  const i = record.incident, e = record.eligibility, a = i.affected;
  return `<section id="amendment-01"><h2>Amendment 01 (${escape(record.authoredOn)}): ${escape(record.title.replace(/^Amendment 01: /, ''))}</h2>
<p><strong>Founder decision, verbatim:</strong> “${escape(record.decision.verbatim)}”</p>
<p>${escape(i.summary)}</p>
<p>From ${escape(i.firstRefusedCallEndedAt)} the pinned client (${escape(i.client)}) answered every call with this message and a non-zero exit:</p>
<pre tabindex="0">${escape(i.message)}</pre>
<p>Affected: ${a.translatorCalls} translator calls, ${a.secondarySample} of the ${a.secondaryOf} secondary-sample rules and ${a.primary} of the ${a.primaryOf} primary rules, no control; their ${a.adjudicatorCallsSkipped} adjudicator calls were not made. ${escape(i.charged)} ${escape(i.untouched)}</p>
<h3>Which rules are re-called</h3>
<p>${escape(e.rule)}</p>
<h3>The re-call</h3>
${list(record.recall.map(escape))}
<p>Unchanged: ${record.unchanged.map(escape).join('; ')}. ${escape(record.onlyChange)}</p>
<p>${escape(record.notBefore)}</p>
<h3>Disclosed with the results</h3>
${list(record.disclosures.map(escape))}
<p>This section is rendered from <a href="../data/blueprint-floor/amendment-01.json"><code>amendment-01.json</code></a> (sha256 ${code(recordSha256)}), whose parent is the pre-registration above (sha256 ${code(record.parent.sha256)}).</p>
</section>
`;
}

/** The built note: the committed render of the pre-registration plus the amendment's section before "Provenance". */
export function amendNote(html, record, recordSha256) {
  const at = html.indexOf('<h2>Provenance</h2>');
  assert(at > 0, 'the EXP 007 note has a Provenance heading');
  assert(!html.includes('id="amendment-01"'), 'the note already carries amendment 01');
  const section = renderSection(record, recordSha256);
  assert(!resultWords.test(section), 'the amendment section states a result');
  return `${html.slice(0, at)}${section}${html.slice(at)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--pin') {
    const parentSha256 = sha256(readFileSync(parentPath));
    validateAmendment(JSON.parse(readFileSync(recordPath, 'utf8')), { parentSha256, verifyHistory: true });
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  amendment-01.json\n`);
    writeFileSync(publishedPath, readFileSync(recordPath));
    console.log(`Pinned ${recordPath} in ${pinPath} and copied it to ${publishedPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/blueprint-floor-amendment.mjs --check | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment('.', { verifyHistory: true });
  console.log(`PASS ${recordPath} sha256 ${digest} (attempt-1 code checked against git history)`);
}
