import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectConfig } from './config';
import { assertTestDatabase } from './config/env';
import { appConfig, authConfig, databaseConfig, llmConfig, type AppConfig, type AuthConfig, type DatabaseConfig, type LlmConfig } from './config/slices';
import { applyMigrations, truncateDomain } from './db/migrate';
import { seedDemoUsers } from './db/seed';
import { DATA_SOURCE, USER_REPOSITORY } from './db/repositories/tokens';
import type { UserRepository } from './db/repositories/user.repository';
import { AppLogger } from './common/app-logger';
import { LogEvent } from './common/constants/log-event';
import { AnalysesService } from './analyses/analyses.service';
import { stuckRecoveryIntervalMs } from './domain/recovery';
import { migrationPool } from './db/database-bootstrap';

@Injectable()
export class StartupService implements OnModuleInit, OnModuleDestroy {
  private purgeTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;

  /**
   * @param appSettings E2E reset flag.
   * @param authSettings Demo seed flag and demo credentials.
   * @param databaseSettings Database URL, checked before an E2E reset.
   * @param llmSettings Used to schedule stuck-run recovery intervals.
   * @param dataSource Connection that is migrated and closed on shutdown.
   * @param users Repository used for demo seeding.
   * @param analyses Runs stuck-run recovery and retention purges.
   * @param logger Redacted structured logs for database readiness retries.
   */
  constructor(
    @InjectConfig(appConfig) private readonly appSettings: AppConfig,
    @InjectConfig(authConfig) private readonly authSettings: AuthConfig,
    @InjectConfig(databaseConfig) private readonly databaseSettings: DatabaseConfig,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly analyses: AnalysesService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Migrates the database, resets or seeds demo data when configured, recovers stuck runs, and schedules retention purge plus periodic recovery.
   * @throws Error when migrations keep failing after 10 attempts, or when an E2E reset targets a non-test database.
   */
  async onModuleInit(): Promise<void> {
    await this.migrateWithRetry();
    if (this.appSettings.e2eReset) {
      assertTestDatabase(this.databaseSettings.url);
      await truncateDomain(this.dataSource);
      await seedDemoUsers(this.users, this.authSettings, this.databaseSettings.url);
    } else if (this.authSettings.seedDemo) {
      await seedDemoUsers(this.users, this.authSettings, this.databaseSettings.url);
    }
    await this.analyses.recoverStuck();
    await this.runPurge('startup');
    const recoveryIntervalMs = stuckRecoveryIntervalMs(this.llmSettings.deadlineMs);
    this.recoveryTimer = setInterval(() => {
      void this.analyses.recoverStuck();
    }, recoveryIntervalMs);
    this.recoveryTimer.unref?.();
    this.purgeTimer = setInterval(() => {
      void this.runPurge('interval');
    }, 60 * 60 * 1000);
    this.purgeTimer.unref?.();
  }

  /** Stops scheduled jobs and closes the connection pool. */
  async onModuleDestroy(): Promise<void> {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.dataSource.destroy();
  }

  /**
   * Applies pending migrations, waiting one second between up to 10 attempts while the database starts.
   * @throws Error with the last database error code when every attempt fails.
   */
  private async migrateWithRetry(): Promise<void> {
    const pool = migrationPool(this.dataSource);
    let lastCode = 'unknown';
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        await applyMigrations(pool);
        return;
      } catch (error) {
        lastCode = readCode(error);
        this.logger.info({ msg: LogEvent.DatabaseNotReady, errorCode: lastCode, attempts: attempt });
        if (attempt === 10) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`The database could not be migrated. code=${lastCode}`);
  }

  /** Runs retention purge and logs failures without rejecting the process. */
  private async runPurge(trigger: string): Promise<void> {
    try {
      await this.analyses.purgeExpired();
    } catch (error) {
      this.logger.error({ msg: LogEvent.PersistFailure, errorCode: readCode(error), kind: trigger });
    }
  }
}

/**
 * @param error Anything thrown by the database driver.
 * @returns The driver error code, or `unknown` when there is none.
 */
function readCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'unknown';
}
