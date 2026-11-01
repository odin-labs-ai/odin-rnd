import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validate } from './json-schema-lite.mjs';
import { dispatchProblems, prepare, publish, PUBLIC_SCHEMA_FILE, screenText, SOURCE_SCHEMA_FILE } from './lab-dispatch-publish.mjs';
import { readDispatches, renderLabs } from './labs.mjs';
import { readFilms } from './lab-films.mjs';
import { readOutage } from './lab-outage.mjs';

// The Lab 01 publisher (mission rnd-labs-human-first-1024). Every session here is written by the test at run time, so
// no recorded session, clip or restricted name is committed: a restricted name is built from character codes.
const temp = mkdtempSync(join(tmpdir(), 'lab-dispatch-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const sourceSchema = JSON.parse(readFileSync(SOURCE_SCHEMA_FILE, 'utf8'));
const publicSchema = JSON.parse(readFileSync(PUBLIC_SCHEMA_FILE, 'utf8'));
const privateProject = String.fromCharCode(111, 97, 99);
const studio = [...'tfolemag'].reverse().join('');
const computePartner = [...'drowelbuod'].reverse().join('');

const cleanProofs = () => [
  { id: 'odin-a1b2c3-1', t: 1700000000.0, agent: 'Odin', asked_by: 'Follower', question: "Odin, what's going on here?",
    answer: 'Four agents are here. Atlas is reading in the library and Juno is at the help desk.',
    why: 'I read these just now: the agents’ states and the world’s structures.', source: 'world-checked',
    sources: [{ what: 'Atlas is reading in the library', ref: "the agents' states" }], via: 'rules:world', ok: true,
    lens: { run: 'agent-space-live-1700000000', seq: 24 } },
  { id: 'atlas-a1b2c3-1', t: 1700000010.0, agent: 'Atlas', asked_by: 'Follower', question: 'how do I plug in my own agent?',
    answer: 'Add an entry to the agents file: a name, a look, a home spot and a brain.', why: "From my knowledge base entry 'plug-in'.",
    source: 'wiki', sources: [{ what: 'knowledge base: plug-in', ref: 'knowledge base: plug-in' }], via: 'scripted', ok: true, ms: 5,
    lens: { run: 'agent-space-live-1700000000', seq: 43 } },
];
const screened = { ok: true, by: 'intake', note: '', checks: ['injection', 'personal-data', 'ip-boundary', 'on-topic'] };
const cleanManifest = (session, clipBytes) => ({
  format: 'odin-dispatch', version: 1, session, questions_session: '2026-W44', date: session.slice(8, 18),
  commit: '0000000000000000000000000000000000000001', space: { url: 'http://127.0.0.1:57342/' },
  clip: { file: 'clip.webm', bytes: clipBytes, mime: 'video/webm;codecs=vp9', bps: 300000, seconds: 38 },
  poster: 'poster.png', stills: ['stills/01-s1-q1.png'],
  questions: [
    { id: 's1-q1', to: 'Odin', text: "What's going on here?", asked_by: 'odin-labs:seed', screened, asked: true, evidence: 'odin-a1b2c3-1', follow_up: false, why_not: null },
    { id: 's1-q2', to: 'Atlas', text: 'How do I plug in my own agent?', asked_by: 'github:@someone', issue: 12, screened, asked: true, evidence: 'atlas-a1b2c3-1', follow_up: false, why_not: null },
    { id: 's1-q3', to: 'Odin', text: 'How do you know?', asked_by: 'odin-labs:seed', screened, asked: true, evidence: 'odin-a1b2c3-1', follow_up: true,
      reply: 'How I know: I read the agents’ states and the world’s structures just now.', why_not: null },
    { id: 's1-q4', to: 'Odin', text: 'a question the intake rejected', asked_by: 'odin-labs:seed', asked: false, evidence: null, why_not: 'not screened' },
  ],
  proofs: ['proofs/odin-a1b2c3-1.json', 'proofs/atlas-a1b2c3-1.json'], answers_screened: false,
  note: 'the answers are not screened yet: screen them before anything is published',
});
const screen = session => ({ format: 'odin-answers-screen', version: 1, session, by: 'odin-labs',
  answers: ['odin-a1b2c3-1', 'atlas-a1b2c3-1'].map(evidence => ({ evidence, verdict: 'ok', checks: ['personal-data', 'ip-boundary', 'place', 'price', 'partner'] })) });

let sessions = 0;
/** A session dir as the agent space exports it; `edit` changes the manifest and proofs before they are written. */
function session(edit = () => {}) {
  const name = `session-2026-10-25-t${++sessions}`;
  const dir = join(temp, 'in', name);
  mkdirSync(join(dir, 'proofs'), { recursive: true });
  mkdirSync(join(dir, 'stills'), { recursive: true });
  const clip = Buffer.from('a stand-in for a recorded clip');
  writeFileSync(join(dir, 'clip.webm'), clip);
  writeFileSync(join(dir, 'poster.png'), 'poster');
  writeFileSync(join(dir, 'stills/01-s1-q1.png'), 'still');
  const manifest = cleanManifest(name, clip.length), proofs = cleanProofs();
  edit(manifest, proofs);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const proof of proofs) writeFileSync(join(dir, `proofs/${proof.id}.json`), JSON.stringify(proof, null, 1));
  return { dir, name, manifest };
}

test('the schema checker: a full manifest conforms, and a missing field, a wrong const or an unknown keyword does not', () => {
  const { manifest } = session();
  assert.deepEqual(validate(sourceSchema, manifest), []);
  const { commit, ...noCommit } = manifest;
  assert.ok(validate(sourceSchema, noCommit).some(p => p.includes('missing commit')));
  assert.ok(validate(sourceSchema, { ...manifest, answers_screened: true }).some(p => p.startsWith('/answers_screened')));
  assert.ok(validate(sourceSchema, { ...manifest, extra: 1 }).some(p => p.startsWith('/extra: not allowed')));
  const asked = structuredClone(manifest); delete asked.questions[0].follow_up;
  assert.ok(validate(sourceSchema, asked).some(p => p.includes('missing follow_up')), 'if/then: an asked question needs follow_up');
  assert.match(validate({ type: 'string', format: 'email' }, 'x').join(), /does not know: format/);
  assert.deepEqual(validate({ oneOf: [{ const: 1 }, { type: 'integer' }] }, 1), ['/: matches 2 of the oneOf branches, expected exactly 1']);
});

test('a clean session passes: the dispatch matches both schemas and carries only the public part', () => {
  const { dir, name, manifest } = session();
  assert.deepEqual(validate(sourceSchema, manifest), [], 'the manifest matches the vendored schema');
  const site = join(temp, 'site-clean');
  const result = publish({ sessionDir: dir, answerScreen: screen(name), site });
  assert.deepEqual(result.problems, []);
  const written = JSON.parse(readFileSync(join(site, `data/labs/agent-space/dispatches/${name}.json`), 'utf8'));
  assert.deepEqual(validate(publicSchema, written), []);
  assert.deepEqual(written.questions.map(q => q.id), ['s1-q1', 's1-q2', 's1-q3'], 'only asked questions');
  assert.equal(written.questions[2].answer, manifest.questions[2].reply, 'a follow-up shows its reply');
  assert.deepEqual(written.questions[1], { id: 's1-q2', to: 'Atlas', text: 'How do I plug in my own agent?', followUp: false,
    answer: cleanProofs()[1].answer, why: cleanProofs()[1].why, source: 'wiki', evidence: 'atlas-a1b2c3-1' });
  const raw = JSON.stringify(written);
  for (const dropped of ['127.0.0.1', manifest.commit, 'agent-space-live', 'odin-labs:seed', 'github:@someone', 'Follower', 'rules:world']) {
    assert.ok(!raw.includes(dropped), `drops ${dropped}`);
  }
  assert.equal(written.source.manifestSha256, createHash('sha256').update(readFileSync(join(dir, 'manifest.json'))).digest('hex'));
  for (const file of ['clip.webm', 'poster.png', 'stills/01-s1-q1.png']) {
    assert.deepEqual(readFileSync(join(site, `assets/labs/agent-space/${name}/${file}`)), readFileSync(join(dir, file)), file);
  }
});

test('the real sample’s shape is refused: a restricted label on a card, a file path, a run id, unscreened answers', () => {
  const { dir, name, manifest } = session((m, proofs) => {
    proofs[0].sources.push({ what: `the home stands on the owned ground ${privateProject}-heightfield-v1 (spec 0000deadbeef)`, ref: 'the terrain spec' });
    proofs[1].why = "From my knowledge base entry 'plug-in' (the agents.json format, space/config.py).";
    m.questions[2].reply = 'The full evidence: evidence odin-a1b2c3-1 (lens agent-space-live-1700000000 #24).';
  });
  assert.deepEqual(validate(sourceSchema, manifest), [], 'the refusal is the screen, not the schema');
  const site = join(temp, 'site-refused');
  const { problems } = publish({ sessionDir: dir, answerScreen: null, site });
  assert.equal(problems.length, 4, problems.join('\n'));
  assert.match(problems[0], /^proofs\/odin-a1b2c3-1\.json#\/sources\/1\/what: a restricted name/);
  assert.match(problems[1], /^proofs\/atlas-a1b2c3-1\.json#\/why: a file path/);
  assert.match(problems[2], /^manifest\.json#\/questions\/2\/reply: a phone number, timestamp or long internal id/);
  assert.match(problems[3], /answers_screened is false in the manifest and no answer screen is recorded/);
  assert.ok(!existsSync(site), 'nothing is written');
  // The same session through the command line: exit 1, every reason on stderr.
  const run = spawnSync(process.execPath, ['scripts/lab-dispatch-publish.mjs', '--session', dir, '--site', site], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, new RegExp(`^REFUSED ${name}: 4 reasons; nothing was written\\.`));
  assert.ok(!existsSync(site));
  // Screening the answers does not lift a refusal of their text.
  assert.equal(prepare(dir, screen(name)).problems.length, 3);
});

test('the screen names each kind of text that may not be public, and passes plain answers', () => {
  const cases = {
    [`Built on ${privateProject.toUpperCase()}Engine`]: 'a restricted name', [`the ${studio} build`]: 'a restricted name',
    [`thanks to ${computePartner.slice(0, 6)} ${computePartner.slice(6)}`]: 'a restricted name',
    'it costs €40 a month': 'a price', 'about 12 EUR': 'a price', 'USD 5': 'a price',
    'mail me at someone@example.com': 'an email address', 'call +31 6 1234 5678': 'a phone number',
    'we sit at 1012 AB': 'a postcode', 'at 12 Main Street': 'a street address', 'Keizersgracht 12': 'a street address',
    'open http://localhost:3000': 'a local or IP address', 'on 10.0.0.12': 'a local or IP address',
    'see https://example.com/x': 'a link to somewhere other than this lab', 'in src/space/config.py': 'a file path',
    'under /Users/someone': 'a file path', 'run 1700000000': 'a phone number',
    'edit config.py': 'a file path', 'add it to agents.json': 'a file path', 'see settings.yaml': 'a file path',
  };
  for (const [text, reason] of Object.entries(cases)) assert.ok(screenText(text).some(r => r.startsWith(reason)), `${text} -> ${reason}: ${screenText(text)}`);
  for (const text of ['Add an entry to the agents file: a name, a look and a brain.', 'approach the coach', 'in 2026 we met', 'Four agents are here, 22 structures on the ground.',
    'Juno is at the help desk', 'Odin Campus', 'Session of 2026-10-25', 'evidence odin-a1b2c3-1', 'See https://github.com/odin-labs-ai/odin-rnd']) {
    assert.deepEqual(screenText(text), [], text);
  }
});

test('an answer screen must cover every proof, pass it, and be for this session', () => {
  const { dir, name } = session();
  const partial = screen(name); partial.answers.pop();
  assert.match(prepare(dir, partial).problems.join('\n'), /does not cover evidence atlas-a1b2c3-1/);
  const failed = screen(name); failed.answers[0].verdict = 'held';
  assert.match(prepare(dir, failed).problems.join('\n'), /did not pass evidence odin-a1b2c3-1/);
  assert.match(prepare(dir, { ...screen(name), session: 'session-2026-10-01' }).problems.join('\n'), /the answer screen is for/);
  assert.match(prepare(dir, { ...screen(name), by: 'Someone@Example.com' }).problems.join('\n'), /does not say who screened it/);
});

test('a manifest off the vendored schema, a clip over 3 MB or a missing file is refused', () => {
  const off = session(m => { delete m.commit; });
  assert.match(prepare(off.dir, screen(off.name)).problems.join('\n'), /manifest\.json#\/: missing commit \(does not match the vendored odin-dispatch v1 schema\)/);
  const big = session(m => { m.clip.bytes = 4 * 1024 * 1024; });
  writeFileSync(join(big.dir, 'clip.webm'), Buffer.alloc(4 * 1024 * 1024));
  assert.match(prepare(big.dir, screen(big.name)).problems.join('\n'), /over the 3145728-byte limit/);
  const missing = session();
  rmSync(join(missing.dir, 'stills/01-s1-q1.png'));
  assert.match(prepare(missing.dir, screen(missing.name)).problems.join('\n'), /stills\/01-s1-q1\.png: missing/);
});

test('a published dispatch renders on the lab page and in the feed; a tampered one fails the build', () => {
  const { dir, name } = session();
  const root = join(temp, 'site-render');
  mkdirSync(join(root, 'data/labs'), { recursive: true });
  // The story page ships only with its record (scripts/lab-milestones.mjs), which these roots do not carry.
  cpSync('site/labs', join(root, 'labs'), { recursive: true, filter: src => !src.includes('labs/agent-space/story') });
  cpSync('site/data/labs/agent-space.json', join(root, 'data/labs/agent-space.json'));
  cpSync('site/data/labs/delivery', join(root, 'data/labs/delivery'), { recursive: true });
  assert.deepEqual(publish({ sessionDir: dir, answerScreen: screen(name), site: root }).problems, []);
  const pages = renderLabs(root);
  const page = pages['labs/agent-space/index.html'];
  assert.match(page, new RegExp(`<source src="\\.\\./\\.\\./assets/labs/agent-space/${name}/clip\\.webm" type="video/webm">`));
  assert.equal((page.match(/class="lab-card"/g) ?? []).length, 3);
  // The fixture carries the proof-card explorer's template, so each card's evidence id links to its entry there.
  assert.match(page, /A page it has read<\/span><a href="proofs\/#proof-atlas-a1b2c3-1"><code>evidence atlas-a1b2c3-1<\/code><\/a>/);
  assert.match(pages['labs/agent-space/proofs/index.html'], /<article class="proof-entry" id="proof-atlas-a1b2c3-1"/);
  assert.doesNotMatch(page, /id="no-dispatch"/);
  assert.match(pages['labs/agent-space/feed.xml'], new RegExp(`<entry><id>https://odin-labs-ai\\.github\\.io/odin-rnd/labs/agent-space/#${name}</id>`));
  assert.match(pages['labs/agent-space/feed.xml'], /<updated>2026-10-25T00:00:00Z<\/updated>/);
  const file = join(root, `data/labs/agent-space/dispatches/${name}.json`);
  const good = readFileSync(file, 'utf8');
  const tampered = JSON.parse(good); tampered.questions[0].answer += ` (with help from ${computePartner})`;
  writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => readDispatches(root), /questions\/0\/answer: a restricted name/);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(good), commit: '0000000000000000000000000000000000000001' }));
  assert.throws(() => readDispatches(root), /#\/commit: not allowed/);
  writeFileSync(file, good);
  assert.equal(readDispatches(root).length, 1);
  // The assets are pinned by sha256: one changed byte in the clip, a swapped still or a dropped hash fails the build.
  const clip = join(root, `assets/labs/agent-space/${name}/clip.webm`);
  const clipBytes = readFileSync(clip);
  const flipped = Buffer.from(clipBytes); flipped[flipped.length - 1] ^= 0xff;
  writeFileSync(clip, flipped);
  assert.throws(() => readDispatches(root), /clip\.webm does not match its recorded sha256/);
  writeFileSync(clip, clipBytes);
  const noHash = JSON.parse(good); delete noHash.source.assetsSha256[noHash.poster];
  writeFileSync(file, JSON.stringify(noHash));
  assert.throws(() => readDispatches(root), /no recorded sha256 for/);
  const extra = JSON.parse(good); extra.source.assetsSha256['assets/labs/agent-space/other/clip.webm'] = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(extra));
  assert.throws(() => readDispatches(root), /is not one of this dispatch's assets/);
  writeFileSync(file, good);
  assert.equal(readDispatches(root).length, 1);
});

test('every committed session passes the publisher\'s checks, every Lab asset belongs to one, and no restricted name in the Lab files', () => {
  // readDispatches runs dispatchProblems (schema, text screen, answer screen) on every committed file and throws on any
  // problem; the explicit loop below repeats it so this test states, not implies, that each one passes.
  const committed = readDispatches('site');
  const dir = 'site/data/labs/agent-space/dispatches';
  const dispatchFiles = existsSync(dir) ? readdirSync(dir).filter(name => !name.startsWith('.')) : [];
  assert.equal(committed.length, dispatchFiles.length, 'every file in the dispatch folder is a read, checked dispatch');
  for (const name of dispatchFiles) {
    const dispatch = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    assert.deepEqual(dispatchProblems(dispatch, `${dir}/${name}`, 'site'), [], name);
    const screened = new Set(dispatch.answersScreen.answers.filter(a => a.verdict === 'ok').map(a => a.evidence));
    for (const q of dispatch.questions) assert.ok(screened.has(q.evidence), `${name}: ${q.evidence} has a passing answer screen`);
  }
  // The lab's films are the only other Lab assets. films.json owns each film file: readFilms refuses (throws) a film
  // or poster whose bytes do not hash to its recorded sha256 and size, so ownership here is hash-checked.
  const films = readFilms('site')?.films ?? [];
  // Dispatch #2's film and poster are owned by outage.json, hash-checked the same way by readOutage.
  const outage = readOutage('site');
  const referenced = new Set([...committed.flatMap(d => [d.clip.src, d.poster, ...d.stills]), ...films.flatMap(f => [f.src, f.poster]),
    ...(outage ? [outage.film.src, outage.film.poster] : [])].map(src => join('site', src)));
  const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];
  for (const file of walk('site/assets/labs')) assert.ok(referenced.has(file), `${file} belongs to no committed dispatch or film`);
  for (const file of referenced) assert.ok(existsSync(file), `${file} is referenced but missing`);
  const files = ['scripts/lab-dispatch-publish.mjs', 'scripts/lab-dispatch-publish.test.mjs', 'scripts/labs.mjs', 'scripts/labs.test.mjs',
    'scripts/json-schema-lite.mjs', 'scripts/lab-screen-terms.json', 'scripts/schemas/odin-dispatch-v1.schema.json', 'scripts/schemas/odin-lab-dispatch.schema.json',
    'scripts/schemas/README.md', 'site/data/labs/agent-space.json', 'site/labs/index.html', 'site/labs/agent-space/index.html',
    '.github/ISSUE_TEMPLATE/ask-the-agents.yml', 'scripts/lab-films.mjs', 'scripts/lab-telemetry.mjs', 'scripts/lab-counts.mjs', 'scripts/schemas/odin-lab-films.schema.json',
    'scripts/schemas/odin-telemetry.schema.json', 'scripts/schemas/odin-lab-counts.schema.json', 'site/data/labs/agent-space/films.json',
    'site/data/labs/agent-space/telemetry.json', 'site/data/labs/agent-space/counts.json',
    'site/data/labs/agent-space/hard-parts.json', 'scripts/lab-outage.mjs', 'scripts/lab-outage.test.mjs',
    'scripts/schemas/odin-lab-outage.schema.json', 'site/data/labs/agent-space/outage.json'];
  for (const file of files) assert.ok(!screenText(readFileSync(file, 'utf8')).some(r => r.startsWith('a restricted name')), file);
  // The vendored schema differs from its upstream copy in one description only (scripts/schemas/README.md).
  const readme = readFileSync('scripts/schemas/README.md', 'utf8');
  assert.ok(readme.includes(createHash('sha256').update(readFileSync(SOURCE_SCHEMA_FILE)).digest('hex')), 'the README records the vendored hash');
});

// Review of #75 (refute-rnd-75): each bypass below passed the first screen and is refused now.
const reverse = text => [...text].reverse().join('');
const NAME = 'a restricted name', PLACE = 'a place name';
// Invisible and look-alike characters are written as code points, so this file holds none of them.
const ch = (...codes) => String.fromCharCode(...codes);

test('a restricted name is caught through invisible, fullwidth, look-alike, accented, split and camelCase spellings', () => {
  const [a, b, c] = privateProject;
  const spellings = [
    `${a}${ch(0x200b)}${b}${ch(0x200b)}${c}-heightfield-v1`, `${a}${ch(0xad)}${b}${ch(0xad)}${c}`, `${a}${ch(0x2060)}${b}${c}`, `${a}${ch(0xfeff)}${b}${c}`,
    [...privateProject].map(ch => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join(''),
    `${ch(0x43e, 0x430, 0x441)} build`, `${a}${ch(0x301)}${b}${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`, `${a.toUpperCase()}${b.toUpperCase()}${c.toUpperCase()}Engine`,
    `the ${studio.slice(0, 4)}${ch(0x200b)}${studio.slice(4)} build`, `${studio.toUpperCase()}STUDIO`, `with ${computePartner}x`,
  ];
  for (const text of spellings) assert.ok(screenText(text).includes(`${NAME} (the private project, a game studio, a partner or a customer)`), JSON.stringify(text));
});

test('the listed places are caught: the lab’s own town, provinces, large cities, split and inside other words', () => {
  const places = [reverse('nrooH'), reverse('dnalloH-drooN'), reverse('dnalloH dziuZ'), reverse('gaaH neD'), reverse('madretsmA'),
    reverse('thcertU'), reverse('nedrawueeL'), reverse('dnaleeZ'), reverse('grubmiL'), reverse('redleH neD'), reverse('madrettoR')];
  for (const place of places) assert.ok(screenText(`we met in ${place} last week`).includes(PLACE), place);
  assert.ok(screenText(`${reverse('oH')}${ch(0xad)}${reverse('nro')}`).includes(PLACE), 'soft hyphen inside the town');
  assert.ok(screenText(`${reverse('madretsmA')}centrum`).includes(PLACE), 'a long place inside a longer word');
  for (const text of ['the help desk', 'Juno answers', 'a horn sounds', 'approach the coach']) assert.ok(!screenText(text).includes(PLACE), text);
});

test('the dispatch it would write is screened whole: a session or still name carrying a restricted name is refused, nothing written', () => {
  const bySession = session(m => { m.session = `${m.session}-${privateProject}`; });
  // The session name itself is the only carrier (the dir name is irrelevant to the dispatch).
  const s1 = screen(bySession.manifest.session);
  const out1 = join(temp, 'site-session-name');
  const r1 = publish({ sessionDir: bySession.dir, answerScreen: s1, site: out1 });
  assert.match(r1.problems.join('\n'), /^dispatch#\/session: a restricted name/m);
  assert.ok(!existsSync(out1));
  const byStill = session(m => { m.stills = [`stills/01-${privateProject}-view.png`]; });
  writeFileSync(join(byStill.dir, `stills/01-${privateProject}-view.png`), 'still');
  const out2 = join(temp, 'site-still-name');
  const r2 = publish({ sessionDir: byStill.dir, answerScreen: screen(byStill.name), site: out2 });
  assert.match(r2.problems.join('\n'), /^dispatch#\/stills\/0: a restricted name/m);
  assert.ok(!existsSync(out2));
});

test('the build refuses a hand-committed dispatch without a passing answer screen for every evidence id, or with no question', () => {
  const { dir, name } = session();
  const root = join(temp, 'site-hand');
  assert.deepEqual(publish({ sessionDir: dir, answerScreen: screen(name), site: root }).problems, []);
  const file = join(root, `data/labs/agent-space/dispatches/${name}.json`);
  const good = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(good.answersScreen.answers.map(a => a.evidence), ['odin-a1b2c3-1', 'atlas-a1b2c3-1'], 'per-evidence verdicts are kept');
  const cases = [
    [d => { d.answersScreen.answers = []; }, /answers: fewer than 1 items/],
    [d => { d.answersScreen.answers[0].checks = []; }, /checks: fewer than 1 items/],
    [d => { d.answersScreen.answers[1].verdict = 'held'; }, /verdict: must be "ok"/],
    [d => { d.answersScreen.answers.pop(); }, /atlas-a1b2c3-1 has no passing answer screen/],
    [d => { delete d.answersScreen; }, /missing answersScreen/],
    [d => { d.questions = []; }, /questions: fewer than 1 items/],
    [d => { d.questions[0].answer = `seen in ${reverse('nrooH')}`; }, /questions\/0\/answer: a place name/],
  ];
  for (const [edit, expected] of cases) {
    const bad = structuredClone(good); edit(bad);
    writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => readDispatches(root), expected, String(expected));
  }
  writeFileSync(file, JSON.stringify(good));
  assert.equal(readDispatches(root).length, 1);
});

test('the schema checker applies additionalProperties as a schema, and refuses forms it does not apply', () => {
  assert.deepEqual(validate({ type: 'object', additionalProperties: { type: 'string' } }, { a: 'x' }), []);
  assert.deepEqual(validate({ type: 'object', additionalProperties: { type: 'string' } }, { a: 1 }), ['/a: expected string, found integer']);
  assert.match(validate({ type: 'object', additionalProperties: 'no' }, {}).join(), /form of additionalProperties this checker does not apply/);
  assert.match(validate({ type: 'array', items: [{ type: 'string' }] }, ['x']).join(), /form of items this checker does not apply/);
  assert.deepEqual(validate({ type: 'array', minItems: 1 }, []), ['/: fewer than 1 items']);
});

test('older dispatches keep the heading order: session h4 under "Earlier sessions" h3, its questions h5', () => {
  const root = join(temp, 'site-two');
  mkdirSync(join(root, 'data/labs'), { recursive: true });
  // The story page ships only with its record (scripts/lab-milestones.mjs), which these roots do not carry.
  cpSync('site/labs', join(root, 'labs'), { recursive: true, filter: src => !src.includes('labs/agent-space/story') });
  cpSync('site/data/labs/agent-space.json', join(root, 'data/labs/agent-space.json'));
  cpSync('site/data/labs/delivery', join(root, 'data/labs/delivery'), { recursive: true });
  for (const date of ['2026-10-25', '2026-11-01']) {
    const one = session(m => { m.session = `session-${date}`; m.date = date; });
    assert.deepEqual(publish({ sessionDir: one.dir, answerScreen: screen(`session-${date}`), site: root }).problems, []);
  }
  const page = renderLabs(root)['labs/agent-space/index.html'];
  const levels = [...page.slice(page.indexOf('id="dispatches-title"') - 4).matchAll(/<h([1-6])\b/g)].map(m => Number(m[1]));
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `heading jumps from h${levels[i - 1]} to h${levels[i]}`);
  assert.deepEqual(levels.slice(0, 6), [2, 3, 4, 4, 4, 3]);
  assert.ok(levels.includes(5));
});

// Review 3 of #75: each case below passed the previous screen.
test('a link in public text counts as this lab only on exactly github.com under the lab repository, after decoding', () => {
  for (const url of ['https://github.com/odin-labs-ai/odin-rnd.evil.com', 'https://github.com/odin-labs-ai/odin-rnd%2eevil.com/x',
    'https://github.com/odin-labs-ai/odin-rnd-extra', 'https://github.com.evil.example/odin-labs-ai/odin-rnd', 'http://github.com/odin-labs-ai/odin-rnd',
    'https://github.com:444/odin-labs-ai/odin-rnd', 'ftp://example.com/x']) {
    assert.ok(screenText(`see ${url} for more`).includes('a link to somewhere other than this lab'), url);
  }
  for (const url of ['https://github.com/odin-labs-ai/odin-rnd', 'https://github.com/odin-labs-ai/odin-rnd/issues']) {
    assert.deepEqual(screenText(`see ${url}.`), [], url);
  }
});

test('a Dutch postcode is caught in any case, and a year before a short word is not', () => {
  for (const text of ['at 1012 AB', 'at 1012ab', 'at 1012 Ab', 'at 1012 aB']) assert.ok(screenText(text).includes('a postcode'), text);
  for (const text of ['in 2026 we met', 'since 2024 in the space', '1999 to now']) assert.ok(!screenText(text).includes('a postcode'), text);
});

test('every field of a proof and a question is walked: unpublished ones by shape and name, unknown ones as page text', () => {
  const cases = [
    [(m, p) => { p[0].lens.run = `${privateProject}-live-run`; }, /proofs\/odin-a1b2c3-1\.json#\/lens\/run: a restricted name/],
    [(m, p) => { p[0].lens.note = 'anything'; }, /proofs\/odin-a1b2c3-1\.json#\/lens: not the expected shape/],
    [(m, p) => { p[0].t = 'yesterday at 12'; }, /proofs\/odin-a1b2c3-1\.json#\/t: not the expected shape/],
    [(m, p) => { p[1].ms = -1; }, /proofs\/atlas-a1b2c3-1\.json#\/ms: not the expected shape/],
    [(m, p) => { p[1].card_note = 'mail someone@example.com'; }, /proofs\/atlas-a1b2c3-1\.json#\/card_note: an email address/],
    [(m, p) => { p[1].extra = { deep: [{ where: `in ${[...'nrooH'].reverse().join('')}` }] }; }, /#\/extra\/deep\/0\/where: a place name/],
    [m => { m.questions[0].asked_by = `sample:${privateProject}-windows`; }, /manifest\.json#\/questions\/0\/asked_by: a restricted name/],
    [m => { m.questions[0].asked_by = 'someone@example.com'; }, /questions\/0\/asked_by: not the expected shape/],
  ];
  for (const [edit, expected] of cases) {
    const one = session(edit);
    assert.match(prepare(one.dir, screen(one.name)).problems.join('\n'), expected, String(expected));
  }
  // The public dispatch cannot carry them: its schema refuses an unpublished field by name.
  const dispatch = { ...JSON.parse(JSON.stringify(cleanPublic())), };
  dispatch.questions[0].lens = { run: 'agent-space-live-1700000000' };
  assert.match(validate(publicSchema, dispatch).join(), /\/questions\/0\/lens: not allowed/);
});

function cleanPublic() {
  const one = session();
  return prepare(one.dir, screen(one.name)).dispatch;
}
