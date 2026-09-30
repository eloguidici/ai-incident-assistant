import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

export interface EnvFileLoaderOptions {
  /** Directories where env files may exist. No machine-specific path is inferred. */
  searchRoots: readonly string[];
  /** Checked in order. Defaults to `.env.local`, then `.env`. */
  fileNames?: readonly string[];
  /** When false, variables already present in `process.env` win. */
  override?: boolean;
}

export interface EnvFileLoadResult {
  loadedFiles: string[];
}

/**
 * @param options Search roots and file names. Missing files are skipped.
 * @returns Absolute paths of the env files that exist, without loading them.
 */
export function resolveEnvFiles(options: EnvFileLoaderOptions): string[] {
  const fileNames = options.fileNames ?? ['.env.local', '.env'];
  const candidates: string[] = [];

  for (const root of options.searchRoots) {
    for (const fileName of fileNames) {
      const candidate = path.resolve(root, fileName);

      if (existsSync(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

/**
 * Loads existing env files. Values already set in the process are kept unless `override` is true.
 * @throws When dotenv cannot read a file that exists.
 */
export function loadEnvFiles(options: EnvFileLoaderOptions): EnvFileLoadResult {
  const loadedFiles: string[] = [];

  for (const file of resolveEnvFiles(options)) {
    const result = loadDotenv({
      path: file,
      override: options.override ?? false,
      quiet: true,
    });

    if (result.error) {
      throw result.error;
    }

    loadedFiles.push(file);
  }

  return { loadedFiles };
}
