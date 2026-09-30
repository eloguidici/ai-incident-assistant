import { DataSource } from 'typeorm';
import { AnalysesService } from '../src/analyses/analyses.service';
import { StartupService } from '../src/startup.service';
import { loadAppConfig } from '../src/config/env';
import { appConfig, authConfig, databaseConfig, llmConfig } from '../src/config/slices';
import { AppLogger } from '../src/common/app-logger';
import type { AnalysisRepository } from '../src/db/repositories/analysis.repository';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { stuckRecoveryIntervalMs } from '../src/domain/recovery';

jest.mock('../src/db/migrate', () => ({ applyMigrations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/db/database-bootstrap', () => ({ migrationPool: jest.fn() }));

describe('scheduled recovery lifecycle', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('retries after a database outage without restarting and stops on shutdown', async () => {
    jest.useFakeTimers();
    const config = loadAppConfig();
    const recoverStuck = jest.fn().mockResolvedValue(undefined);
    const repo = { recoverStuck, purgeExpired: jest.fn().mockResolvedValue(0) } as unknown as AnalysisRepository;
    const logger = { info: jest.fn(), error: jest.fn() } as unknown as AppLogger;
    const service = new AnalysesService(config.get(llmConfig), repo, logger);
    const destroy = jest.fn().mockResolvedValue(undefined);
    const startup = new StartupService(config.get(appConfig), config.get(authConfig), config.get(databaseConfig),
      config.get(llmConfig), { destroy } as unknown as DataSource, {} as UserRepository, service, logger);
    await startup.onModuleInit();
    recoverStuck.mockRejectedValueOnce(new Error('database unavailable'));
    const interval = stuckRecoveryIntervalMs(config.get(llmConfig).deadlineMs);
    await jest.advanceTimersByTimeAsync(interval);
    expect(logger.error).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(interval);
    expect(recoverStuck).toHaveBeenCalledTimes(3);
    const cutoff = recoverStuck.mock.calls[2][0] as Date;
    expect(cutoff.getTime()).toBeLessThan(Date.now() - config.get(llmConfig).deadlineMs);
    await startup.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(interval * 2);
    expect(recoverStuck).toHaveBeenCalledTimes(3);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a pending sweep and releases the guard after failure', async () => {
    const config = loadAppConfig();
    let rejectSweep!: (error: Error) => void;
    const recoverStuck = jest.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSweep = reject; }))
      .mockResolvedValue(undefined);
    const logger = { info: jest.fn(), error: jest.fn() } as unknown as AppLogger;
    const service = new AnalysesService(config.get(llmConfig), { recoverStuck } as unknown as AnalysisRepository, logger);
    const pending = service.recoverStuck();
    await service.recoverStuck();
    expect(recoverStuck).toHaveBeenCalledTimes(1);
    rejectSweep(new Error('temporary outage'));
    await pending;
    await service.recoverStuck();
    expect(recoverStuck).toHaveBeenCalledTimes(2);
  });
});
