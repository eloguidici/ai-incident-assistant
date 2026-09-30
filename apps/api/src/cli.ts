import 'reflect-metadata';
import { ConfigValidationError } from './config/core';
import { assertTestDatabase, loadAppConfig } from './config/env';
import { authConfig, databaseConfig } from './config/slices';
import { createAppDataSource, migrationPool } from './db/database-bootstrap';
import { applyMigrations, rollbackLatest, truncateDomain } from './db/migrate';
import { seedDemoUsers } from './db/seed';
import { UserEntity } from './db/entities/user.entity';
import { TypeOrmUserRepository } from './db/repositories/typeorm/user.typeorm-repository';

/**
 * Runs migrate, rollback, seed, seed-test, or reset against the configured database.
 * @returns Nothing. Exits 1 on configuration or safety errors.
 * @throws Error when the command name is not recognized.
 */
async function main(): Promise<void> {
  const command = process.argv[2];
  const registry = loadAppConfig();
  const databaseSettings = registry.get(databaseConfig);
  const authSettings = registry.get(authConfig);
  const dataSource = await createAppDataSource(databaseSettings.url);
  const users = new TypeOrmUserRepository(dataSource.getRepository(UserEntity));
  const pool = migrationPool(dataSource);
  try {
    if (command === 'rollback') {
      assertTestDatabase(databaseSettings.url);
      await rollbackLatest(pool);
      return;
    }
    await applyMigrations(pool);
    if (command === 'migrate') return;
    if (command === 'reset') {
      assertTestDatabase(databaseSettings.url);
      await truncateDomain(dataSource);
      await seedDemoUsers(users, authSettings, databaseSettings.url);
      return;
    }
    if (command === 'seed' || command === 'seed-test') {
      if (command === 'seed-test') assertTestDatabase(databaseSettings.url);
      await seedDemoUsers(users, authSettings, databaseSettings.url);
      return;
    }
    throw new Error('Unrecognized command. Use migrate, rollback, seed, seed-test, or reset.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Command error';
  if (
    error instanceof ConfigValidationError ||
    message.startsWith('Rejected operation') ||
    message.startsWith('Seed rejected') ||
    message.startsWith('Unrecognized command')
  ) {
    console.error(message);
  } else {
    console.error('The database command could not be completed.');
  }
  process.exit(1);
});
