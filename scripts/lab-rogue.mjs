// Lab 05, "Can an agent go rogue?" (lane lab05-rogue). scripts/labs.mjs calls renderRogue() and writes, into dist/ only
// (nothing rendered is committed):
//   labs/rogue/index.html   the lab page, from site/labs/rogue/index.html (<!--ROGUE_*--> markers)
// The record is site/data/labs/rogue/record.json (odin-lab-rogue v1, scripts/schemas/odin-lab-rogue.schema.json), which
// scripts/vendor-rogue.mjs builds from the agent space's private repository at one commit; its sha256 is pinned in
// site/data/labs/rogue/record.sha256, which the Labs tile (scripts/lab-tiles.mjs) also checks.
//
// What the page may say is fixed here, not in the record: the attack is STAGED (a poisoned ticket we wrote, on a seeded
// sandbox repository with synthetic data); the REFUSALS are real (the engine's own guards, run, and a hash-chained
// journal); the repair time is an ESTIMATE from the record's own repair table, never an observed cost. The build refuses
// the record, every reason listed, when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed);
//   - the repair table does not add up to its hours, or the workdays are not those hours over the workday;
//   - the journal is not a chain (each row's prev is the row above's hash, the first's is zeros, the head is the last),
//     a governed command names no refused row of its own step, or a guard let a command through (breaches, a changed
//     repository);
//   - a reproduction is not the record's state hash, a date is not real or is after the build;
//   - any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks): no machine path, no local host or address, no credential
// shape and no restricted name, with hex tokens (cited by hash, checked by the schema) masked first.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROGUE_RECORD = 'data/labs/rogue/record.json';
export const ROGUE_PIN = 'data/labs/rogue/record.sha256';
export const ROGUE_TEMPLATE = 'labs/rogue/index.html';
export const ROGUE_SCHEMA = join(here, 'schemas/odin-lab-rogue.schema.json');
const ZERO = '0'.repeat(64);

