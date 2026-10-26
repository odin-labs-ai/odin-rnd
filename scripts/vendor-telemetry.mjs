// Vendors the agent space's odin-telemetry v1 pack into site/data/labs/agent-space/telemetry.json (Lab 01, mission
// rnd-labs-human-first-1024). The pack, its session record and its claims table live in a private repository; this
// script is the one way they become public, so re-running it on the same three files at the same commit gives the
// committed file byte for byte.
//
//   node scripts/vendor-telemetry.mjs --commit <40-hex> --pack <odin-telemetry-v1.json> --session <session.json> \
//     --claims <claims table .md> --ancestry <ancestry.json> [--pin <claim>=<40-hex> --pin-how <claim>=<how>]... \
//     [--omit <claim>=<why>]... > site/data/labs/agent-space/telemetry.json
//   node scripts/vendor-telemetry.mjs --verify site/data/labs/agent-space/telemetry.json --pack ... --session ... --claims ... --ancestry ...
//
// The pack, the session record and the claims table are private, so the site's build cannot read them: it checks the
// committed file is consistent with itself (scripts/lab-telemetry.mjs), not that it came from them. That second check
// is --verify: given the three private files (fetched at vendored.commit by anyone with access) and the ancestry
// record, it vendors them again with the committed file's own pins and omissions and refuses unless the result is the
// committed file, field for field. The ancestry record is GitHub's compare of each figure's commit against the private
// main head ({ "main": <40-hex>, "how": <text>, "checked": <date>, "commits": { <commit>: { "status", "behind_by" } } },
// from GET /repos/<owner>/<repo>/compare/<commit>...<main>); a figure is "in the main build" only when that compare
// says its commit is behind_by 0 (an ancestor of main), never because its claims row says MAIN.
//
// What it changes, and nothing else:
// - the session's run id and every private path are dropped (agent_space.source.file and .lens_run,
//   engine[].source.claims_file); the session's question rows are copied in unchanged, so the build can recompute
//   every session figure from them (scripts/lab-telemetry.mjs);
// - each engine figure must be its claims row: every word and number of its value appears in the row's claim, and
//   its commit in the row's source, or it is refused;
// - each engine figure gets the status its claims row gives (MAIN = in the main build, LANE = a work branch); a MAIN
//   figure must also be an ancestor of the private main head by the ancestry record, which is recorded with it; a
//   figure whose commit is a branch name gets the commit given by --pin, or null when none is known yet; a pin must
//   say how its commit was found (--pin-how), and the page shows that next to it (`vendored.pinned`);
// - a figure named by --omit is left out, and the page says which one and why (`vendored.omitted`);
// - the pack, session record and claims table are recorded by sha256, and `figuresSha256` digests the public engine
//   figures so a hand edit of a value is refused at build.
// It refuses, every reason listed, when the session record is not the one the pack names (sha256), when the pack's
// session figures are not what the rows give, or when a claims row is missing or has no status.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, figuresDigest, sessionFromRows } from './lab-telemetry.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;

function args(argv) {
  const out = { pin: {}, 'pin-how': {}, omit: {} };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === '--pin' || flag === '--pin-how' || flag === '--omit') { const [claim, ...rest] = String(value).split('='); out[flag.slice(2)][claim] = rest.join('='); }
    else out[flag.replace(/^--/, '')] = value;
  }
  return out;
}

/** A claims row: its claim text, its status ("main" or "work-branch", null for any other label), its status cell and its source cell. */
export function claimRow(table, row) {
  const line = table.split('\n').find(l => new RegExp(`^\\|\\s*${String(row).replace(/[^a-z0-9]/gi, '')}\\s*\\|`).test(l));
  if (!line) return null;
  const [, , claim = '', status = '', source = ''] = line.split('|').map(cell => cell.trim());
  return { claim, source, statusCell: status, status: /^MAIN\b/.test(status) ? 'main' : /^LANE\b/.test(status) ? 'work-branch' : null };
}

