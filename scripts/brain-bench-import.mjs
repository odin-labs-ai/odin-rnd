// Lab 02, every brain on the same tasks (mission rnd-labs-human-first-1024). It turns the brain bench's private
// experiment files into the one public record the lab page reads:
//   site/data/labs/brain-bench/results.json   (odin-brain-bench v1)
//
//   node scripts/brain-bench-import.mjs --src <dir> --map <file> [--pack <file>] [--notes <file>] [--out <file>] [--check]
//   node scripts/brain-bench-import.mjs --fingerprint "<term>"   (prints the hash to add to brain-bench-screen-terms.json)
//
// --src is a download of the private repository's experiment folders at one commit (each with PREREG.md, REPORT.md and
// results/). --map is the PRIVATE input: that commit, which folder is which experiment, and the neutral label for each
// test world, task, instruction kind and brain the private test game names. It is never committed, and nothing in it
// reaches the output except the commit and the neutral labels. --notes is the public words: the question, how the
// experiments were run, and for each experiment its predictions with their verdicts and its caveats, as the reports
// state them (site/data/labs/brain-bench.json). --pack is the telemetry pack (odin-telemetry v1) the agent-space owner
// recomputes from the same committed results: when the map names one, every brain must match its pack row exactly and
// every pack row must be matched, and the pack row becomes the figure's second source.
// Cost is counted and checked against the pack but never written: this site publishes no money figures.
//
// Every number in the record is counted from the result rows (results/results.jsonl, cited by line ranges) or read
// from a result file (cited by JSON pointer), and every figure carries that source and the private commit. Counts are
// cross-checked against the experiment's own leaderboard, and each Wilson 95 % interval is recomputed and must match
// the leaderboard's to three decimals, or the import refuses. Prose never states a number: it names one with a
// placeholder, {EXP-W01:tuned-1gb:of}, that the page resolves from the record (scripts/brain-bench.mjs).
//
// The import REFUSES (exit 1, every reason listed, nothing written) when a row names a world, task, kind or brain the
// map does not label, or when any string it would write fails the screen: the Lab 01 publisher's screen
// (scripts/lab-dispatch-publish.mjs: restricted names, places, prices, addresses, links, file names) plus this lab's
// own list of the test game's world, character and item names (scripts/brain-bench-screen-terms.json, hashed, so the
// list does not spell them). A source field (a file name, a pointer, a commit) is screened for names, places and world
// terms only, since a file name is what it is meant to hold. The output is a pure function of the inputs: run twice,
// it writes the same bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, normalise, screenHits } from './lab-dispatch-publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const WORLD_TERMS_FILE = join(here, 'brain-bench-screen-terms.json');
export const NOTES_FILE = join(here, '..', 'site/data/labs/brain-bench.json');
export const OUT_FILE = join(here, '..', 'site/data/labs/brain-bench/results.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Exported so a test can add a made-up term's hash: the real names are never written in this repo, not even in a test.
export const WORLD_TERMS = new Set(JSON.parse(readFileSync(WORLD_TERMS_FILE, 'utf8')).terms);

/** Offsets where the text names one of the test game's listed world, character or item names. */
function worldHits(text) {
  const tokens = [...normalise(text).matchAll(/\p{L}+|\p{N}+/gu)].map(m => ({ word: m[0], at: m.index }));
  const hits = [];
  for (let i = 0; i < tokens.length && !hits.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(tokens.length, i + 7); j++) {
      joined += tokens[j].word;
      if (WORLD_TERMS.has(sha256(joined.replace(/[^\p{L}]/gu, '')))) { hits.push(tokens[i].at); break; }
    }
  }
  // Long terms anywhere in the letters, so a name glued to other words or written with no separators is caught too.
  const letters = [...normalise(text).matchAll(/\p{L}/gu)];
  const run = letters.map(m => m[0]).join('');
  for (let length = 7; length <= 32 && !hits.length; length++) {
    for (let i = 0; i + length <= run.length; i++) if (WORLD_TERMS.has(sha256(run.slice(i, i + length)))) { hits.push(letters[i].index); break; }
  }
  return hits.map(at => ({ at, reason: 'a name from the private test game (a world, a character or an item)' }));
}

