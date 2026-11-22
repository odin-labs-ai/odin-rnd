import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('the local Pages preview serves playable films, seek ranges and WebP posters', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'rnd-preview-'));
  const dist = join(cwd, 'dist');
  await mkdir(dist);
  await Promise.all(['film.mp4', 'film.webm', 'poster.webp'].map(file => writeFile(join(dist, file), 'abcdef')));
  const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
    cwd, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(cwd, { recursive: true, force: true });
  });
  const [line] = await once(server.stdout, 'data');
  const base = line.toString().trim().split(' ').at(-1);
  for (const [file, type] of [['film.mp4', 'video/mp4'], ['film.webm', 'video/webm'], ['poster.webp', 'image/webp']]) {
    const response = await fetch(base + file);
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(await response.text(), 'abcdef');
  }
  for (const [range, expectedRange, expectedBody] of [['0-1', '0-1', 'ab'], ['2-', '2-5', 'cdef'], ['-2', '4-5', 'ef']]) {
    const part = await fetch(base + 'film.mp4', { headers: { range: 'bytes=' + range } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes ' + expectedRange + '/6');
    assert.equal(part.headers.get('content-length'), String(expectedBody.length));
    assert.equal(await part.text(), expectedBody);
  }
  const outside = await fetch(base + 'film.mp4', { headers: { range: 'bytes=6-' } });
  assert.equal(outside.status, 416);
  assert.equal(outside.headers.get('content-range'), 'bytes */6');
});
