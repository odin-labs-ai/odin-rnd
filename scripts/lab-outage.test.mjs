import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneCite } from './lab-kit.mjs';
import { FRAME, MAIN_WORD, OUTAGE_RECORD, citeSource, decodeFrames, ocrFrame, screeningFrameProblems, textLeaks, outageProblems, pngSize, readOutage, renderOutage, sectionLeaks, webmSeconds } from './lab-outage.mjs';

// Lab 01's Dispatch #2 (lane dispatch2-film): the film and poster pinned by sha256 and size, the film's own header
// checked against the record, its screen, and a citation that never claims the private main for a commit not on it.
const sha256 = data => createHash('sha256').update(data).digest('hex');
const committed = () => JSON.parse(readFileSync(join('site', OUTAGE_RECORD), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const reverse = text => [...text].reverse().join('');

// A scratch site root holding the committed record and its two files (the real bytes).
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'lab-outage-'));
  cpSync('site/data/labs/agent-space/outage.json', join(root, OUTAGE_RECORD));
  cpSync('site/assets/labs/agent-space/outage', join(root, 'assets/labs/agent-space/outage'), { recursive: true });
  return root;
}
const withScratch = fn => { const root = scratch(); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

test('the committed record passes, and the film and poster on disk are the ones it pins, by sha256 and size', () => {
  const record = committed();
  assert.deepEqual(outageProblems(record, { root: 'site' }), []);
  const film = readFileSync(join('site', record.film.src)), poster = readFileSync(join('site', record.film.poster));
  assert.equal(sha256(film), record.film.sha256.src);
  assert.equal(sha256(poster), record.film.sha256.poster);
  assert.equal(film.length, record.film.bytes);
  assert.equal(poster.length, record.film.posterBytes);
  assert.equal(statSync(join('site', record.film.src)).size, record.film.bytes);
  assert.equal(record.screening.srcSha256, record.film.sha256.src);
  assert.ok(record.film.bytes <= 6 * 1024 * 1024, 'the film is within the 6 MB agreement');
  assert.ok(readOutage('site'));
});

test('the film\'s own WebM header gives the recorded length, and the poster is a PNG of the film\'s frame size', () => {
  const record = committed();
  const w = webmSeconds(readFileSync(join('site', record.film.src)));
  assert.equal(w.problem, undefined);
  assert.equal(Math.round(w.seconds), record.film.seconds);
  assert.deepEqual(pngSize(readFileSync(join('site', record.film.poster))), FRAME);
  assert.match(webmSeconds(Buffer.from('not a film at all')).problem, /not an EBML file/);
  assert.match(pngSize(Buffer.from('not a picture, not at all')).problem, /not a PNG/);
  withScratch(root => {
    const wrong = clone(record);
    wrong.film.seconds = record.film.seconds + 9;
    assert.ok(outageProblems(wrong, { root }).some(p => p.includes("the film's own header says")));
  });
});

for (const [which, key, size] of [['film', 'src', 'bytes'], ['poster', 'poster', 'posterBytes']]) {
  test(`a ${which} that differs by one byte, or has a different size, is refused`, () => withScratch(root => {
    const record = committed(), file = join(root, record.film[key]);
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(file, bytes);
    assert.ok(outageProblems(record, { root }).some(p => p.includes(`#/film/${key}: `) && p.includes('does not match its recorded sha256')), `${which}: one byte`);
    writeFileSync(file, Buffer.concat([bytes, Buffer.from('x')]));
    assert.ok(outageProblems(record, { root }).some(p => p.includes(`#/film/${key}: `) && p.includes('bytes on disk')), `${which}: size`);
    const resized = clone(record);
    resized.film[size] += 1;
    assert.ok(outageProblems(resized, { root: 'site' }).some(p => p.includes(`#/film/${key}: `) && p.includes('bytes on disk')), `${which}: recorded size`);
    assert.throws(() => readOutage(root), /Dispatch #2 refused/);
  }));
}

test('while onMain is false the citation says "not yet part of the private main" and nothing else mentions main', () => {
  const record = committed();
  assert.equal(record.source.onMain, false);
  assert.match(record.source.baseMain, /^[0-9a-f]{40}$/);
  const words = citeSource(record.source);
  // Through the kit's laneCite (ADR 2026-10-28-rnd-lane-evidence-onmain-false), never the main cite.
  assert.ok(words.includes(laneCite(record.source)));
  assert.match(words, /from private commit <code>d02ee74b<\/code>, cited by hash, on a pushed branch that is not yet part of the private main \(checked on <time datetime="2026-10-28">2026-10-28<\/time>\), built on the private main <code>aa35e6db<\/code>\./);
  assert.doesNotMatch(words, /checked as part of the private main/);
  assert.match(words, /It is the main of 27 October plus two changes: the port check works on macOS, and the outage card names the agent instead of its address\./);
  assert.match(words, /This page cannot check it, anyone with access can\./);
  assert.doesNotMatch(words, /mac-qa-public/, 'the lane name stays in the record');
  const html = renderOutage(record);
  assert.doesNotMatch(html, /checked as part of the private main/);
  assert.equal(html.split(words).length, 2, 'the citation appears once');
  assert.doesNotMatch(html.split(words).join(' ').replace(/<[^>]+>/g, ' '), MAIN_WORD, 'main appears only in the citation');
});

// Every way of claiming main the review named, and a few more: each refused in the record and in the rendered section.
const CLAIMS = ['Filmed from a commit checked as part of the private main.', 'This commit is on the private main.',
  'It was merged into the private main on 27 October.', 'The private main includes this commit.', 'Shipped on main.', 'Part of MAIN now.'];
for (const claim of CLAIMS) {
  test(`with onMain false, "${claim}" is refused in the record and in the section`, () => {
    const record = clone(committed());
    record.staged = claim;
    assert.ok(outageProblems(record).some(p => p.includes('mentions main')), claim);
    assert.ok(sectionLeaks(`<p>${claim}</p><p>${citeSource(record.source)}</p>`, record).some(p => p.includes('mentions main')), claim);
  });
}

test('a lane cite needs the lane and the date it was checked, and refuses the base main itself', () => {
  for (const field of ['lane', 'checkedAt']) {
    const record = clone(committed());
    delete record.source[field];
    assert.notDeepEqual(outageProblems(record), [], `no ${field}`);
  }
  const onBase = clone(committed());
  onBase.source.commit = onBase.source.baseMain;
  assert.ok(outageProblems(onBase).some(p => p.includes('is part of the private main; cite it with cite()')));
  const early = clone(committed());
  early.source.checkedAt = '2026-10-26';
  assert.ok(outageProblems(early).some(p => p.includes('#/source/checkedAt: before the film was made')));
});

test('flipping onMain needs a main check, a main check needs onMain, and a re-cite then uses the kit\'s sentence', () => withScratch(root => {
  const flipped = clone(committed());
  flipped.source.onMain = true;
  assert.ok(outageProblems(flipped, { root }).some(p => p.includes('no mainCheck')));
  const stray = clone(committed());
  stray.source.mainCheck = { main: 'a'.repeat(40), checked: '2026-10-28', how: 'GitHub compare against the private main head' };
  assert.ok(outageProblems(stray, { root }).some(p => p.includes('a main check for a commit marked not on main')));
  // Once the lane merges, a re-cite flips onMain and adds the main check; then the main wording is allowed. Checked
  // with the files on disk, so the re-cited record is still the pinned film.
  const merged = clone(stray);
  merged.source.onMain = true;
  assert.deepEqual(outageProblems(merged, { root }), []);
  assert.match(citeSource(merged.source), /checked as part of the private main <code>aaaaaaaa<\/code>/);
  const early = clone(merged);
  early.source.mainCheck.checked = '2026-10-26';
  assert.ok(outageProblems(early, { root }).some(p => p.includes('before the film was made')));
}));

// One negative per leak class: each injected into page text is refused by the record gate and by the section screen.
const LEAKS = {
  'a machine path': 'Filmed from /Users/someone/scratch/film.webm.',
  'a host name': 'Filmed on studio-mbp.local by the worker.',
  'a local host': 'Pulse answered at localhost before it stopped.',
  'an IP address': 'Pulse answered at 10.1.2.3 before it stopped.',
  'a port': 'Pulse did not answer on :6423 any more.',
  'a memory count': 'Pulse said 12.5 GB of 64 GB memory is free.',
  'a processor count': 'Pulse said the host has 16 logical processors.',
  'a credential': `The worker used the key ${['gh', 'p_'].join('')}${'A'.repeat(36)} to push.`,
  'a restricted name': `Filmed for ${reverse('tfolemag')} on the second machine.`,
  'an email address': 'Questions go to someone@example.org.',
  'another repository': 'The space lives in odin-labs-ai/some-private-repo now.',
};
for (const [kind, line] of Object.entries(LEAKS)) {
  test(`the screen refuses ${kind} in the record's text`, () => {
    const record = clone(committed());
    record.line = line;
    assert.notDeepEqual(outageProblems(record), [], `${kind} passed the screen: ${line}`);
  });
  test(`the rendered section refuses ${kind}`, () => {
    const record = clone(committed());
    record.steps[2].said = `I found a problem: ${line}`;
    assert.throws(() => renderOutage(record), /fails the screen/, `${kind} reached the page: ${line}`);
  });
}

test('the published metadata carries no path, host, address, port or machine count', () => {
  const text = readFileSync(join('site', OUTAGE_RECORD), 'utf8');
  for (const [kind, re] of [['a machine path', /\/Users\/|\/home\/|\/private\/|\/tmp\//], ['a local host or address', /localhost|127\.0\.0\.1|\b\d{1,3}(?:\.\d{1,3}){3}\b/],
    ['a port', /:\d{4,5}\b/], ['a host name', /\.local\b|macbook|\bmbp\b/i], ['a machine count', /\bGB\b|logical processors|memory is free/i]]) {
    assert.doesNotMatch(text, re, `the record holds ${kind}`);
  }
});

test('the outage is a failing check between passing ones, each with its own evidence id', () => {
  const record = clone(committed());
  const asks = record.steps.filter(s => s.ask);
  assert.deepEqual(asks.map(s => s.verdict), ['pass', 'fail', 'pass', 'pass']);
  assert.deepEqual(asks.map(s => s.evidence), ['ia-4e58a3', 'ia-709326', 'ia-d7d01a', 'ip-7318d7']);
  assert.match(asks[3].said, /4 of 4 places/);
  record.steps = record.steps.filter(s => s.verdict !== 'fail');
  assert.ok(outageProblems(record).some(p => p.includes('a failing check')));
});

// Review round 2 (#5): the screening is the filming agent's own statement, so the page puts it in the kit's
// "summary only" box; what anyone can repeat is that each screened frame is one of the film's own decoded frames.
test('the page and the record claim only what can be repeated: no attested or viewing claim anywhere', () => {
  const record = committed(), html = renderOutage(record);
  const schema = JSON.parse(readFileSync('scripts/schemas/odin-lab-outage.schema.json', 'utf8'));
  const keys = [];
  (function walk(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } })(schema.properties.screening);
  assert.ok(!keys.some(k => /attest|claim|viewed|viewing/i.test(k)), `a screening claim field in the schema: ${keys.join(', ')}`);
  assert.equal(schema.properties.screening.additionalProperties, false, 'no field can be added unchecked');
  const withClaim = clone(record);
  withClaim.screening.attested = { by: 'the agent that filmed it', statement: 'it viewed each frame' };
  assert.ok(outageProblems(withClaim).length, 'a record carrying an attested claim is refused');
  // Recheck 7c0055e4 #5: no free-text field is left to carry a viewing claim. The procedure fields are fixed text,
  // and the screening holds no list of "checked" labels (what is screened is what the tests run).
  for (const [at, set] of [['method', s => { s.method = 'I viewed every frame'; }], ['textRecognition/extract', s => { s.textRecognition.extract = 'viewed by an AI agent'; }],
    ['checked', s => { s.checked = ['viewed by an AI agent']; }], ['textRecognition/args', s => { s.textRecognition.args = ['viewed by an AI agent']; }],
    ['textRecognition/args, tokenized', s => { s.textRecognition.args = ['I', 'viewed', 'every', 'frame']; }]]) {
    const r = clone(record);
    set(r.screening);
    assert.ok(outageProblems(r).some(p => p.includes('/screening')), `a viewing claim in screening ${at} is refused`);
  }
  // Every leaf of the screening schema is a const, a hash pattern or a number (and `at`, a YYYY-MM-DD date pattern):
  // no free-text string or array is left.
  const loose = [];
  (function walk(v, at) {
    if (!v || typeof v !== 'object') return;
    if ('const' in v) return;
    if (v.type === 'string' && !/^\^\[0-9a-f\]\{64\}\$$/.test(v.pattern ?? '')) { if (!(at === 'screening/at' && v.pattern === '^\\d{4}-\\d{2}-\\d{2}$')) loose.push(at); return; }
    if (v.type === 'integer' || v.type === 'number') return;
    if (v.type === 'array') return walk(v.items, `${at}[]`);
    for (const [k, x] of Object.entries(v.properties ?? {})) walk(x, `${at}/${k}`);
  })(schema.properties.screening, 'screening');
  assert.deepEqual(loose, [], `screening fields that are not a const, a hash or a number: ${loose.join(', ')}`);
  assert.doesNotMatch(html, /viewed|viewing|SUMMARY ONLY|picture is unchanged/i);
  assert.doesNotMatch(JSON.stringify(record), /viewed|viewing|attest/i);
  assert.match(html, /the film decodes to 378 frames; each of the 11 screened frames \(one every 5 s\) is one of them, in order, by its hash; and reading each of those frames gives text with the hash the record lists, with 0 hits/);
});

test('screening frames: each must be one of the film\'s frames, in order, and the frame count must match', () => {
  const record = committed(), listed = record.screening.frames.map(f => f.rgb24Sha256);
  const decoded = Array.from({ length: record.film.frames }, (_, i) => sha256(`other ${i}`));
  record.screening.frames.forEach((f, i) => { decoded[f.frame] = f.rgb24Sha256; });
  assert.deepEqual(screeningFrameProblems(record, decoded), []);
  assert.ok(screeningFrameProblems(record, decoded.slice(1)).some(p => p.includes('#/film/frames')));
  const swapped = [...decoded];
  const [a, b] = [record.screening.frames[0].frame, record.screening.frames[1].frame];
  [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
  assert.ok(screeningFrameProblems(record, swapped).some(p => p.includes('#/screening/frames/')), 'out of order');
  const tampered = clone(record);
  tampered.screening.frames[3].rgb24Sha256 = sha256('a frame that is not in the film');
  assert.ok(screeningFrameProblems(tampered, decoded).some(p => p.includes('#/screening/frames/3')));
});

test('the committed film, decoded with ffmpeg: 378 frames, and every screened frame is one of them, in order', async t => {
  const record = committed();
  const d = await decodeFrames(join('site', record.film.src));
  if (d.problem && /cannot run here/.test(d.problem)) return t.skip(`ffmpeg is not installed here (${d.problem}); run where it is to repeat this check`);
  assert.equal(d.problem, undefined, d.problem);
  assert.deepEqual(screeningFrameProblems(record, d.frames), []);
});

test('a screened frame whose hash sits at another frame number than the record says is refused', () => {
  const record = committed();
  const decoded = Array.from({ length: record.film.frames }, (_, i) => sha256(`other ${i}`));
  record.screening.frames.forEach(f => { decoded[f.frame] = f.rgb24Sha256; });
  const moved = clone(record);
  moved.screening.frames[2].frame += 1;
  assert.ok(screeningFrameProblems(moved, decoded).some(p => p.includes('#/screening/frames/2/frame')));
});

test('the recognised-text screen refuses each leak class in a frame\'s text', () => {
  for (const line of ['/Users/someone/x', 'http://127.0.0.1:6423/ask', 'pulse at 10.1.2.3', 'studio-mbp.local', '12.5 GB of 64 GB memory is free', '16 logical processors']) {
    assert.notDeepEqual(textLeaks(line), [], line);
  }
  assert.deepEqual(textLeaks('I found a problem: 3 of 4 agents answered; Pulse did not answer.'), []);
});

test('text recognition, repeated on each screened frame: the same text hash and length, and no leak', async t => {
  const record = committed(), tr = record.screening.textRecognition;
  const dir = mkdtempSync(join(tmpdir(), 'lab-outage-ocr-'));
  try {
    for (const f of record.screening.frames) {
      const r = ocrFrame(join('site', record.film.src), f.frame, tr, { dir });
      if (r.problem && /cannot run here|tesseract \S* here/.test(r.problem)) return t.skip(`${r.problem}; run where ffmpeg and tesseract ${tr.version} are installed to repeat this check`);
      assert.equal(r.problem, undefined, r.problem);
      assert.equal(sha256(r.text), f.textSha256, `frame ${f.frame} (${f.t} s): its text differs`);
      assert.equal(r.text.length, f.chars, `frame ${f.frame}`);
      assert.deepEqual(textLeaks(r.text), [], `frame ${f.frame}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
