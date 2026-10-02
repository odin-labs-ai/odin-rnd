// EXP 008 (latent-handoff): the EXP 005 leakage lint on text read from stdin (an A1 summary), never from argv.
// Prints the findings as JSON; exit 0 clean, 1 findings.
import { readFileSync } from 'node:fs';
import { lintText } from '../jev-gate/lint.mjs';

const findings = lintText(readFileSync(0, 'utf8'), 'state:c001');
process.stdout.write(`${JSON.stringify(findings)}\n`);
process.exit(findings.length ? 1 : 0);
