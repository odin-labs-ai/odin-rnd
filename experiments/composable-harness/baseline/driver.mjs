// Executed under tsx by run-baseline.mjs. Imports the REAL extension filter and proven-core floor from two
// detached odin-suite worktrees (pre-floor pin and current pin), unchanged, and applies the filter to every
// corpus config. Real extension names exist only in memory here: synthetic floor slots are mapped by position
// (core-NN -> pre floor[NN-1]; q, q-release, q-resume -> the three entries the current floor appends), and the
// output carries synthetic names only. Input: JSON configs on stdin. Output: JSON on stdout.
import { pathToFileURL } from 'node:url';

const [preWt, curWt] = process.argv.slice(2);
const mod = (wt, file) => import(pathToFileURL(`${wt}/odin-agent/src/config/${file}`).href);
const pins = {
  pre: { filter: await mod(preWt, 'extension-filter.ts'), core: await mod(preWt, 'proven-core.ts') },
  current: { filter: await mod(curWt, 'extension-filter.ts'), core: await mod(curWt, 'proven-core.ts') },
};
const preFloor = [...pins.pre.core.PROVEN_CORE_EXTENSIONS];
const curFloor = [...pins.current.core.PROVEN_CORE_EXTENSIONS];
if (preFloor.length !== 25 || curFloor.length !== 28 || preFloor.some((n, i) => curFloor[i] !== n)) {
  throw new Error(`floor shape changed: pre ${preFloor.length}, current ${curFloor.length}`);
}

const toReal = new Map();
preFloor.forEach((real, i) => toReal.set(`core-${String(i + 1).padStart(2, '0')}`, real));
['q', 'q-release', 'q-resume'].forEach((s, i) => toReal.set(s, curFloor[25 + i]));
const toSynth = new Map([...toReal].map(([s, r]) => [r, s]));
const real = s => {
  if (toReal.has(s)) return toReal.get(s);
  if (curFloor.includes(s)) throw new Error(`a synthetic name collides with a real floor entry`);
  return s;
};
const synth = r => toSynth.get(r) ?? r;

const configs = JSON.parse(await new Promise(resolve => {
  let s = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { s += d; }); process.stdin.on('end', () => resolve(s));
}));

// Every console channel the filter could use to say something is captured during the call.
function captured(fn) {
  const diagnostics = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    saved[level] = console[level];
    console[level] = (...args) => diagnostics.push({ level, text: args.map(String).join(' ') });
  }
  const savedEmit = process.emitWarning;
  process.emitWarning = w => diagnostics.push({ level: 'process-warning', text: String(w) });
  try { return { value: fn(), diagnostics }; }
  finally { Object.assign(console, saved); process.emitWarning = savedEmit; }
}

const rows = configs.map(cfg => {
  const { filter } = pins[cfg.floorEpoch];
  const extensions = cfg.registry.map(p => ({ name: real(p.name), factory: null }));
  const profile = cfg.profile === null ? null : { enabledExtensions: cfg.profile.enabledExtensions.map(real) };
  const { value, diagnostics } = captured(() => filter.filterExtensionsAgainstProfile(extensions, profile));
  const retained = value.map(e => synth(e.name));
  return {
    id: cfg.id,
    floorEpoch: cfg.floorEpoch,
    retained,
    dropped: cfg.registry.map(p => p.name).filter(n => !retained.includes(n)),
    // A diagnostic text could carry a real name; only its level and a synthetic-mapped text are kept.
    diagnostics: diagnostics.map(d => ({ level: d.level, text: d.text.split(/(\s+)/).map(synth).join('') })),
  };
});
process.stdout.write(JSON.stringify(rows));
