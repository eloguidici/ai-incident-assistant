import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { LlmGateway, type LlmProvider } from '../ai/gateway';
import { MockProvider } from '../ai/mock.provider';
import { OpenAiProvider } from '../ai/openai.provider';
import { OpenRouterProvider } from '../ai/openrouter.provider';
import { getConfigToken } from '../config';
import { llmConfig, type LlmConfig } from '../config/slices';
import { AddQuestionHandler } from './commands/add-question.handler';
import { CreateAnalysisHandler } from './commands/create-analysis.handler';
import { RetryAnalysisHandler } from './commands/retry-analysis.handler';
import { AnalysisCommandShared } from './analysis-command.shared';
import { AnalysesController } from './analyses.controller';
import { ListAnalysesHandler } from './queries/list-analyses.handler';
import { GetAnalysisHandler } from './queries/get-analysis.handler';
import { AnalysesService } from './analyses.service';

@Module({
  imports: [CqrsModule],
  controllers: [AnalysesController],
  providers: [
    AnalysesService,
    AnalysisCommandShared,
    ListAnalysesHandler,
    GetAnalysisHandler,
    CreateAnalysisHandler,
    RetryAnalysisHandler,
    AddQuestionHandler,
    {
      provide: 'LLM_PROVIDER',
      inject: [getConfigToken(llmConfig)],
      useFactory: (llmSettings: LlmConfig): LlmProvider => {
        if (llmSettings.provider === 'openai') return new OpenAiProvider(llmSettings);
        if (llmSettings.provider === 'openrouter') return new OpenRouterProvider(llmSettings);
        return new MockProvider();
      },
    },
    {
      provide: LlmGateway,
      inject: [getConfigToken(llmConfig), 'LLM_PROVIDER'],
      useFactory: (llmSettings: LlmConfig, provider: LlmProvider) => new LlmGateway(llmSettings, provider),
    },
  ],
  exports: [AnalysesService],
})
export class AnalysesModule {}
