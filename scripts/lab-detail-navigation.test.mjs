import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readTiles, renderTile } from './lab-tiles.mjs';
import { renderFailoverAbout, renderLabs } from './labs.mjs';

test('every published experiment lab has a page reached directly from its index card', () => {
  const pages = renderLabs();
  const index = pages['labs/index.html'];
  for (const tile of readTiles()) {
    const path = `labs/${tile.experiment}/index.html`;
    assert.ok(existsSync(join('site', path)), `${tile.label} has a committed page`);
    assert.ok(pages[path], `${tile.label} has a built page`);
    const card = renderTile(tile);
    assert.match(card, new RegExp(`<a href="\\.\\./${path.replaceAll('.', '\\.')}"><span class="sr-only">`), `${tile.label} has a primary page link`);
    assert.ok(card.includes(`<span class="sr-only">${tile.title} — </span>`), `${tile.label} names its page to screen readers`);
    assert.ok(index.includes(card.slice(0, card.indexOf('<ul class="lab-tile-links">'))), `${tile.label} keeps that link on the index`);
    assert.equal(card.split(`href="../${path}"`).length - 1, 1, `${tile.label} does not repeat its page link among source links`);
    const selfLink = renderTile({ ...tile, links: [...tile.links, { label: 'This lab page', href: path }] });
    assert.equal(selfLink.split(`href="../${path}"`).length - 1, 1, `${tile.label} omits a duplicate self link`);
  }
});

