// EXP 006 WO-1-01: the denial census. Every git command EXP 005's fence refused (317 in the committed reviewer
// record), classified by its exact form and mapped to what fence6 does with it; and, per report (all 180), the first
// command the run was refused, whether fence6 would allow it, and whether the run later tried a form fence6 allows.
//   node experiments/nina-changes/denial-census.mjs --write   write denial-census.json
//   node experiments/nina-changes/denial-census.mjs --check   the committed file is exactly what this computes
// $0: it reads committed records only. The decisions come from fence6.mjs's offline client model, which proves
// nothing about the client; the phase-B live probe proves the allowed forms run and the rest stay refused.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideFence5, decideFence6, FENCE6_PREFIXES, GIT_VERBS, WS_REPO } from './fence6.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const SOURCE = 'experiments/jev-gate/results/reviewer.json';
export const VISIBILITY = 'experiments/jev-gate/results/diff-visibility.json';
export const outFile = join(HERE, 'denial-census.json');
export const ALLOW = 'ALLOW-IN-FENCE6', DENY = 'STAYS-DENIED';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// The record shows the run dir as the placeholder <ws>; its < and > would trip the fence's own `git *<*` / `git *>*`
// deny rules, which never see a placeholder live (the path is absolute). Decide on a neutral absolute stand-in.
export const STAND_IN = '/ws';
const onStandIn = command => command.replaceAll('<ws>', STAND_IN);
const f6 = command => decideFence6(onStandIn(command), `${STAND_IN}/repo`);
const f5 = command => decideFence5(onStandIn(command));
const isGit = cmd => /(^|\s)git(\s|$)/.test(cmd);

// The form categories the plan names, in the priority used when a command has several features.
export const CATEGORIES = ['compound', 'redirection', 'quoting', '-C + --no-pager', 'git -C <ws> <verb>', 'git --no-pager <verb>', 'other'];

