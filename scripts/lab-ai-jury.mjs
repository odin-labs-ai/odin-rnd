// Lab 14, "Can an AI jury judge how a room looks?" (lane vp-bundle4). scripts/labs.mjs calls renderAiJury() and
// writes, into dist/ only (nothing rendered is committed):
//   labs/ai-jury/index.html   the lab page, from site/labs/ai-jury/index.html (<!--JURY_*--> markers)
// The record is site/data/labs/ai-jury/record.json (odin-lab-ai-jury v1, scripts/schemas/odin-lab-ai-jury.schema.json),
// which scripts/vendor-ai-jury.mjs builds from the agent space's private repository at its main head; its sha256 is
// pinned in site/data/labs/ai-jury/record.sha256, which the Labs tile (scripts/lab-tiles.mjs) also checks.
//
// DATA ONLY. What the page may say is fixed here, not in the record: the jurors are AI models, not people; the
// calibration pair is a fixture we made; the page shows no picture (every committed picture is a room of a
// client-themed talk) and describes the rooms in neutral words; only the two rounds on the private main are shown,
// and the lane-only rounds are named as left out; nothing is claimed beyond what the two rounds hold. The build
// refuses the record, every reason listed, when:
//   - its bytes are not the pinned ones, it misses the schema (every object is closed), or the kit's record contract;
//   - a room's median is not the median of its jurors' scores, its n is not their count, or a score is by a model
//     outside that round's jury;
//   - a round's median is not the median of its rooms' medians, the rooms are not the same in every round, or a
//     round is not valid;
//   - a reviewer's calibration does not follow the rubric's rule (passes exactly when good minus bad is at least the
//     margin), a jury is not the passing cloud reviewers, or a missing score has no unreadable replies behind it;
//   - any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks), with only the record's own hashes masked, and carries
// no image at all.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const JURY_RECORD = 'data/labs/ai-jury/record.json';
export const JURY_PIN = 'data/labs/ai-jury/record.sha256';
export const JURY_TEMPLATE = 'labs/ai-jury/index.html';
export const JURY_SCHEMA = join(here, 'schemas/odin-lab-ai-jury.schema.json');
const EPS = 0.0011; // the aggregation rounds to three decimals

export const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => Math.round(x * 1000) / 1000;
/** A score as the page prints it: three decimals at most, and a whole number with one (4 reads 4.0). */
export const score = x => (Number.isInteger(x) ? x.toFixed(1) : String(r3(x)));

