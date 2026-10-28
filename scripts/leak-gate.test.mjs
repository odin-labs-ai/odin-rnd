// The leak gate on fixtures, with a TEST salt and made-up terms: the real term set is a repository secret and never
// appears here. Every class of leak must stop the build, a clean site must pass, and a missing or empty term set must
// stop it too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { gzipSync as gz } from 'node:zlib';
import { MAX_BINARY, checkCommitment, scanPaths, commitmentOf, digest, fillPage, loadKnown, loadSecret, normalise, scanText, settle } from './leak-gate.mjs';

const SALT = 'test-salt-not-the-real-one-0001';
const TERMS = ['Zephyr Quarry', 'blorvak', 'ostrel-nine-host', 'qzx', 'café'];
const CANARY = 'odncanary-0123456789abcdef';
const secretOf = (terms = TERMS, canaries = [CANARY]) => JSON.stringify({ format: 'odin-leak-screen', version: 1, salt: SALT, terms: terms.map(t => digest(SALT, normalise(t))), canaries: canaries.map(c => digest(SALT, normalise(c))), heads: [...terms, ...canaries].map(t => digest(SALT, normalise(t).split('-')[0])) });
const SECRET = secretOf();
const setFile = (raw = SECRET) => { const d = JSON.parse(raw); return JSON.stringify({ format: 'odin-leak-gate-set', version: 1, ...commitmentOf(d.salt, d.terms, d.canaries, d.heads) }); };
const PAGE = '<p>Terms <span data-leak-screen="terms">-</span> canaries <span data-leak-screen="canaries">-</span> <time data-leak-screen="scanned" datetime="">-</time> <code data-leak-screen="commit">-</code> <span data-leak-screen="files">0</span> <span data-leak-screen="hits">-</span> <span data-leak-screen="known">-</span></p>';
const COMMIT = 'a'.repeat(40);
/** A minimal ustar archive, for the vendored-bundle case. */
function tar(files, links = {}, dirs = {}) {
  const parts = [];
  for (const [full, body, link, dir] of [...Object.entries(files), ...Object.entries(links).map(([n, target]) => [n, '', target]), ...Object.keys(dirs).map(d => [d, '', null, true])]) {
    const data = Buffer.from(body), h = Buffer.alloc(512);
    const [prefix, name] = full.includes('\0') ? full.split('\0') : ['', full];
    h.write(name, 0); if (prefix) h.write(prefix, 345); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write(dir ? '5' : link ? '2' : '0', 156); if (link) h.write(link, 157); h.write('ustar\0', 257); h.write('00', 263);
    h.fill(' ', 148, 156); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

function site(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'leak-gate-'));
  const files = { 'leak-gate-set.json': setFile(), 'dist/index.html': '<h1>A clean page</h1><p>Nothing private here, 2026-10-28.</p>', 'dist/data/record.json': '{"note":"a clean record"}', 'dist/leak-screen/index.html': PAGE, ...extra };
  for (const [file, body] of Object.entries(files)) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), body); }
  return root;
}
function gate(root, env = { LEAK_SCREEN_SECRET: SECRET }, args = []) {
  const r = spawnSync(process.execPath, [join(process.cwd(), 'scripts/leak-gate.mjs'), '--set', 'leak-gate-set.json', ...args, 'dist'], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a clean site passes and the Leak screen page is filled with counts, the commit and 0 hits', () => {
  const root = site();
  try {
    const r = gate(root, undefined, ['--page', 'dist/leak-screen/index.html', '--commit', COMMIT]);
    assert.equal(r.code, 0, r.out);
    const page = readFileSync(join(root, 'dist/leak-screen/index.html'), 'utf8');
    assert.match(page, /data-leak-screen="terms">5</);
    assert.match(page, /data-leak-screen="canaries">1</);
    assert.match(page, /data-leak-screen="hits">0</);
    assert.match(page, new RegExp(`data-leak-screen="commit">${COMMIT}<`));
    assert.match(page, /datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const LEAKS = {
  'a planted canary in a draft lab page': ['dist/labs/draft/index.html', `<p>Draft.</p>\n<p>copied: ${CANARY}</p>`, /dist\/labs\/draft\/index\.html:2 canary hash [0-9a-f]{8}/],
  'a protected term, split by case, an entity and markup': ['dist/labs/draft/index.html', '<p>We ran it for ZEPHYR&nbsp;<b>quarry</b>.</p>', /:1 term hash [0-9a-f]{8}/],
  'a protected term inside a gzipped record': ['dist/data/vendored.json.gz', gzipSync('{"host":"ostrel-nine-host"}'), /vendored\.json\.gz:1 term/],
  'a protected term as a JSON escape': ['dist/data/r.json', '{"a":"\\u0062lorvak"}', /r\.json:1 term/],
  'a protected term across a line break and wide spacing': ['dist/index.html', '<p>Zephyr\n      Quarry</p>', /index\.html:1 term/],
  'a protected term in a page that holds a NUL byte': ['dist/labs/draft/index.html', '<!--\0--><p>blorvak</p>', /index\.html:1 term/],
  'a canary inside an image file': ['dist/assets/shot.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from(`tEXtComment\0${CANARY}\0`), Buffer.from([0, 1, 2])]), /\[a file name|shot\.png:0 canary/],
  'a canary inside a vendored tar.gz of raw evidence': ['dist/data/raw-evidence.tar.gz', gzipSync(tar({ 'main/ops.jsonl': `{"op":1}\n{"note":"${CANARY}"}\n`, 'main/clean.json': '{}' })), /raw-evidence\.tar\.gz!main\/ops\.jsonl:2 canary/],
  'a home path inside an image file': ['dist/assets/meta.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from('tEXtSource\0/Users/someone/work\0'), Buffer.from([0, 1])]), /meta\.png:0 home-path/],
  'a short home path between NUL bytes in a binary': ['dist/assets/short.webm', Buffer.from('\x1aE\0\0/home/a\0\0\x01', 'latin1'), /short\.webm:0 home-path/],
  'a three-letter term between NUL bytes in a binary': ['dist/assets/short3.webm', Buffer.from('\x1aE\0qzx\0\x01', 'latin1'), /short3\.webm:0 term/],
  'a protected term split by a JSON line-break escape': ['dist/data/r.json', '{"client":"Zephyr\\nQuarry"}', /r\.json:1 term/],
  'a protected term split by a percent-encoded line break in a link': ['dist/index.html', '<a href="/?client=Zephyr%0AQuarry">record</a>', /index\.html:1 term/],
  'a protected term split by a percent-encoded tab': ['dist/data/r.json', '{"u":"Zephyr%09Quarry"}', /r\.json:1 term/],
  'a protected term split by a JS hex escape': ['dist/assets/a.js', 'const c = "Zephyr\\x0aQuarry";', /a\.js:1 term/],
  'a protected term split by a percent-encoded UTF-8 no-break space': ['dist/index.html', '<a href="/?client=Zephyr%C2%A0Quarry">record</a>', /index\.html:1 term/],
  'a canary in a built node_modules folder': ['dist/node_modules/record.json', `{"x":"${CANARY}"}`, /node_modules\/record\.json:1 canary/],
  'a protected term split by a tag that glues it when removed': ['dist/index.html', '<p>Zephyr<br>Quarry</p>', /index\.html:1 term/],
  'a protected term split by a long tag pair': ['dist/index.html', '<p>Zephyr<span class="x"> </span>Quarry</p>', /index\.html:1 term/],
  'a protected term split by an unlisted named reference': ['dist/index.html', '<p>Zephyr&ensp;Quarry</p>', /index\.html:1 term/],
  'a protected term split across two JSON strings': ['dist/data/r.json', '["Zephyr", "Quarry"]', /r\.json:1 term/],
  'a protected term with a soft hyphen inside a word': ['dist/index.html', '<p>blor\u00advak</p>', /index\.html:1 term/],
  'a home path spelled with named references': ['dist/index.html', '<p>&sol;Users&sol;someone</p>', /index\.html:1 home-path/],
  'a protected term spelled with a full HTML name whose character folds to a letter': ['dist/index.html', '<p>bl&oscr;rvak</p>', /index\.html:1 term/],
  'a protected term split by a reference without its semicolon': ['dist/index.html', '<p>Zephyr&nbsp Quarry and Zephyr&nbspQuarry</p>', /index\.html:1 term/],
  'a protected term around a legacy reference without its semicolon': ['dist/index.html', '<p>Zephyr&copy Quarry</p>', /index\.html:1 term/],
  'a protected term around a full name next to a glued legacy one, in a script': ['dist/assets/both.js', 'document.body.insertAdjacentHTML("beforeend", "<p>Zephyr&notin;&copyQuarry;</p>");', /both\.js:1 term/],
  'a protected term after a legacy reference glued to it in a script': ['dist/assets/inject.js', 'document.body.insertAdjacentHTML("beforeend", "<p>Zephyr&copyQuarry;</p>");', /inject\.js:1 term/],
  'a protected term after a known legacy reference glued to it': ['dist/index.html', '<p>Zephyr&nbspQuarry;</p>', /index\.html:1 term/],
  'a protected term around a full HTML name the gate does not carry, in a script': ['dist/assets/notin.js', 'document.body.insertAdjacentHTML("beforeend", "<p>Zephyr&notin;Quarry</p>");', /notin\.js:1 term/],
  'a protected term split by a tag with a quoted ">"': ['dist/index.html', '<p>blor<span title=">"></span>vak</p>', /index\.html:1 term/],
  'a script escape that spells a reference': ['dist/assets/esc.js', 'document.body.insertAdjacentHTML("beforeend", "<p>bl\\u0026#111;rvak</p>")', /esc\.js:1 term/],
  'a home path as a symlink target inside a vendored archive': ['dist/data/raw-evidence.tar.gz', gzipSync(tar({ 'main/ok.json': '{}' }, { 'main/link': '/Users/someone/private' })), /raw-evidence\.tar\.gz!\(archive headers\):0 home-path/],
  'a loopback address other than 127.0.0.1': ['dist/index.html', '<p>http://127.0.0.2:3099/</p>', /index\.html:1 loopback/],
  'an IPv6 loopback without a port': ['dist/index.html', '<p>http://[::1]/</p>', /index\.html:1 loopback/],
  'a protected term split by a comment holding a quote': ['dist/index.html', '<p>blor<!-- " -->vak</p>', /index\.html:1 term/],
  'a home path as a directory name inside a vendored archive': ['dist/data/raw-evidence.tar.gz', gzipSync(tar({ 'main/ok.json': '{}' }, {}, { '/Users\0someone/private/': true })), /raw-evidence\.tar\.gz!\(archive headers\):0 home-path/],
  'a protected term split by an abruptly closed comment': ['dist/index.html', '<p>bl<!-->orvak and bl<!--->orvak and bl<!-- x --!>orvak</p>', /index\.html:1 term/],
  'a protected term with a combining mark that composes': ['dist/index.html', '<p>cafe\u0301 blorvak</p>', /index\.html:1 term/],
  'a home path': ['dist/data/r.json', '{"cwd":"/Users/someone/work"}', /r\.json:1 home-path/],
  'a private network address': ['dist/data/r.json', '{"host":"192.168.4.20"}', /r\.json:1 private-address/],
  'a local address with a port': ['dist/index.html', '<p>open http://localhost:3099/x</p>', /index\.html:1 loopback/],
  'a token shape': ['dist/index.html', `<p>ghp_${'A1'.repeat(18)}</p>`, /index\.html:1 github-token/],
};
for (const [name, [file, body, want]] of Object.entries(LEAKS)) {
  test(`${name} stops the build, and the output never holds the text`, () => {
    const root = site({ [file]: body });
    try {
      const r = gate(root, undefined, ['--page', 'dist/leak-screen/index.html', '--commit', COMMIT]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, want);
      for (const secret of [CANARY, ...TERMS, 'someone', '192.168.4.20', 'ghp_']) assert.ok(!r.out.toLowerCase().includes(secret.toLowerCase()), `output holds ${secret}`);
      assert.match(readFileSync(join(root, 'dist/leak-screen/index.html'), 'utf8'), /data-leak-screen="hits">-</, 'a failed scan never fills the page');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('a protected term in a file name is reported without printing the name', () => {
  const root = site({ 'dist/blorvak/index.html': '<p>clean</p>' });
  try {
    const r = gate(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /LEAK \[a file name, sha256 [0-9a-f]{8}\]:0 term/);
    assert.ok(!r.out.includes('blorvak'), r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a term set that differs from the public commitment stops the build, even with one term dropped', () => {
  const root = site();
  try {
    const partial = secretOf(TERMS.slice(1));
    const r = gate(root, { LEAK_SCREEN_SECRET: partial });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not the committed one \(committed 5 terms, 1 canaries; got 4, 1\)/);
    assert.throws(() => checkCommitment(loadSecret(SECRET), setFile(secretOf(TERMS, [CANARY, 'odncanary-ffffffffffffffff']))), /not the committed one/);
    checkCommitment(loadSecret(SECRET), setFile());
    const resalted = SECRET.replace(SALT, 'another-salt-of-enough-length');
    assert.throws(() => checkCommitment(loadSecret(resalted), setFile()), /not the committed one/, 'only the salt changed');
    const noSet = spawnSync(process.execPath, [join(process.cwd(), 'scripts/leak-gate.mjs'), 'dist'], { cwd: root, env: { PATH: process.env.PATH, LEAK_SCREEN_SECRET: SECRET }, encoding: 'utf8' });
    assert.equal(noSet.status, 2);
    assert.match(noSet.stderr, /--set/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a file that cannot be read is reported by its redacted name, never its own', () => {
  const root = site();
  try {
    symlinkSync(join(root, 'nowhere'), join(root, 'dist/blorvak.html'));
    const r = gate(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /\[a file name, sha256 [0-9a-f]{8}\] cannot be read \(ENOENT\)/);
    assert.ok(!r.out.includes('blorvak'), r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('code reads as text: `a&&notReady` and `flags&mask;` in a script are no finding', () => {
  const root = site({ 'dist/assets/x.js': 'if (a&&notReady) x = flags&mask;\n' });
  try { const r = gate(root); assert.equal(r.code, 0, r.out); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('two occurrences on one line are two hits, and readings of the same text never add up to more', () => {
  const secret = loadSecret(SECRET);
  assert.equal(scanText('blorvak', secret).length, 1);
  assert.equal(scanText('blorvak blorvak', secret).length, 2);
  assert.equal(scanText('<p>bl&#111;rvak and <b>blorvak</b></p>', secret).length, 2);
  assert.equal(scanText('<a title="blorvak">blor</a>vak', secret).length, 2, 'one in the markup, one only once the tags are gone');
  assert.equal(scanText('%62%6c%6f%72%76%61%6b%20%62%6c%6f%72%76%61%6b', secret).length, 2, 'two words in one percent run');
  const astral = scanText('&Afr; '.repeat(32) + 'bl&#111;rvak bl&#111;rvak', secret).map(h => ({ file: 'dist/a.html', ...h }));
  assert.equal(astral.length, 2, 'astral references keep the offsets after them');
  assert.equal(settle(astral, [{ file: 'dist/a.html', kind: 'term', hash: astral[0].hash, count: 1, reason: 'one reviewed occurrence' }]).stale.length, 1);
  assert.equal(scanText('Zephyr%C2%A0Quarry %ZZ blorvak', secret).length, 2);
  assert.equal(scanText('<p>blor<b>vak</b> and bl&#111;rvak</p>', secret).length, 2);
  const hits = scanText('x blorvak blorvak', secret).map(h => ({ file: 'dist/a.json', ...h }));
  assert.equal(settle(hits, [{ file: 'dist/a.json', kind: 'term', hash: hits[0].hash, count: 1, reason: 'one reviewed occurrence' }]).stale.length, 1);
});

test('the committed term-set commitment is well formed', () => {
  const d = JSON.parse(readFileSync('scripts/leak-gate-set.json', 'utf8'));
  assert.equal(d.format, 'odin-leak-gate-set');
  assert.ok(d.terms > 0 && d.canaries > 0);
  assert.match(d.sha256, /^[0-9a-f]{64}$/);
});

test('a missing, empty, broken or partial term set stops the build: it is never a pass', () => {
  const root = site();
  try {
    const cases = {
      missing: {},
      empty: { LEAK_SCREEN_SECRET: '' },
      blank: { LEAK_SCREEN_SECRET: '  \n' },
      'not JSON': { LEAK_SCREEN_SECRET: 'terms' },
      'wrong format': { LEAK_SCREEN_SECRET: '{}' },
      'no terms': { LEAK_SCREEN_SECRET: secretOf([]) },
      'no canaries': { LEAK_SCREEN_SECRET: secretOf(TERMS, []) },
      'no salt': { LEAK_SCREEN_SECRET: SECRET.replace(SALT, '') },
      'no heads': { LEAK_SCREEN_SECRET: JSON.stringify({ ...JSON.parse(SECRET), heads: [] }) },
    };
    for (const [name, env] of Object.entries(cases)) {
      const r = gate(root, env);
      assert.equal(r.code, 2, `${name}: ${r.out}`);
      assert.match(r.out, /leak gate: the term set/, name);
    }
    assert.throws(() => loadSecret(JSON.stringify({ ...JSON.parse(SECRET), terms: ['not-a-hash'] })), /24-hex/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a path that does not exist, or a scan that reads no text, stops the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'leak-gate-'));
  writeFileSync(join(root, 'leak-gate-set.json'), setFile());
  try {
    const none = gate(root);
    assert.equal(none.code, 2);
    assert.match(none.out, /a path to scan does not exist/);
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/only.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
    const r = gate(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /no text was read/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a known occurrence covers exactly its count: one more is a hit, one fewer is stale, a canary is never known', () => {
  const secret = loadSecret(SECRET);
  const hits = scanText('blorvak\nblorvak', secret).map(h => ({ file: 'dist/a.json', ...h }));
  const hash = hits[0].hash;
  const row = n => ({ file: 'dist/a.json', kind: 'term', hash, count: n, reason: 'pinned pre-registration' });
  assert.deepEqual(settle(hits, [row(2)]), { fresh: [], stale: [], known: 2 });
  assert.equal(settle(hits, [row(1)]).stale.length, 1);
  assert.equal(settle(hits, [row(3)]).stale.length, 1);
  assert.equal(settle(hits, []).fresh.length, 2);
  assert.equal(settle([], [row(1)]).stale[0].seen, 0);
  const canary = scanText(CANARY, secret).map(h => ({ file: 'dist/a.json', ...h }));
  assert.equal(settle(canary, [{ file: 'dist/a.json', kind: 'canary', hash: canary[0].hash, count: 1, reason: 'never allowed' }]).fresh.length, 1);
  const inArchive = [{ file: 'dist/r.tar.gz!a.mjs', kind: 'loopback', line: 1 }, { file: 'dist/r.tar.gz!b/c.mjs', kind: 'loopback', line: 4 }];
  const archiveRow = n => ({ file: 'dist/r.tar.gz!*', kind: 'loopback', count: n, reason: 'local servers in the bundle' });
  assert.deepEqual(settle(inArchive, [archiveRow(2)]), { fresh: [], stale: [], known: 2 });
  assert.equal(settle(inArchive, [archiveRow(1)]).stale.length, 1);
  assert.equal(settle([{ file: 'dist/other.json', kind: 'loopback', line: 1 }], [archiveRow(2)]).fresh.length, 1);
  const list = rows => JSON.stringify({ format: 'odin-leak-gate-known', version: 1, known: rows });
  assert.throws(() => loadKnown(list([{ ...row(1), kind: 'canary' }])), /canary/);
  assert.throws(() => loadKnown(list([{ ...row(1), reason: '' }])), /reason/);
  assert.throws(() => loadKnown(list([{ ...row(1), hash: undefined }])), /hash prefix/);
  assert.throws(() => loadKnown(list([{ ...row(1), kind: 'blorvak' }])), /kind the gate does not report/);
  assert.throws(() => loadKnown(list([{ file: 'dist/missing.html', kind: 'loopback', hash: 'blorvak', count: 1, reason: 'reviewed fixture' }])), /only a known term carries a hash/);
  assert.throws(() => loadKnown(list([{ ...row(1), note: 'blorvak' }])), /field the gate does not read/);
  assert.equal(loadKnown(list([row(1)])).length, 1);
});

test('the committed known-occurrence list is well formed and lists no canary', () => {
  const rows = loadKnown(readFileSync('scripts/leak-gate-known.json', 'utf8'));
  for (const row of rows) assert.match(row.file, /^dist\//);
});

test('the Leak screen page carries every slot the gate fills', () => {
  const page = readFileSync('site/leak-screen/index.html', 'utf8');
  const filled = fillPage(page, { terms: 1, canaries: 1, scanned: '2026-10-28T00:00:00Z', commit: COMMIT, files: 1, hits: 0, known: 0 });
  assert.match(filled, /datetime="2026-10-28T00:00:00Z"/);
  assert.throws(() => fillPage(page.replace('data-leak-screen="known"', ''), { terms: 1 }), /no "known" slot/);
});

test('the publish workflow runs the gate after the build, before the upload, with the secret', () => {
  const wf = readFileSync('.github/workflows/publish.yml', 'utf8');
  const at = s => { const i = wf.indexOf(s); assert.notEqual(i, -1, s); return i; };
  assert.ok(at('pnpm check') < at('node scripts/leak-gate.mjs') && at('node scripts/leak-gate.mjs') < at('upload-pages-artifact'));
  assert.match(wf, /--set scripts\/leak-gate-set\.json/);
  assert.match(wf, /LEAK_SCREEN_SECRET: \$\{\{ secrets\.LEAK_SCREEN_SECRET \}\}/);
  assert.doesNotMatch(wf.slice(at('Leak screen'), at('Upload Pages')), /continue-on-error|\|\| true/);
});

test('a vendored archive the gate cannot read stops the build', () => {
  const whole = tar({ 'main/ops.jsonl': '{"op":1}\n' });
  const root = site({ 'dist/data/raw-evidence.tar.gz': gzipSync(whole.subarray(0, 600)) });
  try {
    const r = gate(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not a readable tar archive/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a binary is read whole: a term spread over a long run is caught, and one too large to read whole stops the build', () => {
  const secret = loadSecret(SECRET);
  assert.ok(MAX_BINARY >= 64 * 1024 * 1024);
  const root = site({ 'dist/assets/long.webm': Buffer.concat([Buffer.alloc(70 * 1024 * 1024), Buffer.from(`Zephyr${' '.repeat(100)}Quarry`), Buffer.alloc(8)]) });
  try {
    const r = gate(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /long\.webm:0 term/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  assert.ok(secret.terms > 0);
});

test('a binary over the size ceiling stops the build, clean or not', () => {
  const root = mkdtempSync(join(tmpdir(), 'leak-gate-'));
  try {
    writeFileSync(join(root, 'clean.webm'), Buffer.alloc(2048));
    assert.throws(() => scanPaths([join(root, 'clean.webm')], loadSecret(SECRET), { maxBinary: 1024 }), /too large to read whole \(2048 bytes\)/);
    assert.equal(scanPaths([join(root, 'clean.webm')], loadSecret(SECRET), { maxBinary: 4096 }).hits.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stale known row that names a protected file is printed redacted', () => {
  const root = site({ 'known.json': JSON.stringify({ format: 'odin-leak-gate-known', version: 1, known: [{ file: 'dist/blorvak.html', kind: 'term', hash: 'abcdef12', count: 1, reason: 'a reviewed occurrence' }] }) });
  try {
    const r = gate(root, undefined, ['--known', 'known.json']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /STALE known occurrence \[a file name, sha256 [0-9a-f]{8}\]/);
    assert.ok(!r.out.includes('blorvak'), r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bytes after an archive\'s end stop the build', () => {
  const root = site({ 'dist/data/raw-evidence.tar.gz': gzipSync(Buffer.concat([tar({ 'main/ok.json': '{}' }), Buffer.from('blorvak')])) });
  try {
    const r = gate(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /has bytes after its end/);
    assert.ok(!r.out.includes('blorvak'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bytes in a member\'s padding stop the build', () => {
  const whole = tar({ 'main/x.txt': 'x' });
  whole.write('blorvak', 512 + 1);
  const root = site({ 'dist/data/raw-evidence.tar.gz': gzipSync(whole) });
  try {
    const r = gate(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /has bytes in a member's padding/);
    assert.ok(!r.out.includes('blorvak'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a term in an unused byte range of an archive header is caught', () => {
  const whole = tar({ 'main/ok.json': '{}' });
  whole.write('blorvak', 500);
  const root = site({ 'dist/data/raw-evidence.tar.gz': gzipSync(whole) });
  try {
    const r = gate(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\(archive headers\):0 term/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a gzip with header text, a second member or bytes after it stops the build', () => {
  const tarball = gzipSync(tar({ 'main/ok.json': '{}' }));
  const withComment = Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0x10, 0, 0, 0, 0, 0, 3]), Buffer.from('/Users/someone/private\0'), tarball.subarray(10)]);
  const cases = { 'header text': [withComment, /gzip header text/], 'two members': [Buffer.concat([tarball, gz(Buffer.from('x'))]), /more than one gzip member/], 'bytes after': [Buffer.concat([tarball, Buffer.from('blorvak')]), /more than one gzip member, or bytes after it/] };
  for (const [name, [bytes, want]] of Object.entries(cases)) {
    const root = site({ 'dist/data/raw-evidence.tar.gz': bytes });
    try {
      const r = gate(root);
      assert.equal(r.code, 2, `${name}: ${r.out}`);
      assert.match(r.out, want, name);
      assert.ok(!r.out.includes('someone') && !r.out.includes('blorvak'), name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('a malformed known list or commitment is reported with a fixed message, never its content', () => {
  const root = site({ 'known.json': 'blorvak', 'bad-set.json': JSON.stringify({ format: 'odin-leak-gate-set', version: 1, terms: 'blorvak', canaries: 1, sha256: 'x' }) });
  try {
    const a = gate(root, undefined, ['--known', 'known.json']);
    assert.equal(a.code, 2, a.out); assert.match(a.out, /known-occurrence list is not JSON/); assert.ok(!a.out.includes('blorvak'));
    const r = spawnSync(process.execPath, [join(process.cwd(), 'scripts/leak-gate.mjs'), '--set', 'bad-set.json', 'dist'], { cwd: root, env: { PATH: process.env.PATH, LEAK_SCREEN_SECRET: SECRET }, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /commitment has the wrong format/); assert.ok(!(r.stdout + r.stderr).includes('blorvak'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
