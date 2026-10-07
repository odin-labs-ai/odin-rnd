// Corpus generator: writes cfg-001..cfg-120.json + index.json. Plain Node, no deps.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261003);
const ri = (n) => Math.floor(rng() * n);
const pick = (a) => a[ri(a.length)];
const chance = (p) => rng() < p;
function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = ri(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const sample = (a, k) => shuffle(a).slice(0, Math.max(0, Math.min(k, a.length)));

const CORES = Array.from({ length: 25 }, (_, i) => `core-${String(i + 1).padStart(2, '0')}`);
const FLOOR_PRE = new Set(CORES);
const FLOOR_CURRENT = new Set([...CORES, 'q', 'q-release', 'q-resume']);
const WORDS = ['ledger', 'notes', 'palette', 'garden', 'harbor', 'lantern', 'meadow', 'orchard', 'pebble', 'quill',
  'saddle', 'timber', 'velvet', 'willow', 'basket', 'candle', 'glacier', 'hinge', 'kettle', 'ladder', 'mosaic',
  'needle', 'parcel', 'river', 'tablet', 'umbrella', 'valley', 'wagon', 'acorn', 'blanket', 'cabin', 'doorway',
  'fiddle', 'gravel', 'hammock', 'jacket', 'lemon', 'mitten', 'nutmeg', 'oyster', 'pillow', 'raisin', 'sparrow',
  'thimble', 'walnut'];
// Fixed small dependencies among core plugins (provider -> key -> consumer).
const CORE_DEPS = [
  ['core-02', 'store.read', 'core-05'],
  ['core-09', 'log.write', 'core-14'],
  ['core-20', 'clock.tick', 'core-21'],
];

function coreEntries(names) {
  const set = new Set(names);
  return names.map((n) => {
    const e = { name: n, needs: [], provides: [] };
    for (const [p, k, c] of CORE_DEPS) {
      if (p === n) e.provides.push(k);
      if (c === n && set.has(p)) e.needs.push(k);
    }
    return e;
  });
}
const Q_TRIO = () => [
  { name: 'q', needs: ['q.release', 'q.resume'], provides: [] },
  { name: 'q-release', needs: [], provides: ['q.release'] },
  { name: 'q-resume', needs: [], provides: ['q.resume'] },
];

// Build extras; each provides <word>.feed; optional chain dependency on an earlier extra or a core key.
function makeExtras(n, coreNames, { chainFrom = null } = {}) {
  const words = sample(WORDS, n);
  const out = [];
  const coreKeys = CORE_DEPS.filter(([p]) => coreNames.includes(p)).map(([, k]) => k);
  words.forEach((w, i) => {
    const e = { name: `x-${w}`, needs: [], provides: [`${w}.feed`] };
    if (i > 0 && chance(0.45)) e.needs.push(out[ri(i)].provides[0]);
    else if (coreKeys.length && chance(0.25)) e.needs.push(pick(coreKeys));
    out.push(e);
  });
  return out;
}

function baseRegistry({ full = true, withQ = true, nExtras = null } = {}) {
  const coreNames = full ? CORES : CORES.slice(0, 3 + ri(10)); // subset keeps first N cores
  const extras = makeExtras(nExtras ?? (full ? 2 + ri(9) : 2 + ri(4)), coreNames);
  const reg = [...coreEntries(coreNames), ...(withQ ? Q_TRIO() : []), ...extras];
  return reg;
}

// ---------- resolver ----------
export function resolve(cfg, withdrawn) {
  const names = cfg.registry.map((p) => p.name);
  const floor = cfg.floorEpoch === 'current' ? FLOOR_CURRENT : FLOOR_PRE;
  const listed = new Set(cfg.profile ? cfg.profile.enabledExtensions : []);
  const enabled = new Set(names.filter((n) => !withdrawn.has(n) && (cfg.profile === null || floor.has(n) || listed.has(n))));
  const providerOf = new Map();
  for (const p of cfg.registry) for (const k of p.provides) providerOf.set(k, p.name);
  const active = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of cfg.registry) {
      if (!enabled.has(p.name) || active.has(p.name)) continue;
      if (p.needs.every((k) => providerOf.has(k) && active.has(providerOf.get(k)))) { active.add(p.name); changed = true; }
    }
  }
  const st = {};
  for (const p of cfg.registry) {
    if (!enabled.has(p.name)) st[p.name] = 'excluded';
    else if (active.has(p.name)) st[p.name] = 'active';
    else {
      const miss = p.needs.filter((k) => !(providerOf.has(k) && active.has(providerOf.get(k)))).sort();
      st[p.name] = 'inactive: ' + [...new Set(miss)].map((k) => `missing ${k}`).join(', ');
    }
  }
  return st;
}
function finalWithdrawn(schedule) {
  const w = new Set();
  for (const ev of [...schedule].sort((a, b) => a.step - b.step)) {
    if (ev.op === 'withdraw') w.add(ev.name); else w.delete(ev.name);
  }
  return w;
}
const reg = (cfg, n) => cfg.registry.find((p) => p.name === n);
const providerName = (cfg, k) => cfg.registry.find((p) => p.provides.includes(k))?.name;
const activeNames = (cfg, st) => cfg.registry.map((p) => p.name).filter((n) => st[n] === 'active');

