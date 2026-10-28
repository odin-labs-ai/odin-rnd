// Lab 09, "Can a talk leak data?" (lane vp-bundle2). scripts/labs.mjs calls renderTalkLeak() and writes, into dist/
// only (nothing rendered is committed):
//   labs/talk-leak/index.html   the lab page, from site/labs/talk-leak/index.html (<!--TALK_*--> markers)
// The record is site/data/labs/talk-leak/record.json (odin-lab-talk-leak v1, scripts/schemas/odin-lab-talk-leak.schema.json),
// which scripts/vendor-talk-leak.mjs builds from the agent space's private repository at its main and from one run on a
// Mac; its sha256 is pinned in site/data/labs/talk-leak/record.sha256, which the Labs tile (scripts/lab-tiles.mjs) also
// checks. Beside it, site/data/labs/talk-leak/self-scan.json is the same scanner's pass over what this lab publishes.
//
// What the page may say is fixed here, not in the record. The TENANT is fiction (Northwind Labs, a made-up logistics
// firm) and is boxed as staged. The METHOD is real and told in words, with COUNTS only: the deny-list's terms and labels
// are never shown, because its labels and the scanner's own word lists name what it protects. The TESTS and the SCAN
// are real runs on a Mac, at the private main. The build refuses the record, every reason listed, when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed), or the kit record contract;
//   - the tests failed or errored, or count fewer tests than planted leaks;
//   - the gate found a problem or the scan an error, or it did not scan every file of the zip but its manifest;
//   - the deny-list's levels do not add up to its terms;
//   - the self-scan is missing, was not made with this scanner, found anything beyond this site's own public names, or
//     names a file whose bytes have changed since (the page, the record, the tile or the template);
//   - a date is not real or is after the build, or any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks), with only the record's own hashes masked.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, realInstant, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const TALK_RECORD = 'data/labs/talk-leak/record.json';
export const TALK_PIN = 'data/labs/talk-leak/record.sha256';
export const TALK_SELF_SCAN = 'data/labs/talk-leak/self-scan.json';
export const TALK_TILE = 'data/labs/talk-leak-tile.json';
export const TALK_TEMPLATE = 'labs/talk-leak/index.html';
export const TALK_SCHEMA = join(here, 'schemas/odin-lab-talk-leak.schema.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const total = o => Object.values(o).reduce((a, b) => a + b, 0);
const OTHER_CHECKS = 6;
const realInstantOk = iso => typeof iso === 'string' && realInstant(iso) !== null;
// The scan's kinds and the planted leaks' names, in words; a key this page does not know refuses the record.
const KIND_WORDS = { repo: 'a private repository\'s name', org: 'the GitHub organisation\'s name', person: 'a real person', machine: 'a team machine\'s name', client: 'the client\'s name', game: 'a game studio\'s terms', 'number-figure': 'a real internal figure', 'number-money': 'a money amount', 'number-named': 'a figure beside its name', 'secret-gh': 'a GitHub token', 'secret-sk': 'an API key', 'secret-jwt': 'a signed web token', 'secret-link': 'an invite link\'s token', email: 'an e-mail address', 'local-path': 'a machine path', 'internal-ip': 'an internal address', number: 'a real internal figure', secret: 'a secret' };

/** Every reason the record may not be published (empty when it may). */
export function talkLeakProblems(record, { now = new Date(), where = TALK_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(TALK_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-talk-leak v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where), ...vendoredProblems(record.vendored, { where, now }));
  const t = record.tests, s = record.scan, d = record.denylist;
  for (const [iso, at] of [[record.vendored.committed, '/vendored/committed'], [t.at, '/tests/at'], [s.at, '/scan/at']]) problems.push(...instantProblems(iso, `${where}#${at}`, now));
  if (t.at.slice(0, 10) !== t.on) problems.push(`${where}#/tests/on: not the date of its run`);
  if (s.at.slice(0, 10) !== s.on) problems.push(`${where}#/scan/on: not the date of its run`);
  if (t.failed !== 0 || t.errors !== 0) problems.push(`${where}#/tests: a test failed or errored; this page says they passed`);
  if (t.passed < t.plants.length) problems.push(`${where}#/tests: fewer tests passed than leaks are planted, one test each`);
  // The page names the other checks one by one, six of them.
  if (t.passed - t.plants.length !== OTHER_CHECKS) problems.push(`${where}#/tests: ${t.passed - t.plants.length} checks beside the planted leaks; the page names ${OTHER_CHECKS}`);
  if (s.verifyProblems !== 0) problems.push(`${where}#/scan/verifyProblems: the page says the gate found no problem`);
  if (s.errors !== 0 || total(s.errorsByKind) !== 0) problems.push(`${where}#/scan/errors: the page says the scan found no error`);
  if (s.manifests !== 1 || s.files + s.binary !== s.entries - s.manifests) problems.push(`${where}#/scan: scanned ${s.files} text and ${s.binary} binary files, not every one of the zip's ${s.entries} but its manifest`);
  if (d.errors + d.warns !== d.terms) problems.push(`${where}#/denylist: errors and warnings do not add up to its terms`);
  // The scan's counts are keyed by its kinds and levels, which the screen does not read as text: only known words.
  for (const k of Object.keys(s.errorsByKind)) if (!Object.hasOwn(KIND_WORDS, k)) problems.push(`${where}#/scan/errorsByKind: ${JSON.stringify(k.slice(0, 20))} is not a kind this page knows`);
  for (const p of t.plants) if (!Object.hasOwn(KIND_WORDS, p)) problems.push(`${where}#/tests/plants: ${JSON.stringify(p.slice(0, 20))} is not a kind this page knows`);
  return problems;
}

/** Why the self-scan may not stand beside this record and page (empty when it may). */
export function selfScanProblems(scan, files, record, where = TALK_SELF_SCAN) {
  if (!scan) return [`${where}: missing (run scripts/vendor-talk-leak.mjs --self-scan)`];
  if (typeof scan !== 'object' || Array.isArray(scan)) return [`${where}: not a JSON object`];
  // A closed receipt: exactly these fields, the findings an empty object, the counts non-negative whole numbers.
  const KEYS = ['at', 'denylistSha256', 'files', 'findings', 'format', 'publicNames', 'scanner', 'scannerSha256', 'version'];
  if (JSON.stringify(Object.keys(scan).sort()) !== JSON.stringify(KEYS)) return [`${where}: not exactly the fields ${KEYS.join(', ')}`];
  const problems = [];
  if (scan.format !== 'odin-lab-talk-leak-self-scan' || scan.version !== 1) problems.push(`${where}: not odin-lab-talk-leak-self-scan v1`);
  const pinned = Object.fromEntries(record.vendored.files.map(f => [f.role, f.sha256]));
  if (scan.scanner !== record.vendored.commit) problems.push(`${where}#/scanner: not the scanner at the record's main`);
  if (scan.scannerSha256 !== pinned.scanner) problems.push(`${where}#/scannerSha256: not the scanner the record cites`);
  if (scan.denylistSha256 !== pinned.denylist) problems.push(`${where}#/denylistSha256: not the deny-list the record cites`);
  if (!realInstantOk(scan.at)) problems.push(`${where}#/at: not a real instant`);
  if (!Number.isInteger(scan.publicNames) || scan.publicNames < 0) problems.push(`${where}#/publicNames: not a count`);
  if (!scan.findings || typeof scan.findings !== 'object' || Array.isArray(scan.findings) || Object.keys(scan.findings).length) problems.push(`${where}#/findings: the scan found something beyond this site's own public names, or did not say`);
  const want = ['the rendered page', 'the record', 'the Labs tile', 'the page template'];
  if (!Array.isArray(scan.files) || JSON.stringify(scan.files.map(f => f?.what)) !== JSON.stringify(want) || scan.files.some(f => JSON.stringify(Object.keys(f).sort()) !== '["sha256","what"]')) problems.push(`${where}#/files: not exactly ${want.join(', ')}, each with its sha256`);
  else scan.files.forEach((f, i) => { if (f.sha256 !== sha256(files[i])) problems.push(`${where}#/files/${i}: ${f.what} has changed since it was scanned; re-run the self-scan`); });
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readTalkLeak(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: TALK_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: TALK_PIN, file: TALK_RECORD, vendor: 'scripts/vendor-talk-leak.mjs' }), check: record => talkLeakProblems(record, { now }), refused: 'Lab 09 record refused' });
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const n = v => escape(Number(v).toLocaleString('en-GB'));
const kind = k => escape(KIND_WORDS[k] ?? k.replaceAll('-', ' '));

