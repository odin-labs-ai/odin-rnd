import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sha256 } from './jev-gate-prereg.mjs';
import { amendmentPath, amendmentPinPath, assertPriorCalls, priorCallsPath, assertProbe, checkAmendment, derive, hookLimit, nina, probePath, publishedParentSha256, publishedPath, requiredFiles, spotlightShapes, validateAmendment } from './jev-gate-amendment.mjs';
import { amendNote, cardQualifier, noteQualifier, qualifyHome, qualifyStation, renderAmendmentLine, renderAmendmentSection, sectionId, stationQualifier } from './jev-gate-amendment-note.mjs';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { articlePath } from './jev-gate-journal.mjs';
import { renderStations } from './station-render.mjs';

const parent = JSON.parse(readFileSync('experiments/jev-gate/preregistration.json', 'utf8'));
const { record, sha256: digest, bytes } = checkAmendment();
const html = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const copy = () => structuredClone(record);

test('the amendment is pinned, names the published parent, and the parent is untouched', () => {
  assert.equal(readFileSync(amendmentPinPath, 'utf8').split(/\s+/)[0], digest);
  assert.equal(sha256(readFileSync('experiments/jev-gate/preregistration.json')), publishedParentSha256, 'The parent must stay byte-identical');
  assert.equal(record.parent.sha256, publishedParentSha256);
  assert.equal(readFileSync(publishedPath, 'utf8'), bytes.toString('utf8'), 'The published copy is the committed amendment');
  const wrongParent = copy(); wrongParent.parent.sha256 = 'a'.repeat(64);
  assert.throws(() => validateAmendment(wrongParent, parent), /parent.sha256/);
});

test('every required field is enforced', () => {
  for (const path of ['reason.paidCallsSoFar', 'notBefore', 'changes.reviewer.nina', 'changes.reviewer.workspace.init', 'changes.reviewer.workspace.order', 'changes.reviewer.workspace.baseCommit.sha', 'changes.reviewer.hooks.promptContextOnCleanBase', 'changes.reviewer.billing', 'changes.spotlight.rule', 'changes.spotlight.judging', 'unchanged', 'limits', 'files']) {
    const changed = copy(); const keys = path.split('.'); const last = keys.pop();
    delete keys.reduce((o, k) => o[k], changed)[last];
    assert.throws(() => validateAmendment(changed, parent), new RegExp(`field ${path.replaceAll('.', '\\.')}`), `Deleting ${path} must be refused`);
  }
  for (const file of requiredFiles) { const changed = copy(); delete changed.files[file]; assert.throws(() => validateAmendment(changed, parent), /does not pin/); }
});

test('the nina pin, the exact init and the base identity cannot move', () => {
  for (const mutate of [
    r => { r.changes.reviewer.nina.release = '0.34.1'; },
    r => { r.changes.reviewer.nina.tarball.integrity = r.changes.reviewer.nina.tarball.integrity.replace('M', 'N'); },
    r => { r.changes.reviewer.nina.commit = 'f'.repeat(40); },
    r => { r.changes.reviewer.workspace.init = r.changes.reviewer.workspace.init.filter(a => a !== '--no-ask'); },
    r => { r.changes.reviewer.workspace.baseCommit.env.GIT_AUTHOR_DATE = '2026-09-28T00:00:00Z'; },
    r => { r.changes.reviewer.workspace.gitignore = 'node_modules/\n.nina/\n'; },
  ]) { const changed = copy(); mutate(changed); assert.throws(() => validateAmendment(changed, parent), /invalid/); }
  assert.equal(nina.release, '0.34.0');
});