/** Why one public string may not be published (empty when it may). `source` strings may be file names and long ids. */
export function benchScreen(text, { source = false } = {}) {
  // The record repeats the same short strings (file names, labels) thousands of times: each is screened once.
  if (!screened.has(text)) screened.set(text, [...screenHits(text), ...worldHits(text)]);
  const hits = screened.get(text);
  return (source ? hits.filter(hit => /^a (restricted name|place name|name from the private)/.test(hit.reason)) : hits).map(hit => hit.reason);
}
const screened = new Map();
/** Forget screened strings (after WORLD_TERMS changes). */
export const clearScreenCache = () => screened.clear();

const COST_FIELDS = ['costPerTaskUsd', 'costBasis', 'totalCostUsd', 'listPriceEstimateUsd', 'costSource'];
const SOURCE_KEYS = new Set(['source', 'prereg', 'costSource', 'runSpendSource']);
/** Screen every string under `value`; keys in SOURCE_KEYS (at any depth) hold sources. "<pointer>: <reason>" lines. */
export function benchScreenTree(value, at = '', source = false) {
  if (typeof value === 'string') return benchScreen(value, { source }).map(reason => `${at || '/'}: ${reason} (${JSON.stringify(value.slice(0, 80))})`);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [...benchScreen(key, { source }).map(reason => `${at}/${key}: the key: ${reason}`),
    ...benchScreenTree(child, `${at}/${key}`, source || SOURCE_KEYS.has(key))]);
}

/** Wilson 95 % interval for k of n, as fractions rounded to three decimals (how the bench's leaderboards store it). */
export function wilson(k, n, z = 1.959964) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [round((c - m) / d, 3), round((c + m) / d, 3)];
}
/** The Wilson 95 % interval unrounded, to compare with a source that rounds to four decimals. */
const wilsonExact = (k, n, z = 1.959964) => { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const round = (v, places) => { const f = 10 ** places; return Math.round((v + Number.EPSILON) * f) / f; };

/** Line ranges [[from, to], ...] (1-based, inclusive) for a sorted list of line numbers. */
export function ranges(lines) {
  const out = [];
  for (const line of lines) { const last = out.at(-1); if (last && last[1] === line - 1) last[1] = line; else out.push([line, line]); }
  return out;
}

const readJsonl = (file, problems, label) => {
  try { return readFileSync(file, 'utf8').split('\n').map((text, i) => ({ line: i + 1, text })).filter(r => r.text.trim()).map(r => ({ line: r.line, row: JSON.parse(r.text) })); }
  catch (error) { problems.push(`${label}: ${error.message}`); return []; }
};
const readJson = (file, problems, label) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { problems.push(`${label}: ${error.message}`); return null; }
};
const get = (obj, pointer) => pointer.split('/').slice(1).map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const pointerKey = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** A result file's sha256 as git stores it (LF) and as a Windows checkout reads it (CRLF): the pack hashes the latter. */
function hashes(file) {
  try { const lf = readFileSync(file); return { lf: sha256(lf), crlf: sha256(Buffer.from(lf.toString('utf8').replace(/\r?\n/g, '\r\n'))) }; }
  catch { return { lf: null, crlf: null }; }
}

/**
 * The telemetry pack (odin-telemetry v1) recomputes each brain's row from the same committed results. Every brain the
 * import counted must match its pack row exactly (successes, episodes, harness, the Wilson interval to four decimals,
 * the results file's hash, and the cost where the pack prices it), and every pack row must be matched. The pack row is
 * kept as the figure's second source. Where the pack says a cloud model was not priced in that run (null), the record
 * says so too: not priced, never free.
 */
