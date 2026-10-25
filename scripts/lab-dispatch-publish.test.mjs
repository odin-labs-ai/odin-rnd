import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validate } from './json-schema-lite.mjs';
import { prepare, publish, PUBLIC_SCHEMA_FILE, screenText, SOURCE_SCHEMA_FILE } from './lab-dispatch-publish.mjs';
import { readDispatches, renderLabs } from './labs.mjs';

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
    answer: 'Add an entry to agents.json: a name, a look, a home spot and a brain.', why: "From my knowledge base entry 'plug-in'.",
    source: 'wiki', sources: [{ what: 'knowledge base: plug-in', ref: 'knowledge.json#plug-in' }], via: 'scripted', ok: true, ms: 5,
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
  for (const dropped of ['127.0.0.1', manifest.commit, 'agent-space-live', 'odin-labs:seed', 'github:@someone', 'Follower', 'knowledge.json', 'rules:world']) {
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
  };
  for (const [text, reason] of Object.entries(cases)) assert.ok(screenText(text).some(r => r.startsWith(reason)), `${text} -> ${reason}: ${screenText(text)}`);
  for (const text of ['Add an entry to agents.json: a name, a look and a brain.', 'Four agents are here, 22 structures on the ground.',
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
  cpSync('site/labs', join(root, 'labs'), { recursive: true });
  cpSync('site/data/labs/agent-space.json', join(root, 'data/labs/agent-space.json'));
  assert.deepEqual(publish({ sessionDir: dir, answerScreen: screen(name), site: root }).problems, []);
  const pages = renderLabs(root);
  const page = pages['labs/agent-space/index.html'];
  assert.match(page, new RegExp(`<source src="\\.\\./\\.\\./assets/labs/agent-space/${name}/clip\\.webm" type="video/webm">`));
  assert.equal((page.match(/class="lab-card"/g) ?? []).length, 3);
  assert.match(page, /A page it has read<\/span><code>evidence atlas-a1b2c3-1<\/code>/);
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
});

test('this repository holds no recorded session yet, and no restricted name in the Lab files', () => {
  assert.ok(!existsSync('site/data/labs/agent-space/dispatches') || readdirSync('site/data/labs/agent-space/dispatches').length === 0);
  assert.ok(!existsSync('site/assets/labs'));
  const files = ['scripts/lab-dispatch-publish.mjs', 'scripts/lab-dispatch-publish.test.mjs', 'scripts/labs.mjs', 'scripts/labs.test.mjs',
    'scripts/json-schema-lite.mjs', 'scripts/schemas/odin-dispatch-v1.schema.json', 'scripts/schemas/odin-lab-dispatch.schema.json',
    'scripts/schemas/README.md', 'site/data/labs/agent-space.json', 'site/labs/index.html', 'site/labs/agent-space/index.html',
    '.github/ISSUE_TEMPLATE/ask-the-agents.yml'];
  for (const file of files) assert.ok(!screenText(readFileSync(file, 'utf8')).some(r => r.startsWith('a restricted name')), file);
  // The vendored schema differs from its upstream copy in one description only (scripts/schemas/README.md).
  const readme = readFileSync('scripts/schemas/README.md', 'utf8');
  assert.ok(readme.includes(createHash('sha256').update(readFileSync(SOURCE_SCHEMA_FILE)).digest('hex')), 'the README records the vendored hash');
  assert.equal(execFileSync('git', ['ls-files', 'site/data/labs/agent-space/dispatches', 'site/assets/labs'], { encoding: 'utf8' }), '');
});