/** Every reason the record may not be published (empty when it may). */
export function juryProblems(record, { now = new Date(), where = JURY_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(JURY_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-ai-jury v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where));
  problems.push(...vendoredProblems(record.vendored, { where, now }));
  const { minMargin } = record.rubric;
  const labels = record.rounds[0].rooms.map(r => r.label).join();
  record.rounds.forEach((round, i) => {
    const at = `${where}#/rounds/${i}`;
    if (round.round !== i + 1) problems.push(`${at}/round: rounds are numbered from 1, in order`);
    problems.push(...instantProblems(round.on, `${at}/on`, now));
    if (!round.valid) problems.push(`${at}/valid: the page shows valid rounds only`);
    for (const [j, r] of round.reviewers.entries()) {
      const want = r.good !== null && r.bad !== null ? r3(r.good - r.bad) : null;
      if (r.margin !== want && !(want !== null && r.margin !== null && Math.abs(r.margin - want) <= EPS)) problems.push(`${at}/reviewers/${j}/margin: not good minus bad`);
      if (r.passes !== (r.margin !== null && r.margin >= minMargin)) problems.push(`${at}/reviewers/${j}/passes: not the rubric's rule (good minus bad at least ${minMargin})`);
      const missing = ['good', 'bad'].filter(k => r[k] === null);
      if (missing.join() !== r.unreadable.map(u => u.picture).join()) problems.push(`${at}/reviewers/${j}/unreadable: a missing calibration score must have unreadable replies behind it, and only then`);
    }
    const passing = round.reviewers.filter(r => r.passes && r.kind === 'cloud').map(r => r.id).sort();
    if (passing.join() !== [...round.jury].sort().join()) problems.push(`${at}/jury: not the cloud reviewers that passed the calibration`);
    if (round.jury.length < record.rubric.minJury) problems.push(`${at}/jury: fewer than ${record.rubric.minJury} jurors; the round would be void`);
    const jg = median(round.reviewers.filter(r => round.jury.includes(r.id)).map(r => r.good));
    const jb = median(round.reviewers.filter(r => round.jury.includes(r.id)).map(r => r.bad));
    if (Math.abs(jg - round.juryGood) > EPS || Math.abs(jb - round.juryBad) > EPS || Math.abs(r3(jg - jb) - round.juryMargin) > EPS) problems.push(`${at}: the jury's calibration medians are not its jurors'`);
    if (round.juryMargin < minMargin) problems.push(`${at}/juryMargin: below ${minMargin}; the round would be void`);
    if (round.rooms.map(r => r.label).join() !== labels) problems.push(`${at}/rooms: not the same rooms as round 1`);
    for (const [j, room] of round.rooms.entries()) {
      const by = Object.entries(room.by);
      if (by.some(([id]) => !round.jury.includes(id))) problems.push(`${at}/rooms/${j}/by: a score by a model outside this round's jury`);
      if (room.n !== by.length) problems.push(`${at}/rooms/${j}/n: not the number of jurors' scores`);
      if (!by.length || Math.abs(median(by.map(([, v]) => v)) - room.median) > EPS) problems.push(`${at}/rooms/${j}/median: not the median of its jurors' scores`);
    }
    if (r3(median(round.rooms.map(r => r.median))) !== round.median) problems.push(`${at}/median: not the median of its rooms' medians`);
  });
  if (!/none was reworked/.test(record.rooms) || !/photographed again/.test(record.rooms)) problems.push(`${where}#/rooms: the page says the rooms were not reworked but photographed again; the record must say so too`);
  if (!/we rendered/.test(record.calibrationPair) || !/deliberately ruined/.test(record.calibrationPair)) problems.push(`${where}#/calibrationPair: the page boxes the pair as a fixture we made; the record must say we made it`);
  if (!/blind|random names/.test(record.blinding) || /\bnot blind\b|\bunblinded\b|\bsaw the room name\b/i.test(record.blinding)) problems.push(`${where}#/blinding: the page says the jurors judged blind; the record must say so, and nothing that takes it back`);
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readAiJury(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: JURY_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: JURY_PIN, file: JURY_RECORD, vendor: 'scripts/vendor-ai-jury.mjs' }), check: record => juryProblems(record, { now }), refused: 'Lab 14 record refused' });
}

export { pageLeaks, recordHashes };

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const cap = t => t[0].toUpperCase() + t.slice(1);
const words = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][n] ?? String(n);
const signed = x => (x > 0 ? `+${score(x)}` : x < 0 ? `−${score(-x)}` : '0.0');
/** Per room, the change from the first round to the last. */
export const changes = record => record.rounds[0].rooms.map((room, i) => r3(record.rounds.at(-1).rooms[i].median - room.median));
const dropped = record => record.rounds.slice(1).flatMap(round => record.rounds[0].jury.filter(id => !round.jury.includes(id)).map(id => ({ round, reviewer: round.reviewers.find(r => r.id === id) })));

export function renderIntro(record) {
  const [a, b] = [record.rounds[0], record.rounds.at(-1)];
  const most = Math.max(...changes(record).map(Math.abs));
  // Computed, never the record's words: whether every juror that scored both pictures of the pair passed the gate.
  const scored = record.rounds.flatMap(round => round.reviewers.filter(r => r.margin !== null));
  const ranked = scored.every(r => r.passes) ? 'Every juror that could score our calibration pair told a good picture from a deliberately ruined one.' : `${words(scored.filter(r => r.passes).length)} of the ${words(scored.length)} scorings of our calibration pair told a good picture from a deliberately ruined one by the gate's margin.`;
  return `<span class="technical">LAB 14 · CAN AN AI JURY JUDGE HOW A ROOM LOOKS?</span><h1 id="lab-title">Can an AI jury judge how a room looks?</h1><p class="company-lead">A jury of AI models scored pictures of the rooms of a 3D presentation space, blind, on one rubric, twice. ${ranked} On ${words(a.rooms.length)} rooms that did not change between the two sittings, the jury's median was ${score(a.median)} out of 10 the first time and ${score(b.median)} the second, with ${words(a.jury.length)} jurors and then ${words(b.jury.length)}. Single rooms moved by up to ${score(most)}.</p><p>So a difference between two rooms smaller than that is not, on these two rounds, a verdict on the rooms. This page shows numbers only: no picture.</p>`;
}

