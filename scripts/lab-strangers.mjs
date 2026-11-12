// Lab 12, "How many strangers can the space hold?" (vision-plan bundle 3, WO-03). scripts/labs.mjs calls
// renderStrangers() and writes, into dist/ only (nothing rendered is committed):
//   labs/strangers/index.html   the lab page, from site/labs/strangers/index.html (<!--STRANGERS_*--> markers)
// The record is site/data/labs/strangers/record.json (odin-lab-strangers v1, scripts/schemas/odin-lab-strangers.schema.json),
// which scripts/vendor-strangers.mjs builds from the agent space's private repository at its main and from one run on a
// Mac; its sha256 is pinned in site/data/labs/strangers/record.sha256, which the Labs tile (scripts/lab-tiles.mjs) also
// checks.
//
// Two things stand on this page and are never mixed: THE ESTIMATE, the capacity sheet's figures, measured on another
// machine and so an estimate for any other host, in the kit's estimate box; and THE MEASUREMENT, one fresh run of the
// same tool, from a checked copy of the same main, on a Mac, in its own panel. What the page may say is fixed here, not in the record. The
// build refuses the record, every reason listed, when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed), or the kit record contract;
//   - a date is not real or is after the build, the run ends before it starts, or its day is not the day it started;
//   - it does not hold exactly the five source files (the sheet, the tool, the loop log, the sheet's run file, the run);
//   - a table's steps are not its ramp, in order, or either verdict is not what its own rows give again (the tool's rules:
//     every loop chore's p95 under 50 ms; smooth = loop lag p95 under 100 ms with at least 1.8 pushes a second each);
//   - the run started at a one-minute load of 40 or more, started browsers, or its summary was not given again by the
//     tool's resummarize from the run's own files;
//   - a step's measured window is empty, or a percentile it reports has no samples behind it;
//   - the copy of the code the run started from was not checked to be main's, file for file;
//   - the isolation does not hold: the run's own listeners not all on loopback, any of them there before or after the
//     run, or any process of the run left behind;
//   - an abuse probe did not hold at every step, or a guest got more than the quota of Odin's checks;
//   - any text fails the publisher's screen, or the rendered page fails it as a whole (pageLeaks).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, realInstant, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const STRANGERS_RECORD = 'data/labs/strangers/record.json';
export const STRANGERS_PIN = 'data/labs/strangers/record.sha256';
export const STRANGERS_TILE = 'data/labs/strangers-tile.json';
export const STRANGERS_TEMPLATE = 'labs/strangers/index.html';
export const STRANGERS_SCHEMA = join(here, 'schemas/odin-lab-strangers.schema.json');
export const ROLES = ['sheet', 'tool', 'perf', 'estimate-run', 'run'];
export const PROBE_WORDS = {
  flood: 'a flood: twenty-five lines at once, of which twenty pass and the rest are told to slow down',
  oversized_line: 'a chat line of five thousand characters, which everyone sees cut short',
  forged_evidence: 'a pasted evidence id, which carries no evidence record',
  operator_ops: 'operator commands, such as inviting an agent, which a guest is refused',
  oversized_frame: 'a WebSocket frame of two megabytes, which closes that connection while the next guest still gets in',
};
export const MAX_LOAD1 = 40;

/** The tool's own verdict rules, applied again to a table's rows. */
// A step with no samples behind a percentile it reports earns nothing (and the record is refused, below).
export const sampled = (r, keys) => r.windowS > 0 && keys.every(k => r.samples[k] > 0);
export function verdictOf(rows) {
  const under = rows.filter(r => sampled(r, ['tick', 'step', 'crowd']) && Math.max(r.tickP95, r.stepP95, r.crowdP95) < 50).map(r => r.guests);
  const smooth = rows.filter(r => sampled(r, ['lag']) && r.lagP95 < 100 && r.pushesPerGuest >= 1.8).map(r => r.guests);
  return { tickUnder50: under.length ? Math.max(...under) : null, smooth: smooth.length ? Math.max(...smooth) : null };
}

