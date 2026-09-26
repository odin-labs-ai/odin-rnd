// Pre-registered, model-free comparison baselines for EXP 005 (added after WO-07 review round 1).
//
// A baseline is a deterministic function predict(state) -> true (RED: the change breaks a rule) or
// false (GREEN). It sees exactly what a gate sees: the state string of each item in inputs.json
// (rules.txt + "\n\n" + the diff). It never reads labels.json, manifest.json or the patch files;
// labels are used only afterwards, here, to score it. A gate result is reported next to these.
//
// Each baseline script records its own entry in baselines.json, with the sha256 of the script and of
// this file, so a published score is tied to the exact code that produced it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HERE, REPO_ROOT } from './bce-contract.mjs';

export const BASELINES = join(HERE, 'baselines.json');
const INPUTS = join(HERE, 'inputs.json');
const LABELS = join(HERE, 'labels.json');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** The diff part of a state, and its added lines with the file each belongs to. */
export function parseState(state) {
  const start = state.indexOf('\ndiff --git ');
  if (start < 0) throw new Error('state holds no diff');
  const diff = state.slice(start + 1);
  const added = [];
  let file = null;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ b\/(\S+)/.exec(line);
    if (header) { file = header[1]; continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) added.push({ file, line: line.slice(1) });
  }
  return { diff, added };
}

/** Run predict over every input and score it against bce's labels (disagree and EXCLUDED items left out). */
export function score(predict) {
  const inputs = JSON.parse(readFileSync(INPUTS, 'utf8')).items;
  const predictions = inputs.map(item => ({ id: item.id, red: Boolean(predict(item.state)) }));
  const truth = Object.fromEntries(JSON.parse(readFileSync(LABELS, 'utf8')).items.map(i => [i.id, i]));
  const scored = predictions.filter(p => ['RED', 'GREEN'].includes(truth[p.id].label) && !truth[p.id].disagree);
  const missedRed = scored.filter(p => truth[p.id].label === 'RED' && !p.red).map(p => p.id);
  const falseReject = scored.filter(p => truth[p.id].label === 'GREEN' && p.red).map(p => p.id);
  const correct = scored.length - missedRed.length - falseReject.length;
  return {
    scored: scored.length,
    correct,
    accuracy: Number((correct / scored.length).toFixed(4)),
    missedRed,
    falseReject,
    predictions: Object.fromEntries(predictions.map(p => [p.id, p.red ? 'RED' : 'GREEN'])),
  };
}

/** The baselines.json entry for one baseline script. */
export function entryFor(scriptPath, description, predict) {
  return {
    script: relative(REPO_ROOT, scriptPath).split('\\').join('/'),
    scriptSha256: sha256(readFileSync(scriptPath)),
    libSha256: sha256(readFileSync(new URL(import.meta.url))),
    description,
    ...score(predict),
  };
}

function render(entries) {
  return JSON.stringify({
    schemaVersion: 1,
    note: 'Model-free comparison baselines. Each reads only inputs.json (the gate view) and is scored against labels.json. Regenerate with the scripts named in each entry.',
    inputsSha256: sha256(readFileSync(INPUTS)),
    labelsSha256: sha256(readFileSync(LABELS)),
    baselines: entries,
  }, null, 2) + '\n';
}

/** CLI for a baseline script: print its score, then write (or with --check, compare) its entry. */
export function runBaseline(name, scriptPath, description, predict, argv = process.argv) {
  const entry = entryFor(scriptPath, description, predict);
  console.log(`${name}: accuracy ${entry.accuracy} (${entry.correct}/${entry.scored}), missed RED ${entry.missedRed.length} [${entry.missedRed.join(' ')}], false reject ${entry.falseReject.length} [${entry.falseReject.join(' ')}]`);
  const current = existsSync(BASELINES) ? JSON.parse(readFileSync(BASELINES, 'utf8')).baselines : {};
  const next = render(Object.fromEntries(Object.entries({ ...current, [name]: entry }).sort(([a], [b]) => a.localeCompare(b))));
  if (argv.includes('--check')) {
    const same = existsSync(BASELINES) && readFileSync(BASELINES, 'utf8') === next;
    console.log(same ? 'baselines.json reproduces' : 'baselines.json DIFFERS');
    process.exitCode = same ? 0 : 1;
  } else {
    writeFileSync(BASELINES, next);
  }
}