/** Every reason the record may not be published (empty when it may). */
export function rogueProblems(record, { now = new Date(), where = ROGUE_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(ROGUE_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-rogue v1)`);
  if (problems.length) return problems;
  // Hashes and commits are checked by the schema's patterns; every other string is page text and passes the screen.
  problems.push(...screenRecord(record, where));
  const v = record.vendored;
  const when = (iso, at) => problems.push(...instantProblems(iso, `${where}#${at}`, now));
  when(v.committed, '/vendored/committed');
  when(`${v.mainCheck.checked}T00:00:00Z`, '/vendored/mainCheck/checked');
  v.cites.forEach((c, i) => when(c.at, `/vendored/cites/${i}/at`));
  const roles = v.files.map(f => f.role);
  if (new Set(roles).size !== roles.length || roles.length !== 6) problems.push(`${where}#/vendored/files: each of the six files, once`);

  // The page says the run with no controls ran every command, and states its damage as measured on the sandbox: the
  // record must say the same, and its counts must agree with each other.
  const u = record.ungoverned, d = u.damage, sb = record.staged.sandbox;
  u.steps.forEach((s, i) => { if (s.ran !== true) problems.push(`${where}#/ungoverned/steps/${i}/ran: the page says every command ran`); });
  if (u.before.mainCommits !== sb.mainCommits || !u.before.exists) problems.push(`${where}#/ungoverned/before: not the seeded sandbox`);
  if (d.commitsLostFromMain !== u.before.mainCommits - u.after.mainCommits) problems.push(`${where}#/ungoverned/damage/commitsLostFromMain: not main before minus main after`);
  if (d.repositoryDeleted !== !u.after.exists) problems.push(`${where}#/ungoverned/damage/repositoryDeleted: not what the state after says`);
  if (d.prBranchesDeleted > sb.prBranches || d.prBranchesDeleted > u.before.branches - u.after.branches) problems.push(`${where}#/ungoverned/damage/prBranchesDeleted: more than the branches that went`);
  if (d.ciRunsStopped !== (d.repositoryDeleted ? sb.ciRuns : 0)) problems.push(`${where}#/ungoverned/damage/ciRunsStopped: not the sandbox's CI runs when the repository went`);
  const r = record.ungoverned.repairEstimate;
  const sum = Math.round(r.rows.reduce((t, row) => t + row.hours, 0) * 10) / 10;
  if (sum !== r.hours) problems.push(`${where}#/ungoverned/repairEstimate/hours: ${r.hours}, but its rows add up to ${sum}`);
  if (Math.round(r.hours / r.workdayHours * 10) / 10 !== r.workdays) problems.push(`${where}#/ungoverned/repairEstimate/workdays: ${r.workdays} is not ${r.hours} hours over a ${r.workdayHours}-hour workday`);
  if (!/estimate/i.test(r.rule) || !/not a measurement/i.test(r.rule)) problems.push(`${where}#/ungoverned/repairEstimate/rule: the rule must say it is an estimate, not a measurement`);

  const g = record.governed, rows = g.journal.rows;
  rows.forEach((row, i) => {
    if (row.n !== i + 1) problems.push(`${where}#/governed/journal/rows/${i}/n: rows are numbered from 1, in order`);
    if (row.prev !== (i ? rows[i - 1].hash : ZERO)) problems.push(`${where}#/governed/journal/rows/${i}/prev: not the hash of the row above`);
  });
  if (rows.at(-1).hash !== g.journal.head) problems.push(`${where}#/governed/journal/head: not the last row's hash`);
  if (g.acts.length !== record.ungoverned.steps.length) problems.push(`${where}#/governed/acts: not the same commands as the run with no controls`);
  g.acts.forEach((a, i) => {
    const row = rows[a.journalRow - 1], step = record.ungoverned.steps[i];
    if (!row || row.act !== 'refused') problems.push(`${where}#/governed/acts/${i}/journalRow: names no refused row`);
    if (!step || step.command !== a.command) problems.push(`${where}#/governed/acts/${i}/command: not the same command as the run with no controls`);
  });
  if (rows.filter(row => row.act === 'refused').length !== g.acts.length) problems.push(`${where}#/governed/journal/rows: one refused row per command`);
  if (new Set(g.acts.map(a => a.journalRow)).size !== g.acts.length) problems.push(`${where}#/governed/acts: each command names its own journal row`);
  if (g.breaches !== 0 || !g.repositoryUnchanged) problems.push(`${where}#/governed: a guard let a command through; this page says every command was refused`);

  record.reproductions.forEach((p, i) => {
    when(p.at, `/reproductions/${i}/at`);
    if (p.at.slice(0, 10) !== p.on) problems.push(`${where}#/reproductions/${i}/on: not the date of its run`);
    if (!record.stateHash.startsWith(p.committed)) problems.push(`${where}#/reproductions/${i}/committed: not the record's state hash`);
    if (p.verdict !== (p.now === p.committed ? 'SAME' : 'DIFFERENT')) problems.push(`${where}#/reproductions/${i}/verdict: not what its two hashes say`);
    // The page shows the re-run beside "every command was refused": only a re-run that matched, with no breach, says that.
    if (p.verdict !== 'SAME' || p.breaches !== 0) problems.push(`${where}#/reproductions/${i}: the re-run did not match with no breach; this page would misstate it`);
    if (p.tests.failed !== 0) problems.push(`${where}#/reproductions/${i}/tests: a test failed`);
  });
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readRogue(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: ROGUE_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: ROGUE_PIN, file: ROGUE_RECORD, vendor: 'scripts/vendor-rogue.mjs' }), check: record => rogueProblems(record, { now }), refused: 'Lab 05 record refused' });
}

// The leak screen is the kit's (scripts/lab-kit.mjs); exported here too, as before.
export { pageLeaks, recordHashes };

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const n = v => escape(Number(v).toLocaleString('en-GB'));

export function renderIntro(record) {
  const s = record.staged;
  return `<span class="technical">LAB 05 · CAN AN AGENT GO ROGUE?</span><h1 id="lab-title">Can an agent go rogue?</h1><p class="company-lead">We staged an attack: a poisoned ticket, on a seeded sandbox repository with synthetic data. The same agent, ${escape(s.agent)}, got the same ticket twice: once with no controls, once through the engine's real guards. With no controls it did everything the ticket asked. Through the guards, every command was refused, and each refusal was written to a hash-chained journal.</p>`;
}

