// Vendors the lab's fit map (odin-fit-map v1) into site/data/labs/fit-map.json ("Where each store fits" on the Labs
// page, mission rnd-labs-human-first-1024). The fit map lives in the agent space's private repository; this script is
// the one way it becomes public, so re-running it on the same file, commit and arguments gives the committed file byte
// for byte (scripts/lab-fit-map.test.mjs checks that on a synthetic fit map).
//
//   node scripts/vendor-fit-map.mjs --commit <40-hex> --file <fit-map.json> \
//     --as '<lab>=<EXP nnn|Lab nn>' --title '<lab>=<public title>' [--page '<lab>=<site path>'] \
//     [--result '<lab>/<scenario>=<site path>']... [--pin-out scripts/fit-map.pin.json] > site/data/labs/fit-map.json
//
// What it changes, and nothing else (every lab's mapping is recorded in `vendored.transform`):
// - each lab gets this site's name and a public title (--as, --title): the site numbers its labs itself, so the
//   source's own lab names are mapped here, never edited by hand;
// - every path into the private repository is dropped (a lab's dir, its pre-registration or design file); a lab links
//   to a page only when this site has one (--page), otherwise it is a plain label;
// - a publication note becomes the pull request number it names; the note itself is left out;
// - the rule's file name (RESULT.json) is said in words, "result record", recorded in `vendored.reworded` by the
//   sha256 of what it replaced, so the public file does not spell the file name;
// - the predictions are keyed by who made them (the lab, MongoDB's advocate, PostgreSQL's advocate), text unchanged;
//   each key rename is recorded in `vendored.renamed` by the sha256 of the source key;
// - a cell with a verdict needs the public page of its result (--result); without one the vendor refuses.
// It refuses, every reason listed, on a field it does not know (anywhere), a lab without --as or --title, a verdict
// outside the fit map's own words, or a mapping for a lab or cell the file does not have. The source file is recorded
// by sha256; --pin-out writes scripts/fit-map.pin.json with the output's own sha256, which the build checks
// (scripts/lab-fit-map.mjs), so a hand edit of the data file is refused unless the pin is changed with it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { pinFor, VERDICT_WORDS } from './lab-fit-map.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;
const PREDICTOR_KEYS = { this_pc: 'lab', mongodb_advocate: 'mongodbAdvocate', postgres_advocate: 'postgresAdvocate' };
const KNOWN = {
  top: ['format', 'version', 'built_at_commit', 'question', 'rule', 'verdict_words', 'labs'],
  lab: ['lab', 'dir', 'published', 'prereg', 'design', 'stage', 'cells'],
  published: ['odin_rnd', 'how'], prereg: ['file', 'commit', 'status', 'sha256'], design: ['file', 'commit', 'status'],
  cell: ['scenario', 'what', 'verdict', 'predictions'],
};

function args(argv) {
  const out = { as: {}, title: {}, page: {}, result: {} };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    const key = String(flag).replace(/^--/, '');
    if (['as', 'title', 'page', 'result'].includes(key)) {
      const at = String(value).indexOf('=');
      if (at < 1) throw new Error(`${flag} ${value}: expected <name>=<value>`);
      out[key][value.slice(0, at)] = value.slice(at + 1);
    } else out[key] = value;
  }
  return out;
}

