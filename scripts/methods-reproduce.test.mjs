import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTags } from './test-html-text.mjs';

// The methods page's "Rerun it yourself" section (site/methods/index.html#reproduce) and the README's "Run locally"
// section tell a reader the same thing. They drifted once: the README gained JDK 21, the Windows line-ending clone and
// the pnpm test platform note while the methods page kept the old short list. This ties them together, and keeps the
// steps pasteable into Windows PowerShell 5.1 (no `&&`) without an elevated shell (no bare `corepack enable` step).
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = readFileSync('site/methods/index.html', 'utf8');
const section = html.split('aria-labelledby="reproduce-title"')[1]?.split('</section>')[0];
const readme = readFileSync('README.md', 'utf8').split(/^## Run locally$/m)[1]?.split(/^## /m)[0];
const blocks = readme ? [...readme.matchAll(/```sh\n([\s\S]*?)```/g)].map(m => m[1].trimEnd()) : [];
const steps = blocks.find(block => /\bclone\b/.test(block));

test('the methods page shows the README "Run locally" steps, verbatim, and links to them', () => {
  assert(section, 'the methods page has its Rerun it yourself section');
  assert(readme, 'the README has a "## Run locally" section');
  assert(steps, 'the README Run locally section has a block with the clone step');
  assert(section.includes(`<pre><code>${escape(steps)}</code></pre>`), `the methods page differs from the README block:\n${steps}`);
  assert(section.includes('href="https://github.com/odin-labs-ai/odin-rnd#run-locally"'), 'the methods page links to the README section');
});

test('every step is its own line and pastes into Windows PowerShell 5.1', () => {
  for (const block of blocks) {
    assert(!block.includes('&&'), `PowerShell 5.1 has no &&:\n${block}`);
    for (const line of block.split('\n')) assert(!/[;|]/.test(line.replace(/\s#.*$/, '')), `one command per line: ${line}`);
  }
  const lines = steps.split('\n');
  assert.equal(lines[0], 'git -c core.autocrlf=false clone https://github.com/odin-labs-ai/odin-rnd', 'the clone keeps committed line endings');
  assert.equal(lines[1], 'cd odin-rnd');
  // CI installs pnpm this way (.github/workflows/publish.yml); corepack enable needs admin on Windows.
  assert.equal(lines[2], 'npm install --global pnpm@10.11.1');
  assert(!lines.includes('corepack enable'), 'corepack enable is not a step: on Windows it needs an elevated shell');
  assert.match(readFileSync('.github/workflows/publish.yml', 'utf8'), /run: npm install --global pnpm@10\.11\.1/);
  assert.match(readFileSync('package.json', 'utf8'), /"packageManager": "pnpm@10\.11\.1"/);
  for (const cmd of ['pnpm install --frozen-lockfile', 'pnpm experiment', 'pnpm test', 'pnpm build', 'pnpm check']) assert(lines.some(l => l.startsWith(cmd)), cmd);
});

test('both pages state the same requirements', () => {
  const text = s => stripTags(s, '').replace(/\s+/g, ' ');
  for (const [where, body] of [['README', readme], ['methods page', text(section)]]) {
    for (const need of [/\bgit\b/, /Node 22/, /JDK 21/, /JAVA_HOME/, /pnpm 10\.11\.1/, /ZIP download will not build/, /corepack enable/, /elevated shell/, /python3/, /bash/, /POSIX/, /WSL/]) {
      assert.match(body, need, `${where} says ${need}`);
    }
  }
  // The re-checkout note is two lines too, not one && chain.
  assert(blocks.includes('git rm --cached -r .\ngit reset --hard'), 'the README re-checkout note is one command per line');
});
