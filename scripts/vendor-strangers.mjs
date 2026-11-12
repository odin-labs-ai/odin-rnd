// Vendors Lab 12, "How many strangers can the space hold?", into site/data/labs/strangers/record.json (and its one-line
// sha256 pin), from two sources kept apart:
//   - THE ESTIMATE: the public demo's capacity sheet in the agent space's private repository, read at its main, with
//     its run 3 result file. Its numbers were measured on another machine (a shared Windows PC), so for the space as it
//     would be hosted they are an estimate, and the page says so in the kit's estimate box. Its headline figures (the
//     recommended cap, the cap on a dedicated core, where it breaks, where it is unusable, the wire bandwidth estimate)
//     are read from the sheet's own sentences, and its rows from its run 3 file, never typed by hand.
//   - THE MEASUREMENT: one fresh run of the load tool, from a copy checked against that main, on a Mac, isolated: a copy of
//     the code taken with git archive, a scratch Python environment, its own free loopback ports and its own run
//     folder, stopping only the processes it started. Its rows come from the run's result file; the result file itself
//     is not published (it names local paths and ports), only its sha256. The listener lists taken before, during and
//     after the run are reduced to counts here: no port, address or process name reaches the record.
//
//   node scripts/vendor-strangers.mjs --fetch <dir> --space <git dir> --repo <owner/name> --tree <archived copy> \
//        --run <run folder> --meta <meta file> --before <listeners> --during <listeners> --after <listeners> \
//        --python <python of the run> --cite <sha>=<what it changed> ... --file <role>=<path> ...
//        (roles: sheet, tool, perf, estimate-run; reads the main head from GitHub; refuses a cited commit that is not
//        part of it, a file whose last change at main is not a cited commit, and a copy whose tool or perf log is not
//        main's bytes; re-summarises the run from its own files and refuses a summary that differs; the repository,
//        its paths, the run and <dir> are private and never committed)
//   node scripts/vendor-strangers.mjs --from <dir>                       (writes the record and its pin)
//   node scripts/vendor-strangers.mjs --verify --from <dir>              (refuses unless the record is the same bytes)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const OUT_FILE = 'site/data/labs/strangers/record.json';
export const PIN_FILE = 'site/data/labs/strangers/record.sha256';
export const GIT_ROLES = ['sheet', 'tool', 'perf', 'estimate-run'];
export const ROLE_WORDS = {
  sheet: 'the public demo\'s capacity sheet',
  tool: 'the load tool, which starts the space, ramps the guests in and summarises each step',
  perf: 'the space\'s own loop log, which times each tick, step and push',
  'estimate-run': 'the capacity sheet\'s run 3 result file',
  run: 'this lab\'s own run, its result file (not published: it names local paths and ports)',
};
const at = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

/** One step of a run, as the page shows it, from the load tool's own summary row. */
export function rowOf(s) {
  return {
    guests: s.guests, windowS: s.window_s, ticks: s.tick_ms.n,
    samples: { tick: s.tick_ms.n, step: s.step_ms.n, crowd: s.crowd_ms.n, lag: s.loop_lag_ms.n, move: s.rtt_ms.move?.n ?? 0, cpu: s.host_cpu_pct.n },
    tickP95: r2(s.tick_ms.p95), stepP95: r2(s.step_ms.p95), crowdP95: r2(s.crowd_ms.p95),
    lagP50: r1(s.loop_lag_ms.p50), lagP95: r1(s.loop_lag_ms.p95),
    pushesPerGuest: s.states_per_s_per_guest, moveP95: r1(s.rtt_ms.move.p95),
    hostCpu: r1(s.host_cpu_pct.mean), cpuPerPush: r2(s.host_cpu_ms_per_push), rssMb: Math.round(s.host_rss_mb.mean),
    machineCpu: r1(s.machine_cpu_pct.mean), downPerGuest: s.guest_in_bytes_per_s,
  };
}

