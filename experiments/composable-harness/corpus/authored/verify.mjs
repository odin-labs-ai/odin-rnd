// Self-check for the corpus. Plain Node, no dependencies. Prints OK or the list of problems.
// Interpretation used: a withdrawn plugin is treated as removed (reported `excluded`) until restored.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const errs = [];
const err = (id, m) => errs.push(`${id}: ${m}`);

const CORES = Array.from({ length: 25 }, (_, i) => `core-${String(i + 1).padStart(2, '0')}`);
const FLOORS = { pre: new Set(CORES), current: new Set([...CORES, 'q', 'q-release', 'q-resume']) };
const CLASSES = ['floor-epoch-drop', 'missing-dependency-pair', 'missing-dependency', 'transitive-missing', 'provider-withdrawn', 'profile-typo'];
const NAME_RE = /^[a-z][a-z0-9-]*$/;

function statuses(cfg, removed) {
  const floor = FLOORS[cfg.floorEpoch];
  const prof = cfg.profile ? new Set(cfg.profile.enabledExtensions) : null;
  const on = (n) => !removed.has(n) && (prof === null || floor.has(n) || prof.has(n));
  const prov = {};
  for (const p of cfg.registry) for (const k of p.provides) prov[k] = p.name;
  const act = new Set();
  for (;;) {
    const before = act.size;
    for (const p of cfg.registry) if (on(p.name) && p.needs.every((k) => prov[k] && act.has(prov[k]))) act.add(p.name);
    if (act.size === before) break;
  }
  const out = {};
  for (const p of cfg.registry) {
    if (!on(p.name)) out[p.name] = 'excluded';
    else if (act.has(p.name)) out[p.name] = 'active';
    else out[p.name] = 'inactive: ' + [...new Set(p.needs.filter((k) => !(prov[k] && act.has(prov[k]))))].sort().map((k) => 'missing ' + k).join(', ');
  }
  return out;
}
function removedAfter(schedule) {
  const r = new Set();
  for (const e of [...schedule].sort((a, b) => a.step - b.step)) e.op === 'withdraw' ? r.add(e.name) : r.delete(e.name);
  return r;
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
if (index.configs.length !== 120) err('index', `expected 120 entries, got ${index.configs.length}`);
const labels = { faulty: 0, clean: 0 };
const classCount = {};
let minimalDrop = 0;
const nearMiss = { currentQ: 0, withdrawRestore: 0, nullProfile: 0, harmlessTypo: 0 };

for (let i = 1; i <= 120; i++) {
  const id = `cfg-${String(i).padStart(3, '0')}`;
  const file = `${id}.json`;
  const ent = index.configs.find((e) => e.id === id);
  let bytes;
  try { bytes = readFileSync(join(DIR, file)); } catch { err(id, 'file missing'); continue; }
  if (!ent) { err(id, 'not in index'); continue; }
  if (createHash('sha256').update(bytes).digest('hex') !== ent.sha256) err(id, 'sha256 mismatch');
  const cfg = JSON.parse(bytes.toString('utf8'));
  if (cfg.id !== id || ent.file !== file || ent.label !== cfg.label || ent.faultClass !== cfg.faultClass) err(id, 'index fields disagree with file');

  // structure
  const names = cfg.registry.map((p) => p.name);
  if (names.length < 6 || names.length > 40) err(id, `registry size ${names.length}`);
  if (new Set(names).size !== names.length) err(id, 'duplicate names');
  for (const n of names) {
    if (!NAME_RE.test(n)) err(id, `bad name ${n}`);
    if (!(CORES.includes(n) || ['q', 'q-release', 'q-resume'].includes(n) || /^x-[a-z]+$/.test(n))) err(id, `name outside naming rules ${n}`);
  }
  const keyOwner = {};
  for (const p of cfg.registry) for (const k of p.provides) { if (keyOwner[k]) err(id, `key ${k} provided twice`); keyOwner[k] = p.name; }
  const q = cfg.registry.find((p) => p.name === 'q');
  if (q && JSON.stringify([...q.needs].sort()) !== '["q.release","q.resume"]') err(id, 'q wiring');
  for (const [n, k] of [['q-release', 'q.release'], ['q-resume', 'q.resume']]) {
    const p = cfg.registry.find((x) => x.name === n);
    if (p && JSON.stringify(p.provides) !== JSON.stringify([k])) err(id, `${n} wiring`);
  }
  if (!['pre', 'current'].includes(cfg.floorEpoch)) err(id, 'floorEpoch');
  if (!cfg.note || typeof cfg.note !== 'string') err(id, 'note');

  // 1. recompute expected
  const boot = statuses(cfg, new Set());
  const end = statuses(cfg, removedAfter(cfg.schedule));
  if (!same(boot, cfg.expectedAtBoot)) err(id, 'expectedAtBoot mismatch');
  if (!same(end, cfg.expected)) err(id, 'expected mismatch');

  // 2. label follows from rules
  const broken = cfg.intended.filter((n) => end[n] !== 'active');
  const lbl = broken.length ? 'faulty' : 'clean';
  if (lbl !== cfg.label) err(id, `label ${cfg.label} but rules say ${lbl}`);
  labels[cfg.label] = (labels[cfg.label] || 0) + 1;
  if (cfg.label === 'clean' && cfg.faultClass !== 'none') err(id, 'clean with faultClass');
  if (cfg.label === 'faulty' && !CLASSES.includes(cfg.faultClass)) err(id, 'unknown faultClass');
  classCount[cfg.faultClass] = (classCount[cfg.faultClass] || 0) + 1;

  // class shape checks
  const regd = new Set(names);
  const prov = (k) => cfg.registry.find((p) => p.provides.includes(k))?.name;
  const missingKeys = (n) => (end[n] || '').startsWith('inactive') ? end[n].slice(10).split(', ').map((s) => s.slice(8)) : [];
  const fc = cfg.faultClass;
  if (fc === 'floor-epoch-drop') {
    const ok = cfg.floorEpoch === 'pre' && cfg.intended.includes('q') && cfg.profile && !cfg.profile.enabledExtensions.includes('q')
      && end.q === 'excluded' && regd.has('q-release') && regd.has('q-resume');
    if (!ok) err(id, 'floor-epoch-drop shape');
    const minimal = names.length === 28 && CORES.every((c) => regd.has(c)) && regd.has('q')
      && cfg.profile.enabledExtensions.every((n) => !FLOORS.pre.has(n));
    if (minimal) minimalDrop++;
  } else if (fc === 'missing-dependency-pair') {
    const helperOff = ['q-release', 'q-resume'].some((h) => !regd.has(h) || end[h] === 'excluded');
    if (!(end.q && end.q !== 'excluded' && end.q !== 'active' && helperOff && cfg.intended.includes('q'))) err(id, 'missing-dependency-pair shape');
  } else if (fc === 'missing-dependency') {
    const ok = cfg.intended.some((n) => n !== 'q' && missingKeys(n).some((k) => !prov(k) || end[prov(k)] === 'excluded'));
    if (!ok) err(id, 'missing-dependency shape');
  } else if (fc === 'transitive-missing') {
    const ok = cfg.intended.some((n) => missingKeys(n).some((k) => prov(k) && end[prov(k)].startsWith('inactive')));
    if (!ok) err(id, 'transitive-missing shape');
  } else if (fc === 'provider-withdrawn') {
    const ok = cfg.intended.every((n) => boot[n] === 'active') && cfg.schedule.some((e) => e.op === 'withdraw')
      && cfg.intended.some((n) => missingKeys(n).some((k) => removedAfter(cfg.schedule).has(prov(k))));
    if (!ok) err(id, 'provider-withdrawn shape');
  } else if (fc === 'profile-typo') {
    const ok = cfg.profile && cfg.profile.enabledExtensions.some((n) => !regd.has(n)) && broken.length > 0;
    if (!ok) err(id, 'profile-typo shape');
  }

  // near-miss tallies (clean)
  if (cfg.label === 'clean') {
    if (cfg.floorEpoch === 'current' && cfg.intended.includes('q') && cfg.profile && !cfg.profile.enabledExtensions.includes('q')) nearMiss.currentQ++;
    const w = cfg.schedule.filter((e) => e.op === 'withdraw');
    if (w.length && w.every((e) => cfg.schedule.some((r) => r.op === 'restore' && r.name === e.name && r.step > e.step))) nearMiss.withdrawRestore++;
    if (cfg.profile === null) nearMiss.nullProfile++;
    if (cfg.profile && cfg.profile.enabledExtensions.some((n) => !regd.has(n))) nearMiss.harmlessTypo++;
  }
}

// 3. split, minimums, index
if (labels.faulty !== 60 || labels.clean !== 60) err('corpus', `split faulty=${labels.faulty} clean=${labels.clean}`);
for (const c of CLASSES) if ((classCount[c] || 0) < 8) err('corpus', `class ${c} used ${classCount[c] || 0} < 8`);
if (minimalDrop < 3) err('corpus', `only ${minimalDrop} minimal floor-epoch-drop configs`);
for (const [k, v] of Object.entries(nearMiss)) if (v < 1) err('corpus', `no clean near-miss ${k}`);
if (JSON.stringify(index.classCounts) !== JSON.stringify(Object.fromEntries(Object.entries(index.classCounts).map(([k]) => [k, classCount[k]])))
  || Object.keys(index.classCounts).length !== Object.keys(classCount).length) err('index', 'classCounts disagree');

if (errs.length) { console.log(errs.join('\n')); console.log(`FAIL (${errs.length} problems)`); process.exit(1); }
console.log(`faulty=${labels.faulty} clean=${labels.clean} classes=${JSON.stringify(classCount)} minimalDrop=${minimalDrop} nearMiss=${JSON.stringify(nearMiss)}`);
console.log('OK');