function typo(name) {
  const w = name.slice(2);
  const i = 1 + ri(w.length - 2);
  const v = chance(0.5) ? w.slice(0, i) + w.slice(i + 1) : w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
  return v === w ? 'x-' + w + 's' : 'x-' + v;
}
const coreTypo = () => { const n = 1 + ri(9); return `core-${n}`; }; // core-7 vs core-07

function extrasOf(r) { return r.filter((p) => p.name.startsWith('x-')); }
function fillIntended(cfg, st, must, extra = 3) {
  const others = activeNames(cfg, st).filter((n) => !must.includes(n));
  return [...new Set([...must, ...sample(others, ri(extra + 1))])];
}

// ---------- class builders: each returns a cfg (without id/expected) or null to retry ----------
const B = {};
B['floor-epoch-drop'] = (minimal) => {
  if (minimal) {
    const r = [...coreEntries(CORES), ...Q_TRIO()];
    const cfg = { floorEpoch: 'pre', registry: r, profile: { enabledExtensions: [] }, schedule: [] };
    cfg.intended = ['q', ...sample(CORES, 2)];
    cfg.note = 'Minimal incident shape: the old floor does not carry q, so the always-on plugin q is excluded.';
    return cfg;
  }
  const r = baseRegistry({ withQ: true });
  const ex = extrasOf(r).map((p) => p.name);
  const listed = [...sample(ex, 1 + ri(ex.length)), ...(chance(0.4) ? ['q-release', 'q-resume'] : [])];
  const cfg = { floorEpoch: 'pre', registry: r, profile: { enabledExtensions: listed }, schedule: [] };
  const st = resolve(cfg, new Set());
  cfg.intended = fillIntended(cfg, st, ['q']);
  cfg.note = 'q is meant to be always-on but the pre floor lacks it and the profile does not list it, so q is excluded.';
  return cfg;
};
B['missing-dependency-pair'] = () => {
  const v = ri(3);
  let r = baseRegistry({ withQ: true, full: chance(0.75) });
  const ex = extrasOf(r).map((p) => p.name);
  let cfg;
  if (v === 0) { // pre + profile lists q but not both helpers
    const helper = pick([[], ['q-release'], ['q-resume']]);
    cfg = { floorEpoch: 'pre', registry: r, profile: { enabledExtensions: ['q', ...helper, ...sample(ex, ri(3))] }, schedule: [] };
    cfg.note = 'The profile lists q on the pre floor but omits ' + (helper.length ? 'one of its helpers' : 'both helpers') + ', so q cannot get its keys.';
  } else if (v === 1) { // current epoch, one helper absent from the registry
    const gone = pick(['q-release', 'q-resume']);
    r = r.filter((p) => p.name !== gone);
    cfg = { floorEpoch: 'current', registry: r, profile: chance(0.5) ? null : { enabledExtensions: sample(ex, 1 + ri(2)) }, schedule: [] };
    cfg.note = `q is on the current floor but ${gone} is not registered, so one of its needs has no provider.`;
  } else { // null profile, both helpers absent
    r = r.filter((p) => p.name !== 'q-release' && p.name !== 'q-resume');
    cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: null, schedule: [] };
    cfg.note = 'Every plugin is enabled but neither q helper is registered, so q misses both keys.';
  }
  const st = resolve(cfg, new Set());
  cfg.intended = fillIntended(cfg, st, ['q']);
  return cfg;
};
B['missing-dependency'] = () => {
  const r = baseRegistry({ withQ: chance(0.6), full: chance(0.7) });
  const ex = extrasOf(r);
  const dep = ex.filter((p) => p.needs.some((k) => providerName({ registry: r }, k)?.startsWith('x-')));
  if (!dep.length) return null;
  const d = pick(dep);
  const k = d.needs[0];
  const prov = providerName({ registry: r }, k);
  let registry = r, listed;
  const exNames = ex.map((p) => p.name);
  if (chance(0.5)) { // provider registered but not enabled
    listed = [d.name, ...sample(exNames.filter((n) => n !== prov && n !== d.name), ri(3))];
  } else { // provider absent from registry
    registry = r.filter((p) => p.name !== prov);
    listed = [d.name, ...sample(exNames.filter((n) => n !== prov && n !== d.name), ri(3))];
  }
  const cfg = { floorEpoch: pick(['pre', 'current']), registry, profile: { enabledExtensions: listed }, schedule: [] };
  const st = resolve(cfg, new Set());
  if (st[d.name] === 'active') return null;
  // the provider of the first unmet key must be absent or excluded, and d must be inactive due to it
  cfg.intended = fillIntended(cfg, st, [d.name]);
  cfg.note = `${d.name} is enabled but no enabled plugin provides ${k}.`;
  return cfg;
};
B['transitive-missing'] = () => {
  const coreNames = chance(0.7) ? CORES : CORES.slice(0, 4 + ri(8));
  const words = sample(WORDS, 3 + ri(5));
  const [a, b, c] = words;
  const extras = [
    { name: `x-${c}`, needs: [], provides: [`${c}.feed`] },
    { name: `x-${b}`, needs: [`${c}.feed`], provides: [`${b}.feed`] },
    { name: `x-${a}`, needs: [`${b}.feed`], provides: [`${a}.feed`] },
    ...words.slice(3).map((w) => ({ name: `x-${w}`, needs: [], provides: [`${w}.feed`] })),
  ];
  let registry = [...coreEntries(coreNames), ...(chance(0.5) ? Q_TRIO() : []), ...extras];
  if (chance(0.4)) registry = registry.filter((p) => p.name !== `x-${c}`);
  const others = words.slice(3).map((w) => `x-${w}`);
  const cfg = { floorEpoch: pick(['pre', 'current']), registry, profile: { enabledExtensions: [`x-${a}`, `x-${b}`, ...sample(others, ri(3))] }, schedule: [] };
  const st = resolve(cfg, new Set());
  cfg.intended = fillIntended(cfg, st, [`x-${a}`]);
  cfg.note = `x-${a} needs ${b}.feed from x-${b}, which is enabled but inactive because ${c}.feed is unavailable.`;
  return cfg;
};
B['provider-withdrawn'] = () => {
  const full = chance(0.7);
  const r = baseRegistry({ withQ: chance(0.6), full });
  const ex = extrasOf(r).map((p) => p.name);
  const cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: chance(0.3) ? null : { enabledExtensions: sample(ex, 1 + ri(ex.length)) }, schedule: [] };
  const st = resolve(cfg, new Set());
  const act = new Set(activeNames(cfg, st));
  // dependents whose provider is active
  const pairs = [];
  for (const p of r) for (const k of p.needs) { const pv = providerName(cfg, k); if (act.has(p.name) && act.has(pv)) pairs.push([pv, p.name]); }
  if (!pairs.length) return null;
  const [prov, dep] = pick(pairs);
  const step = 1 + ri(3);
  cfg.schedule = [{ step, op: 'withdraw', name: prov }];
  if (chance(0.4)) { // add an unrelated restore earlier, still ending withdrawn
    const other = pick([...act].filter((n) => n !== prov && n !== dep));
    if (other) cfg.schedule = [{ step: step, op: 'withdraw', name: other }, { step: step + 1, op: 'restore', name: other }, { step: step + 2, op: 'withdraw', name: prov }];
  }
  cfg.intended = [...new Set([dep, ...sample([...act].filter((n) => n !== prov), ri(3))])];
  cfg.note = `Everything intended is active at boot, then ${prov} is withdrawn and ${dep} loses its provider.`;
  return cfg;
};
B['profile-typo'] = () => {
  const r = baseRegistry({ withQ: chance(0.5), full: chance(0.7) });
  const ex = extrasOf(r);
  const target = pick(ex);
  const dependents = ex.filter((p) => p.needs.includes(target.provides[0]));
  const bad = typo(target.name);
  if (r.some((p) => p.name === bad)) return null;
  const rest = ex.map((p) => p.name).filter((n) => n !== target.name && !dependents.some((d) => d.name === n));
  const listed = [bad, ...dependents.map((d) => d.name), ...sample(rest, ri(3)), ...(chance(0.3) ? [coreTypo()] : [])];
  const cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: { enabledExtensions: listed }, schedule: [] };
  const st = resolve(cfg, new Set());
  const mustI = dependents.length && chance(0.6) ? [dependents[0].name] : [target.name];
  cfg.intended = fillIntended(cfg, st, mustI);
  cfg.note = `The profile lists ${bad} instead of ${target.name}, so ${mustI[0]} is left ${mustI[0] === target.name ? 'excluded' : 'inactive'}.`;
  return cfg;
};

