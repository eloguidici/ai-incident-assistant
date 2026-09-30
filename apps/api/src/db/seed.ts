import bcrypt from 'bcryptjs';
import { assertDemoSeedAllowed } from '../config/env';
import type { AuthConfig } from '../config/slices';
import type { UserRepository } from './repositories/user.repository';

export const DEMO_EMAILS = ['analyst.a@example.test', 'analyst.b@example.test'] as const;

/**
 * Inserts the two local demo analysts when they are missing.
 * @param usersRepository Persistence port for user rows.
 * @param authSettings Demo password and the flag that allows seeding the local database.
 * @param databaseUrl Used only to decide whether this database may be seeded.
 */
export async function seedDemoUsers(usersRepository: UserRepository, authSettings: AuthConfig, databaseUrl: string): Promise<void> {
  assertDemoSeedAllowed(databaseUrl, authSettings.allowSeedDemo || databaseNameIncludesTest(databaseUrl));
  const passwordHash = await bcrypt.hash(authSettings.seedPassword, 10);
  for (const email of DEMO_EMAILS) {
    if (await usersRepository.findByEmail(email)) continue;
    await usersRepository.insert(email, passwordHash);
  }
}

/**
 * @param databaseUrl Postgres URL whose path segment names the database.
 * @returns True when the database name contains `test` (case-insensitive).
 */
function databaseNameIncludesTest(databaseUrl: string): boolean {
  return new URL(databaseUrl).pathname.toLowerCase().includes('test');
}