export function renderIntro() {
  return `<span class="technical">LAB 09 · CAN A TALK LEAK DATA?</span><h1 id="lab-title">Can a talk leak data?</h1><p class="company-lead">A talk shows real software to a room, and anything private on a screen or in a shipped file is a leak. Ours is built to make one unlikely, not impossible: a made-up company to show, a sealed build that is the only way the talk leaves the machine it is made on, and a leak scan that fails the build. This page shows how the scan works, runs its own tests, and runs it again, fresh, over the sealed build.</p>`;
}

export function renderStagedReal(record) {
  return `<div class="rogue-split">${box('staged', { cls: 'talk-staged', id: 'staged', body: `<ul class="rogue-list"><li><strong>The company on stage.</strong> Northwind Labs, a logistics-software firm we made up: a route planner, a parcel tracking site, a fleet gateway. Its agents and people are invented, and its repositories sit under an organisation that is not ours.</li><li><strong>Its work.</strong> Synthetic records, made by a generator and checked to be its output, so none is typed by hand and none is copied from a real company.</li><li><strong>Who the talk is for.</strong> A real client, who is never named here. The talk is made for them, never as them.</li></ul>` })}${box('real', { cls: 'talk-real', id: 'real', body: `<ul class="rogue-list"><li><strong>The scan.</strong> The scanner as it is at the private main, cited by sha256, not a copy rewritten for this page.</li><li><strong>Its tests.</strong> Run on ${time(record.tests.on)}, on ${escape(record.tests.host)}: ${n(record.tests.passed)} passed.</li><li><strong>The fresh scan.</strong> The build gate's own check, run on ${time(record.scan.on)} over the sealed build's zip.</li></ul>` })}</div>`;
}