// clean builders
const C = {};
C['current-q'] = () => {
  const r = baseRegistry({ withQ: true, full: chance(0.8) });
  const ex = extrasOf(r).map((p) => p.name);
  const cfg = { floorEpoch: 'current', registry: r, profile: { enabledExtensions: sample(ex, ri(ex.length + 1)) }, schedule: [] };
  return [cfg, ['q'], 'Near-miss: q is intended and unlisted, but the current floor carries q and both helpers, so it is active.'];
};
C['withdraw-restore'] = () => {
  const r = baseRegistry({ withQ: chance(0.6), full: chance(0.7) });
  const ex = extrasOf(r).map((p) => p.name);
  const cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: chance(0.3) ? null : { enabledExtensions: sample(ex, 1 + ri(ex.length)) }, schedule: [] };
  const st = resolve(cfg, new Set());
  const act = new Set(activeNames(cfg, st));
  const pairs = [];
  for (const p of r) for (const k of p.needs) { const pv = providerName(cfg, k); if (act.has(p.name) && act.has(pv)) pairs.push([pv, p.name]); }
  if (!pairs.length) return null;
  const [prov, dep] = pick(pairs);
  const s = 1 + ri(3);
  cfg.schedule = [{ step: s, op: 'withdraw', name: prov }, { step: s + 1 + ri(2), op: 'restore', name: prov }];
  return [cfg, [dep], `Near-miss: ${prov} is withdrawn and then restored before the end, so ${dep} finishes active.`];
};
C['null-profile'] = () => {
  const r = baseRegistry({ withQ: chance(0.7), full: chance(0.7) });
  const cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: null, schedule: [] };
  const must = r.some((p) => p.name === 'q') ? ['q'] : [];
  return [cfg, must, 'Near-miss: the profile is null, so every registered plugin is enabled regardless of the floor epoch.'];
};
C['harmless-typo'] = () => {
  const r = baseRegistry({ withQ: chance(0.5), full: chance(0.7) });
  const ex = extrasOf(r).map((p) => p.name);
  const listed = [...ex];
  let note;
  if (chance(0.5)) { listed.push(coreTypo()); note = 'Near-miss: the profile carries an unregistered core typo, but the core plugin is on the floor anyway.'; }
  else { const w = pick(WORDS.filter((w) => !ex.includes(`x-${w}`))); listed.push(typo(`x-${w}`)); note = 'Near-miss: the profile names an unregistered extra that no intended plugin depends on.'; }
  const cfg = { floorEpoch: pick(['pre', 'current']), registry: r, profile: { enabledExtensions: shuffle(listed) }, schedule: [] };
  return [cfg, [], note];
};
C['plain'] = () => {
  const r = baseRegistry({ withQ: chance(0.6), full: chance(0.7) });
  const ex = extrasOf(r).map((p) => p.name);
  const epoch = pick(['pre', 'current']);
  const hasQ = r.some((p) => p.name === 'q');
  const listed = sample(ex, ri(ex.length + 1));
  if (hasQ && epoch === 'pre' && chance(0.5)) listed.push('q', 'q-release', 'q-resume');
  const cfg = { floorEpoch: epoch, registry: r, profile: { enabledExtensions: listed }, schedule: [] };
  return [cfg, [], 'A profiled config whose intended plugins all resolve to active.'];
};