/** The commits a figure's source names: the numbers' commit, and when the pack gives them the code measured and the merge into main. */
const COMMIT_FIELDS = ['commit', 'code_commit', 'merge'];
const commitsOf = source => COMMIT_FIELDS.map(k => source[k]).filter(c => /^[0-9a-f]{7,40}$/.test(c ?? ''));
// A claims row writes commits short (8 hex): a figure's commit is in the row when the row holds a 7+ hex prefix of it.
const rowHasCommit = (text, commit) => [...text.matchAll(/\b[0-9a-f]{7,40}\b/g)].some(([hex]) => commit.startsWith(hex) || hex.startsWith(commit));

// The words and numbers of a value, the way they are compared with its claims row: lowercase, thousands commas and
// arrows dropped ("1,867 passed" -> "1867", "passed"; "45.6 -> 1.0" -> "45.6", "1.0").
const tokens = text => text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/->|→/g, ' ').split(/[\s;()]+/)
  .map(t => t.replace(/^["'.,:]+|["'.,:]+$/g, '')).filter(t => t && t !== 'vs' && t !== '/');
/** Why a figure is not its claims row: a word or number of its value missing from the claim, or its commit missing from the source. */
export function figureVsRow(figure, row) {
  const problems = [], claim = new Set(tokens(row.claim));
  for (const t of tokens(figure.value)) if (!claim.has(t)) problems.push(`claim ${figure.claim}: "${t}" of its value "${figure.value}" is not in its claims row`);
  for (const field of COMMIT_FIELDS) {
    const c = figure.source[field];
    if (/^[0-9a-f]{7,40}$/.test(c ?? '') && !rowHasCommit(`${row.statusCell ?? ''} ${row.source}`, c)) problems.push(`claim ${figure.claim}: its ${field === 'commit' ? 'commit' : field.replace('_', ' ')} ${c} is not in its claims row`);
  }
  return problems;
}

export function vendor({ commit, packBytes, sessionBytes, claimsBytes, ancestry, pin = {}, pinHow = {}, omit = {} }) {
  const problems = [];
  const pack = JSON.parse(packBytes), session = JSON.parse(sessionBytes), claims = claimsBytes.toString('utf8');
  if (!HEX40.test(commit ?? '')) problems.push('--commit: not a 40-hex commit');
  if (!HEX40.test(ancestry?.main ?? '') || !(ancestry?.how ?? '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(ancestry?.checked ?? '') || typeof ancestry?.commits !== 'object') problems.push('--ancestry: needs main (40-hex), how, checked (a date) and commits');
  const sessionSha256 = sha256(sessionBytes);
  if (pack.agent_space.source.sha256 !== sessionSha256) problems.push(`the session record is not the one the pack names (${sessionSha256} vs ${pack.agent_space.source.sha256})`);
  const fromRows = sessionFromRows(session.rows, Object.keys(pack.agent_space.per_agent));
  if (canonicalJson(fromRows.per_agent) !== canonicalJson(pack.agent_space.per_agent)) problems.push('the pack\'s per-agent figures are not what the session rows give');
  if (fromRows.ok_rate !== pack.agent_space.ok_rate) problems.push(`the pack's ok_rate ${pack.agent_space.ok_rate} is not the rows' ${fromRows.ok_rate}`);
  for (const claim of Object.keys(pin)) {
    if (!HEX40.test(pin[claim])) problems.push(`--pin ${claim}: not a 40-hex commit`);
    if (!(pinHow[claim] ?? '').trim()) problems.push(`--pin ${claim}: no --pin-how saying how the commit was found`);
  }
  for (const claim of Object.keys(omit)) if (!pack.engine.some(f => String(f.claim) === claim)) problems.push(`--omit ${claim}: the pack has no such figure`);
  const engine = pack.engine.filter(f => !(String(f.claim) in omit)).map(({ source: { claims_file, row, commit: c, status: packStatus, code_commit, merge, note }, ...figure }) => {
    const claimsRow = claimRow(claims, row);
    const status = claimsRow?.status ?? null;
    if (!status) problems.push(`claims row ${row}: missing, or its status is neither MAIN nor LANE`);
    if (packStatus !== undefined && packStatus !== status) problems.push(`claim ${figure.claim}: the pack says ${packStatus}, its claims row says ${status}`);
    const pinned = HEX40.test(pin[String(figure.claim)] ?? '') ? pin[String(figure.claim)] : null;
    const source = { row, status, commit: /^[0-9a-f]{7,40}$/.test(c) ? c : pinned };
    // A code commit or merge enters the source only once it is a 40-hex commit; anything else is refused, never copied.
    for (const [key, value] of Object.entries({ code_commit, merge })) if (value !== undefined) {
      if (HEX40.test(value)) source[key] = value;
      else problems.push(`claim ${figure.claim}: its ${key.replace('_', ' ')} ${JSON.stringify(value)} is not a 40-hex commit`);
    }
    if (note !== undefined) source.note = note;
    if (claimsRow) problems.push(...figureVsRow({ ...figure, source }, claimsRow));
    if (status === 'main') {
      // Every commit the figure names (the numbers, the code measured, the merge) must be an ancestor of main.
      const named = commitsOf(source);
      const off = named.filter(commit => { const seen = ancestry?.commits?.[commit]; return !seen || seen.behind_by !== 0 || !['ahead', 'identical'].includes(seen.status); });
      if (!named.length || off.length) problems.push(`claim ${figure.claim}: its claims row says MAIN, but the ancestry record does not show commit ${(off.length ? off : [source.commit]).join(', ')} as an ancestor of main ${ancestry?.main}`);
      else source.onMain = ancestry.main;
    }
    return { ...figure, source };
  });
  if (problems.length) throw new Error(`vendor-telemetry refused:\n  ${problems.join('\n  ')}`);
  const { source: { file: _f, lens_run: _l, ...source }, ...space } = pack.agent_space;
  return {
    format: pack.format,
    version: pack.version,
    vendored: {
      from: 'the agent space\'s own telemetry pack, kept in its private repository',
      commit,
      packSha256: sha256(packBytes),
      packBuiltAtCommit: pack.built_at_commit,
      claimsSha256: sha256(claimsBytes),
      figuresSha256: figuresDigest(engine),
      mainCheck: { main: ancestry.main, how: ancestry.how, checked: ancestry.checked },
      pinned: Object.keys(pin).map(claim => ({ claim, commit: pin[claim], how: pinHow[claim] })),
      omitted: Object.entries(omit).map(([claim, why]) => ({ claim, why })),
      kept: 'rule, agent_space and engine, and the session\'s question rows; each engine figure\'s status from its claims row',
      leftOut: 'the benchmark rows (they belong to the brain benchmark lab), the session\'s run id (run ids are never published) and every private path',
    },
    rule: pack.rule,
    agent_space: { ...space, source: { record: 'the session record', ...source }, rows: session.rows },
    engine,
  };
}

/** Vendor the private files again with the committed record's own commit, pins and omissions; the fields that differ. */
export function verify(record, { packBytes, sessionBytes, claimsBytes, ancestry }) {
  const pin = Object.fromEntries(record.vendored.pinned.map(p => [p.claim, p.commit])), pinHow = Object.fromEntries(record.vendored.pinned.map(p => [p.claim, p.how]));
  const omit = Object.fromEntries(record.vendored.omitted.map(o => [o.claim, o.why]));
  const again = vendor({ commit: record.vendored.commit, packBytes, sessionBytes, claimsBytes, ancestry, pin, pinHow, omit });
  const differ = [];
  (function walk(a, b, at) {
    if (canonicalJson(a) === canonicalJson(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${at}/${k}`); }
    else differ.push(`${at || '/'}: committed ${JSON.stringify(a)}, the private files give ${JSON.stringify(b)}`);
  })(record, again, '');
  return differ;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const inputs = { packBytes: readFileSync(a.pack), sessionBytes: readFileSync(a.session), claimsBytes: readFileSync(a.claims), ancestry: JSON.parse(readFileSync(a.ancestry, 'utf8')) };
  if (a.verify) {
    const differ = verify(JSON.parse(readFileSync(a.verify, 'utf8')), inputs);
    if (differ.length) { console.error(`NOT VERIFIED: ${a.verify} is not what the private files give:\n  ${differ.join('\n  ')}`); process.exit(1); }
    console.log(`VERIFIED: ${a.verify} is exactly what the private pack, session record and claims table give at its commit.`);
  } else {
    process.stdout.write(`${JSON.stringify(vendor({ commit: a.commit, ...inputs, pin: a.pin, pinHow: a['pin-how'], omit: a.omit }), null, 1)}\n`);
  }
}