export function renderJudge(record) {
  const all = record.rounds[0].reviewers;
  const list = all.map(r => `<li><strong>${escape(r.model)}</strong>${r.kind === 'local' ? ': a small local model, scored as a floor for comparison and never on the jury' : ''}.</li>`).join('');
  return box('judge', { cls: 'jury-judge', id: 'judge', body: `<p>Every score on this page is an AI model's. No person scored a picture.</p><ul class="jury-list">${list}</ul><p>${escape(cap(record.blinding))}.</p>` });
}

export function renderHow(record) {
  const r = record.rubric;
  return `<ul class="jury-list"><li><strong>The rubric.</strong> Seven criteria, each scored ${escape(r.scale)}: ${r.criteria.map(escape).join('; ')}.</li><li><strong>The score.</strong> ${escape(cap(r.overall))}.</li><li><strong>The calibration gate.</strong> Every juror also scores the calibration pair. A juror whose good picture does not score at least ${score(r.minMargin)} above the bad one is out of that round's jury. A round with fewer than ${words(r.minJury)} jurors left, or whose jury does not rank the pair by that margin, is void.</li><li><strong>The rooms.</strong> ${escape(cap(record.rooms))}.</li></ul>`;
}

export function renderCalibration(record) {
  const rows = record.rounds.map(round => round.reviewers.map(r => `<tr><td>${round.round}</td><td>${escape(r.model)}</td><td>${r.good === null ? 'no score' : score(r.good)}</td><td>${r.bad === null ? 'no score' : score(r.bad)}</td><td>${r.margin === null ? 'none' : score(r.margin)}</td><td>${r.kind === 'local' ? 'floor, never on the jury' : round.jury.includes(r.id) ? 'on the jury' : 'out'}</td></tr>`).join('')).join('');
  const out = dropped(record).map(({ round, reviewer: r }) => `<p>In round ${round.round}, ${escape(r.model)} was out. It gave no usable score for the ${r.unreadable.map(u => `${u.picture} picture: its ${words(u.replies)} replies on it could not be read`).join(', and none for the ')}, so it had no margin, and the gate took it off the jury. Round ${round.round} was judged by the ${words(round.jury.length)} that passed.</p>`).join('');
  return `${box('fixture', { cls: 'jury-fixture', id: 'calibration-pair', body: `<p>The calibration pair is ours: ${escape(record.calibrationPair)}. It is the yardstick, not a room.</p>` })}<div class="lab-table-wrap"><table class="jury-table"><thead><tr><th scope="col">Round</th><th scope="col">Model</th><th scope="col">Good picture</th><th scope="col">Ruined picture</th><th scope="col">Margin</th><th scope="col">Jury</th></tr></thead><tbody>${rows}</tbody></table></div>${out}<p class="lab-source">Each juror's overall score for each picture of the pair. Every round passed the gate: ${record.rounds.map(round => `round ${round.round}'s jury ranked the pair by ${score(round.juryMargin)}`).join(', ')}.</p>`;
}

export function renderRooms(record) {
  const ch = changes(record);
  const rows = record.rounds[0].rooms.map((room, i) => `<tr><th scope="row">${escape(cap(room.label))}</th>${record.rounds.map(round => `<td>${score(round.rooms[i].median)} <span class="jury-n">(${round.rooms[i].n} jurors)</span></td>`).join('')}<td>${signed(ch[i])}</td></tr>`).join('');
  const med = `<tr class="jury-median"><th scope="row">The median of the rooms</th>${record.rounds.map(round => `<td>${score(round.median)}</td>`).join('')}<td>${signed(r3(record.rounds.at(-1).median - record.rounds[0].median))}</td></tr>`;
  return `<p>The same ${words(record.rounds[0].rooms.length)} rooms in both rounds, the jury's median score for each, out of 10. A room scored by fewer jurors than the round's jury is one whose other replies could not be read.</p><div class="lab-table-wrap"><table class="jury-table"><thead><tr><th scope="col">Room</th>${record.rounds.map(round => `<th scope="col">Round ${round.round}, ${time(round.on)}</th>`).join('')}<th scope="col">Change</th></tr></thead><tbody>${rows}${med}</tbody></table></div><p class="lab-source">Recounted at build from each juror's score: the build refuses the record if a room's median is not its jurors' median, or the round's is not its rooms'.</p>`;
}