/** Every reason the record may not be published (empty when it may). */
export function strangersProblems(record, { now = new Date(), where = STRANGERS_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(STRANGERS_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-strangers v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where), ...vendoredProblems(record.vendored, { where, now }));
  const v = record.vendored, e = record.estimate, m = record.measurement;
  for (const [iso, p] of [[v.committed, '/vendored/committed'], [m.at, '/measurement/at'], [m.endedAt, '/measurement/endedAt']]) problems.push(...instantProblems(iso, `${where}#${p}`, now));
  if (realInstant(m.endedAt) && realInstant(m.at) && realInstant(m.endedAt) <= realInstant(m.at)) problems.push(`${where}#/measurement/endedAt: the run ends before it starts`);
  if (m.at.slice(0, 10) !== m.on) problems.push(`${where}#/measurement/on: not the date the run started`);
  const roles = v.files.map(f => f.role);
  if (roles.length !== ROLES.length || ROLES.some(r => !roles.includes(r))) problems.push(`${where}#/vendored/files: not exactly the five source files (${ROLES.join(', ')})`);
  for (const [name, t] of [['estimate', e], ['measurement', m]]) {
    if (JSON.stringify(t.rows.map(r => r.guests)) !== JSON.stringify(t.ramp)) problems.push(`${where}#/${name}/rows: its steps are not its ramp, in order`);
    for (const r of t.rows) if (!sampled(r, ['tick', 'step', 'crowd', 'lag', 'move', 'cpu']) || r.ticks !== r.samples.tick) problems.push(`${where}#/${name}/rows: the ${r.guests}-guest step has an empty measured window or a percentile with no samples behind it`);
    const again = verdictOf(t.rows);
    if (again.tickUnder50 !== t.verdict.tickUnder50 || again.smooth !== t.verdict.smooth) problems.push(`${where}#/${name}/verdict: not what its own rows give (${JSON.stringify(again)})`);
  }
  if (!(e.recommendedCap <= e.dedicatedCoreCap && e.dedicatedCoreCap <= e.breaksAt && e.breaksAt < e.unusableAt)) problems.push(`${where}#/estimate: its cap, dedicated cap, break and unusable points are not in order`);
  if (e.wireKiBPerGuest.low > e.wireKiBPerGuest.high) problems.push(`${where}#/estimate/wireKiBPerGuest: low above high`);
  if (m.load1Start >= MAX_LOAD1) problems.push(`${where}#/measurement/load1Start: the run started at a one-minute load of ${m.load1Start}; a run is made only below ${MAX_LOAD1}`);
  if (!m.code.templatesFromCopy) problems.push(`${where}#/measurement/code: the run's own records do not name the checked copy`);
  if (!m.code.matchesMain) problems.push(`${where}#/measurement/code: the copy the run started from is not main's code`);
  if (!m.resummarized) problems.push(`${where}#/measurement/resummarized: the summary was not given again from the run's own files`);
  const iso = m.isolation;
  if (iso.ownListenersDuring < 1 || iso.ownListenersLoopback !== iso.ownListenersDuring) problems.push(`${where}#/measurement/isolation: the run's own listeners were not all on loopback`);
  if (iso.ownListenersBefore !== 0 || iso.ownListenersAfter !== 0) problems.push(`${where}#/measurement/isolation: one of the run's listeners was there before or after it`);
  if (iso.ownProcessesLeft !== 0) problems.push(`${where}#/measurement/isolation: a process of the run was left behind`);
  if (iso.keptByOthers > iso.listenersBefore || iso.keptByOthers > iso.listenersAfter) problems.push(`${where}#/measurement/isolation: more listeners kept than there were`);
  for (const [k, n] of Object.entries(m.probes.held)) if (n !== m.probes.steps) problems.push(`${where}#/measurement/probes/held/${k}: held at ${n} of ${m.probes.steps} steps; the page says every step`);
  if (m.probes.steps !== m.ramp.length) problems.push(`${where}#/measurement/probes/steps: not one round per step of the ramp`);
  if (!m.quota.held || m.quota.mostInTenMinutes > m.quota.limit) problems.push(`${where}#/measurement/quota: a guest got more of Odin's checks than the quota`);
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readStrangers(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: STRANGERS_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: STRANGERS_PIN, file: STRANGERS_RECORD, vendor: 'scripts/vendor-strangers.mjs' }), check: record => strangersProblems(record, { now }), refused: 'Lab 12 record refused' });
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const clock = iso => `<time datetime="${escape(iso)}">${escape(iso.slice(11, 16))} UTC</time>`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const n = (v, digits = 0) => escape(Number(v).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const kb = b => n(b / 1000, 1);
const stepsOf = ramp => `${ramp.slice(0, -1).join(', ')} and ${ramp.at(-1)}`;

export function renderIntro() {
  return `<span class="technical">LAB 12 · HOW MANY STRANGERS CAN THE SPACE HOLD?</span><h1 id="lab-title">How many strangers can the space hold?</h1><p class="company-lead">The agent space can be opened to anonymous guests: anyone with the link walks in, talks to the agents and asks Odin to check them. Before a link like that is shared, someone has to say how many guests one space can take. We had a written answer, measured on another machine. This page sets it beside a fresh measurement on a Mac, and keeps the two apart.</p>`;
}

const reach = (t, key) => (t.verdict[key] === null ? 'none of the steps tried' : `${n(t.verdict[key])} guests${t.verdict[key] === t.ramp.at(-1) ? ', the last step tried' : ''}`);

export function renderSideBySide(record) {
  const e = record.estimate, m = record.measurement;
  const estimate = box('estimate', { cls: 'strangers-estimate', id: 'estimate', body: `<h3>The capacity sheet</h3><p>Measured on ${escape(e.machine)}. For the space as it would be hosted, these are an estimate, and the sheet says how much room it leaves.</p><ul class="rogue-list"><li><strong>Recommended public cap: ${n(e.recommendedCap)} guests</strong>, at most ${n(e.dedicatedCoreCap)} on a processor core of its own.</li><li>Every loop chore under 50 ms up to ${reach(e, 'tickUnder50')}; smooth up to ${reach(e, 'smooth')}.</li><li>One core saturated at ${n(e.breaksAt)}; unusable at ${n(e.unusableAt)}.</li><li>On the wire, about ${n(e.wireKiBPerGuest.low)} to ${n(e.wireKiBPerGuest.high)} KiB a second per guest: the sheet's own estimate from compressing real pushes offline, not a capture.</li></ul>` });
  const heldAll = m.verdict.smooth === m.ramp.at(-1) && m.verdict.tickUnder50 === m.ramp.at(-1);
  const next = m.rows.find(r => r.guests > (m.verdict.smooth ?? 0));
  const behind = next ? `At ${n(next.guests)} it fell behind: loop lag p95 ${n(next.lagP95, 0)} ms, ${n(next.pushesPerGuest, 2)} pushes a second to each guest instead of two, the space's loop at ${n(next.hostCpu, 0)}% of one core.` : 'Past that, it fell behind; the table below shows how.';
  const measured = `<div class="lab-panel strangers-measured" id="measured"><p class="technical">A MEASUREMENT, RUN ON ${escape(longDate(m.on).toUpperCase())}</p><h3>A fresh run on a Mac</h3><p>Run on ${escape(m.host)}, with no browsers.</p><ul class="rogue-list"><li>Every loop chore under 50 ms up to ${reach(m, 'tickUnder50')}.</li><li>Smooth up to ${reach(m, 'smooth')}.</li><li>${heldAll ? `It did not break within the steps tried, so this run does not say where it would. It says the space held ${n(m.ramp.at(-1))} on this machine.` : behind}</li><li>Every abuse probe held at all ${n(m.probes.steps)} steps.</li></ul></div>`;
  return `<div class="rogue-split">${estimate}${measured}</div><p class="lab-source">The two are not the same experiment twice: the machines differ, and so do the versions of the code and its WebSocket library. Read them as an estimate and a measurement, not as a before and after.</p>`;
}

const table = (t, caption) => `<div class="lab-table-wrap"><table><caption class="sr-only">${escape(caption)}</caption><thead><tr><th scope="col">Guests</th><th scope="col">Tick p95</th><th scope="col">Step p95</th><th scope="col">Crowd p95</th><th scope="col">Loop lag p50 / p95</th><th scope="col">Pushes a second, each</th><th scope="col">Move reply p95</th><th scope="col">Space's CPU (one core)</th><th scope="col">CPU per push</th><th scope="col">Memory</th><th scope="col">Down, per guest</th></tr></thead><tbody>${t.rows.map(r => `<tr><th scope="row">${n(r.guests)}</th><td>${n(r.tickP95, 2)} ms</td><td>${n(r.stepP95, 2)} ms</td><td>${n(r.crowdP95, 2)} ms</td><td>${n(r.lagP50, 1)} / ${n(r.lagP95, 1)} ms</td><td>${n(r.pushesPerGuest, 2)}</td><td>${n(r.moveP95, 1)} ms</td><td>${n(r.hostCpu, 1)}%</td><td>${n(r.cpuPerPush, 2)} ms</td><td>${n(r.rssMb)} MB</td><td>${kb(r.downPerGuest)} KB/s</td></tr>`).join('')}</tbody></table></div>`;

export function renderEstimate(record) {
  const e = record.estimate;
  return box('estimate', { cls: 'strangers-estimate-rows', id: 'estimate-rows', body: `<p>The sheet's capacity run, its run 3: ${n(e.crowdAgents)} resident crowd agents in the space, guests ramped in at ${escape(stepsOf(e.ramp))}, ${n(e.phaseS)} seconds a step, measured after the first ${n(e.settleS)}. On ${escape(e.machine)}.</p>${table(e, 'The capacity sheet\'s run 3, step by step')}<p>The break point and the unusable point come from the sheet's other runs, on the same machine. The bandwidth on the wire is the sheet's estimate, not a capture.</p>` });
}

export function renderMeasurement(record) {
  const m = record.measurement;
  return `<div class="lab-panel strangers-measured-rows" id="measured-rows"><p class="technical">A MEASUREMENT, RUN ON ${escape(longDate(m.on).toUpperCase())}</p><p>On ${time(m.on)}, from ${clock(m.at)} to ${clock(m.endedAt)}, on ${escape(m.host)}: ${escape(m.os)}, Python ${escape(m.python)}, WebSocket library ${escape(m.websockets)}. The load tool as it stands at main, from the checked copy described below, and the same space as the sheet: ${n(m.crowdAgents)} resident crowd agents, ${n(m.dutyPct)}% of them on shift, guests ramped in at ${escape(stepsOf(m.ramp))}, ${n(m.phaseS)} seconds a step, measured after the first ${n(m.settleS)}, no browsers.</p><p>The machine was not idle: its one-minute load was ${n(m.load1Start, 2)} when the run started and ${n(m.load1End, 2)} when it ended, and ${n(m.machineCpuBefore, 1)}% of its processor was busy in the ten seconds before. The run is made only below a load of ${n(MAX_LOAD1)}.</p>${table(m, 'The fresh run on a Mac, step by step')}<p>Each step is pooled over its measured window; the tick column counts ${n(Math.min(...m.rows.map(r => r.ticks)))} to ${n(Math.max(...m.rows.map(r => r.ticks)))} ticks a step. The summary above was computed again from the run's own files with the tool's resummarize, and came out the same.</p></div>`;
}

export function renderIsolation(record) {
  const i = record.measurement.isolation;
  return `<p>A load test on a shared machine is only fair to the machine if it touches nothing else. This run:</p><ul class="rogue-list"><li>ran from its own copy of the code, taken from the private main with git archive: after the run, all ${n(record.measurement.code.files)} files of that copy were checked against main by git's own object hash, every one main's bytes and none missing (the list of their hashes has sha256 <code>${escape(record.measurement.code.digest)}</code>). The only files added were the ${n(record.measurement.code.compiledCaches)} bytecode files Python wrote as it ran, and each was checked to be exactly its own source compiled again. The run's own records name this copy as the place its space's templates were read from. That ties the run to the copy through what the run wrote; nothing here watched which code its processes executed;</li><li>used a scratch Python environment of its own;</li><li>started its own space in its own run folder, on free loopback ports it chose at the start, avoiding the ports the live services use;</li><li>stopped only the processes it had started.</li></ul><p>Its listening sockets were listed before, during and after. During the run the space held <strong>${n(i.ownListenersDuring)} listeners, all ${n(i.ownListenersLoopback)} on loopback</strong>. None of them was there before the run, none was left after it, and <strong>${n(i.ownProcessesLeft)} of its processes</strong> were left running. Of the machine's other ${n(i.listenersBefore)} listeners, ${n(i.keptByOthers)} were exactly the same after the run; ${n(i.changedByOthers)} changed, and none of those was the run's own: other programs on the machine opened and closed theirs meanwhile.</p><p class="lab-source">The listings themselves are not published: they name ports and other programs on the machine. These are their counts.</p>`;
}

export function renderProbes(record) {
  const m = record.measurement;
  const items = Object.keys(m.probes.held).map(k => `<li>${escape(cap(PROBE_WORDS[k]))}: held at ${n(m.probes.held[k])} of ${n(m.probes.steps)} steps.</li>`).join('');
  return `<p>At every step of the ramp, on a fresh guest connection, the tool tries what a hostile guest would:</p><ul class="rogue-list">${items}</ul><p>After the run, Odin's own inspection records were read back: ${n(m.quota.checks)} checks in all, and no guest got more than ${n(m.quota.mostInTenMinutes)} in ten minutes, under the limit of ${n(m.quota.limit)}.</p>`;
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(cap(c.what))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(cap(f.what))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${STRANGERS_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}. ${cite(v, mc)}</p><h3 class="lab-subhead">The commits it stands on</h3><ul class="rogue-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="rogue-list rogue-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>Loopback only: no network between the guests and the space, so no latency and no lost packets.</li><li>The guests are a swarm that keeps to the rules, plus the probes. A real crowd behaves differently, and a hostile client is bounded only by the limits the probes test and by the edge in front of the space.</li><li>No browser drew the space in this run, so it says nothing about what a guest's screen does at these counts.</li><li>One run on one machine that was doing other work. A second run, or a quiet machine, would give other numbers.</li><li>The bandwidth on the wire is the sheet's estimate on both sides; this run counted the bytes of the messages, not the compressed bytes on the wire.</li><li>The space's interest code ran as plain Python, without its native module, on both machines.</li><li>Which code ran is shown by the check of the copy and by what the run wrote, not by watching its processes; the page cannot show more than that.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderStrangers(root = 'site', { now = new Date() } = {}) {
  const record = readStrangers(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, STRANGERS_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--STRANGERS_INTRO-->': renderIntro(record), '<!--STRANGERS_SIDE_BY_SIDE-->': renderSideBySide(record), '<!--STRANGERS_ESTIMATE-->': renderEstimate(record), '<!--STRANGERS_MEASUREMENT-->': renderMeasurement(record), '<!--STRANGERS_ISOLATION-->': renderIsolation(record), '<!--STRANGERS_PROBES-->': renderProbes(record), '<!--STRANGERS_CHECK-->': renderCheck(record), '<!--STRANGERS_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${STRANGERS_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${STRANGERS_TEMPLATE}: unresolved content marker`);
  const v = record.vendored;
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [v.commit, v.mainCheck.main, ...v.mainCheck.commits] });
  if (leaks.length) throw new Error(`${STRANGERS_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [STRANGERS_TEMPLATE]: html } };
}
