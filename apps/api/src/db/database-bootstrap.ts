import { DataSource } from 'typeorm';
import type { Pool } from 'pg';
import { buildDataSourceOptions } from './data-source.options';

/**
 * Creates and initializes a TypeORM data source for CLI commands.
 * @param databaseUrl PostgreSQL connection string.
 */
export async function createAppDataSource(databaseUrl: string): Promise<DataSource> {
  const dataSource = new DataSource(buildDataSourceOptions(databaseUrl));
  await dataSource.initialize();
  return dataSource;
}

/**
 * @param dataSource Initialized TypeORM data source using the node-postgres driver.
 * @returns The pool used for advisory-lock migrations.
 */
export function migrationPool(dataSource: DataSource): Pool {
  return (dataSource.driver as unknown as { master: Pool }).master;
}
