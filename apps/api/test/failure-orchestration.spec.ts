import { AnalysisCommandShared } from '../src/analyses/analysis-command.shared';
import { AnalysesService } from '../src/analyses/analyses.service';
import { LlmGateway } from '../src/ai/gateway';
import { ProviderRequestError } from '../src/ai/contracts';
import { loadAppConfig } from '../src/config/env';
import { appConfig, llmConfig, limitsConfig } from '../src/config/slices';
import type { AnalysisRepository } from '../src/db/repositories/analysis.repository';
import { AppLogger } from '../src/common/app-logger';
import { ErrorCode } from '../src/common/constants/error-code';
import { AppError } from '../src/common/http';

describe('failure orchestration', () => {
  it('uses the execution-scoped atomic fallback and preserves the original attempt count', async () => {
    const config = loadAppConfig();
    const sourceError = new ProviderRequestError('server', 'Unavailable');
    sourceError.attempts = 2;
    const commitAnalysisFailure = jest.fn().mockRejectedValue(new Error('audit unavailable'));
    const closeAnalysisFailure = jest.fn().mockResolvedValue('committed');
    const repo = { commitAnalysisFailure, closeAnalysisFailure } as unknown as AnalysisRepository;
    const logger = { info: jest.fn(), error: jest.fn() } as unknown as AppLogger;
    const maintenance = new AnalysesService(config.get(llmConfig), repo, logger);
    const gateway = { complete: jest.fn().mockRejectedValue(sourceError) } as unknown as LlmGateway;
    const shared = new AnalysisCommandShared(config.get(appConfig), config.get(llmConfig), config.get(limitsConfig), repo, maintenance, gateway, logger);
    await expect(shared.finishAnalysis({ id: 'owner' }, 'analysis', 'Synthetic incident', 'correlation', new AbortController().signal, 'execution'))
      .rejects.toMatchObject({ errorCode: ErrorCode.ProviderError });
    expect(closeAnalysisFailure).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner', analysisId: 'analysis', executionId: 'execution', attemptCount: 2,
    }));
    expect(closeAnalysisFailure.mock.calls[0][0]).not.toHaveProperty('audit');
  });

  it('retains the question attempt count when the full failure commit and fallback both fail', async () => {
    const config = loadAppConfig();
    const sourceError = new ProviderRequestError('server', 'Unavailable');
    sourceError.attempts = 2;
    const finishExecution = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const recoverStuck = jest.fn().mockResolvedValue(undefined);
    const repo = { commitQuestionFailure: jest.fn().mockRejectedValue(new Error('database unavailable')), finishExecution } as unknown as AnalysisRepository;
    const logger = { info: jest.fn(), error: jest.fn() } as unknown as AppLogger;
    const shared = new AnalysisCommandShared(config.get(appConfig), config.get(llmConfig), config.get(limitsConfig), repo,
      { recoverStuck } as unknown as AnalysesService, {} as LlmGateway, logger);
    await shared.recordQuestionFailure({ ownerId: 'owner', analysisId: 'analysis', executionId: 'execution',
      question: 'Synthetic question', appError: new AppError(ErrorCode.ProviderError, 502, 'Provider unavailable'),
      sourceError, outcome: undefined, correlationId: 'correlation', userMessageStored: false });
    expect(finishExecution).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'execution', attemptCount: 2 }));
    expect(recoverStuck).toHaveBeenCalledTimes(1);
  });
});