export function vendor({ commit, fileBytes, as = {}, title = {}, page = {}, result = {} }) {
  const problems = [];
  const map = JSON.parse(fileBytes);
  const unknown = (object, kind, where) => {
    if (object === null || typeof object !== 'object') return;
    for (const key of Object.keys(object)) if (!KNOWN[kind].includes(key)) problems.push(`${where}: unknown field ${key}`);
  };
  if (!HEX40.test(commit ?? '')) problems.push('--commit: not a 40-hex commit');
  if (map.format !== 'odin-fit-map' || map.version !== 1) problems.push('not odin-fit-map v1');
  if (JSON.stringify(map.verdict_words) !== JSON.stringify(VERDICT_WORDS)) problems.push(`verdict_words: not exactly ${VERDICT_WORDS.join(', ')}`);
  unknown(map, 'top', '/');
  const names = (map.labs ?? []).map(lab => lab.lab);
  for (const flag of ['as', 'title', 'page']) for (const name of Object.keys({ as, title, page }[flag])) if (!names.includes(name)) problems.push(`--${flag} ${name}: the fit map has no such lab`);
  for (const key of Object.keys(result)) {
    const [name, scenario] = key.split('/');
    if (!(map.labs ?? []).some(lab => lab.lab === name && lab.cells.some(cell => cell.scenario === scenario))) problems.push(`--result ${key}: the fit map has no such cell`);
  }
  const labs = (map.labs ?? []).map((lab, i) => {
    const at = `/labs/${i}`;
    unknown(lab, 'lab', at);
    unknown(lab.published, 'published', `${at}/published`);
    unknown(lab.prereg, 'prereg', `${at}/prereg`);
    unknown(lab.design, 'design', `${at}/design`);
    if (!as[lab.lab]) problems.push(`${at}: no --as for ${lab.lab}`);
    if (!title[lab.lab]) problems.push(`${at}: no --title for ${lab.lab}`);
    const source = lab.prereg ?? lab.design;
    if (!source) problems.push(`${at}: neither a pre-registration nor a design`);
    else if (!['main', 'work-branch'].includes(source.status)) problems.push(`${at}: record status ${JSON.stringify(source.status)} is neither main nor work-branch`);
    let published = null;
    if (lab.published) {
      const pr = Number(String(lab.published.how ?? '').match(/\bPR #(\d+)\b/)?.[1]);
      if (!HEX40.test(lab.published.odin_rnd ?? '') || !pr) problems.push(`${at}/published: no odin-rnd commit or no "PR #n" in its note`);
      published = { commit: lab.published.odin_rnd, pr };
    }
    const cells = (lab.cells ?? []).map((cell, j) => {
      unknown(cell, 'cell', `${at}/cells/${j}`);
      if (cell.verdict !== null && !VERDICT_WORDS.includes(cell.verdict)) problems.push(`${at}/cells/${j}/verdict: ${JSON.stringify(cell.verdict)} is not a verdict word`);
      const link = result[`${lab.lab}/${cell.scenario}`] ?? null;
      if (cell.verdict !== null && !link) problems.push(`${at}/cells/${j}: a verdict without --result for ${lab.lab}/${cell.scenario}`);
      if (cell.verdict === null && link) problems.push(`${at}/cells/${j}: --result for a cell with no verdict`);
      const predictions = {};
      for (const [key, value] of Object.entries(cell.predictions ?? {})) {
        if (!(key in PREDICTOR_KEYS)) problems.push(`${at}/cells/${j}/predictions: unknown predictor ${key}`);
        else predictions[PREDICTOR_KEYS[key]] = value;
      }
      return { scenario: cell.scenario, what: cell.what, verdict: cell.verdict, result: link, predictions };
    });
    return {
      lab: as[lab.lab], title: title[lab.lab], stage: lab.stage, page: page[lab.lab] ?? null, published,
      record: { kind: lab.prereg ? 'pre-registration' : 'design', commit: source?.commit, status: source?.status, sha256: source?.sha256 ?? null },
      cells,
    };
  });
  if (problems.length) throw new Error(`vendor-fit-map refused:\n  ${problems.join('\n  ')}`);
  const record = {
    format: map.format,
    version: map.version,
    vendored: {
      from: 'the lab\'s own fit map, kept in the agent space\'s private repository',
      commit,
      sourceSha256: sha256(fileBytes),
      builtAtCommit: map.built_at_commit,
      transform: map.labs.map(lab => ({ lab: lab.lab, as: as[lab.lab], title: title[lab.lab], page: page[lab.lab] ?? null })),
      renamed: Object.entries(PREDICTOR_KEYS).filter(([from]) => map.labs.some(lab => lab.cells.some(cell => from in (cell.predictions ?? {}))))
        .map(([from, to]) => ({ field: 'predictions', fromSha256: sha256(from), to })),
      reworded: String(map.rule).includes('RESULT.json') ? [{ field: 'rule', fromSha256: sha256('RESULT.json'), to: 'result record' }] : [],
      kept: 'the question, the rule, the verdict words and, per lab, its stage, its record\'s commit, status and sha256, and every cell\'s scenario, verdict and predictions',
      leftOut: 'Left out: every path into the private repository, and the note on who posted a publication',
    },
    question: map.question,
    // The rule names the result's file; a file name is never published, so it is said in words (recorded in `reworded`).
    rule: String(map.rule).replace(/\bRESULT\.json\b/g, 'result record'),
    verdictWords: map.verdict_words,
    labs,
  };
  return record;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  const record = vendor({ commit: a.commit, fileBytes: readFileSync(a.file), as: a.as, title: a.title, page: a.page, result: a.result });
  const out = `${JSON.stringify(record, null, 1)}\n`;
  if (a['pin-out']) writeFileSync(a['pin-out'], `${JSON.stringify(pinFor(Buffer.from(out), record), null, 1)}\n`);
  process.stdout.write(out);
}
