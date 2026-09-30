import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reads a migration script from the compiled output or from the source tree, depending on where the process started.
 * @param fileName File inside the migrations directory, for example `001_init.sql`.
 * @returns The SQL text.
 * @throws Error when the file is not found in any known location.
 */
export function migrationSql(fileName: string): string {
  const candidates = [
    path.resolve(__dirname, 'migrations', fileName),
    path.resolve(process.cwd(), 'src/db/migrations', fileName),
    path.resolve(process.cwd(), 'apps/api/src/db/migrations', fileName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(`Migration file ${fileName} was not found.`);
}
