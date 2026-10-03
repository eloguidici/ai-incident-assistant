import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Public analyst identity returned after login and on session checks. */
export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'analyst.a@example.test' })
  email!: string;
}

/** Credentials for `POST /auth/login`. */
export class LoginRequestDto {
  @ApiProperty({ format: 'email', maxLength: 320 })
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  password!: string;
}

/** Successful login payload. Session and CSRF values are also set as cookies. */
export class LoginResponseDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;

  @ApiProperty({ description: 'Echo of the CSRF cookie; send the same value in the CSRF header on mutating requests.' })
  csrfToken!: string;
}

/** Active session for `GET /auth/session`. */
export class SessionResponseDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;
}

/** Acknowledgement for `POST /auth/logout`. */
export class LogoutResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

/** Liveness probe for `GET /health`. */
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

/** Effective runtime character limits; no sensitive configuration is exposed. */
export class ContentLimitsResponseDto {
  @ApiProperty({ description: 'Whether this runtime requires local content protection.' })
  contentProtectionEnabled!: boolean;

  @ApiProperty({ description: 'Whether the optional PERSON detector is enabled; email/phone protection remains on when content protection is enabled.' })
  personProtectionEnabled!: boolean;

  @ApiProperty({ minimum: 20, maximum: 50000 })
  sourceTextMax!: number;

  @ApiProperty({ minimum: 1, maximum: 8000 })
  questionMax!: number;
}

/** Body for `POST /analyses`. No extra fields are allowed. */
export class CreateAnalysisRequestDto {
  @ApiProperty({ minLength: 1, description: 'Incident narrative. The effective maximum is returned by GET /analyses/limits.' })
  sourceText!: string;
}

/** Body for `POST /analyses/:id/messages`. */
export class QuestionRequestDto {
  @ApiProperty({ minLength: 1, description: 'Question text. The effective maximum is returned by GET /analyses/limits.' })
  question!: string;
}

/** Evidence item inside a structured analysis result. */
export class EvidenceDto {
  @ApiProperty({ maxLength: 500 })
  quote!: string;

  @ApiProperty({ maxLength: 500 })
  note!: string;
}

/** Hypothesis inside a structured analysis result. */
export class HypothesisDto {
  @ApiProperty({ maxLength: 500 })
  statement!: string;

  @ApiProperty({ enum: ['low', 'medium', 'high'] })
  confidence!: 'low' | 'medium' | 'high';
}

/** Model output stored on a completed analysis or question. */
export class AnalysisResultDto {
  @ApiProperty()
  summary!: string;

  @ApiProperty({ enum: ['availability', 'performance', 'security', 'data', 'unknown'] })
  category!: string;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical', 'unknown'] })
  suggestedSeverity!: string;

  @ApiProperty({ type: [EvidenceDto] })
  evidence!: EvidenceDto[];

  @ApiProperty({ type: [HypothesisDto] })
  hypotheses!: HypothesisDto[];

  @ApiProperty({ type: [String] })
  missingInformation!: string[];

  @ApiProperty()
  uncertainty!: string;

  @ApiPropertyOptional({ description: 'Present on question replies.' })
  answer?: string;
}

/** One row in `GET /analyses`. */
export class AnalysisListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  excerpt!: string;

  @ApiProperty({ nullable: true })
  summary!: string | null;

  @ApiProperty({ nullable: true })
  suggestedSeverity!: string | null;

  @ApiProperty({ nullable: true })
  errorCode!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

/** Paginated list for `GET /analyses`. */
export class ListAnalysesResponseDto {
  @ApiProperty({ type: [AnalysisListItemDto] })
  items!: AnalysisListItemDto[];

  @ApiProperty({
    type: 'object',
    properties: {
      limit: { type: 'number' },
      offset: { type: 'number' },
      total: { type: 'number' },
    },
  })
  page!: { limit: number; offset: number; total: number };
}

/** LLM run metadata on analysis detail (`executions[]`). */
export class AnalysisExecutionDto {
  @ApiProperty({ format: 'uuid', description: 'Stable execution row id (R02).' })
  id!: string;

  @ApiProperty()
  kind!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  promptVersion!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty({ nullable: true })
  latencyMs!: number | null;

  @ApiProperty({ nullable: true })
  inputTokens!: number | null;

  @ApiProperty({ nullable: true })
  outputTokens!: number | null;

  @ApiProperty({ nullable: true })
  errorCode!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Thread message on analysis detail. */
export class AnalysisMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: AnalysisResultDto, nullable: true })
  result!: AnalysisResultDto | null;

  @ApiProperty({ nullable: true })
  errorCode!: string | null;

  @ApiProperty()
  sequence!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Detail for `GET /analyses/:id` and successful mutating analysis routes. */
export class AnalysisDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  sourceText!: string;

  @ApiProperty({ type: AnalysisResultDto, nullable: true })
  result!: AnalysisResultDto | null;

  @ApiProperty({ nullable: true })
  errorCode!: string | null;

  @ApiProperty({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ nullable: true })
  promptVersion!: string | null;

  @ApiProperty({ nullable: true })
  provider!: string | null;

  @ApiProperty({ nullable: true })
  model!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: [AnalysisMessageDto] })
  messages!: AnalysisMessageDto[];

  @ApiProperty({ type: [AnalysisExecutionDto] })
  executions!: AnalysisExecutionDto[];
}

/** Standard API error envelope. Stacks are never included. */
export class ApiErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  correlationId!: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  analysisId!: string | null;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;
}