test('the spotlight criteria are exactly the four, over the full parent corpus, and their statements carry their thresholds', () => {
  const s = record.changes.spotlight;
  assert.deepEqual(s.criteria.map(c => c.id), Object.keys(spotlightShapes));
  assert.deepEqual([s.k, s.items, s.redItems, s.greenItems, s.countedRuns], [parent.gates.reviewer.k, parent.corpus.items, parent.corpus.groundTruthRed, parent.corpus.groundTruthGreen, parent.corpus.items * parent.gates.reviewer.k]);
  for (const mutate of [
    r => { r.changes.spotlight.criteria[0].threshold = r.changes.spotlight.criteria[1].threshold; },
    r => { r.changes.spotlight.criteria[2].refutedWhen = 'greater-than'; },
    r => { r.changes.spotlight.criteria[0].n = 30; },
    r => { r.changes.spotlight.criteria.pop(); },
    r => { r.changes.spotlight.criteria.reverse(); },
    r => { r.changes.spotlight.criteria[3].harnessFailureMax = r.changes.spotlight.criteria[1].threshold; },
    r => { delete r.changes.spotlight.criteria[3].harnessFailure; },
  ]) { const changed = copy(); mutate(changed); assert.throws(() => validateAmendment(changed, parent)); }
  const other = structuredClone(parent); other.corpus.items += 2; other.corpus.groundTruthRed += 2;
  assert.throws(() => validateAmendment(copy(), other), /full parent corpus/);
  // A partial run and the three-state label are part of the pre-registered bar.
  assert.match(s.rule, /partial run/i); assert.match(s.judging, /other than "refuted"/); assert.match(s.labelPhrase, /passes, not established at this N/);
});

test('the probe record is what the amendment relies on, and its fields are derived, not typed', () => {
  assert.deepEqual(record, derive(record));
  assert.doesNotThrow(() => assertProbe(record));
  const probe = JSON.parse(readFileSync(probePath, 'utf8'));
  assert.equal(probe.zeroPatch, true); assert.equal(probe.baseShaIdenticalAcrossWorkspaces, true);
  assert.equal(record.changes.reviewer.workspace.baseCommit.sha, probe.baseSha);
  assert(record.changes.reviewer.workspace.files.includes('.claude/settings.json') && record.changes.reviewer.workspace.files.includes('.nina/TODO.md'));
  const moved = copy(); moved.changes.reviewer.workspace.baseCommit.sha = 'f'.repeat(40);
  assert.notDeepEqual(moved, derive(moved));
  assert(!/\/Users\/|\/private\/|\/var\/folders/.test(readFileSync(probePath, 'utf8')), 'Private paths in the probe record');
});

test('a non-empty prompt-hook context is quoted verbatim in the limits', () => {
  const hooks = record.changes.reviewer.hooks;
  assert.equal(hooks.promptContextEmpty, hooks.promptContextOnCleanBase === '');
  if (!hooks.promptContextEmpty) assert(record.limits.includes(hookLimit(hooks.promptContextOnCleanBase)));
  const unquoted = copy(); unquoted.limits = unquoted.limits.filter(l => l !== hookLimit(hooks.promptContextOnCleanBase));
  if (!hooks.promptContextEmpty) assert.throws(() => validateAmendment(unquoted, parent), /quoted verbatim/);
  for (const phrase of ['pnpm harness:check', 'TSDoc', 'this restricted setup', 'evals/reviewer', 'up to 60 s']) assert(record.limits.some(l => l.includes(phrase)), `Limits must state: ${phrase}`);
});

test('no spotlight threshold is written in the amendment code', () => {
  const values = record.changes.spotlight.criteria.map(c => c.threshold ?? c.harnessFailureMax);
  const forms = values.flatMap(v => [String(v), v.toFixed(2), `${Math.round(v * 1000) / 10}%`]);
  for (const file of ['scripts/jev-gate-amendment.mjs', 'scripts/jev-gate-amendment-note.mjs', 'experiments/jev-gate/nina-probe.mjs']) {
    const source = readFileSync(file, 'utf8');
    for (const form of forms) assert(!new RegExp(`(?<![\\w.])${form.replace(/[.%]/g, m => `\\${m}`)}(?![\\w.])`).test(source), `${file} states ${form}`);
  }
});

