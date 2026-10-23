import { runDoctor } from '../server/doctor.js';

const options = new Set(process.argv.slice(2));
const report = await runDoctor({ network: !options.has('--no-network') });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === 'error') process.exitCode = 2;
else if (report.status === 'degraded') process.exitCode = 1;