/** The sheet's headline figures, read from its own sentences; throws when one is not where it was. */
export function sheetFigures(text) {
  const grab = (re, what) => { const m = re.exec(text); if (!m) throw new Error(`the sheet no longer says ${what}`); return m.slice(1).map(Number); };
  const [tick] = grab(/\| \*\*Tick p95 under 50 ms\*\*[^|]*\| \*\*(\d+)\*\*/, 'where the tick p95 stays under 50 ms');
  const [smooth] = grab(/\| \*\*Smooth\*\*[^|]*\| \*\*(\d+)\*\*/, 'where it is smooth');
  const [breaks] = grab(/\| \*\*Breaks\*\*[^|]*\| \*\*(\d+)\*\*/, 'where it breaks');
  const [unusable] = grab(/\| \*\*Unusable\*\*[^|]*\| \*\*(\d+)\*\*/, 'where it is unusable');
  const [cap, dedicated] = grab(/\| \*\*Recommended public cap\*\* \| \*\*keep (\d+)\*\*[^|]*?at most \*\*(\d+)\*\* on a dedicated core/, 'its recommended cap');
  const [low, high] = grab(/about \*\*(\d+)-(\d+) KiB\/s per guest\*\*/, 'its wire bandwidth estimate');
  return { tick, smooth, breaks, unusable, cap, dedicated, low, high };
}

// The folders of the private repository the run's copy was taken from (git archive), all of them checked against main.
export const CODE_PATHS = ['clients', 'contracts', 'conftest.py', 'engine', 'games', 'tools'];
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const walk = (root, rel = '') => readdirSync(join(root, rel), { withFileTypes: true }).flatMap(e => {
  const p = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? walk(root, p) : [p];
});
// Bytecode Python wrote into the copy while the run imported it is not part of main, and Python would run a cached file
// in place of its source; so each one must be exactly its own source compiled again by the run's Python (marshal bytes
// after the 16-byte header), or it is refused. The tree is passed as an argument, never into the source (rule 13).
export const PYC_CHECK = [
  'import importlib.util, marshal, os, sys, json',
  'tree, good = sys.argv[1], []',
  'for d, _, fs in os.walk(tree):',
  '    if os.path.basename(d) != "__pycache__": continue',
  '    for f in fs:',
  '        p = os.path.join(d, f)',
  '        try: src = importlib.util.source_from_cache(p)',
  '        except ValueError: continue',
  '        data = open(p, "rb").read()',
  '        if not os.path.exists(src) or data[:4] != importlib.util.MAGIC_NUMBER: continue',
  // held in a name, as importlib holds it when it writes the cache: marshal marks objects by their reference count
  '        code = compile(open(src, "rb").read(), src, "exec", dont_inherit=True)',
  '        if marshal.dumps(code) == data[16:]: good.append(os.path.relpath(p, tree).replace(os.sep, "/"))',
  'print(json.dumps(good))',
].join('\n');

/** Why a copy is not main's code (empty when it is), from `git ls-tree -r` of main over CODE_PATHS; and its identity. */
export function treeCheck(tree, lsTree, read = p => (lstatSync(join(tree, p)).isSymbolicLink() ? Buffer.from(readlinkSync(join(tree, p))) : readFileSync(join(tree, p))), list = () => walk(tree), compiled = new Set()) {
  // A submodule entry (type commit) carries no bytes and is not archived; every blob, symbolic links included, is checked.
  const want = new Map(lsTree.split('\n').filter(Boolean).map(l => { const [meta, path] = l.split('\t'); return [path, meta.split(' ')]; }).filter(([, m]) => m[1] === 'blob').map(([path, m]) => [path, m[2]]));
  const problems = [];
  const have = list().filter(p => CODE_PATHS.some(c => p === c || p.startsWith(`${c}/`)));
  for (const p of have) {
    if (want.has(p)) { if (blobSha(read(p)) !== want.get(p)) problems.push(`${p}: not main's bytes`); }
    else if (!compiled.has(p)) problems.push(`${p}: not in main${/\.pyc$/.test(p) ? ', and not its own source compiled again' : ''}`);
  }
  const seen = new Set(have);
  for (const p of want.keys()) if (!seen.has(p)) problems.push(`${p}: missing from the copy`);
  const digest = createHash('sha256').update([...want].sort(([x], [y]) => (x < y ? -1 : 1)).map(([p, b]) => `${b} ${p}\n`).join('')).digest('hex');
  return { problems, files: want.size, digest, compiled: have.filter(p => !want.has(p) && compiled.has(p)).length };
}

