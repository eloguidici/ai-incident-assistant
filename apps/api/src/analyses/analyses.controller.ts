import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { ErrorCode } from '../common/constants/error-code';
import { SessionCookieName } from '../common/constants/http';
import { Pagination } from '../common/constants/pagination';
import { AppError } from '../common/http';
import { InjectConfig } from '../config';
import { llmConfig, type LlmConfig } from '../config/slices';
import { ApiErrorResponseDto, AnalysisDetailResponseDto, CreateAnalysisRequestDto, ListAnalysesResponseDto, QuestionRequestDto } from '../openapi/dtos';
import { AddQuestionCommand } from './commands/add-question.types';
import { CreateAnalysisCommand } from './commands/create-analysis.types';
import { RetryAnalysisCommand } from './commands/retry-analysis.types';
import { GetAnalysisQuery } from './queries/get-analysis.types';
import { ListAnalysesQuery } from './queries/list-analyses.types';

const createSchema = z.object({ sourceText: z.string() }).strict();
const questionSchema = z.object({ question: z.string() }).strict();

@ApiTags('analyses')
@ApiCookieAuth(SessionCookieName)
@UseGuards(AuthGuard)
@Controller('analyses')
export class AnalysesController {
  /**
   * @param listAnalyses CQRS query for paginated summaries.
   * @param getAnalysis CQRS query for one owned detail.
   * @param createAnalysis CQRS command for new incident analysis.
   * @param addQuestion CQRS command for follow-up questions.
   * @param retryAnalysis CQRS command for failed analysis retry.
   * @param llmSettings Supplies the model deadline used to abort each request.
   */
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
  ) {}

  /**
   * @param request Authenticated request. The owner is `request.user`.
   * @param query `limit` and `offset`. Defaults are 20 and 0.
   * @returns The owner's analysis page.
   * @throws AppError VALIDATION_ERROR when limit or offset is out of range.
   */
  @Get()
  @ApiOperation({ summary: 'List analyses for the authenticated analyst' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–50, default 20).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Rows to skip (default 0).' })
  @ApiResponse({ status: 200, type: ListAnalysesResponseDto, description: 'Paginated summaries owned by the caller.' })
  @ApiResponse({ status: 400, type: ApiErrorResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    const page = readPage(query);
    return this.queryBus.execute(new ListAnalysesQuery(request.user!.id, page.limit, page.offset));
  }

  /**
   * @param response Used to abort the model call when the client disconnects.
   * @param body JSON object whose only field is `sourceText`.
   * @returns The created analysis.
   * @throws AppError VALIDATION_ERROR when the body has any other field.
   */
  @Post()
  @HttpCode(200)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Analyze incident text with the configured LLM provider' })
  @ApiBody({ type: CreateAnalysisRequestDto })
  @ApiResponse({ status: 200, type: AnalysisDetailResponseDto, description: 'Completed analysis detail, or processing state before failure handling.' })
  @ApiResponse({ status: 400, type: ApiErrorResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  @ApiResponse({ status: 413, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  @ApiResponse({ status: 429, type: ApiErrorResponseDto })
  @ApiResponse({ status: 502, type: ApiErrorResponseDto })
  @ApiResponse({ status: 504, type: ApiErrorResponseDto })
  create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const createBody = createSchema.safeParse(body);
    if (!createBody.success) throw new AppError(ErrorCode.ValidationError, 400, 'The body must contain only sourceText.');
    return this.withDeadline(response, (signal) =>
      this.commandBus.execute(
        new CreateAnalysisCommand(request.user!, createBody.data.sourceText.trim(), request.correlationId, signal),
      ),
    );
  }

  /**
   * @param id Analysis id. A non-UUID is treated as not found.
   * @returns The owner's analysis detail.
   * @throws AppError NOT_FOUND.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Fetch one analysis owned by the caller' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AnalysisDetailResponseDto, description: 'Analysis detail with messages and executions.' })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  get(@Req() request: Request, @Param('id') id: string) {
    return this.queryBus.execute(new GetAnalysisQuery(request.user!.id, parseAnalysisId(id)));
  }

  /**
   * @param id Analysis that must already be completed and owned by the caller.
   * @param body JSON object whose only field is `question`.
   * @returns The detail with the new messages.
   * @throws AppError VALIDATION_ERROR when the body has any other field.
   */
  @Post(':id/messages')
  @HttpCode(200)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Ask a follow-up question about the original incident text' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: QuestionRequestDto })
  @ApiResponse({ status: 200, type: AnalysisDetailResponseDto, description: 'Detail including the new user and assistant messages.' })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  @ApiResponse({ status: 413, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  @ApiResponse({ status: 429, type: ApiErrorResponseDto })
  @ApiResponse({ status: 502, type: ApiErrorResponseDto })
  question(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const questionBody = questionSchema.safeParse(body);
    if (!questionBody.success) throw new AppError(ErrorCode.ValidationError, 400, 'The body must contain only question.');
    return this.withDeadline(response, (signal) =>
      this.commandBus.execute(
        new AddQuestionCommand(
          request.user!,
          parseAnalysisId(id),
          questionBody.data.question.trim(),
          request.correlationId,
          signal,
        ),
      ),
    );
  }

  /**
   * @param id Failed analysis to run again.
   * @returns The detail after the retry.
   * @throws AppError NOT_FOUND or CONFLICT. See {@link RetryAnalysisHandler.execute}.
   */
  @Post(':id/retry')
  @HttpCode(200)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Retry a failed analysis' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AnalysisDetailResponseDto, description: 'Detail after the retry completes or fails.' })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  retry(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    return this.withDeadline(response, (signal) =>
      this.commandBus.execute(
        new RetryAnalysisCommand(request.user!, parseAnalysisId(id), request.correlationId, signal),
      ),
    );
  }

  /**
   * Runs `run` with a signal that aborts at the model deadline or when the response closes.
   * @param run Work that must stop when the signal aborts.
   * @returns Whatever `run` returns.
   */
  private async withDeadline<T>(response: Response, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const deadlineAt = Date.now() + this.llmSettings.deadlineMs;
    const timer = setTimeout(() => controller.abort('deadline'), Math.max(0, deadlineAt - Date.now()));
    const onClose = () => {
      if (!response.writableEnded) controller.abort('client');
    };
    response.on('close', onClose);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
      response.off('close', onClose);
    }
  }
}

/**
 * @param rawAnalysisId Path parameter.
 * @returns The same id when it is a UUID.
 * @throws AppError NOT_FOUND otherwise.
 */
function parseAnalysisId(rawAnalysisId: string): string {
  const analysisId = z.string().uuid().safeParse(rawAnalysisId);
  if (!analysisId.success) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
  return analysisId.data;
}

/**
 * @param query Query string values, still strings or missing.
 * @returns Integer limit and offset.
 * @throws AppError VALIDATION_ERROR when either value is out of range.
 */
function readPage(query: Record<string, unknown>): { limit: number; offset: number } {
  const limit = query.limit === undefined ? Pagination.DefaultLimit : Number(query.limit);
  const offset = query.offset === undefined ? Pagination.DefaultOffset : Number(query.offset);
  if (!Number.isInteger(limit) || limit < Pagination.MinLimit || limit > Pagination.MaxLimit) {
    throw new AppError(ErrorCode.ValidationError, 400, 'limit must be an integer between 1 and 50.');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > Pagination.MaxOffset) {
    throw new AppError(ErrorCode.ValidationError, 400, 'offset is not valid.');
  }
  return { limit, offset };
}

