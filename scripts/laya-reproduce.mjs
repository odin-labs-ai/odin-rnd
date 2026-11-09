#!/usr/bin/env node
// The Laya page's "Reproduce the check." commands, taken from the page itself so that CI runs what a reader copies
// (.github/workflows/laya-reproduce.yml). The page's macOS/Linux and Windows blocks must equal the README's `sh` and
// `powershell` blocks; any drift between the two, or a block that no longer runs, turns the workflow red.
//
//   node scripts/laya-reproduce.mjs --shell sh --out <file>          the macOS/Linux block, for `sh -ex <file>`
//   node scripts/laya-reproduce.mjs --shell powershell --out <file>  the Windows block, every line followed by an
//                                                                    exit-code check (PowerShell does not stop on a
//                                                                    failing native command by itself)
//   node scripts/laya-reproduce.mjs --platforms                      the page's platform sentence, checked against
//                                                                    the runners the workflow proves it on
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PAGE = 'site/projects/laya-browser/index.html';
export const README = 'research/laya-browser/README.md';
export const WORKFLOW = '.github/workflows/laya-reproduce.yml';

const unescape = s => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');

export function pageSection(html) {
  const section = html.split('aria-labelledby="reproduce-heading"')[1]?.split('</section>')[0];
  if (!section) throw new Error(`${PAGE}: no Reproduce section`);
  return section;
}

/** The page's command blocks: [clone, macOS/Linux, Windows], read from its <pre><code> elements. */
export function pageBlocks(html) {
  const blocks = [...pageSection(html).matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(m => unescape(m[1]));
  if (blocks.length !== 3) throw new Error(`${PAGE}: expected 3 command blocks (clone, macOS/Linux, Windows), found ${blocks.length}`);
  return { clone: blocks[0], sh: blocks[1], powershell: blocks[2] };
}

export function readmeBlocks(md) {
  const section = md.split(/^## Reproduce$/m)[1];
  if (!section) throw new Error(`${README}: no "## Reproduce" section`);
  const blocks = Object.fromEntries([...section.matchAll(/```(sh|powershell)\n([\s\S]*?)```/g)].map(m => [m[1], m[2].trimEnd()]));
  for (const k of ['sh', 'powershell']) if (!blocks[k]) throw new Error(`${README}: no \`${k}\` block in "## Reproduce"`);
  return blocks;
}

/** The block for one shell, after checking that the page and the README say the same thing. */
export function commands(shell, html = readFileSync(PAGE, 'utf8'), md = readFileSync(README, 'utf8')) {
  const page = pageBlocks(html);
  const readme = readmeBlocks(md);
  if (!(shell in readme)) throw new Error(`unknown shell ${shell}`);
  if (page[shell] !== readme[shell]) throw new Error(`the page's ${shell} block differs from the README's:\n--- page\n${page[shell]}\n--- README\n${readme[shell]}`);
  return page[shell].split('\n').filter(line => line.trim());
}

export function script(shell, lines) {
  if (shell === 'sh') return lines.join('\n') + '\n';
  // Windows PowerShell 5.1 runs on after a native command fails; stop at the first non-zero exit, as a reader would.
  const q = s => `'${s.replaceAll("'", "''")}'`;
  return [...lines.flatMap(line => [`Write-Host ${q('> ' + line)}`, line, 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }']), ''].join('\r\n');
}

// What the page and the README promise, and the runner that proves each promise (the workflow's matrix).
export const PLATFORMS = [
  ['64-bit Linux (x86_64 or aarch64)', ['ubuntu-latest', 'ubuntu-24.04-arm']],
  ['Windows (x64 or arm64', ['windows-latest', 'windows-11-arm']],
  ['macOS 14 or later on Apple silicon', ['macos-15']],
];

export function checkPlatforms(html = readFileSync(PAGE, 'utf8'), md = readFileSync(README, 'utf8'), wf = readFileSync(WORKFLOW, 'utf8')) {
  const runners = [...wf.matchAll(/^ +- os: (\S+)$/gm)].map(m => m[1]);
  const section = pageSection(html);
  const readme = md.split(/^## Reproduce$/m)[1] ?? '';
  for (const [claim, proof] of PLATFORMS) {
    for (const [name, text] of [[PAGE, section], [README, readme]]) if (!text.includes(claim)) throw new Error(`${name}: no "${claim}"`);
    for (const os of proof) if (!runners.includes(os)) throw new Error(`"${claim}" is claimed but ${WORKFLOW} does not run on ${os}`);
  }
  const claimed = PLATFORMS.flatMap(p => p[1]);
  for (const os of runners) if (!claimed.includes(os)) throw new Error(`${WORKFLOW} runs on ${os}, which no platform claim names`);
  return runners;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  if (process.argv.includes('--platforms')) {
    console.log(`platform claims proven on: ${checkPlatforms().join(', ')}`);
  } else {
    const shell = arg('--shell');
    const lines = commands(shell);
    writeFileSync(arg('--out'), script(shell, lines));
    console.log(lines.join('\n'));
  }
}
