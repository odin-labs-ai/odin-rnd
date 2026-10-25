// Vendors the agent space's odin-telemetry v1 pack into site/data/labs/agent-space/telemetry.json (Lab 01, mission
// rnd-labs-human-first-1024). The pack, its session record and its claims table live in a private repository; this
// script is the one way they become public, so re-running it on the same three files at the same commit gives the
// committed file byte for byte.
//
//   node scripts/vendor-telemetry.mjs --commit <40-hex> --pack <odin-telemetry-v1.json> --session <session.json> \
//     --claims <claims table .md> [--pin <claim>=<40-hex> --pin-how <claim>=<how>]... [--omit <claim>=<why>]... > site/data/labs/agent-space/telemetry.json
//
// What it changes, and nothing else:
// - the session's run id and every private path are dropped (agent_space.source.file and .lens_run,
//   engine[].source.claims_file); the session's question rows are copied in unchanged, so the build can recompute
//   every session figure from them (scripts/lab-telemetry.mjs);
// - each engine figure gets the status its claims row gives (MAIN = in the main build, LANE = a work branch); a
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

/** The status column of a claims row: "main" or "work-branch". */
function claimStatus(table, row) {
  const line = table.split('\n').find(l => new RegExp(`^\\|\\s*${String(row).replace(/[^a-z0-9]/gi, '')}\\s*\\|`).test(l));
  if (!line) return null;
  const status = line.split('|')[3]?.trim() ?? '';
  if (/^MAIN\b/.test(status)) return 'main';
  if (/^LANE\b/.test(status)) return 'work-branch';
  return null;
}

export function vendor({ commit, packBytes, sessionBytes, claimsBytes, pin = {}, pinHow = {}, omit = {} }) {
  const problems = [];
  const pack = JSON.parse(packBytes), session = JSON.parse(sessionBytes), claims = claimsBytes.toString('utf8');
  if (!HEX40.test(commit ?? '')) problems.push('--commit: not a 40-hex commit');
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
  const engine = pack.engine.filter(f => !(String(f.claim) in omit)).map(({ source: { claims_file, row, commit: c }, ...figure }) => {
    const status = claimStatus(claims, row);
    if (!status) problems.push(`claims row ${row}: missing, or its status is neither MAIN nor LANE`);
    const pinned = HEX40.test(pin[String(figure.claim)] ?? '') ? pin[String(figure.claim)] : null;
    return { ...figure, source: { row, status, commit: /^[0-9a-f]{7,40}$/.test(c) ? c : pinned } };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const record = vendor({ commit: a.commit, packBytes: readFileSync(a.pack), sessionBytes: readFileSync(a.session), claimsBytes: readFileSync(a.claims), pin: a.pin, pinHow: a['pin-how'], omit: a.omit });
  process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}
