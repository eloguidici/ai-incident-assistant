import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';
import { InflightLimiter } from '../common/limiters';
import type { LlmConfig } from '../config/slices';
import { isRetryable, ProviderRequestError, type LlmRequest, type LlmResponse } from './contracts';
export type LlmProvider = {
  readonly providerName: string;
  /**
   * Sends one prompt to the provider. Retries stay in {@link LlmGateway}.
   * @param request Prompt version, model, and messages.
   * @param signal Aborted when this attempt exceeds its time limit or the caller cancels.
   * @returns The raw model text and token counts when the provider reports them.
   * @throws ProviderRequestError when this attempt fails.
   */
  complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
};

export type LlmOutcome = {
  response: LlmResponse;
  attempts: number;
  latencyMs: number;
};

const DEFAULT_RETRY_BACKOFF_MS = 50;
const RETRY_JITTER_MS = 100;

/**
 * Backoff before a second attempt: provider Retry-After when present, otherwise a short default, plus jitter.
 * @param retryAfterMs Milliseconds from a rate-limit response, when the provider sent one.
 */
function retryBackoffMs(retryAfterMs?: number): number {
  const base = retryAfterMs ?? DEFAULT_RETRY_BACKOFF_MS;
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
  return base + jitter;
}

/** Calls the configured provider once, then once more when the failure is retryable and time remains. */
export class LlmGateway {
  private readonly inflight: InflightLimiter;

  /**
   * @param llmSettings Model name, per-attempt timeout, and the in-flight cap.
   * @param provider Mock or OpenAI implementation.
   */
  constructor(
    private readonly llmSettings: LlmConfig,
    private readonly provider: LlmProvider,
  ) {
    this.inflight = new InflightLimiter(llmSettings.maxInflight);
  }

  /**
   * Sends the prompt and records how many attempts it took.
   * Retry policy: at most two attempts; only {@link isRetryable} kinds; honours provider Retry-After on rate limits;
   * otherwise ~50ms plus jitter; parent abort cancels the wait and the in-flight attempt; no further retries after two failures.
   * @param request Prompt messages. The model is replaced with the configured one.
   * @param parentSignal Aborted when the HTTP client disconnects or the request deadline expires.
   * @param deadlineAt Epoch milliseconds when the whole call must stop.
   * @returns The provider response, the attempt count, and the elapsed time.
   * @throws AppError BUSY when the in-flight cap is full.
   * @throws ProviderRequestError when both attempts fail or the time budget runs out.
   */
  async complete(request: LlmRequest, parentSignal: AbortSignal, deadlineAt: number): Promise<LlmOutcome> {
    if (!this.inflight.tryEnter()) {
      throw new AppError(ErrorCode.Busy, 429, 'Too many AI requests are in progress. Try again in a few seconds.');
    }
    const started = Date.now();
    let attempts = 0;
    try {
      while (attempts < 2) {
        attempts += 1;
        const remaining = deadlineAt - Date.now();
        if (parentSignal.aborted || remaining < 200) {
          const kind = parentSignal.aborted ? parentAbortKind(parentSignal) : 'timeout';
          throw new ProviderRequestError(kind, 'The total time budget ran out.');
        }
        const attemptMs = Math.min(this.llmSettings.attemptTimeoutMs, remaining);
        const attemptController = new AbortController();
        const timer = setTimeout(() => attemptController.abort(), attemptMs);
        const onParent = () => attemptController.abort();
        parentSignal.addEventListener('abort', onParent);
        try {
          const response = await this.provider.complete(
            { ...request, model: this.llmSettings.provider === 'mock' ? 'mock-incident-v1' : this.llmSettings.model },
            attemptController.signal,
          );
          return { response, attempts, latencyMs: Date.now() - started };
        } catch (error) {
          const mapped = asProviderError(error, parentSignal.aborted, attemptController.signal.aborted, parentSignal);
          const budgetLeft = deadlineAt - Date.now();
          const waitMs = retryBackoffMs(mapped.retryAfterMs);
          const canRetry = attempts < 2 && isRetryable(mapped.kind) && !parentSignal.aborted && budgetLeft > waitMs + 200;
          mapped.attempts = attempts;
          if (!canRetry) throw mapped;
          await delay(Math.min(waitMs, budgetLeft - 200), parentSignal);
        } finally {
          clearTimeout(timer);
          parentSignal.removeEventListener('abort', onParent);
        }
      }
      throw new ProviderRequestError('timeout', 'The total time budget ran out.');
    } finally {
      this.inflight.leave();
    }
  }
}

