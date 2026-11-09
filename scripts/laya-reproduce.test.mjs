import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE, README, checkPlatforms, commands, script } from './laya-reproduce.mjs';

const html = readFileSync(PAGE, 'utf8');
const md = readFileSync(README, 'utf8');

test('the smoke workflow gets the page\'s own commands, and refuses a page that drifted from the README', () => {
  const sh = commands('sh', html, md);
  assert.equal(sh[0], 'python3.12 -m venv .venv');
  assert.match(sh.at(-1), /^python research\/laya-browser\/convert\.py /);
  const ps = commands('powershell', html, md);
  assert.equal(ps[0], 'py -3.12 -m venv .venv');
  assert.match(ps.at(-1), /^\.venv\\Scripts\\python research\/laya-browser\/convert\.py /);
  assert.throws(() => commands('sh', html.replace('--out reference.json', '--out ref.json'), md), /differs from the README/);
  assert.throws(() => commands('powershell', html, md.replace('py -3.12 -m venv', 'py -3.13 -m venv')), /differs from the README/);
});

test('the PowerShell script stops at the first failing command, which Windows PowerShell does not do by itself', () => {
  const out = script('powershell', ['py -3.12 -m venv .venv', ".venv\\Scripts\\python -c 'x'"]).split('\r\n');
  assert.deepEqual(out.slice(0, 3), ["Write-Host '> py -3.12 -m venv .venv'", 'py -3.12 -m venv .venv', 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }']);
  assert.equal(out[3], "Write-Host '> .venv\\Scripts\\python -c ''x'''");
});

test('every platform the page claims has a runner in the smoke workflow, and no runner goes unclaimed', () => {
  const wf = readFileSync('.github/workflows/laya-reproduce.yml', 'utf8');
  assert.deepEqual(checkPlatforms(html, md, wf).sort(), ['macos-15', 'ubuntu-24.04-arm', 'ubuntu-latest', 'windows-11-arm', 'windows-latest']);
  assert.throws(() => checkPlatforms(html, md, wf.replace('runs-on: windows-11-arm', 'runs-on: windows-2025')), /windows-11-arm|windows-2025/);
  assert.throws(() => checkPlatforms(html.replace('macOS 14 or later on Apple silicon', 'macOS'), md, wf), /Apple silicon/);
});
