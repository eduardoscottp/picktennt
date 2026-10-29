import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Run with server credentials already in process.env. Never log their names or
// values, and never write them into a fixture or report.
const root = resolve(process.argv[2] ?? '.next/static');
const secrets = [...new Set(Object.entries(process.env)
  .filter(([name, value]) => !name.startsWith('NEXT_PUBLIC_') && /SECRET|PASSWORD|SERVICE_ROLE|PRIVATE_KEY|API_KEY|(?:ACCESS|REFRESH|AUTH)_TOKEN/i.test(name) && value?.length >= 12)
  .map(([, value]) => value))];
if (!secrets.length) throw new Error('No configured private values were available for the bundle check.');
let checked = 0, leaks = 0;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (item.isFile()) {
      const content = await readFile(path, 'utf8');
      checked++;
      if (secrets.some(value => content.includes(value) || content.includes(JSON.stringify(value).slice(1, -1)))) leaks++;
    }
  }
}
await scan(root);
if (leaks) throw new Error(`Private values were found in ${leaks} client artifacts. Withhold the build and rotate exposed credentials.`);
console.log(`PASS: ${checked} client artifacts checked against ${secrets.length} configured private values; zero matches.`);