test('the published render requires checked tiles and pages, and Failover metadata follows its tile', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'rnd-lab-page-'));
  try {
    cpSync('site', join(fixture, 'site'), { recursive: true });
    cpSync('scripts', join(fixture, 'scripts'), { recursive: true });
    cpSync('experiments', join(fixture, 'experiments'), { recursive: true });
    copyFileSync('package.json', join(fixture, 'package.json'));
    const source = join(fixture, 'scripts/labs.mjs');
    const original = readFileSync(source, 'utf8');
    assert.ok(original.includes('    ...jury.pages,'), 'the fixture removes a real rendered page entry');
    writeFileSync(source, original.replace('    ...jury.pages,', ''));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /labs\/ai-jury\/index\.html: checked tile has no rendered page/);
    writeFileSync(source, original);
    const tilePath = join(fixture, 'site/data/labs/failover.json');
    const tile = JSON.parse(readFileSync(tilePath, 'utf8'));
    tile.label = 'Lab 12';
    tile.title = 'Failover study';
    tile.question = 'When the primary database stops, which acknowledged writes survive?';
    tile.status = 'Pre-registered; next step under review';
    const alternatePrereg = 'journal/failover-pre-registration-alt.html';
    copyFileSync(join(fixture, 'site/journal/failover-pre-registration.html'), join(fixture, 'site', alternatePrereg));
    const planIndex = tile.links.findIndex(link => /pre-?registration/i.test(link.label) && /pre-?registration/i.test(link.href));
    assert.ok(planIndex >= 0, 'the fixture changes the actual plan rather than a result link');
    tile.links[planIndex].href = alternatePrereg;
    tile.links.push({ label: 'Another plan copy', href: alternatePrereg });
    tile.links.push({ label: 'This lab page', href: 'labs/failover/index.html' });
    writeFileSync(tilePath, JSON.stringify(tile));
    const changed = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; process.stdout.write(renderLabs('site', {requireBench: false})['labs/failover/index.html']);"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.ok(changed.stdout.includes(`<title>${tile.label}: ${tile.title} — Odin Labs R&amp;D</title>`));
    assert.ok(changed.stdout.includes(`<meta property="og:title" content="${tile.label}: ${tile.title} — Odin Labs R&amp;D">`));
    assert.ok(changed.stdout.includes(`<meta name="description" content="${tile.question} ${tile.status}.">`));
    assert.ok(changed.stdout.includes(`<meta property="og:description" content="${tile.question} ${tile.status}.">`));
    assert.ok(changed.stdout.includes(`<span class="technical">${tile.label.toUpperCase()}</span><h1 id="lab-title">${tile.title}</h1>`));
    const plan = changed.stdout.match(/<section[^>]*id="plan"[\s\S]*?<\/section>/)?.[0];
    const sources = changed.stdout.match(/<section[^>]*id="sources"[\s\S]*?<\/section>/)?.[0];
    assert.ok(plan?.includes(`href="../../${alternatePrereg}"`), 'the plan follows the tile link, even when its path changes');
    assert.ok(sources, 'the page has a source list');
    assert.ok(!sources.includes(`href="../../${alternatePrereg}"`), 'the source list omits both copies of the plan link');
    assert.equal(changed.stdout.split(`href="../../${alternatePrereg}"`).length - 1, 1, 'the plan link appears once');
    assert.ok(!sources.includes('href="../../labs/failover/index.html"'), 'the source list omits a link to itself');
    tile.links[planIndex].label = 'The plan';
    writeFileSync(tilePath, JSON.stringify(tile));
    const noPrereg = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(noPrereg.status, 1, noPrereg.stderr);
    assert.match(noPrereg.stderr, /expected one pre-registration link in the checked tile/);
    tile.links[planIndex].label = 'The pre-registration (EXP 021)';
    tile.links.push({ label: 'Pre-registration record', href: 'data/failover/preregistration.json' });
    writeFileSync(tilePath, JSON.stringify(tile));
    const twoPrereg = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(twoPrereg.status, 1, twoPrereg.stderr);
    assert.match(twoPrereg.stderr, /expected one pre-registration link in the checked tile/);
    rmSync(tilePath);
    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /data\/labs\/failover\.json: missing \(listed in TILE_FILES/);
    copyFileSync('site/data/labs/failover.json', tilePath);
    const tilesSource = join(fixture, 'scripts/lab-tiles.mjs');
    const tilesCode = readFileSync(tilesSource, 'utf8');
    assert.ok(tilesCode.includes("'data/labs/failover.json', "));
    writeFileSync(tilesSource, tilesCode.replace("'data/labs/failover.json', ", ''));
    const unlisted = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(unlisted.status, 1, unlisted.stderr);
    assert.match(unlisted.stderr, /labs\/failover\/index\.html: template has no checked tile/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('the failover page shows its published result, plan and bounded status', () => {
  const page = renderLabs()['labs/failover/index.html'];
  const tile = readTiles().find(item => item.experiment === 'failover');
  assert.ok(page);
  assert.ok(page.includes(tile.question));
  assert.ok(page.includes(tile.how));
  assert.ok(page.includes(tile.status), 'the page reflects the checked tile status');
  assert.equal(tile.kind, 'results', 'the completed experiment uses the results metadata contract');
  assert.ok(page.includes('A result is published.'));
  assert.doesNotMatch(page, /No counted result is published yet\./);
  assert.ok(page.includes(`href="../../${tile.record.href}"`), 'the published result record is reachable');
  const prereg = `data/${tile.experiment}/preregistration.json`;
  assert.ok(existsSync(join('site', prereg)), 'the checked tile requires a published pre-registration');
  const preregLinks = tile.links.filter(link => /pre-?registration/i.test(link.label) && /pre-?registration/i.test(link.href));
  assert.equal(preregLinks.length, 1, 'the checked tile names exactly one pre-registration link');
  const preregLink = preregLinks[0];
  const plan = page.match(/<section[^>]*id="plan"[\s\S]*?<\/section>/)?.[0];
  assert.ok(plan?.includes(`href="../../${preregLink.href}"`), 'the plan links the checked tile source');
  assert.equal(page.split(`href="../../${preregLink.href}"`).length - 1, 1, 'the page links the plan once');
  const description = page.match(/<meta name="description" content="([^"]*)">/)?.[1];
  assert.ok(description);
  assert.ok(description.includes(tile.question));
  assert.ok(description.includes(tile.status));
  for (const link of tile.links) assert.ok(page.includes(`href="../../${link.href}"`), `${link.label} is on the lab page`);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/failover/</loc>'));
  assert.doesNotMatch(page, /<!--FAILOVER_[A-Z_]+-->/);
});