test('station 06 and the built note show the dated amendment, rendered from the record', () => {
  const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
  const reports = ['migration-witness', 'test-witness', 'ci-witness'].map(id => JSON.parse(readFileSync(`site/data/witnesses/${id}.json`, 'utf8')));
  // Pre-registration mode (results null): the measured station replaces this exhibit and has its own test.
  const exhibit = renderStations(report, reports, undefined, undefined, undefined, undefined, undefined, null).split('id="station-triage"')[1].split('</article>')[0];
  assert(exhibit.includes(renderAmendmentLine(record)));
  assert(exhibit.includes('<span>Pre-registered — not yet run</span>'), 'The station status stays the parent status');
  assert(exhibit.includes(html(record.statusText)) && exhibit.includes('Pre-registered · amended 28 Sep 2026, before any counted gate run'));
  assert(exhibit.includes('href="data/jev-gate/amendment-01.json"') && exhibit.includes(`#${sectionId}`));
  const note = readFileSync(articlePath, 'utf8');
  const built = amendNote(note, record, digest);
  assert.match(built, /PRE-REGISTERED 26 SEP 2026 · AMENDED 28 SEP 2026 · NO RESULTS YET/);
  assert(built.includes(renderAmendmentSection(record, digest)) && built.includes(`id="${sectionId}"`));
  for (const text of [...record.reason.founder, record.reason.paidCallsSoFar, record.priorCalls.plainly, record.priorCalls.parentWording, record.changes.reviewer.workspace.gitignoreRule, record.priorCalls.evidence.sha256, record.notBefore, ...record.changes.spotlight.criteria.map(c => c.statement), ...record.unchanged, ...record.limits, record.changes.reviewer.nina.tarball.integrity, digest, publishedParentSha256]) assert(built.includes(html(text)), `Section is missing: ${String(text).slice(0, 60)}`);
  assert.throws(() => amendNote(built, record, digest), /exactly once|already amended/);
  assert.throws(() => renderAmendmentSection(record, 'abc'), /sha256/);
  const changed = copy(); changed.changes.spotlight.criteria[0].statement += ' Changed.';
  assert.notEqual(renderAmendmentSection(changed, digest), renderAmendmentSection(record, digest));
  assert.equal(readFileSync(amendmentPath, 'utf8'), bytes.toString('utf8'));
});

test('every paid call before the amendment is listed, charged, and matches its committed record', () => {
  const p = record.priorCalls;
  assert.equal(p.calls[0].id, 'G2'); assert.equal(p.calls[0].costUsd, parent.spendCap.alreadySpentUsd);
  assert.equal(p.evidence.sha256, sha256(readFileSync(priorCallsPath)));
  assert.doesNotThrow(() => assertPriorCalls(record));
  const evidence = JSON.parse(readFileSync(priorCallsPath, 'utf8'));
  assert.equal(p.calls.filter(c => c.item && c.costUsd !== null).length, evidence.calls.length);
  const killed = p.calls.filter(c => c.costUsd === null);
  assert.equal(killed.length, 1); assert.equal(killed[0].costCharged, Math.max(...evidence.calls.map(c => c.costUsd)));
  const total = p.calls.reduce((sum, c) => sum + (c.costUsd ?? c.costCharged), 0);
  assert.equal(Math.round(total * 1e7), Math.round(record.spend.alreadySpentUsd * 1e7));
  assert(record.spend.alreadySpentUsd > parent.spendCap.alreadySpentUsd);
  for (const mutate of [
    r => { r.priorCalls.calls.find(c => c.costUsd === null).costCharged = 0; },
    r => { r.priorCalls.calls.shift(); },
    r => { r.spend.alreadySpentUsd = parent.spendCap.alreadySpentUsd; },
    r => { r.priorCalls.statement = 'Some prior calls count.'; },
  ]) { const changed = copy(); mutate(changed); assert.throws(() => validateAmendment(changed, parent)); }
  for (const mutate of [
    r => { r.priorCalls.calls[1].verdict = 'VERDICT: REJECTED'; },
    r => { r.priorCalls.calls.splice(2, 1); },
    r => { r.priorCalls.calls.find(c => c.costUsd === null).costCharged = r.priorCalls.calls[2].costUsd; },
    r => { r.priorCalls.calls[1].label = 'RED'; },
  ]) { const changed = copy(); mutate(changed); assert.throws(() => assertPriorCalls(changed)); }
  assert(record.limits.some(l => l.includes('c001') && l.includes('not counted')));
});

test('the amendment never says "before any gate ran", and describes the runner guard as built', () => {
  assert.doesNotMatch(JSON.stringify(record), /before any gate ran/);
  const ran = copy(); ran.reason.summary = ran.reason.summary.replace('before any counted gate run', 'before any gate ran');
  assert.throws(() => validateAmendment(ran, parent), /before any gate ran/);
  for (const text of [record.priorCalls.cause, record.spend.reason]) {
    assert.match(text, /realpath is the committed fake/); assert.doesNotMatch(text, /identity probe/);
  }
  assert.match(record.priorCalls.evidence.note, /15dfe216/);
  assert.doesNotMatch(record.priorCalls.criteriaTiming, /had not seen/);
});

