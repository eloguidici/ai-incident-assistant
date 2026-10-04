import { ApiErrorCode, CsrfCookieName, CsrfHeaderName, RunStatus } from './constants';

export { RunStatus } from './constants';



export type AnalysisResult = {

  summary: string;

  category: string;

  suggestedSeverity: string;

  evidence: { quote: string; note: string }[];

  hypotheses: { statement: string; confidence: string }[];

  missingInformation: string[];

  uncertainty: string;

};



export type QuestionResult = AnalysisResult & { answer: string };



export type AnalysisMessage = {

  id: string;

  role: 'user' | 'assistant';

  content: string;

  status: RunStatus.Completed | RunStatus.Failed;

  result: QuestionResult | null;

  errorCode: string | null;

  sequence: number;

};



export type AnalysisDetail = {

  id: string;

  status: RunStatus;

  sourceText: string;

  /** True when the stored incident matches assistant-instruction patterns. Not a verdict or a block. */
  assistantInstructionsNoted: boolean;

  result: AnalysisResult | null;

  errorCode: string | null;

  errorMessage: string | null;

  promptVersion: string | null;

  provider: string | null;

  model: string | null;

  createdAt: string;

  expiresAt: string;

  messages: AnalysisMessage[];

  executions: { kind: string; status: Exclude<RunStatus, RunStatus.Pending>; attemptCount: number; promptVersion: string; model: string; latencyMs: number | null }[];

};



export type AnalysisListItem = {

  id: string;

  status: RunStatus;

  excerpt: string;

  summary: string | null;

  suggestedSeverity: string | null;

  errorCode: string | null;

  createdAt: string;

};



export class ApiError extends Error {

  /**

   * @param code Error code from the API body, or `HTTP_ERROR` when the body has none.

   * @param message Text safe to show to the analyst.

   * @param status HTTP status of the response.

   */

  constructor(

    readonly code: string,

    message: string,

    readonly status: number,

  ) {

    super(message);

  }

}



/** @returns The decoded CSRF cookie value, or undefined before sign-in. */

function csrfToken(): string | undefined {

  const csrfCookie = document.cookie.split('; ').find((cookiePart) => cookiePart.startsWith(`${CsrfCookieName}=`));

  return csrfCookie ? decodeURIComponent(csrfCookie.split('=').slice(1).join('=')) : undefined;

}



/**

 * Calls the API with the session cookie, a JSON content type when there is a body, and the CSRF header when available.

 * @param path API path, for example `/api/analyses`.

 * @param init Fetch options. Headers are merged.

 * @returns The parsed JSON body.

 * @throws ApiError when the response status is not 2xx.

 */

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {

  const headers = new Headers(init.headers);

  if (init.body) headers.set('content-type', 'application/json');

  const csrf = csrfToken();

  if (csrf) headers.set(CsrfHeaderName, csrf);

  const response = await fetch(path, { ...init, headers, credentials: 'include' });

  const responseBody = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;

  if (!response.ok) {

    throw new ApiError(

      responseBody?.error?.code ?? ApiErrorCode.HttpError,

      responseBody?.error?.message ?? 'The request could not be completed.',

      response.status,

    );

  }

  return responseBody as T;

}


