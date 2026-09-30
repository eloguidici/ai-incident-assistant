import type { DataSourceOptions } from 'typeorm';
import { persistenceEntities } from './entities';

/**
 * Builds TypeORM options for PostgreSQL with synchronize disabled.
 * @param databaseUrl Connection string from configuration.
 */
export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: persistenceEntities,
    synchronize: false,
    logging: false,
    extra: { max: 10 },
  };
}