/**
 * Turns a provider or abort failure into a {@link ProviderRequestError}.
 * @param error Value caught from {@link LlmProvider.complete}.
 * @param parentAborted True when the caller cancelled the whole request.
 * @param attemptAborted True when only this attempt's timer fired.
 * @returns `cancelled` for the caller, `timeout` when the attempt timer fired, otherwise the original or a network error.
 */
function parentAbortKind(signal: AbortSignal): 'cancelled' | 'timeout' {
  return signal.reason === 'deadline' ? 'timeout' : 'cancelled';
}

function asProviderError(error: unknown, parentAborted: boolean, attemptAborted: boolean, parentSignal: AbortSignal): ProviderRequestError {
  if (parentAborted) {
    return new ProviderRequestError(parentAbortKind(parentSignal), parentAbortKind(parentSignal) === 'timeout' ? 'The total time budget ran out.' : 'The request was cancelled.');
  }
  if (error instanceof ProviderRequestError) {
    if (error.kind === 'cancelled' && attemptAborted) return new ProviderRequestError('timeout', 'The attempt exceeded the time limit.');
    return error;
  }
  if (attemptAborted) return new ProviderRequestError('timeout', 'The attempt exceeded the time limit.');
  return new ProviderRequestError('network', 'The provider could not be reached.');
}

/**
 * Waits before the second attempt.
 * @param ms Delay taken from the provider hint, capped by the remaining budget.
 * @param signal Aborted when the caller cancels during the wait.
 * @throws ProviderRequestError cancelled when `signal` aborts.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new ProviderRequestError(
          parentAbortKind(signal),
          parentAbortKind(signal) === 'timeout' ? 'The total time budget ran out.' : 'The request was cancelled.',
        ),
      );
      return;
    }
    const handles: { timer?: ReturnType<typeof setTimeout> } = {};
    const onAbort = (): void => {
      if (handles.timer !== undefined) clearTimeout(handles.timer);
      signal.removeEventListener('abort', onAbort);
      reject(
        new ProviderRequestError(
          parentAbortKind(signal),
          parentAbortKind(signal) === 'timeout' ? 'The total time budget ran out.' : 'The request was cancelled.',
        ),
      );
    };
    signal.addEventListener('abort', onAbort);
    handles.timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}

/**
 * Maps a provider failure to the HTTP error the API returns.
 * @param error Failure after the gateway stopped retrying.
 * @param analysisId Present when a row was already stored for this call.
 * @returns AppError whose code matches `error.kind`.
 */
export function providerFailure(error: ProviderRequestError, analysisId?: string): AppError {
  switch (error.kind) {
    case 'timeout':
      return new AppError(ErrorCode.ProviderTimeout, 504, 'The analysis did not finish within the time limit.', analysisId);
    case 'cancelled':
      return new AppError(ErrorCode.Cancelled, 408, 'The request was cancelled before a result was saved.', analysisId);
    case 'rate_limit':
      return new AppError(
        ErrorCode.ProviderRateLimited,
        429,
        'The provider limited the request. There was no infinite retry.',
        analysisId,
      );
    case 'auth':
      return new AppError(ErrorCode.ProviderAuth, 502, 'The provider rejected the configured credential.', analysisId);
    default:
      return new AppError(ErrorCode.ProviderError, 502, 'The provider did not return a usable result.', analysisId);
  }
}