export function renderMethod(record) {
  const d = record.denylist;
  return `<p>The scan reads every text file it is given, twice: as written, and with its JSON escapes undone, because a name hidden inside an escaped string was missed at first. It reads every file's name too. A binary file is counted and only its name is read; the pictures in the build are drawn by our own code from the made-up company, which is itself scanned.</p><p>It fails on a private repository's name, a real person, a team machine, the client's name, a game studio's terms, a real internal figure near its name, a money amount (with one allowance, below), the shapes of tokens and keys, an e-mail address, a machine path and an internal address. A few common words that are also repository names only warn, unless they stand in a slug.</p><p>The names it protects are kept as a deny-list of <strong>${n(d.terms)} terms</strong> under <strong>${n(d.labels)} labels</strong> (${n(d.errors)} that fail the build, ${n(d.warns)} that warn), each stored only as the ${escape(d.hashedAs)}, so the list does not spell them. The real figures and the client's words come from two files that are never committed.</p>${box('summary', { cls: 'talk-hashed', id: 'hashed', body: `<h3>Hashed is not secret</h3><p>A short name can be found again from its hash by trying names. What the hashing prevents is the list itself becoming the leak, through a search or a copied file. That is why this page gives the list's counts and nothing else: not its terms, not its labels, which say what each term protects, and not its figures.</p>` })}`;
}

export function renderTests(record) {
  const t = record.tests;
  const plants = t.plants.map(p => `<li>${kind(p)}</li>`).join('');
  return `<p>On ${time(t.on)}, on ${escape(t.host)}, the scanner's own test ran with ${escape(t.how)}, Python ${escape(t.python)}: <strong>${n(t.passed)} passed, ${n(t.failed)} failed</strong>. ${n(t.plants.length)} of them each plant one leak and check it is caught, with its kind; the other ${n(t.passed - t.plants.length)} check that the made-up company and the build are clean, that a leak in a built bundle fails the command, that a file's name is read, that the deny-list holds no plain text, and that the presenter and the fiction pass.</p>${box('fixture', { cls: 'talk-plants', id: 'plants', body: `<p>The planted leaks are ours. The real names among them are read from our own files when the test runs, and the client's name is stored encoded, so the test itself carries no private plain text. The ${n(t.plants.length)} kinds:</p><ul class="rogue-list talk-plants-list">${plants}</ul>` })}`;
}