// ---------- class predicates (shared with verify via duplication there) ----------
function isFaultyOk(cfg) { return cfg.intended.some((n) => cfg.expected[n] !== 'active'); }

// ---------- assemble ----------
const FAULT = ['floor-epoch-drop', 'missing-dependency-pair', 'missing-dependency', 'transitive-missing', 'provider-withdrawn', 'profile-typo'];
const slots = [];
for (const f of FAULT) for (let i = 0; i < 10; i++) slots.push({ label: 'faulty', kind: f, minimal: f === 'floor-epoch-drop' && i < 3 });
const CLEAN = [['current-q', 10], ['withdraw-restore', 10], ['null-profile', 10], ['harmless-typo', 10], ['plain', 20]];
for (const [k, n] of CLEAN) for (let i = 0; i < n; i++) slots.push({ label: 'clean', kind: k });
const order = shuffle(slots);

function finish(cfg) {
  cfg.expectedAtBoot = resolve(cfg, new Set());
  cfg.expected = resolve(cfg, finalWithdrawn(cfg.schedule));
}

const configs = order.map((slot, idx) => {
  const id = `cfg-${String(idx + 1).padStart(3, '0')}`;
  for (let tries = 0; tries < 500; tries++) {
    let cfg;
    if (slot.label === 'faulty') {
      cfg = B[slot.kind](slot.minimal);
      if (!cfg) continue;
      finish(cfg);
      if (!isFaultyOk(cfg)) continue;
      if (slot.kind === 'provider-withdrawn' && !cfg.intended.every((n) => cfg.expectedAtBoot[n] === 'active')) continue;
    } else {
      const res = C[slot.kind]();
      if (!res) continue;
      const [c, must, note] = res;
      cfg = c; cfg.note = note;
      finish(cfg);
      const act = activeNames(cfg, cfg.expected);
      if (!must.every((n) => act.includes(n))) continue;
      cfg.intended = [...new Set([...must, ...sample(act.filter((n) => !must.includes(n)), 1 + ri(4))])];
      if (!cfg.intended.length) continue;
    }
    if (cfg.registry.length < 6 || cfg.registry.length > 40) continue;
    return {
      id, label: slot.label, faultClass: slot.label === 'faulty' ? slot.kind : 'none',
      floorEpoch: cfg.floorEpoch, registry: cfg.registry, profile: cfg.profile, intended: cfg.intended,
      schedule: cfg.schedule, expectedAtBoot: cfg.expectedAtBoot, expected: cfg.expected, note: cfg.note,
    };
  }
  throw new Error(`could not build ${id} ${slot.kind}`);
});

const entries = [];
const classCounts = {};
for (const c of configs) {
  const file = `${c.id}.json`;
  const text = JSON.stringify(c, null, 2) + '\n';
  writeFileSync(join(DIR, file), text);
  entries.push({ id: c.id, label: c.label, faultClass: c.faultClass, file, sha256: createHash('sha256').update(text).digest('hex') });
  classCounts[c.faultClass] = (classCounts[c.faultClass] || 0) + 1;
}
writeFileSync(join(DIR, 'index.json'), JSON.stringify({ configs: entries, classCounts }, null, 2) + '\n');
console.log('wrote', configs.length, classCounts);