test('"What it is." opens the failover page as on Lab 13: plain words, then how it works, every count the record\'s, no overall winner', () => {
  const page = renderLabs()['labs/failover/index.html'];
  const body = page.split('<main id="main">')[1].split('</main>')[0];
  const about = body.match(/<section[^>]*id="about"[\s\S]*?<\/section>/)?.[0];
  assert.ok(about, 'the page has a What it is section');
  const hero = body.indexOf('lab-hero'), at = body.indexOf('id="about"');
  assert.ok(hero >= 0 && hero < at && at < body.indexOf('id="status"'), 'right after the hero, before where it stands');
  assert.equal(body.slice(hero, at).split('<section').length - 1, 1, 'no other section between the hero and it');
  assert.match(about, /<figure class="lab-flow">/);
  const tile = readTiles().find(item => item.experiment === 'failover');
  const rec = JSON.parse(readFileSync(join('site', tile.record.href), 'utf8'));
  const compared = Object.values(rec.verdict.scenarios).filter(row => row.labelled_fault === false);
  const mongo = compared.filter(row => row.verdict === 'mongodb-fits'), pg = compared.filter(row => row.verdict === 'postgres-fits');
  const metric = m => mongo.filter(row => row.compared_metric === m).length;
  const totals = Object.values(rec.recount.totals);
  const sum = key => totals.reduce((k, t) => k + t[key], 0).toLocaleString('en-GB');
  const text = about.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(`${rec.recount.countedCells} counted runs`));
  // How it ran, in counts the record holds: the fault runs disrupted the main server, the steady runs left it alone.
  assert.ok(text.includes(`In ${rec.recount.countedCells - rec.recount.steadyCells} of the ${rec.recount.countedCells} counted runs we disrupted the main server on purpose in the middle of the work; in the other ${rec.recount.steadyCells} we left it alone.`), 'the fault and steady runs, counted from the record');
  assert.doesNotMatch(text, /stopped or cut off the main one/, 'not every fault stops or cuts off the main server (one is a planned handover)');
  // The decision rule as a reader takes it away, its margin and pair count read from the frozen fault-verdict line:
  // at least 20 % shorter in at least 4 of the 5 first-round pairs, and only the middle value's direction in round two.
  const prereg = JSON.parse(readFileSync(join('site', 'data/failover/preregistration.json'), 'utf8'));
  const ruleLine = prereg.prereg.sections.flatMap(section => section.lines).find(line => line.startsWith('**A fault verdict**'));
  const [, margin, need, of] = ruleLine.match(/≥ (\d+) % shorter than the other arm's compared variant in ≥ (\d+) of (\d+) paired repetitions/).map(Number);
  assert.equal(margin, 20, 'the frozen margin is a fifth');
  const reps = [...new Set(compared.flatMap(row => Object.values(row.pairs).map(list => list.length)))];
  const rounds = [...new Set(compared.map(row => Object.keys(row.pairs).length))];
  assert.deepEqual(reps, [of], 'every round holds as many pairs as the rule counts');
  assert.ok(text.includes(`First, a database must keep every confirmed write and pass its other checks; if only one database does, that one fits. If both do, one fits only when its break in confirmed writes is clearly shorter (by at least a fifth, a margin fixed in advance) in at least ${need} of ${of} paired runs of a first round, and still shorter on the middle value of a second round of runs. Otherwise both fit.`), 'the rule as frozen, in plain words');
  assert.doesNotMatch(text, /the one with the shorter break[^.]*fits/, 'a shorter break alone is never said to win');
  assert.doesNotMatch(text, /again in a second round|in most of the paired runs/, 'the margin is not said to be tested twice, nor to hold in a bare majority');
  // The record agrees with that sentence: a gate-only fit had exactly one database pass the checks, a timed fit had both.
  for (const row of compared.filter(r => /-fits$/.test(r.verdict))) {
    const passed = [row.gates.mongo, row.gates.pg].filter(Boolean).length;
    assert.equal(passed, row.basis === 'gate-only' ? 1 : 2, `${row.verdict} ${row.basis}`);
  }
  assert.ok(Object.values(rec.verdict.scenarios).some(r => r.verdict === 'both-fit' && r.gates.mongo && r.gates.pg), 'the record has a scenario where both passed and neither was clearly shorter: both fit');
  assert.ok(text.includes(`${rec.recount.countedCells - rec.recount.steadyCells} fault runs, ${rec.recount.steadyCells} steady runs`));
  assert.ok(text.includes(`the same ${compared.length} compared fault scenarios, each repeated ${reps[0]} times in each of ${rounds[0]} rounds`), 'the repeats, from the record');
  assert.ok(text.includes(`${sum('acknowledged')} confirmed writes counted in ${sum('cells')} runs`));
  assert.equal(sum('lostAcknowledged'), '0');
  assert.ok(text.includes(`Neither database lost a write it had confirmed, in any of the ${rec.recount.countedCells} counted runs.`), 'the lost-writes sentence, from the record');
  assert.equal(totals.reduce((k, t) => k + t.cells, 0), rec.recount.countedCells);
  assert.match(about, /lab-flow-good"><strong>None lost<\/strong>/, 'no confirmed write lost: the good tone, from the record');
  assert.ok(text.includes(`MongoDB fits ${mongo.length} of ${compared.length} ${metric('outage')} on write outage, ${metric('ack_gap')} on acknowledgement gap`));
  assert.ok(text.includes(`PostgreSQL fits ${pg.length} of ${compared.length} ${pg.filter(row => row.basis === 'gate-only').length} where only it passed the checks`));
  // The prose verdict sentence a reader takes away, every count recomputed from the record.
  assert.equal(pg.length, pg.filter(row => row.basis === 'gate-only').length, 'every PostgreSQL fit is gate-only');
  assert.ok(text.includes(`MongoDB fits ${mongo.length} of ${compared.length} compared scenarios (${metric('outage')} on write outage, ${metric('ack_gap')} on acknowledgement gap); PostgreSQL fits ${pg.length} of ${compared.length} compared scenarios (${pg.length} where only it passed the checks).`), 'the verdict sentence, from the record');
  assert.ok(text.includes("Some questions stay open; the last lane below shows one of them, and the record's limits name the rest."), 'the open sentence promises one lane, not every open question');
  assert.ok(text.includes(`${rec.recount.strictAckCells.reduce((k, c) => k + c.acks, 0).toLocaleString('en-GB')} confirmed writes in ${rec.recount.strictAckCells.length} runs`));
  assert.ok(text.includes('There is no overall winner.') && text.includes('No overall winner'));
  assert.match(text, /two-copy safety not established/);
  assert.doesNotMatch(text, /fits (?:six|\d+) outage scenarios|of \d+ compared(?: fault)? scenarios on outage|wins overall|overall winner is|two-copy (?:durability|safety) (?:is )?established/i, 'never all fits called outage, never a winner, never two-copy durability');
});

test('"What it is." on the failover page fails closed: an open strict-ack question or the frozen rule never silently drops', () => {
  const read = path => JSON.parse(readFileSync(join('site', path), 'utf8'));
  const rec = read('data/failover/results.json'), prereg = read('data/failover/preregistration.json');
  const strictAcks = rec.recount.strictAckCells.reduce((k, c) => k + c.acks, 0).toLocaleString('en-GB');
  const html = renderFailoverAbout(rec, prereg);
  assert.ok(html.includes(`${strictAcks} confirmed writes in ${rec.recount.strictAckCells.length} runs`), 'the open lane shows while the record holds strict acknowledgements');
  // The limit reworded (no longer naming the empty standby list): the build stops, it does not hide the open lane.
  const reworded = structuredClone(rec);
  reworded.limits = reworded.limits.map(l => l.replace('synchronous_standby_names was empty', 'the standby list were empty'));
  assert.throws(() => renderFailoverAbout(reworded, prereg), new RegExp(`no limit names the ${strictAcks} strict acknowledgements in ${rec.recount.strictAckCells.length} runs`));
  // A strict acknowledgement in a run that is not PostgreSQL's: the build stops.
  const foreign = structuredClone(rec);
  foreign.recount.strictAckCells[0].cell = `mongo-${foreign.recount.strictAckCells[0].cell.slice(3)}`;
  assert.throws(() => renderFailoverAbout(foreign, prereg), /strict acknowledgements in runs that are not PostgreSQL's/);
  // The limit's count differs from the record's runs: the build stops.
  const fewer = structuredClone(rec);
  fewer.recount.strictAckCells.pop();
  assert.throws(() => renderFailoverAbout(fewer, prereg), /no limit names/);
  // The record loses its list of strict-ack runs, or the list is emptied, while the limit still names the open question: the build stops.
  const missing = structuredClone(rec);
  delete missing.recount.strictAckCells;
  assert.throws(() => renderFailoverAbout(missing, prereg), /recount\.strictAckCells is missing/);
  const emptied = structuredClone(rec);
  emptied.recount.strictAckCells = [];
  assert.throws(() => renderFailoverAbout(emptied, prereg), /a limit names an open question .* but recount\.strictAckCells lists no runs/);
  // An empty list with no limit naming the question is a record with nothing open: the page renders without the lane.
  const closed = structuredClone(rec);
  closed.recount.strictAckCells = [];
  closed.limits = closed.limits.filter(l => !/synchronous_standby_names|not established/.test(l));
  const closedHtml = renderFailoverAbout(closed, prereg);
  assert.doesNotMatch(closedHtml, /Still open|Some questions stay open/, 'nothing open in the record: no open lane');
  // No frozen rule to read the margin from: the build stops rather than type one.
  const noRule = structuredClone(prereg);
  noRule.prereg.sections = noRule.prereg.sections.map(section => ({ ...section, lines: section.lines.filter(line => !line.startsWith('**A fault verdict**')) }));
  assert.throws(() => renderFailoverAbout(rec, noRule), /no frozen fault-verdict rule/);
});