function packCheck({ exp, brains, pack, map, packUsed, resultsSha, problems }) {
  const exact = wilsonExact;
  pack.benchmark.forEach((row, index) => {
    if (row.experiment !== exp.id) return;
    const key = `${row.brain}|${row.brain_version}`;
    const id = map.pack.brains[key];
    const where = `${exp.id} pack row ${index}`;
    if (!id) { problems.push(`${where}: the map has no neutral id for this pack brain`); return; }
    const brain = brains.find(b => b.id === id);
    if (!brain) { problems.push(`${where}: no counted brain ${id}`); return; }
    const sensitivity = row.kind === 'cloud (sensitivity)';
    const figure = sensitivity ? brain.sensitivity : brain;
    if (!figure) { problems.push(`${where}: a sensitivity row for a brain with no sensitivity check`); return; }
    packUsed.add(index);
    if (row.successes !== figure.successes || row.episodes !== figure.n) problems.push(`${where}: the pack says ${row.successes}/${row.episodes}, the rows ${figure.successes}/${figure.n}`);
    if (row.harness !== brain.harness) problems.push(`${where}: the pack says harness ${row.harness}, the rows ${brain.harness}`);
    if (!sensitivity && row.kind !== brain.where) problems.push(`${where}: the pack says ${row.kind}, the notes ${brain.where}`);
    const ci = exact(figure.successes, figure.n);
    if (row.ci95.some((v, i) => Math.abs(v - ci[i]) > 0.00006)) problems.push(`${where}: the pack's interval ${row.ci95} is not the Wilson interval ${ci.map(v => v.toFixed(4))}`);
    const file = sensitivity ? figure.source.sha256 : resultsSha.lf;
    const crlf = sensitivity ? figure.crlf : resultsSha.crlf;
    if (![file, crlf].includes(row.source?.sha256)) problems.push(`${where}: the pack's results hash is not this results file's`);
    if (row.usd_per_task === null) {
      if (brain.costBasis !== 'local') Object.assign(brain, { costPerTaskUsd: null, costBasis: 'not-priced', listPriceEstimateUsd: brain.costBasis === 'list-price-estimate' ? brain.costPerTaskUsd : null, totalCostUsd: null });
      else problems.push(`${where}: the pack leaves a local brain unpriced`);
    } else if (!sensitivity && Math.abs(row.usd_per_task - brain.costPerTaskUsd) > 5e-7) problems.push(`${where}: the pack's cost per task ${row.usd_per_task} is not the rows' ${brain.costPerTaskUsd}`);
    // A pack row's results file can be named after a world (the sensitivity file is): then only its folder is kept.
    const results = sensitivity ? `${dirname(row.source.file)}/` : row.source.file;
    const cite = { file: map.pack.file, commit: map.pack.commit, pointer: `/benchmark/${index}`, results: { file: results, commit: row.source.commit, sha256: row.source.sha256, sha256Of: 'the file as a Windows checkout reads it (CRLF line endings)' } };
    if (sensitivity) Object.assign(figure, { packNote: row.note, registered: false }); else brain.packNote = row.note;
    figure.source.pack = cite;
  });
}

/** Count a group of rows into one figure: n, successes, the interval, and the rows it came from. */
function count(rows, file, ctx) {
  const n = rows.length, successes = rows.filter(r => r.row.success === true).length;
  return { n, successes, rate: round(successes / n, 4), ci: wilson(successes, n), source: { ...ctx, file, lines: ranges(rows.map(r => r.line)) } };
}

/**
 * Build the public record. Returns { problems, record }. `src` is the experiments download, `map` the private map,
 * `notes` the public words.
 */