/** The features of one command as the record has it (scrubbed), and its single category by priority. */
export function formOf(command) {
  const d = f6(command);
  const parts = d.parts.map(p => p.part);
  const features = {
    compound: d.compound,
    operators: [...new Set(d.ops)].sort(),
    redirection: /\d*(>>|>|<)/.test(command.replace(/<ws>/g, '')),
    redirectToFile: /(^|[^\d&])>{1,2}\s*(?!\/dev\/null|&)/.test(command.replace(/<ws>/g, '').replace(/2>&1/g, '')),
    quoting: /["'\\`]/.test(command),
    dashC: /(^|\s)git -C\s/.test(command) || /\s-C\s/.test(command),
    noPager: /--no-pager/.test(command),
    nonGitPart: parts.some(p => !/^git(\s|$)/.test(p)),
  };
  const category = features.compound ? 'compound' : features.redirection ? 'redirection' : features.quoting ? 'quoting'
    : features.dashC && features.noPager ? '-C + --no-pager' : features.dashC ? 'git -C <ws> <verb>' : features.noPager ? 'git --no-pager <verb>' : 'other';
  return { category, features };
}

function load(root = ROOT) {
  const reviewerBytes = readFileSync(join(root, SOURCE));
  const visibilityBytes = readFileSync(join(root, VISIBILITY));
  return { reviewer: JSON.parse(reviewerBytes), visibility: JSON.parse(visibilityBytes), shas: { reviewer: sha256(reviewerBytes), visibility: sha256(visibilityBytes) } };
}

export function census({ reviewer, visibility, shas }) {
  const denials = reviewer.calls.flatMap(c => (c.permissionDenials ?? []).map((d, i) => ({ id: c.id, run: c.run, index: i, tool: d.tool, command: String(d.input?.command ?? '') })));
  const gitDenials = denials.filter(d => d.tool === 'Bash' && isGit(d.command));
  const byCommand = new Map();
  for (const d of gitDenials) byCommand.set(d.command, (byCommand.get(d.command) ?? 0) + 1);
  const commands = [...byCommand].map(([command, count]) => {
    const d6 = f6(command), d5 = f5(command);
    return { command, count, ...formOf(command), fence5: d5.allowed ? 'ALLOWED' : 'DENIED', fence6: d6.allowed ? ALLOW : DENY, reason: d6.reason };
  }).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
  const categories = CATEGORIES.map(category => {
    const rows = commands.filter(c => c.category === category);
    return { category, denials: rows.reduce((s, r) => s + r.count, 0), commands: rows.length, allowInFence6: rows.filter(r => r.fence6 === ALLOW).reduce((s, r) => s + r.count, 0) };
  });
  const decision = new Map(commands.map(c => [c.command, c]));
  const cls = new Map(visibility.runs.map(r => [`${r.id}#${r.run}`, r.class]));
  const runs = reviewer.calls.map(c => {
    const refused = (c.permissionDenials ?? []).map(d => String(d.input?.command ?? '')).filter(isGit);
    const first = refused[0] ?? null;
    return {
      id: c.id, run: c.run, diffVisibility: cls.get(`${c.id}#${c.run}`) ?? null, gitDenials: refused.length,
      firstDenied: first === null ? null : { command: first, category: decision.get(first).category, fence6: decision.get(first).fence6, reason: decision.get(first).reason },
      laterAllowedFallback: refused.slice(1).some(cmd => decision.get(cmd).fence6 === ALLOW),
      anyAllowedInFence6: refused.some(cmd => decision.get(cmd).fence6 === ALLOW),
    };
  });
  const blind = runs.filter(r => r.diffVisibility === 'diff-blind');
  const tally = xs => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
  const record = {
    schemaVersion: 1, kind: 'denial-census',
    source: { file: SOURCE, sha256: shas.reviewer }, diffVisibility: { file: VISIBILITY, sha256: shas.visibility },
    rule: 'Every refused Bash git command in the committed EXP 005 reviewer record, as the record has it (the run dir scrubbed to <ws>), grouped by exact command text. Category: one of the plan\'s forms, by priority compound > redirection > quoting > -C + --no-pager > git -C <ws> <verb> > git --no-pager <verb> > other. fence6: the decision of fence6.mjs\'s offline client model (every part of a compound must match an allow rule; redirections to /dev/null and 2>&1 are stripped before matching; a redirect to a file, a non-git part, a quote, a $ and every fence5 deny rule stay refused). It models the client; the live probe proves it.',
    fence6: { allowPrefixes: FENCE6_PREFIXES.map(p => p.replace('{ws}', WS_REPO)), verbs: GIT_VERBS },
    totals: {
      denials: denials.length, gitDenials: gitDenials.length, distinctCommands: commands.length, reports: reviewer.calls.length,
      runsWithGitDenials: runs.filter(r => r.gitDenials > 0).length,
      allowInFence6: commands.filter(c => c.fence6 === ALLOW).reduce((s, c) => s + c.count, 0),
      staysDenied: commands.filter(c => c.fence6 === DENY).reduce((s, c) => s + c.count, 0),
    },
    categories,
    staysDeniedReasons: tally(commands.filter(c => c.fence6 === DENY).flatMap(c => Array(c.count).fill(c.reason))),
    blindRuns: {
      runs: blind.length,
      firstAttemptStillDenied: blind.filter(r => r.firstDenied?.fence6 === DENY).length,
      firstAttemptAllowed: blind.filter(r => r.firstDenied?.fence6 === ALLOW).length,
      firstAttemptDeniedReasons: tally(blind.filter(r => r.firstDenied?.fence6 === DENY).map(r => r.firstDenied.reason)),
      laterAllowedFallback: blind.filter(r => r.laterAllowedFallback).length,
      anyAllowedInFence6: blind.filter(r => r.anyAllowedInFence6).length,
      expectedMechanism: 'first attempt denied, then a fallback form fence6 allows; a blind run with no allowed fallback is data, not a fence failure',
    },
    commands, runs,
  };
  assert.equal(categories.reduce((s, c) => s + c.denials, 0), gitDenials.length, 'the categories sum to the git denials');
  assert.equal(record.totals.allowInFence6 + record.totals.staysDenied, gitDenials.length, 'every denial is mapped');
  return record;
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;
export const compute = (root = ROOT) => census(load(root));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const record = compute();
  if (command === '--write') writeFileSync(outFile, render(record));
  else if (command === '--check') assert.equal(readFileSync(outFile, 'utf8'), render(record), `${outFile} differs from what denial-census.mjs computes`);
  else { console.error('usage: node experiments/nina-changes/denial-census.mjs --write | --check'); process.exit(2); }
  console.log(JSON.stringify({ totals: record.totals, categories: record.categories, blindRuns: record.blindRuns }, null, 1));
}