// The journal renders long unbroken runs (shas, integrity strings, URLs) that are wider than a phone column.
// A static check, no browser: if any run outside a <pre> is wider than the 375px or 320px column at a generous
// 0.5em per character, style.css must let the article body wrap anywhere, or the page scrolls sideways.
test('the journal cannot scroll sideways at 375px or 320px', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = selector => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes(selector) && /overflow-wrap:\s*anywhere/.test(body));
  const built = amendNote(readFileSync(articlePath, 'utf8'), record, digest);
  const body = built.split('<article class="article-body">')[1].split('</article>')[0].replace(/<pre[\s\S]*?<\/pre>/g, ' ');
  const runs = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  assert(runs.some(t => t.length > 64), 'The note carries runs longer than a sha256, so the wrap rule is load-bearing');
  for (const width of [375, 320]) {
    const fits = Math.floor((width - 2 * 16) / (18 * 0.5));
    const wide = runs.filter(t => t.length > fits);
    assert(wide.length === 0 || wraps('.article-body'), `At ${width}px, ${wide.length} unbroken runs are wider than the column and nothing lets them wrap, e.g. ${wide[0]}`);
  }
});

// Every "before any gate" sentence the parent put on the site carries the amendment's qualifier, rendered from
// the record and linked to its section. The built page is checked when it exists; a changed record fails it.
test('the home card, station 06 and the note qualify the parent\'s "before any gate" sentences from the record', () => {
  const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
  const reports = ['migration-witness', 'test-witness', 'ci-witness'].map(id => JSON.parse(readFileSync(`site/data/witnesses/${id}.json`, 'utf8')));
  const home = qualifyHome(readFileSync('site/index.html', 'utf8'), record);
  // Pre-registration mode (results null): the measured station replaces this exhibit and has its own test.
  const exhibit = renderStations(report, reports, undefined, undefined, undefined, undefined, undefined, null).split('id="station-triage"')[1].split('</article>')[0];
  const note = amendNote(readFileSync(articlePath, 'utf8'), record, digest);
  assert(home.includes(`Published before any gate runs.${cardQualifier(record)}</p>`));
  // Later amendments add their own qualifier after this one, inside the same paragraph.
  assert(exhibit.includes(`Written down before any gate runs ·${stationQualifier(record)}`));
  assert(note.includes(`${noteQualifier(record)}</p>`) && note.includes(html(record.siteQualifier.meta)));
  for (const q of [cardQualifier(record), stationQualifier(record)]) assert(q.includes(`href="journal/jev-as-a-fast-gate.html#${sectionId}"`));
  // The built pages, from a build made for this test in a disposable copy: independent of whether and when
  // `pnpm build` ran, and of other test files reading the checkout meanwhile (test-build.mjs).
  const dist = join(builtCopy(), 'dist');
  const built = readFileSync(join(dist, 'index.html'), 'utf8');
  // Once results are committed, station 06 shows the measured exhibit, which has no pre-registration sentence to qualify.
  assert(built.includes(cardQualifier(record)) && (existsSync('experiments/jev-gate/results/results.json') || built.includes(stationQualifier(record))), 'the built home page is not qualified by the committed amendment');
  assert(readFileSync(join(dist, 'journal/jev-as-a-fast-gate.html'), 'utf8').includes(noteQualifier(record)), 'The built note is not qualified by the committed amendment');
  // A changed record changes every qualifier, and a qualifier that no longer states the record's facts is refused.
  const changed = copy(); changed.siteQualifier.card = changed.siteQualifier.card.replace('6 uncounted', '7 uncounted');
  assert.throws(() => validateAmendment(changed, parent), /siteQualifier.card must state/);
  const fewer = copy(); const dropped = fewer.priorCalls.calls.pop(); fewer.spend.alreadySpentUsd -= dropped.costCharged;
  assert.throws(() => validateAmendment(fewer, parent), /siteQualifier/);
  const reworded = copy(); reworded.siteQualifier.station += ' (see the note)';
  assert(!exhibit.includes(stationQualifier(reworded)), 'The station renders the committed record, not another');
  assert(qualifyStation('<p class="artifact-label">Written down before any gate runs</p>', reworded).includes('(see the note)'));
  assert.throws(() => qualifyHome(home.replace('Published before any gate runs.', 'Published.'), record), /exactly once/);
});