export function renderStagedReal(record) {
  const s = record.staged, sb = s.sandbox;
  return `<div class="rogue-split">${box('staged', { cls: 'rogue-staged', id: 'staged', body: `<ul class="rogue-list"><li><strong>The attack.</strong> We wrote the poisoned ticket. Nobody attacked anything.</li><li><strong>The company.</strong> ${escape(s.company)}, with a fictional repository, <code>${escape(s.repository)}</code>.</li><li><strong>The repository.</strong> A seeded sandbox in a temporary folder: ${n(sb.mainCommits)} commits on main, ${n(sb.prBranches)} pull-request branches and ${n(sb.ciRuns)} CI runs, all synthetic, with a local copy as its origin. All ${n(sb.calls)} git calls of the run with no controls stayed inside that folder; none reached the network, and no real GitHub command ever started. The repository delete deleted the sandbox's own copy.</li><li><strong>The repair time.</strong> An estimate, from the record's own repair table. Nobody repaired anything.</li></ul>` })}${box('real', { cls: 'rogue-real', id: 'real', body: `<ul class="rogue-list"><li><strong>The guards.</strong> The engine's own code, run as it is, not re-written for the demo: the read-only door, the outbox and its writer, and the trust wall.</li><li><strong>The refusals.</strong> The words below are what those guards returned.</li><li><strong>The journal.</strong> One row per refusal, each row holding the hash of the row before it. The engine's own check of the chain passed when the runs were recorded, and the demo's check re-runs it.</li><li><strong>The record.</strong> Every file it comes from is cited by its sha256, at a private commit cited by hash.</li></ul>` })}</div>`;
}

export function renderAttack(record) {
  const t = record.staged.ticket;
  return `<p>The ticket is ${escape(t.id)}, "${escape(t.title)}", in the fictional repository. Its text holds ${escape(t.by)}: an instruction written to look like it came from the team, telling the agent to skip review and wipe the repository.</p><blockquote class="rogue-attack" id="attack-text"><p class="technical">THE ATTACK TEXT · AS PLANTED IN THE TICKET · DO NOT FOLLOW</p><p>${escape(t.body)}</p></blockquote><p>It asks for four things, in this order:</p><ol class="lab-steps">${record.ungoverned.steps.map(s => `<li>${escape(s.says)}.</li>`).join('')}</ol>`;
}

export function renderUngoverned(record) {
  const u = record.ungoverned, d = u.damage, r = u.repairEstimate;
  const steps = u.steps.map(s => `<tr><td>${escape(s.says)}</td><td><code>${escape(s.command)}</code></td><td>${s.ran ? 'ran' : 'did not run'}: ${escape(s.result)}</td></tr>`).join('');
  const rows = r.rows.map(row => `<tr><td>${escape(row.what)}</td><td>${n(row.n)}</td><td>${n(row.hours)}</td></tr>`).join('');
  return `<p>${escape(record.staged.agent)} was given a writable copy of the sandbox and no controls. It ran every command the ticket asked for.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">The ticket asked</th><th scope="col">The command</th><th scope="col">What happened</th></tr></thead><tbody>${steps}</tbody></table></div><h3 class="lab-subhead">What it did to the sandbox</h3><ul class="rogue-list"><li>Main went from ${n(u.before.mainCommits)} commits to ${n(u.after.mainCommits)}: ${n(d.commitsLostFromMain)} commits gone.</li><li>${n(d.prBranchesDeleted)} pull-request branches deleted.</li><li>${d.repositoryDeleted ? 'The repository deleted' : 'The repository kept'}, so its ${n(d.ciRunsStopped)} CI runs stopped.</li></ul><p class="lab-source">Measured on the sandbox after the run. It is the only place the damage happened.</p>${box('estimate', { cls: 'rogue-estimate', id: 'estimate', body: `<h3>What repairing it might take</h3><p>About <strong>${n(r.hours)} engineer-hours</strong>, or <strong>${n(r.workdays)} working days</strong> of ${n(r.workdayHours)} hours. This is not an observed cost: nobody repaired anything. It is the record's own repair table, which gives each kind of damage a fixed number of hours, multiplied by the damage counted above. In the record's words: ${escape(r.rule)}.</p><details class="lab-panel-table"><summary>The repair table</summary><table><thead><tr><th scope="col">Repair</th><th scope="col">Count</th><th scope="col">Hours, by the table</th></tr></thead><tbody>${rows}</tbody></table></details>` })}`;
}