/** Whether the run's own tenant root says its templates were read from this copy (real paths compared). */
export function templatesFromCopy(run, tree) {
  try { return realpathSync(readFileSync(join(run, 'root', 'templates.dir'), 'utf8').trim()) === realpathSync(join(tree, 'games', 'agent_space', 'templates')); } catch { return false; }
}

/** A listener list ("<command> <pid> <address>" per line) as rows. */
export const listeners = text => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [cmd, pid, addr] = l.split(/\s+/); return { cmd, pid, addr, line: l }; });

/** The isolation proof as counts: the run's own listeners, and what the rest of the machine did meanwhile. */
export function isolationOf({ before, during, after, left }) {
  const b = listeners(before), d = listeners(during), a = listeners(after);
  const pids = new Set(d.map(x => x.pid)), addrs = new Set(d.map(x => x.addr));
  const own = x => pids.has(x.pid) || addrs.has(x.addr);
  const bl = new Set(b.map(x => x.line)), al = new Set(a.map(x => x.line));
  return {
    ownListenersDuring: d.length,
    ownListenersLoopback: d.filter(x => /^127\.0\.0\.1:\d+$/.test(x.addr)).length,
    ownListenersBefore: b.filter(own).length,
    ownListenersAfter: a.filter(own).length,
    ownProcessesLeft: left,
    listenersBefore: b.length,
    listenersAfter: a.length,
    keptByOthers: [...bl].filter(l => al.has(l)).length,
    changedByOthers: [...bl].filter(l => !al.has(l)).length + [...al].filter(l => !bl.has(l)).length,
  };
}

