import { mkdtemp, rm, readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, hashInputs, recordProject } from '../lib.mjs';
const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export async function runProject({ root = defaultRoot, javaHome = process.env.JAVA_HOME } = {}) {
  root = path.resolve(root);
  const startedAt = new Date().toISOString();
  const workdir = await mkdtemp(path.join(tmpdir(), 'migration-witness-'));
  const commands = [], observations = [], runs = {};
  const fixtureDir = path.join(root, 'demos/migration-witness/fixtures');
  const normalize = text => String(text).split(workdir).join('<workdir>').split(root).join('<repo>').split(javaHome || '\0').join('<jdk>');
  const invoke = async (tool, args) => {
    const result = await runCommand({ executable: javaHome ? path.join(javaHome, 'bin', tool) : tool, args, cwd: workdir });
    const id = `command-${commands.length + 1}`;
    commands.push({ id, executable: tool, args: args.map(normalize), cwd: '<workdir>', ...result, stdout: normalize(result.stdout), stderr: normalize(result.stderr) });
    return { ...result, id };
  };
  try {
    const java = await invoke('java', ['-version']);
    const javac = await invoke('javac', ['-version']);
    const files = (await readdir(fixtureDir)).sort();
    const inputSha256 = await hashInputs({ root, relativePaths: ['demos/lib.mjs', 'demos/CONTRACT.md', 'demos/migration-witness/run.mjs', 'demos/migration-witness/README.md', ...files.map(f => `demos/migration-witness/fixtures/${f}`)] });
    const cases = (await readFile(path.join(fixtureDir, 'cases.tsv'), 'utf8')).trimEnd().split('\n').slice(1).map(line => {
      const [id, customer, amount, timestamp, beforeExpected, afterExpected, preservation] = line.split('\t');
      return { id, customer, amount, timestamp, beforeExpected, afterExpected, preservation: preservation === 'yes' };
    });
    for (const [id, className, candidate, sharedBug, role] of [
      ['baseline', 'BeforeInvoice', false, false, 'baseline'],
      ['candidate', 'AfterInvoice', true, false, 'candidate'],
      ['semantic-regression', 'RegressionInvoice', true, false, 'negative-control'],
      ['shared-bug-baseline', 'BeforeInvoice', false, true, 'negative-control'],
      ['shared-bug-candidate', 'AfterInvoice', true, true, 'negative-control'],
      ['compile-failure', 'BrokenInvoice', true, false, 'negative-control'],
    ]) {
      const classes = path.join(workdir, id); await mkdir(classes);
      const compile = await invoke('javac', ['-encoding', 'UTF-8', '-d', classes, path.join(fixtureDir, `${className}.java`), path.join(fixtureDir, 'WitnessHarness.java')]);
      if (compile.status !== 'completed' || compile.exitCode !== 0) {
        runs[id] = { verdict: 'inconclusive', compiled: false, compileStatus: compile.status, compileExitCode: compile.exitCode };
        observations.push({ id, caseId: 'compilation', role, expected: 'Executable Java implementation', actual: { status: compile.status, exitCode: compile.exitCode }, verdict: 'inconclusive', reason: 'Compilation did not produce runnable evidence; never a semantic defect.', commandIds: [compile.id] });
        continue;
      }
      const execution = await invoke('java', ['-Dfile.encoding=UTF-8', '-cp', classes, 'WitnessHarness', className, path.join(fixtureDir, 'cases.tsv'), String(candidate), String(sharedBug)]);
      const lines = execution.stdout.trimEnd().split('\n');
      const assertions = lines.filter(l => l.startsWith('ASSERT\t')).map(l => l.split('\t'));
      const summary = lines.find(l => l.startsWith('SUMMARY\t'))?.split('\t');
      const valid = execution.status === 'completed' && assertions.length === cases.length && new Set(assertions.map(a => a[1])).size === cases.length && assertions.every(a => cases.some(c => c.id === a[1]) && ['PASS', 'FAIL'].includes(a[2]) && a.length === 4) && summary && Number(summary[1]) === cases.length && Number(summary[2]) === assertions.filter(a => a[2] === 'FAIL').length && execution.exitCode === (Number(summary[2]) ? 1 : 0);
      const actuals = {};
      for (const c of cases) {
        const a = assertions.find(a => a[1] === c.id);
        const actual = a ? Buffer.from(a[3], 'base64').toString('utf8') : null;
        const expected = candidate ? c.afterExpected : c.beforeExpected;
        actuals[c.id] = actual;
        const consistent = a && (a[2] === 'PASS') === (actual === expected);
        observations.push({ id: `${id}:${c.id}`, caseId: c.id, role, expected, actual, verdict: valid && consistent ? actual === expected ? 'accepted' : 'rejected' : 'inconclusive', reason: c.preservation ? 'Compared to declared independent expected invoice result.' : 'Declared intentional change: blank customer becomes ERROR_CUSTOMER; excluded from preservation.', commandIds: [compile.id, execution.id] });
      }
      const own = observations.filter(o => o.id.startsWith(`${id}:`));
      runs[id] = { compiled: true, assertionCount: assertions.length, failureCount: summary ? Number(summary[2]) : null, actuals, verdict: own.some(o => o.verdict === 'inconclusive') ? 'inconclusive' : own.some(o => o.verdict === 'rejected') ? 'rejected' : 'accepted' };
    }
    const eligible = cases.filter(c => c.preservation);
    const preserved = eligible.filter(c => observations.find(o => o.id === `baseline:${c.id}`)?.verdict === 'accepted' && observations.find(o => o.id === `candidate:${c.id}`)?.verdict === 'accepted' && runs.baseline.actuals?.[c.id] === runs.candidate.actuals?.[c.id]);
    const sharedPairwiseEqual = eligible.every(c => runs['shared-bug-baseline'].actuals?.[c.id] != null && runs['shared-bug-baseline'].actuals[c.id] === runs['shared-bug-candidate'].actuals?.[c.id]);
    const controls = { positiveAccepted: runs.baseline.verdict === 'accepted' && runs.candidate.verdict === 'accepted', semanticRegressionRejected: runs['semantic-regression'].compiled && runs['semantic-regression'].verdict === 'rejected', sharedBugRejectedDespiteEquality: sharedPairwiseEqual && runs['shared-bug-baseline'].verdict === 'rejected' && runs['shared-bug-candidate'].verdict === 'rejected', compileFailureInconclusive: runs['compile-failure'].verdict === 'inconclusive' && runs['compile-failure'].compileStatus === 'completed' && runs['compile-failure'].compileExitCode !== 0 };
    const infra = [java, javac].some(r => r.status !== 'completed' || r.exitCode !== 0) || Object.entries(runs).some(([id,r]) => id !== 'compile-failure' && r.verdict === 'inconclusive') || runs['compile-failure'].compileStatus !== 'completed';
    return freeze({ schemaVersion: 1, project: 'migration-witness', projectVersion: '0.1.0', mode: 'authored-fixtures', startedAt, completedAt: new Date().toISOString(), runtime: { node: process.version, java: normalize((java.stderr + java.stdout).trim()), javac: normalize((javac.stderr + javac.stdout).trim()) }, inputSha256, scope: 'Declared invoice formatting cases in authored before/after Java fixtures; no automatic transformation.', limitations: ['No ROI measured; no customer code or live model calls.', 'Seven declared preservation cases, not general program equivalence.', 'Intentional blank-customer validation change excluded from preservation denominator.', 'Trusted bundled sources only; owned temporary directories are not a security sandbox.', 'Hashes establish consistency, not authenticity against malicious artifact replacement.'], logsPathNormalized: true, observations, commands, runs, controls, metrics: [{ id: 'declared-preservation', numerator: preserved.length, denominator: eligible.length, unit: 'cases', definition: 'Both versions satisfy independent expected values and pairwise equality, excluding intentional change.' }, { id: 'control-discrimination', numerator: Object.values(controls).filter(Boolean).length, denominator: Object.keys(controls).length, unit: 'controls', definition: 'Positive acceptance, semantic rejection, shared-bug rejection and compile-inconclusive classification.' }, { id: 'inconclusive-observations', numerator: observations.filter(o => o.verdict === 'inconclusive').length, denominator: observations.length, unit: 'observations', definition: 'Includes deliberately invalid compilation; not counted as a detected behavior defect.' }], experimentVerdict: infra ? 'inconclusive' : Object.values(controls).every(Boolean) ? 'passed' : 'failed' });
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node demos/migration-witness/run.mjs --out <report.json>');
    const report = await runProject(); await recordProject({ outputPath: path.resolve(args[1]), report });
    console.log(`Migration Witness: ${report.experimentVerdict}`);
    process.exitCode = { passed: 0, failed: 1, inconclusive: 2 }[report.experimentVerdict];
  } catch { console.error('Migration Witness infrastructure error; no completed receipt.'); process.exitCode = 2; }
}
