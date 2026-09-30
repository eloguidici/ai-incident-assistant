import { Module } from '@nestjs/common';
import { LlmGateway, type LlmProvider } from '../ai/gateway';
import { MockProvider } from '../ai/mock.provider';
import { OpenAiProvider } from '../ai/openai.provider';
import { getConfigToken } from '../config';
import { llmConfig, type LlmConfig } from '../config/slices';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';

@Module({
  controllers: [AnalysesController],
  providers: [
    AnalysesService,
    {
      provide: 'LLM_PROVIDER',
      inject: [getConfigToken(llmConfig)],
      useFactory: (llmSettings: LlmConfig): LlmProvider =>
        llmSettings.provider === 'openai' ? new OpenAiProvider(llmSettings) : new MockProvider(),
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
