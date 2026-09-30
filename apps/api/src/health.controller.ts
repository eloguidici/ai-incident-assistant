import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ANALYSIS_REPOSITORY } from './db/repositories/tokens';
import type { AnalysisRepository } from './db/repositories/analysis.repository';
import { ApiErrorResponseDto, HealthResponseDto } from './openapi/dtos';

@ApiTags('health')
@Controller('health')
export class HealthController {
  /** @param analyses Repository pinged by {@link health}. */
  constructor(@Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository) {}

  /**
   * Reports whether the API can reach PostgreSQL.
   * @returns `{ status: 'ok' }` when `select 1` succeeds.
   * @throws ServiceUnavailableException (503) when the database does not answer.
   */
  @Get()
  @ApiOperation({ summary: 'Report API and database readiness' })
  @ApiResponse({ status: 200, type: HealthResponseDto })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto })
  async health() {
    try {
      await this.analyses.ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
