import path from 'node:path';
import { loadConfig, type ConfigRegistry } from './core';
import { loadEnvFiles } from './dotenv';
import { appSlices } from './slices';

/** Directories where `.env` may live when the process starts from the repo or from `apps/api`. */
export function envSearchRoots(): string[] {
  return [process.cwd(), path.resolve(process.cwd(), '../..')];
}

/**
 * Loads env files without overriding variables already set, then validates every slice.
 * @throws ConfigValidationError when a slice is invalid. The message names the field and does not include secret values.
 */
export function loadAppConfig(): ConfigRegistry {
  loadEnvFiles({ searchRoots: envSearchRoots() });
  return loadConfig({ slices: [...appSlices] });
}

/**
 * @param databaseUrl Postgres URL whose path is the database name.
 * @returns Decoded database name without the leading slash.
 */
export function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
}

/**
 * Refuses reset, rollback, and test seed unless the database name contains `test`.
 * @throws Error when the database is not marked as a test database.
 */
export function assertTestDatabase(databaseUrl: string): void {
  const name = databaseName(databaseUrl);
  if (!name.toLowerCase().includes('test')) {
    throw new Error(`Rejected operation: database "${name}" is not marked as a test database.`);
  }
}

/**
 * Allows demo users on a test database, or on `incident_assistant` when the demo flag is set.
 * @param allowDemo True only for the local demo database, never for an arbitrary name.
 * @throws Error for any other database.
 */
export function assertDemoSeedAllowed(databaseUrl: string, allowDemo: boolean): void {
  const name = databaseName(databaseUrl);
  if (name.toLowerCase().includes('test')) return;
  if (allowDemo && name === 'incident_assistant') return;
  throw new Error(`Seed rejected for database "${name}".`);
}