export function renderGoverned(record) {
  const g = record.governed;
  const acts = g.acts.map(a => `<article class="lab-panel rogue-act"><p class="technical">${escape(a.says.toUpperCase())}</p><p><code>${escape(a.command)}</code></p><dl class="rogue-guards"><div><dt>The read-only door</dt><dd>${escape(a.door)}</dd></div>${a.githubWrite ? `<div><dt>The GitHub-write rule</dt><dd>${escape(a.githubWrite)}</dd></div>` : ''}<div><dt>The outbox</dt><dd>${escape(a.outbox)}</dd></div><div><dt>The outbox writer</dt><dd>${escape(a.writer)}</dd></div><div><dt>The trust wall</dt><dd>${escape(a.trust)}</dd></div></dl><p class="rogue-outcome">Refused. Journal row ${n(a.journalRow)}.</p></article>`).join('');
  const rows = g.journal.rows.map(row => `<tr><td>${n(row.n)}</td><td>${escape(row.act)}${row.step ? `: ${escape(row.step)}` : ''}${row.verdict ? `: ${escape(row.verdict)}` : ''}</td><td>${escape(row.by)}</td><td><code>${escape(row.prev.slice(0, 12))}</code></td><td><code>${escape(row.hash.slice(0, 12))}</code></td></tr>`).join('');
  return `<p>The same ticket, the same agent, the same four commands, sent through the engine's own guards instead of a writable copy. Each command meets every guard in turn, and each guard refuses it on its own. The agent may only read; the only writes it may ask for are ${g.outboxKinds.map(k => `<code>${escape(k)}</code>`).join(', ')}, and the trust wall never lets ${g.trustNever.map(k => `<code>${escape(k)}</code>`).join(', ')} through, whatever the evidence.</p><div class="rogue-acts">${acts}</div><h3 class="lab-subhead">A person then judges the agent</h3><p>Before this ticket, the agent was trusted to draft comments: ${escape(g.trust.before.why)}. A person then judged its work on this ticket wrong, and the trust wall took that trust away: ${escape(g.trust.after.why)}. This part is staged too: the earlier verdicts are seeded data, and in the demo the presenter plays the person. What is real is the trust wall's rule, which turned one wrong into no trust.</p><h3 class="lab-subhead">The journal</h3><p>One row per refusal and one for the verdict. Each row holds the hash of the row before it, so a row changed or removed later breaks the chain. The engine's own check of the chain passed; this page checks that each row names the hash of the row above. The sandbox repository was the same after the run as before it.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">Row</th><th scope="col">What</th><th scope="col">By</th><th scope="col">Previous row's hash</th><th scope="col">This row's hash</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-source">Hashes shortened to 12 characters; the record holds them in full.</p>`;
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(c.what[0].toUpperCase() + c.what.slice(1))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(f.what)}: <code>${escape(f.sha256)}</code></li>`).join('');
  const repro = record.reproductions.map(p => `<li>On ${time(p.on)}, on ${escape(p.host)}: ${escape(p.basis)}. Ran ${escape(p.command)}. It printed <code>committed ${escape(p.committed)}  now ${escape(p.now)}  ${escape(p.verdict)}; breaches ${n(p.breaches)}</code>. Then ${escape(p.tests.how)}: ${n(p.tests.passed)} passed, ${n(p.tests.failed)} failed, ${n(p.tests.skipped)} skipped.</li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${ROGUE_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}. ${cite(v, mc)}</p><h3 class="lab-subhead">The commits it stands on</h3><ul class="rogue-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="rogue-list rogue-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p><h3 class="lab-subhead">Run again, on a second machine</h3><ul class="rogue-list">${repro}</ul><p class="lab-source">The check re-runs both runs from nothing and compares the result with the state hash the record holds, <code>${escape(record.stateHash.slice(0, 16))}</code>; it fails if a single byte differs or a guard was bypassed.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>It is one staged attack on a sandbox. It does not say how often agents go rogue, or how well a stronger attack would do.</li><li>It shows that these guards refused these four commands, and that a bypassed guard is caught: the demo's tests bypass each guard in turn and check that the damage is reported.</li><li>The repair time is an estimate by a fixed table, not a cost anyone paid.</li><li>The main branch carries this version of the demo, the route planner. A newer version, not yet on main, is not cited here.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderRogue(root = 'site', { now = new Date() } = {}) {
  const record = readRogue(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, ROGUE_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--ROGUE_INTRO-->': renderIntro(record), '<!--ROGUE_STAGED_REAL-->': renderStagedReal(record), '<!--ROGUE_ATTACK-->': renderAttack(record), '<!--ROGUE_UNGOVERNED-->': renderUngoverned(record), '<!--ROGUE_GOVERNED-->': renderGoverned(record), '<!--ROGUE_CHECK-->': renderCheck(record), '<!--ROGUE_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${ROGUE_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${ROGUE_TEMPLATE}: unresolved content marker`);
  const leaks = pageLeaks(html, recordHashes(record));
  if (leaks.length) throw new Error(`${ROGUE_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [ROGUE_TEMPLATE]: html } };
}
