/** Applied migration id tracked in schema_migrations. */
export const MigrationId = {
  Init: '001_init',
} as const;

/** PostgreSQL advisory lock key for migration runners. */
export const MigrationAdvisoryLockKey = 814_201;
