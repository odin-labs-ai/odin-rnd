import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publish } from './lab-dispatch-publish.mjs';
import { DRAFT_FILES, X_LIMIT, dispatchUrl, draftProblems, drafts, excerpt, length, outProblems, writeDrafts } from './lab-dispatch-drafts.mjs';

// The Lab 01 drafts generator (mission rnd-labs-human-first-1024). The dispatch here is published by the real publisher
// from a session written at run time, so no recorded session or restricted name is committed: a restricted name is
// built from character codes, as in the publisher's own test.
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'lab-dispatch-drafts.mjs');
const temp = mkdtempSync(join(tmpdir(), 'lab-drafts-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const privateProject = String.fromCharCode(111, 97, 99);
const run = (...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8' });

const screened = { ok: true, by: 'intake', note: '', checks: ['injection', 'personal-data', 'ip-boundary', 'on-topic'] };
let sessions = 0;
/** A temp site with the lab's words and one dispatch published from a clean synthetic session; `edit` changes it first. */
function site({ date = '2026-10-25', edit = () => {} } = {}) {
  const name = `session-${date}-d${++sessions}`;
  const root = join(temp, `site-${sessions}`), dir = join(temp, 'in', name);
  mkdirSync(join(root, 'data/labs'), { recursive: true });
  cpSync(join(here, '..', 'site/data/labs/agent-space.json'), join(root, 'data/labs/agent-space.json'));
  mkdirSync(join(dir, 'proofs'), { recursive: true }); mkdirSync(join(dir, 'stills'), { recursive: true });
  const clip = Buffer.from('a stand-in for a recorded clip');
  writeFileSync(join(dir, 'clip.webm'), clip); writeFileSync(join(dir, 'poster.png'), 'poster'); writeFileSync(join(dir, 'stills/01-s1-q1.png'), 'still');
  const proofs = [
    { id: 'odin-a1b2c3-1', t: 1700000000.0, agent: 'Odin', question: "what's going on here?",
      answer: 'Four agents are here. Atlas is reading in the library and Juno is at the help desk.',
      why: 'I read these just now: the agents’ states and the world’s structures.', source: 'world-checked', ok: true },
    { id: 'atlas-a1b2c3-1', t: 1700000010.0, agent: 'Atlas', question: 'how do I plug in my own agent?',
      answer: 'Add an entry to the agents file: a name, a look, a home spot and a brain.', why: "From my knowledge base entry 'plug-in'.", source: 'wiki', ok: true },
  ];
  const manifest = {
    format: 'odin-dispatch', version: 1, session: name, questions_session: '2026-W44', date,
    commit: '0000000000000000000000000000000000000001', space: { url: 'http://127.0.0.1:57342/' },
    clip: { file: 'clip.webm', bytes: clip.length, mime: 'video/webm;codecs=vp9', bps: 300000, seconds: 38 },
    poster: 'poster.png', stills: ['stills/01-s1-q1.png'],
    questions: [
      { id: 's1-q1', to: 'Odin', text: "What's going on here?", asked_by: 'odin-labs:seed', screened, asked: true, evidence: 'odin-a1b2c3-1', follow_up: false, why_not: null },
      { id: 's1-q2', to: 'Atlas', text: 'How do I plug in my own agent?', asked_by: 'github:@someone', issue: 12, screened, asked: true, evidence: 'atlas-a1b2c3-1', follow_up: false, why_not: null },
      { id: 's1-q3', to: 'Odin', text: 'How do you know?', asked_by: 'odin-labs:seed', screened, asked: true, evidence: 'odin-a1b2c3-1', follow_up: true,
        reply: 'How I know: I read the agents’ states and the world’s structures just now.', why_not: null },
    ],
    proofs: ['proofs/odin-a1b2c3-1.json', 'proofs/atlas-a1b2c3-1.json'], answers_screened: false,
    note: 'the answers are not screened yet: screen them before anything is published',
  };
  edit(manifest, proofs);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const proof of proofs) writeFileSync(join(dir, `proofs/${proof.id}.json`), JSON.stringify(proof, null, 1));
  const answerScreen = { format: 'odin-answers-screen', version: 1, session: name, by: 'odin-labs',
    answers: proofs.map(({ id }) => ({ evidence: id, verdict: 'ok', checks: ['personal-data', 'ip-boundary', 'place', 'price', 'partner'] })) };
  const result = publish({ sessionDir: dir, answerScreen, site: root });
  assert.deepEqual(result.problems, []);
  return { root, file: result.out, dispatch: result.dispatch };
}

test('a clean dispatch: four drafts and a preview, every draft links the dispatch, every X part fits', () => {
  const { file, dispatch } = site();
  const out = join(temp, 'out-clean');
  const cli = run('--dispatch', file, '--out', out);
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(readdirSync(out).sort(), [...DRAFT_FILES, 'preview.html'].sort());
  const url = dispatchUrl(dispatch);
  assert.equal(url, `https://odin-labs-ai.github.io/odin-rnd/labs/agent-space/#${dispatch.session}`);
  for (const name of DRAFT_FILES) {
    const text = readFileSync(join(out, name), 'utf8');
    assert.ok(text.includes(url), `${name} links the dispatch`);
    assert.match(text, /DRAFT — the founder posts/);
  }
  const preview = readFileSync(join(out, 'preview.html'), 'utf8');
  assert.match(preview, /DRAFT — the founder posts/);
  for (const label of ['LinkedIn', 'X (a thread)', 'Reddit', 'GitHub Discussions']) assert.ok(preview.includes(`<h2>${label}</h2>`));
  assert.doesNotMatch(preview, /<script|<link |src=/, 'the preview loads nothing');
  assert.match(readFileSync(join(out, 'reddit.md'), 'utf8'), /## Title[\s\S]*## Body/);
  assert.match(readFileSync(join(out, 'reddit.md'), 'utf8'), /self-promotion/);
  const { xParts } = drafts(dispatch);
  assert.equal(xParts.length, dispatch.questions.length + 2);
  for (const part of xParts) assert.ok(length(part) <= X_LIMIT, `${length(part)} > ${X_LIMIT}: ${part}`);
  assert.ok(xParts.at(-1).includes(url));
  // Every question's text and answer come from the dispatch, word for word.
  const github = readFileSync(join(out, 'github-discussion.md'), 'utf8');
  for (const q of dispatch.questions) { assert.ok(github.includes(q.text)); assert.ok(github.includes(q.answer)); }
});

test('a long question and answer: cut at a word to a verbatim prefix, and every X part still fits', () => {
  const long = 'The agents keep a record of what they see and read, and they say which record each answer came from so a reader can check it. '.repeat(4).trim();
  const { dispatch } = site({ edit: (manifest, proofs) => { proofs[0].answer = long; manifest.questions[0].text = `${'Why '.repeat(70)}here?`; } });
  const { problems, xParts } = drafts(dispatch);
  assert.deepEqual(problems, []);
  for (const part of xParts) assert.ok(length(part) <= X_LIMIT, `${length(part)} > ${X_LIMIT}`);
  const cut = excerpt(long, 100);
  assert.ok(length(cut) <= 100 && cut.endsWith('…') && long.startsWith(cut.slice(0, -1)), cut);
  assert.equal(excerpt('short', 100), 'short');
  // X weighs an ellipsis or an emoji 2 and a curly quote 1.
  assert.equal(length('a…'), 3); assert.equal(length('“’”'), 3); assert.equal(length('😀'), 2);
});

test('a restricted term injected into the dispatch: refused, nothing written', () => {
  const { file, dispatch } = site();
  const tampered = structuredClone(dispatch);
  tampered.questions[0].answer = `Four agents are here, built on ${privateProject}.`;
  const bad = join(temp, 'tampered.json');
  writeFileSync(bad, JSON.stringify(tampered));
  const out = join(temp, 'out-refused');
  const cli = run('--dispatch', bad, '--out', out);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /^REFUSED .*nothing was written\./);
  assert.match(cli.stderr, /#\/questions\/0\/answer: a restricted name/);
  assert.equal(existsSync(out), false, 'the out dir is not even created');
  assert.ok(existsSync(file));
});

test('the draft screen itself: a restricted term or a second link in a draft is refused; the dispatch link alone passes', () => {
  const { dispatch } = site();
  const url = dispatchUrl(dispatch);
  assert.deepEqual(draftProblems({ 'linkedin.md': `See ${url}` }, url), []);
  assert.match(draftProblems({ 'linkedin.md': `See ${url}, built on ${privateProject}.` }, url).join(), /linkedin\.md: a restricted name/);
  assert.match(draftProblems({ 'x.md': `See ${url} and https://example.com/more` }, url).join(), /x\.md: a link to somewhere other than this lab/);
  assert.match(draftProblems({ 'reddit.md': 'no link here' }, url).join(), /does not link the dispatch/);
  assert.match(draftProblems({ 'x.md': url }, url, ['x'.repeat(X_LIMIT + 1)]).join(), /over 280/);
  assert.match(draftProblems({ 'x.md': 'https://example.com/' }, 'https://example.com/').join(), /not on an allowed host/);
});

test('--out under site/ or dist/ is refused before anything is written, through a symlink too', () => {
  const { file, root } = site();
  const cli = run('--dispatch', file, '--out', join(here, '..', 'site', 'drafts-should-not-exist'));
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /drafts are never published/);
  assert.equal(existsSync(join(here, '..', 'site', 'drafts-should-not-exist')), false);
  assert.match(outProblems(join(here, '..', 'dist', 'x')).join(), /under .*dist/);
  const link = join(temp, 'link-to-site');
  symlinkSync(root, link);
  assert.equal(writeDrafts(file, join(link, 'drafts'), [root]).problems.length, 1);
  assert.equal(existsSync(join(root, 'drafts')), false);
  assert.deepEqual(outProblems(join(temp, 'elsewhere')), []);
  // On a case-insensitive file system "SITE/" is site/; refused by identity. On a case-sensitive one it is another dir.
  const upper = join(here, '..', 'SITE', 'drafts');
  if (existsSync(join(here, '..', 'SITE'))) assert.match(outProblems(upper).join(), /drafts are never published/);
});

test('--cadence: days since the latest committed dispatch, exit 2 after ten quiet days', () => {
  const { root, dispatch } = site({ date: '2026-10-20' });
  const fresh = run('--cadence', '--site', root, '--today', '2026-10-30');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, new RegExp(`^OK 10 days: the latest dispatch, ${dispatch.session}, is dated 2026-10-20`));
  const quiet = run('--cadence', '--site', root, '--today', '2026-10-31');
  assert.equal(quiet.status, 2);
  assert.match(quiet.stdout, /^QUIET 11 days/);
  // With no dispatch yet, the count runs from the day the lab opened, and says so.
  const empty = join(temp, 'site-empty');
  mkdirSync(join(empty, 'data/labs'), { recursive: true });
  cpSync(join(here, '..', 'site/data/labs/agent-space.json'), join(empty, 'data/labs/agent-space.json'));
  const since = JSON.parse(readFileSync(join(empty, 'data/labs/agent-space.json'), 'utf8')).since;
  const none = run('--cadence', '--site', empty, '--today', since);
  assert.equal(none.status, 0);
  assert.match(none.stdout, new RegExp(`no dispatch yet; the lab opened ${since}`));
  assert.equal(run('--cadence', '--today', 'yesterday').status, 1);
  assert.equal(run('--dispatch').status, 3);
});

test('no network: the script imports and calls nothing that could reach one', () => {
  const source = readFileSync(script, 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./lab-dispatch-publish.mjs', './labs.mjs', 'node:fs', 'node:path', 'node:url']);
  assert.doesNotMatch(source, /\bfetch\(|\bimport\(|\brequire\(|XMLHttpRequest|WebSocket|node:(?:http|https|net|dns|tls|dgram|child_process)/);
});