export function renderReading(record) {
  const ch = changes(record), up = ch.filter(x => x > 0).length, down = ch.filter(x => x < 0).length;
  const [a, b] = [record.rounds[0], record.rounds.at(-1)];
  return `<ul class="jury-list"><li><strong>The gate works as a gate.</strong> It took a juror off when that juror could not score the yardstick, and the round went on with the ${words(b.jury.length)} that could. ${(() => { const least = Math.min(...record.rounds.flatMap(round => round.reviewers.filter(r => r.margin !== null).map(r => r.margin))); return least > 0 ? `Every juror that scored both pictures of the pair ranked the good one higher, by at least ${score(least)}.` : 'Not every juror that scored both pictures of the pair ranked the good one higher.'; })()}</li><li><strong>The jury is not a fine ruler.</strong> Between the two sittings ${words(up)} rooms went up and ${words(down)} went down, by up to ${score(Math.max(...ch.map(Math.abs)))}, although none was reworked. The median moved from ${score(a.median)} to ${score(b.median)}. Some of that is the jury changing (${words(a.jury.length)} jurors, then ${words(b.jury.length)}) and some the pictures being taken again; two rounds cannot separate the two.</li><li><strong>What follows.</strong> A difference smaller than that, between two rooms or before and after a rework, is not shown by this jury on two rounds. A bigger one may be.</li></ul>`;
}

export function renderLeftOut(record) {
  const ex = record.excluded.map(e => `<li>Round ${escape(e.round)}: ${escape(e.why)}. Not shown, not counted.</li>`).join('');
  return `<ul class="jury-list"><li>Every picture. Each committed picture is a room of a talk themed for a client, so none is shown; the rooms are described in neutral words.</li><li>The jurors' reasons, the rubric's wording and the rooms' names: only numbers are vendored.</li><li>Ten other rooms that the same sittings judged before and after a rework: this lab is about the jury, so it shows only the rooms that stayed the same.</li><li>What the jury cost, by the site's rule on money.</li>${ex}</ul>`;
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(cap(c.what))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(cap(f.what))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${JURY_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}.</p><h3 class="lab-subhead">The commits it stands on</h3><ul class="jury-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="jury-list jury-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary(record) {
  return `<ul class="jury-list"><li>Two rounds, on one day, of ${words(record.rounds[0].rooms.length)} rooms of one style. It does not say how this jury does on other pictures, or over more rounds.</li><li>The jurors are AI models; no person's judgement of these rooms is shown or compared.</li><li>It shows the noise between two sittings, not its cause: the jury and the pictures both changed.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderAiJury(root = 'site', { now = new Date() } = {}) {
  const record = readAiJury(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, JURY_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--JURY_INTRO-->': renderIntro(record), '<!--JURY_JUDGE-->': renderJudge(record), '<!--JURY_HOW-->': renderHow(record), '<!--JURY_CALIBRATION-->': renderCalibration(record), '<!--JURY_ROOMS-->': renderRooms(record), '<!--JURY_READING-->': renderReading(record), '<!--JURY_LEFT_OUT-->': renderLeftOut(record), '<!--JURY_CHECK-->': renderCheck(record), '<!--JURY_BOUNDARY-->': renderBoundary(record) })) {
    if (!html.includes(marker)) throw new Error(`${JURY_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${JURY_TEMPLATE}: unresolved content marker`);
  // DATA ONLY: no picture, of any kind, in the page's content (the site's header and footer carry its logo).
  const content = html.split('<main id="main">')[1]?.split('</main>')[0] ?? html;
  if (/<(img|picture|video|source|svg|object|embed|iframe)\b|\.(png|jpe?g|webp|gif|avif|svg)\b|url\(/i.test(content)) throw new Error(`${JURY_TEMPLATE}: the page's content carries a picture; this lab shows none`);
  const v = record.vendored;
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [v.mainCheck.main, ...v.mainCheck.commits] });
  if (leaks.length) throw new Error(`${JURY_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [JURY_TEMPLATE]: html } };
}
