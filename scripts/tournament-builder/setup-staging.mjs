import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const productionRef = 'qmiljmxnnryhuaudpuff';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const selectedFiles = [
  'scripts/tournament-builder/staging-baseline.sql',
  'supabase/migrations/202610280001_tournament_builder.sql',
  'supabase/migrations/202610280002_tournament_connector_oauth.sql',
];

/** Produces reviewed SQL only. This program has no network or deployment capability. */
export function stagingPackage(projectRef) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '') || projectRef === productionRef) throw new Error('STAGING_ONLY: supply a new empty non-production project ref.');
  const files = selectedFiles.map(path => {
    const sql = readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, '');
    return { path, sql, sha256: createHash('sha256').update(sql).digest('hex') };
  });
  // The baseline and both selected migrations commit as ONE transaction. Failure cannot leave a partial setup.
  const body = files.map(file => `-- SELECTED FILE: ${file.path}\n-- SHA256: ${file.sha256}\n${file.sql.replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '')}`).join('\n\n');
  return {
    manifest: { project_ref: projectRef, production_ref_blocked: true, applies_remotely: false, files: files.map(({ path, sha256 }) => ({ path, sha256 })) },
    sql: `-- Generated for EMPTY ISOLATED STAGING ONLY. No production data or credentials.\nBEGIN;\nSET LOCAL tournament_builder.staging_project_ref = '${projectRef}';\n${body}\nCOMMIT;\n`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg, i) => i % 2 === 0 && !['--project-ref', '--output'].includes(arg)) || args.length % 2 !== 0) throw new Error('Usage: node setup-staging.mjs --project-ref <20-character-ref> [--output <reviewed-staging.sql>]');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const prepared = stagingPackage(options['--project-ref']);
  if (options['--output']) writeFileSync(resolve(options['--output']), prepared.sql, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ ...prepared.manifest, output: options['--output'] ? resolve(options['--output']) : null }, null, 2) + '\n');
}