export function renderScan(record) {
  const s = record.scan;
  return `<p>On ${time(s.on)}, on ${escape(s.host)}, with ${escape(s.how)}. The zip, <code>${escape(s.zipSha256)}</code>, was first checked against its parts manifest: its ${n(s.zipBytes)} bytes, and its ${n(s.parts)} parts, each by sha256 and joined back into the zip. Then the gate checked each of the build's ${n(s.entries - s.manifests)} files against the build's own manifest by sha256, and scanned every one of them: ${n(s.files)} as text, ${n(s.binary)} as binary.</p><p class="talk-verdict"><strong>${n(s.verifyProblems)} problems, ${n(s.errors)} errors.</strong> ${n(s.warns)} warnings, and ${n(s.jsDollarDigit)} allowed.</p><ul class="rogue-list"><li><strong>A warning</strong> is one of the common words that are also repository names, outside a slug. It does not fail the build.</li><li><strong>An allowed finding</strong> is the gate's one allowance: a dollar sign and one to three digits in a JavaScript file, such as a pattern's back-reference or a name a bundler made up. The gate takes every such match in a JavaScript file as code, and does not check each one, so a real amount of that shape in a JavaScript string would pass it too. A plain scan without that one rule reads each as a money amount, and fails.</li></ul><p class="lab-source">The findings' text is not published, only these counts. The commit the build was made from is not on the private main, so this page names the build by its zip's sha256 instead, and does not cite it.</p>`;
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(cap(c.what))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(cap(f.what))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${TALK_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}. ${cite(v, mc)}</p><p>Before it was published, this page, its record, its tile and its template were run through the same scan; <a href="../../${TALK_SELF_SCAN}">what it found is published too</a>, file by file by sha256, with this site's own public names set aside and counted. The build refuses to publish if any of those files has changed since.</p><h3 class="lab-subhead">The commits it stands on</h3><ul class="rogue-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="rogue-list rogue-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>A scan only finds what its list and its shapes know. A name missing from the list is caught only by a person reading.</li><li>The hashes hide the list from a search, not from someone trying names.</li><li>A binary file's contents are not read, only its name; and a dollar sign with one to three digits in a JavaScript file passes the gate unchecked.</li><li>The sealed build itself is not published, so its zip's hash cannot be checked here. Anyone with the build can.</li><li>The build is meant to reach nothing beyond the machine it runs on. This page did not test that: it scanned the build's files, it did not watch it run.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderTalkLeak(root = 'site', { now = new Date(), selfScan = true } = {}) {
  const record = readTalkLeak(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, TALK_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--TALK_INTRO-->': renderIntro(record), '<!--TALK_STAGED_REAL-->': renderStagedReal(record), '<!--TALK_METHOD-->': renderMethod(record), '<!--TALK_TESTS-->': renderTests(record), '<!--TALK_SCAN-->': renderScan(record), '<!--TALK_CHECK-->': renderCheck(record), '<!--TALK_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${TALK_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${TALK_TEMPLATE}: unresolved content marker`);
  const v = record.vendored;
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [v.commit, v.mainCheck.main, ...v.mainCheck.commits] });
  if (leaks.length) throw new Error(`${TALK_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  // The self-scan must stand beside exactly these bytes (the vendor asks for the page without this check, to make it).
  if (selfScan) {
    const path = join(root, TALK_SELF_SCAN);
    const scan = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const files = [Buffer.from(html), readFileSync(join(root, TALK_RECORD)), readFileSync(join(root, TALK_TILE)), readFileSync(join(root, TALK_TEMPLATE))];
    const problems = selfScanProblems(scan, files, record);
    if (problems.length) throw new Error(`Lab 09 self-scan refused:\n  ${problems.join('\n  ')}`);
  }
  return { pages: { [TALK_TEMPLATE]: html } };
}