function fetch(into, a) {
  const dir = resolve(into);
  mkdirSync(join(dir, 'files'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', a.space, ...args], { maxBuffer: 1 << 27 });
  const main = execFileSync('gh', ['api', `repos/${a.repo}/commits/main`, '--jq', '.sha']).toString().trim();
  git('cat-file', '-e', `${main}^{commit}`);
  const cites = a.cite.map(spec => { const [sha, ...what] = spec.split('='); return { commit: git('rev-parse', `${sha}^{commit}`).toString().trim(), what: what.join('=') }; });
  if (cites.some(c => !c.what)) throw new Error('--cite <sha>=<what it changed>');
  for (const spec of a.file) {
    const [role, path] = spec.split('=');
    if (!GIT_ROLES.includes(role) || !path) throw new Error(`--file ${spec}: <role>=<path>, role one of ${GIT_ROLES.join(', ')}`);
    const bytes = git('show', `${main}:${path}`);
    const last = git('log', '-1', '--format=%H', main, '--', path).toString().trim();
    if (!cites.some(c => c.commit === last)) throw new Error(`--file ${role}: last changed at main by ${last.slice(0, 8)}, which is not cited`);
    // The code that ran must be main's: the tool and the loop log in the archived copy are main's very bytes.
    if (['tool', 'perf'].includes(role) && !bytes.equals(readFileSync(join(a.tree, path)))) throw new Error(`--tree: its ${role} is not the one at main`);
    writeFileSync(join(dir, 'files', role), bytes);
  }
  // The whole copy the run started from is main's, file for file: every path under the archived folders matches main's
  // blob (git's own object hash), none is missing, and nothing else is there but the bytecode Python wrote while it ran.
  const compiled = new Set(JSON.parse(execFileSync(a.python, ['-I', '-B', '-c', PYC_CHECK, a.tree], { maxBuffer: 1 << 26 }).toString()));
  const code = treeCheck(a.tree, git('ls-tree', '-r', '--full-tree', main, ...CODE_PATHS).toString(), undefined, undefined, compiled);
  if (code.problems.length) throw new Error(`--tree is not main's code:\n  ${code.problems.slice(0, 10).join('\n  ')}`);
  // What the run wrote names the copy: the tool derives the space's templates from its own location, and the run's own
  // tenant root records that path. This ties the run to the copy through its own records; it does not watch which code
  // the processes executed, and the page says so.
  if (!templatesFromCopy(a.run, a.tree)) throw new Error('--run did not read its templates from --tree');
  for (const c of cites) {
    c.at = git('show', '-s', '--format=%cI', c.commit).toString().trim();
    c.check = JSON.parse(execFileSync('gh', ['api', `repos/${a.repo}/compare/${c.commit}...${main}`, '--jq', '{status: .status, behind_by: .behind_by}']).toString());
  }
  // The run's result file, and the same summary computed again from the run's own files by the tool's resummarize.
  const result = join(a.run, 'public-load.json');
  copyFileSync(result, join(dir, 'files', 'run'));
  // resummarize reads the loop log and the swarm files beside the result, so it runs in a copy of exactly those files.
  const rerun = join(dir, 'rerun');
  mkdirSync(rerun, { recursive: true });
  for (const f of readdirSync(a.run)) if (f === 'host-perf.jsonl' || /^swarm-\d+\.jsonl$/.test(f)) copyFileSync(join(a.run, f), join(rerun, f));
  const again = join(rerun, 'public-load.json');
  copyFileSync(result, again);
  execFileSync(a.python, ['-I', join(a.tree, 'tools/scale/public_load.py'), 'resummarize', again], { cwd: a.tree, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const first = JSON.parse(readFileSync(result, 'utf8')), second = JSON.parse(readFileSync(again, 'utf8'));
  const resummarized = JSON.stringify([first.summary, first.verdict]) === JSON.stringify([second.summary, second.verdict]);
  const meta = readFileSync(a.meta, 'utf8');
  const field = (re, what) => { const m = re.exec(meta); if (!m) throw new Error(`--meta: no ${what}`); return m[1]; };
  const source = {
    main, committed: git('show', '-s', '--format=%cI', main).toString().trim(), checked: new Date().toISOString().slice(0, 10), cites,
    run: {
      start: field(/^start (\S+) load1=/m, 'start'), load1Start: Number(field(/^start \S+ load1=([\d.]+)/m, 'start load')),
      end: field(/^end (\S+) load1=/m, 'end'), load1End: Number(field(/^end \S+ load1=([\d.]+)/m, 'end load')),
      exit: Number(field(/^run_exit=(\d+)/m, 'run exit')), left: Number(field(/^leftover=\s*(\d+)/m, 'leftover count')),
      chip: field(/^(Apple M\S* ?\S*)$/m, 'chip'), cores: Number(field(/^(\d+)$/m, 'core count')),
      memGb: Math.round(Number(field(/^(\d{9,})$/m, 'memory')) / 2 ** 30),
      os: field(/^ProductVersion:\s+(\S+)/m, 'macOS version'), python: field(/^Python (\S+)/m, 'Python version'),
      websockets: field(/^websockets==(\S+)/m, 'websockets version'),
    },
    resummarized,
    code: { paths: CODE_PATHS, files: code.files, digest: code.digest, compiled: code.compiled, templatesFromCopy: true },
    isolation: isolationOf({ before: readFileSync(a.before, 'utf8'), during: readFileSync(a.during, 'utf8'), after: readFileSync(a.after, 'utf8'), left: Number(field(/^leftover=\s*(\d+)/m, 'leftover count')) }),
  };
  writeFileSync(join(dir, 'source.json'), JSON.stringify(source, null, 1) + '\n');
}

const PROBES = ['flood', 'oversized_line', 'forged_evidence', 'operator_ops', 'oversized_frame'];

export function build(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'));
  const bytes = role => readFileSync(join(dir, 'files', role));
  for (const c of source.cites) if (c.check.behind_by !== 0) throw new Error(`${c.commit.slice(0, 8)} is not part of main`);
  const sheet = sheetFigures(bytes('sheet').toString());
  const est = JSON.parse(bytes('estimate-run'));
  const run = JSON.parse(bytes('run'));
  if (source.run.exit !== 0) throw new Error('the run did not exit cleanly; nothing is recorded');
  if (!source.resummarized) throw new Error('the run\'s summary is not what its own files give again');
  if (run.browsers !== 0) throw new Error('the run started browsers; this page reports a run without them');
  // One probe round per step of the ramp, found by that step's own name; a round missing a probe counts for none of it.
  const steps = run.ramp.map(g => run.probes[`${g} guests`]).filter(s => s && PROBES.every(p => typeof s[p]?.held === 'boolean'));
  const held = Object.fromEntries(PROBES.map(p => [p, steps.filter(s => s[p].held === true).length]));
  return {
    format: 'odin-lab-strangers',
    version: 1,
    vendored: {
      from: 'the public demo\'s capacity sheet and its load tool in the agent space\'s private repository, read at its main, and one run on a Mac from a copy of that main',
      commit: source.main,
      committed: at(source.committed),
      mainCheck: { main: source.main, how: 'GitHub compare of each cited commit against the private main head; behind by 0 means the commit is part of main', checked: source.checked, commits: source.cites.map(c => c.commit) },
      cites: source.cites.map(c => ({ commit: c.commit, what: c.what, at: at(c.at) })),
      files: [...GIT_ROLES, 'run'].map(role => ({ role, what: ROLE_WORDS[role], sha256: sha256(bytes(role)) })),
    },
    estimate: {
      machine: `a shared Windows PC with ${est.machine.cpus} logical cores and other work running on it (${Math.round(est.machine.baseline.machine_cpu_pct_mean)}% of its processor busy before the run)`,
      ramp: est.ramp, phaseS: est.phase_s, settleS: est.settle_s, crowdAgents: est.agents,
      recommendedCap: sheet.cap, dedicatedCoreCap: sheet.dedicated, breaksAt: sheet.breaks, unusableAt: sheet.unusable,
      wireKiBPerGuest: { low: sheet.low, high: sheet.high },
      rows: est.summary.map(rowOf),
      verdict: { tickUnder50: sheet.tick, smooth: sheet.smooth },
    },
    measurement: {
      at: at(source.run.start), endedAt: at(source.run.end), on: source.run.start.slice(0, 10),
      host: `a Mac with an ${source.run.chip} (${source.run.cores} cores, ${source.run.memGb} GB of memory), shared with other work while it ran`,
      os: `macOS ${source.run.os}`, python: source.run.python, websockets: source.run.websockets,
      load1Start: source.run.load1Start, load1End: source.run.load1End,
      machineCpuBefore: r1(run.machine.baseline.machine_cpu_pct_mean),
      ramp: run.ramp, phaseS: run.phase_s, settleS: run.settle_s, crowdAgents: run.agents, dutyPct: run.duty_pct, browsers: run.browsers,
      rows: run.summary.map(rowOf),
      verdict: { tickUnder50: run.verdict.max_guests_tick_p95_under_50ms, smooth: run.verdict.max_guests_smooth },
      resummarized: source.resummarized,
      code: { files: source.code.files, digest: source.code.digest, compiledCaches: source.code.compiled, matchesMain: true, templatesFromCopy: source.code.templatesFromCopy === true },
      probes: { steps: steps.length, held },
      quota: { checks: run.quota.checks, mostInTenMinutes: run.quota.most_in_10_min, limit: 3, held: run.quota.held === true },
      isolation: source.isolation,
    },
  };
}

export const serialise = record => `${JSON.stringify(record, null, 1)}\n`;

function main(argv) {
  const a = { file: [], cite: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'verify') a.flags.add(k); else if (k === 'file' || k === 'cite') a[k].push(argv[++i]); else a[k] = argv[++i];
  }
  if (a.fetch) return fetch(a.fetch, a);
  if (!a.from) throw new Error('usage: --fetch <dir> ... | --from <dir> [--verify]');
  const text = serialise(build(a.from));
  if (a.flags.has('verify')) {
    if (readFileSync(OUT_FILE, 'utf8') !== text) throw new Error(`${OUT_FILE} is not what --from ${a.from} gives`);
    return console.log('verified: the committed record is the same bytes');
  }
  mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
  writeFileSync(OUT_FILE, text);
  writeFileSync(PIN_FILE, `${sha256(text)}  record.json\n`);
  console.log(`wrote ${OUT_FILE} and ${PIN_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
