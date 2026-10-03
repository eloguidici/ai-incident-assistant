/** Applied migration id tracked in schema_migrations. */
export const MigrationId = {
  Init: '001_init',
  PiiPolicy: '002_pii_policy',
} as const;

/** PostgreSQL advisory lock key for migration runners. */
export const MigrationAdvisoryLockKey = 814_201;