export function build({ src, map, notes, pack = null }) {
  const problems = [];
  if (map?.format !== 'odin-brain-bench-private-map' || map.version !== 1) problems.push('the map is not odin-brain-bench-private-map v1');
  if (!/^[0-9a-f]{40}$/.test(map?.commit ?? '')) problems.push('the map does not name the full private commit');
  if (notes?.format !== 'odin-lab-bench' || notes.version !== 1) problems.push('the notes are not odin-lab-bench v1');
  if (map?.pack && (pack?.format !== 'odin-telemetry' || pack.version !== 1 || !Array.isArray(pack.benchmark))) problems.push('the map names a telemetry pack, and none (odin-telemetry v1) was given');
  if (map?.pack && !/^[0-9a-f]{40}$/.test(map.pack.commit ?? '')) problems.push('the map does not name the pack\'s full commit');
  if (problems.length) return { problems, record: null };
  const packUsed = new Set();
  const label = (table, key, what, where) => {
    if (!(key in map[table])) { problems.push(`${where}: the map has no neutral label for this ${what}`); return null; }
    return map[table][key];
  };
  const experiments = [];
  for (const exp of map.experiments) {
    const words = notes.experiments.find(e => e.id === exp.id);
    if (!words) { problems.push(`${exp.id}: the notes have no words for it`); continue; }
    const dir = join(src, exp.dir);
    const ctx = { experiment: exp.id, commit: map.commit };
    const all = readJsonl(join(dir, 'results/results.jsonl'), problems, `${exp.id} results`);
    const resultsSha = hashes(join(dir, 'results/results.jsonl'));
    const rows = all.filter(r => !('skip' in r.row));
    const skipped = all.length - rows.length;
    const before = problems.length;
    // Every experiment is cross-checked against at least one recomputation: its leaderboard, the telemetry pack, or both.
    if (!exp.leaderboard && !map.pack) problems.push(`${exp.id}: no leaderboard and no telemetry pack to check the counts against`);
    const board = exp.leaderboard ? readJson(join(dir, exp.leaderboard), problems, `${exp.id} leaderboard`) : null;
    const summary = exp.summary ? readJson(join(dir, exp.summary), problems, `${exp.id} summary`) : null;
    const prereg = readFileSync(join(dir, 'PREREG.md'));

    // Every row must carry labels the map knows; the brain key never leaves this function.
    for (const { line, row } of rows) {
      const where = `${exp.id} results line ${line}`;
      label('brains', row.brain, 'brain', where); label('worlds', row.game, 'world', where); label('tasks', row.task, 'task', where);
      if (row.instruction) label('kinds', row.instruction.kind, 'instruction kind', where);
    }
    // Only this experiment's own problems stop it; the others are still counted, so every failure is reported.
    if (problems.length > before) continue;
    const brainKeys = [...new Set(rows.map(r => r.row.brain))];
    const brains = [];
    for (const key of brainKeys) {
      const id = map.brains[key];
      const mine = rows.filter(r => r.row.brain === key);
      const meta = notes.brains[id];
      if (!meta) { problems.push(`${exp.id}/${id}: the notes have no label for this brain`); continue; }
      const figure = count(mine, 'results/results.jsonl', ctx);
      figure.source.sha256 = resultsSha.lf;
      const versions = [...new Set(mine.map(r => r.row.brain_version))];
      const harness = [...new Set(mine.map(r => r.row.harness))];
      if (versions.length !== 1 || harness.length !== 1) problems.push(`${exp.id}/${id}: rows of more than one brain version or harness`);
      const sum = field => mine.reduce((total, r) => total + (Number(r.row[field]) || 0), 0);
      const brain = {
        id, label: meta.label, where: meta.where, model: meta.model, brainVersion: meta.where === 'rules' ? null : versions[0], harness: harness[0],
        ...figure,
        fallbacks: sum('fallbacks'),
        tokensPerTask: round(sum('tokens') / figure.n, 1),
        modelMsPerTask: round(sum('llm_ms') / figure.n, 1),
      };
      // Cost as the bench measured it; where the bench could not price a cloud model, the list-price estimate.
      const measured = round(sum('cost_usd'), 6);
      if (meta.where !== 'cloud') Object.assign(brain, { costPerTaskUsd: 0, costBasis: 'local', totalCostUsd: 0 });
      else if (measured > 0) Object.assign(brain, { costPerTaskUsd: round(measured / figure.n, 7), costBasis: 'bench-estimate', totalCostUsd: measured });
      else {
        const pointer = `/${pointerKey(key)}/cost_est_usd`;
        const estimate = summary ? get(summary, pointer) : undefined;
        if (typeof estimate !== 'number') problems.push(`${exp.id}/${id}: a cloud brain the bench did not price, and no list-price estimate in the summary`);
        else Object.assign(brain, { costPerTaskUsd: round(estimate / figure.n, 7), costBasis: 'list-price-estimate', totalCostUsd: estimate, costSource: { ...ctx, file: exp.summary, pointer } });
      }
      // The leaderboard's own row for this brain: the counts must agree, and the interval must be the one recomputed.
      if (board) {
        const index = board.brains.findIndex(b => b.brain === key);
        const row = board.brains[index];
        if (!row) problems.push(`${exp.id}/${id}: not on the leaderboard`);
        else {
          if (row.n !== figure.n || row.successes !== figure.successes) problems.push(`${exp.id}/${id}: the rows count ${figure.successes}/${figure.n}, the leaderboard ${row.successes}/${row.n}`);
          if (row.success_ci.some((v, i) => Math.abs(v - figure.ci[i]) > 0.0005)) problems.push(`${exp.id}/${id}: the recomputed interval ${figure.ci} is not the leaderboard's ${row.success_ci}`);
          brain.source.checkedAgainst = { file: exp.leaderboard, pointer: `/brains/${index}` };
        }
      }
      // Breakdowns, each counted from its own rows: by task family when there are several, by world and instruction kind.
      const by = (fn, table) => {
        const groups = new Map();
        for (const r of mine) { const k = fn(r.row); if (k == null) continue; const id = map[table][k]; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(r); }
        return Object.fromEntries([...groups.keys()].sort().map(k => [k, count(groups.get(k), 'results/results.jsonl', ctx)]));
      };
      brain.breakdown = {};
      if (new Set(mine.map(r => r.row.task)).size > 1) brain.breakdown.task = by(r => r.task, 'tasks');
      else brain.breakdown.world = by(r => r.game, 'worlds');
      if (mine.some(r => r.row.instruction)) brain.breakdown.kind = by(r => r.instruction?.kind, 'kinds');
      brains.push(brain);
    }
    // The disclosed sensitivity check: the affected episodes re-run, swapped in for the originals.
    if (exp.sensitivity) {
      const s = exp.sensitivity;
      const rerun = readJsonl(join(dir, s.file), problems, `${exp.id} sensitivity`);
      const rerunSha = hashes(join(dir, s.file));
      const id = map.brains[s.brain];
      const brain = brains.find(b => b.id === id);
      const seeds = rerun.map(r => r.row.seed);
      const replaced = rows.filter(r => r.row.brain === s.brain && r.row.game === s.world && seeds.includes(r.row.seed));
      if (!brain || replaced.length !== rerun.length || rerun.some(r => r.row.brain !== s.brain || r.row.game !== s.world)) problems.push(`${exp.id}: the sensitivity rows do not replace exactly the affected rows`);
      else {
        const won = rerun.filter(r => r.row.success === true).length;
        const successes = brain.successes - replaced.filter(r => r.row.success === true).length + won;
        brain.sensitivity = {
          world: map.worlds[s.world], seeds: { from: Math.min(...seeds), to: Math.max(...seeds) }, rerun: rerun.length, rerunWon: won,
          rerunFallbacks: rerun.reduce((t, r) => t + (r.row.fallbacks || 0), 0),
          n: brain.n, successes, ci: wilson(successes, brain.n),
          // Episodes in the affected range where a model call came back empty (no tokens, no time): what the error looked like.
          emptyReplyEpisodes: replaced.filter(r => r.row.fallbacks > 0 && r.row.tokens === 0 && r.row.llm_ms === 0).length,
          // The file is named after the world, so the record names its folder and identifies it by its hash.
          source: { ...ctx, file: `${dirname(s.file)}/`, fileIs: 'the only file in this folder, identified by its sha256', sha256: rerunSha.lf, lines: ranges(rerun.map(r => r.line)), replaces: { file: 'results/results.jsonl', sha256: resultsSha.lf, lines: ranges(replaced.map(r => r.line)) } },
        };
        Object.defineProperty(brain.sensitivity, 'crlf', { value: rerunSha.crlf, enumerable: false });
      }
    }
    if (map.pack && pack) packCheck({ exp, brains, pack, map, packUsed, resultsSha, problems });
    brains.sort((a, b) => b.successes - a.successes || a.id.localeCompare(b.id));
    // The page states one episodes-per-brain count, so every brain must have exactly that many episodes.
    if (new Set(brains.map(b => b.n)).size > 1) problems.push(`${exp.id}: brains have unequal episode counts (${brains.map(b => `${b.id} ${b.n}`).join(', ')})`);
    const seeds = [...new Set(rows.map(r => r.row.seed))].sort((a, b) => a - b);
    experiments.push({
      id: exp.id, title: words.title, question: words.question, date: words.date,
      design: {
        tasks: new Set(rows.map(r => r.row.task)).size, worlds: new Set(rows.map(r => r.row.game)).size,
        seeds: { from: seeds[0], to: seeds.at(-1), count: seeds.length }, brains: brains.length,
        episodesPerBrain: brains[0]?.n ?? 0, episodes: rows.length, skippedRows: skipped,
        harness: [...new Set(rows.map(r => r.row.harness))].sort(),
        source: { ...ctx, file: 'results/results.jsonl', lines: ranges(all.map(r => r.line)) },
      },
      prereg: { commit: words.prereg.commit, sha256: sha256(prereg), file: 'PREREG.md', experiment: exp.id },
      comparators: words.comparators ?? [],
      predictions: words.predictions, unpredicted: words.unpredicted ?? [], caveats: words.caveats, brains,
    });
    if (words.prereg.sha256 && words.prereg.sha256 !== sha256(prereg)) problems.push(`${exp.id}: PREREG.md does not hash to the sha256 its report states`);
  }
  for (const words of notes.experiments) if (!map.experiments.some(e => e.id === words.id)) problems.push(`${words.id}: words but no experiment`);
  if (map.pack && pack) pack.benchmark.forEach((row, i) => { if (!packUsed.has(i)) problems.push(`pack benchmark row ${i} (${row.experiment}): matches no brain the import counted`); });
  const record = {
    format: 'odin-brain-bench', version: 1,
    source: { repository: 'private', commit: map.commit, about: notes.sourceAbout,
      ...(map.pack && pack ? { pack: { format: 'odin-telemetry', version: 1, file: map.pack.file, commit: map.pack.commit, builtAtCommit: pack.built_at_commit, rule: pack.rule } } : {}) },
    labels: notes.labels,
    experiments,
  };
  // Cost is counted (and checked against the pack) but never published: this site shows no money figures.
  for (const exp of record.experiments) for (const brain of exp.brains) for (const key of COST_FIELDS) delete brain[key];
  const json = JSON.parse(JSON.stringify(record));
  problems.push(...benchScreenTree(json));
  return { problems, record: json };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

function args(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--check') out.check = true;
    else if (['--src', '--map', '--notes', '--out', '--pack', '--fingerprint'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!out.fingerprint && (!out.src || !out.map)) throw new Error('--src <dir> and --map <file> are required');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/brain-bench-import.mjs --src <dir> --map <file> [--pack <file>] [--notes <file>] [--out <file>] [--check]\n${error.message}`);
    process.exit(2);
  }
  if (options.fingerprint) { console.log(fingerprint(options.fingerprint)); process.exit(0); }
  const { problems, record } = build({ src: resolve(options.src), map: JSON.parse(readFileSync(options.map, 'utf8')), notes: JSON.parse(readFileSync(options.notes ?? NOTES_FILE, 'utf8')),
    pack: options.pack ? JSON.parse(readFileSync(options.pack, 'utf8')) : null });
  if (problems.length) {
    console.error(`REFUSED: ${problems.length} reason${problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const out = resolve(options.out ?? OUT_FILE);
  if (options.check) { console.log(`OK: ${record.experiments.length} experiments may be published (--check, nothing written).`); process.exit(0); }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serialise(record));
  // The pin scripts/brain-bench.mjs enforces at build: the record's sha256, beside it.
  writeFileSync(join(dirname(out), 'results.sha256'), `${sha256(serialise(record))}  results.json\n`);
  console.log(`WROTE ${out}: ${record.experiments.length} experiments, ${record.experiments.reduce((t, e) => t + e.brains.length, 0)} brain rows.`);
}
