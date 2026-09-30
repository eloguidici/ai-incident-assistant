import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { ErrorCode } from '../common/constants/error-code';
import { Pagination } from '../common/constants/pagination';
import { AppError } from '../common/http';
import { InjectConfig } from '../config';
import { llmConfig, type LlmConfig } from '../config/slices';
import { AnalysesService } from './analyses.service';

const createSchema = z.object({ sourceText: z.string() }).strict();
const questionSchema = z.object({ question: z.string() }).strict();

@UseGuards(AuthGuard)
@Controller('analyses')
export class AnalysesController {
  /**
   * @param analyses Use cases for listing, creating, retrying, and questioning analyses.
   * @param llmSettings Supplies the model deadline used to abort each request.
   */
  constructor(
    private readonly analyses: AnalysesService,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
  ) {}

  /**
   * @param request Authenticated request. The owner is `request.user`.
   * @param query `limit` and `offset`. Defaults are 20 and 0.
   * @returns The owner's analysis page.
   * @throws AppError VALIDATION_ERROR when limit or offset is out of range.
   */
  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    const page = readPage(query);
    return this.analyses.list(request.user!.id, page.limit, page.offset);
  }

  /**
   * @param response Used to abort the model call when the client disconnects.
   * @param body JSON object whose only field is `sourceText`.
   * @returns The created analysis.
   * @throws AppError VALIDATION_ERROR when the body has any other field.
   */
  @Post()
  create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const createBody = createSchema.safeParse(body);
    if (!createBody.success) throw new AppError(ErrorCode.ValidationError, 400, 'The body must contain only sourceText.');
    return this.withDeadline(response, (signal) =>
      this.analyses.create(request.user!, createBody.data.sourceText.trim(), request.correlationId, signal),
    );
  }

  /**
   * @param id Analysis id. A non-UUID is treated as not found.
   * @returns The owner's analysis detail.
   * @throws AppError NOT_FOUND.
   */
  @Get(':id')
  get(@Req() request: Request, @Param('id') id: string) {
    return this.analyses.get(request.user!.id, parseAnalysisId(id));
  }

  /**
   * @param id Analysis that must already be completed and owned by the caller.
   * @param body JSON object whose only field is `question`.
   * @returns The detail with the new messages.
   * @throws AppError VALIDATION_ERROR when the body has any other field.
   */
  @Post(':id/messages')
  question(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const questionBody = questionSchema.safeParse(body);
    if (!questionBody.success) throw new AppError(ErrorCode.ValidationError, 400, 'The body must contain only question.');
    return this.withDeadline(response, (signal) =>
      this.analyses.addQuestion(request.user!, parseAnalysisId(id), questionBody.data.question.trim(), request.correlationId, signal),
    );
  }

  /**
   * @param id Failed analysis to run again.
   * @returns The detail after the retry.
   * @throws AppError NOT_FOUND or CONFLICT. See {@link AnalysesService.retry}.
   */
  @Post(':id/retry')
  retry(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    return this.withDeadline(response, (signal) =>
      this.analyses.retry(request.user!, parseAnalysisId(id), request.correlationId, signal),
    );
  }

  /**
   * Runs `run` with a signal that aborts at the model deadline or when the response closes.
   * @param run Work that must stop when the signal aborts.
   * @returns Whatever `run` returns.
   */
  private async withDeadline<T>(response: Response, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.llmSettings.deadlineMs);
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
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
