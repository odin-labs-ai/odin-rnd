// EXP 005 WO-04: the three practice rows for the dry run. They are authored here, separately from the
// corpus: they are not in corpus/, manifest.json, labels.json, inputs.json or corpus.sha256, and their ids
// (p01–p03) are not corpus ids. They exist only to exercise the runners with paid calls before the
// measured run; no result on them is a measurement, and the nina-upstream lane never uses them.
//
//   node experiments/jev-gate/practice/author-practice.mjs          write practice-rows.json
//   node experiments/jev-gate/practice/author-practice.mjs --check  rebuild and compare byte for byte
//
// Each row is an edit to the base app, turned into a unified diff by git in a scratch repository, and
// its state is built exactly as the corpus states are: rules.txt + "\n\n" + diff.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JEV = join(HERE, '..');
const OUT = join(HERE, 'practice-rows.json');

// [id, file, from, to]: one textual edit per row. The expected outcome is the author's intent only;
// practice rows are never labelled by bce and never scored.
const ROWS = [
  ['p01', 'src/domain/money.ts',
    'export function multiply(a: Money, factor: number): Money {',
    'export function subtract(a: Money, b: Money): Money {\n  if (a.currency !== b.currency) throw new RangeError(\'currency mismatch\');\n  return money(a.cents - b.cents, a.currency);\n}\n\nexport function multiply(a: Money, factor: number): Money {'],
  ['p02', 'src/domain/money.ts',
    "export function money(cents: number, currency = 'EUR'): Money {",
    "import { settings } from '../config';\n\nexport function money(cents: number, currency = settings.currency ?? 'EUR'): Money {"],
  ['p03', 'src/app/place-order.ts',
    "import type { CustomerRepository, OrderRepository } from './ports';",
    "import type { CustomerRepository, OrderRepository } from './ports';\nimport { Pool } from 'pg';\n\nconst audit = new Pool();"],
];
const INTENT = { p01: 'GREEN', p02: 'RED', p03: 'RED' };

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export function buildPractice() {
  const rules = readFileSync(join(JEV, 'rules.txt'), 'utf8');
  const corpusIds = new Set(JSON.parse(readFileSync(join(JEV, 'inputs.json'), 'utf8')).items.map(i => i.id));
  const items = ROWS.map(([id, file, from, to]) => {
    if (corpusIds.has(id)) throw new Error(`${id} is a corpus id`);
    const dir = mkdtempSync(join(tmpdir(), 'jev-gate-practice-'));
    try {
      cpSync(join(JEV, 'base'), dir, { recursive: true });
      git(dir, 'init', '-q'); git(dir, 'add', '-A');
      const path = join(dir, file), text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`${id}: the anchor must occur exactly once in ${file}`);
      writeFileSync(path, text.replace(from, to));
      const patch = git(dir, 'diff', '--no-color', '--no-ext-diff');
      return { id, intent: INTENT[id], patch, state: `${rules}\n\n${patch}` };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  return { schemaVersion: 1, kind: 'practice-rows', note: 'Practice rows for the EXP 005 dry run (bundle 3 WO-04). Not corpus items, not hashed into the corpus, never scored; intent is the author\'s, not a bce label.', items };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = `${JSON.stringify(buildPractice(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) { console.error('practice-rows.json differs from a rebuild'); process.exit(1); }
    console.log('practice-rows.json rebuilds byte for byte');
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
