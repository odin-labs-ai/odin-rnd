import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, hashInputs, recordProject } from '../lib.mjs';
const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function runProject({ root = defaultRoot, javaHome = process.env.JAVA_HOME } = {}) {
  root = path.resolve(root);
  const startedAt = new Date().toISOString();
  const work = await mkdtemp(path.join(tmpdir(), 'ci-witness-'));
  const commands = [], observations = [];
  const clean = value => {
    let result = value;
    for (const [from, to] of [[work, '<workdir>'], [root, '<repo>'], [javaHome, '<jdk>']]) if (from) result = result.split(from).join(to);
    return result;
  };
  async function command(tool, args) {
    const result = await runCommand({ executable: javaHome ? path.join(javaHome, 'bin', tool) : tool, args, cwd: work, timeoutMs: 15000 });
    const entry = { id: `command-${commands.length + 1}`, executable: tool, args: args.map(clean), cwd: '<workdir>', ...result, stdout: clean(result.stdout), stderr: clean(result.stderr) };
    commands.push(entry);
    return entry;
  }
  try {
    const java = await command('java', ['-version']);
    const javac = await command('javac', ['-version']);
    const compile = await command('javac', ['-encoding', 'UTF-8', '-d', work, path.join(root, 'demos/ci-witness/fixtures/Witness.java')]);
    const cases = JSON.parse(await readFile(path.join(root, 'demos/ci-witness/fixtures/cases.json'), 'utf8'));
    const infrastructureOK = [java, javac, compile].every(c => c.status === 'completed' && c.exitCode === 0);
    if (infrastructureOK) for (const scenario of cases) {
      for (const variant of ['baseline', 'reproducer', 'corrected', 'unrelated', 'suppressed', 'regression', 'unknown']) {
        const result = await command('java', ['-Dfile.encoding=UTF-8', ...scenario.properties, '-cp', work, 'Witness', variant, scenario.id]);
        const lines = result.stdout.trim().split(/\r?\n/);
        const targetPass = `ASSERT|target.${scenario.id}|PASS|actual=${scenario.expected}|expected=${scenario.expected}`;
        const targetFail = `ASSERT|target.${scenario.id}|FAIL|actual=${scenario.baseline}|expected=${scenario.expected}`;
        const regressions = [`ASSERT|boundary.${scenario.id}|PASS|actual=${scenario.boundaryExpected}|expected=${scenario.boundaryExpected}`, 'ASSERT|regression.empty|PASS|actual=|expected=', 'ASSERT|regression.total|PASS|actual=4|expected=4'];
        const exact = expected => lines.length === expected.length && expected.every((line, i) => lines[i] === line);
        let actual = 'inconclusive';
        if (result.status === 'completed') {
          if (result.exitCode === 0 && exact([targetPass, ...regressions, 'CHECKS|4|FAILURES|0'])) actual = 'verified-correction';
          else if (result.exitCode === 1 && exact([targetFail, ...regressions, 'CHECKS|4|FAILURES|1'])) actual = 'target-failure-reproduced';
          else if (result.exitCode === 0 && exact(['CHECKS|0|FAILURES|0'])) actual = 'rejected-missing-checks';
          else if (result.exitCode === 1 && exact(['ASSERT|unrelated|FAIL|actual=crash|expected=ready', 'CHECKS|1|FAILURES|1'])) actual = 'rejected-unrelated-failure';
          else if (result.exitCode === 1 && exact([targetPass, regressions[0], regressions[1], 'ASSERT|regression.total|FAIL|actual=5|expected=4', 'CHECKS|4|FAILURES|1'])) actual = 'rejected-surviving-regression';
        }
        const expected = ({baseline:'target-failure-reproduced',reproducer:'target-failure-reproduced',corrected:'verified-correction',unrelated:'rejected-unrelated-failure',suppressed:'rejected-missing-checks',regression:'rejected-surviving-regression',unknown:'inconclusive'})[variant];
        const isUnknown = variant === 'unknown';
        const controlExecuted = result.status === 'completed' && result.exitCode === 1;
        const matched = actual === expected && (!isUnknown || controlExecuted);
        observations.push({ id: `${scenario.id}-${variant}`, caseId: scenario.id, role: variant === 'baseline' ? 'baseline' : ['reproducer','corrected'].includes(variant) ? 'candidate' : 'negative-control', expected, actual, verdict: actual === 'inconclusive' ? 'inconclusive' : actual.startsWith('rejected-') ? 'rejected' : matched ? 'accepted' : 'rejected', discriminationPassed: matched, reason: isUnknown ? 'Unknown failure remains unresolved; no diagnosis inferred from exception text.' : matched ? 'Exact assertion identities, values, execution count and exit agree with the declared oracle.' : 'Required oracle evidence did not match.', commandIds: [compile.id, result.id] });
        if (variant === 'corrected') observations.push({ id:`${scenario.id}-boundary`, caseId:scenario.id, role:'oracle', expected:scenario.boundaryExpected, actual:lines.includes(regressions[0]) ? scenario.boundaryExpected : 'inconclusive', verdict:actual === 'verified-correction' ? 'accepted' : 'inconclusive', discriminationPassed:actual === 'verified-correction', reason:'Independent case-specific boundary assertion must execute alongside the target and regression checks.', commandIds:[compile.id,result.id] });
      }
    }
    else observations.push({id:'infrastructure',caseId:'compile',role:'baseline',expected:'successful runtime probes and compilation',actual:'inconclusive',verdict:'inconclusive',reason:'Runtime or compilation failure cannot establish behavioral evidence.',commandIds:[java.id,javac.id,compile.id]});
    const passed = infrastructureOK && observations.length === 32 && observations.every(o => o.discriminationPassed);
    const unexpectedUnknown = observations.some(o => o.actual === 'inconclusive' && o.expected !== 'inconclusive');
    const report = {
      schemaVersion:1, project:'ci-witness',projectVersion:'0.1.0',mode:'authored-fixtures',startedAt,completedAt:new Date().toISOString(),
      runtime:{node:process.version,java:(java.stdout+java.stderr).trim(),javac:(javac.stdout+javac.stderr).trim()},
      inputSha256: await hashInputs({root,relativePaths:['demos/ci-witness/run.mjs','demos/ci-witness/README.md','demos/ci-witness/fixtures/Witness.java','demos/ci-witness/fixtures/cases.json','demos/lib.mjs','demos/CONTRACT.md']}),
      scope:'Four deterministic authored timezone, locale, order and configuration cases; explicit fixed order, reproduced target assertions and hand-authored corrections with one case-specific boundary and two regression assertions per case.',
      limitations:['No statistical flaky-rate estimate or general diagnosis claim.','No AI calls, automatic repair, customer inputs or measured ROI.','Unknown failures remain inconclusive, including the expected unknown negative control.','Trusted bundled code only; temporary directories are not a security sandbox.','Hashes establish input consistency, not malicious-tamper authenticity.'],
      logsPathNormalized:true,observations,commands,
      metrics:[{id:'controlled-corrections',numerator:observations.filter(o=>o.id.endsWith('-corrected')&&o.actual==='verified-correction').length,denominator:4,unit:'cases',definition:'Declared cases with all four exact assertions passing after the authored correction.'},{id:'discrimination',numerator:observations.filter(o=>o.discriminationPassed).length,denominator:32,unit:'observations',definition:'Expected outcomes matched across 28 executions and four boundary observations, including rejection and unresolved unknown controls; not a behavioral pass rate.'},{id:'unresolved',numerator:observations.filter(o=>o.role!=='oracle'&&o.actual==='inconclusive').length,denominator:28,unit:'executions',definition:'Unresolved executions, including four deliberately unknown failures.'}],
      experimentVerdict:passed?'passed':!infrastructureOK||unexpectedUnknown?'inconclusive':'failed'
    };
    return report;
  } finally { await rm(work,{recursive:true,force:true}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') { console.error('Usage: node demos/ci-witness/run.mjs --out /tmp/ci-witness.json'); process.exitCode=2; }
  else try { const report=await runProject(); await recordProject({outputPath:path.resolve(args[1]),report}); console.log(`${report.project}: ${report.experimentVerdict}`); process.exitCode=({passed:0,failed:1,inconclusive:2})[report.experimentVerdict]; } catch(error) { console.error(`CI Witness could not produce evidence (${error.code || error.name}).`); process.exitCode=2; }
}
