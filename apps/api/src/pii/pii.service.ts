import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { InjectConfig } from '../config';
import { piiConfig, type PiiConfig } from '../config/slices';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';
import type { AnalysisResult, QuestionResult } from '../ai/contracts';

export const PII_SANITIZER = Symbol('PII_SANITIZER');
export const PII_POLICY_VERSION = 'pii-local-v1';
export const PII_CONTACT_POLICY_VERSION = 'pii-contacts-v1';

const batchResponse = z.object({
  texts: z.array(z.string().max(65536)).max(64),
  policyVersion: z.enum([PII_POLICY_VERSION, PII_CONTACT_POLICY_VERSION]),
  engineVersion: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:/@-]+$/),
  entityCounts: z.object({
    PERSON: z.number().int().min(0).max(65536).optional(),
    EMAIL_ADDRESS: z.number().int().min(0).max(65536).optional(),
    PHONE_NUMBER: z.number().int().min(0).max(65536).optional(),
  }).strict(),
}).strict();

/** Internal sanitation port; implementations must never return originals on failure. */
export interface PiiSanitizer {
  sanitize(texts: string[], scope: string, signal: AbortSignal): Promise<string[]>;
  ready(): Promise<void>;
}

/** Bounded HTTP adapter for the private local detector; never logs payloads or dependency errors. */
export class HttpPiiSanitizer implements PiiSanitizer {
  /** @param settings Internal endpoint and bounded timeout; no third-party credentials. */
  constructor(private readonly settings: PiiConfig) {}

  /** @param texts Narrative strings. @param scope Owner/incident scope. @param signal Cancellation. @returns Sanitized strings in input order. @throws AppError PII_UNAVAILABLE without dependency payloads. */
  async sanitize(texts: string[], scope: string, signal: AbortSignal): Promise<string[]> {
    const response = await this.request('/sanitize-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, scope }), signal,
    });
    try {
      const sanitized = batchResponse.parse(response);
      if (sanitized.policyVersion !== (this.settings.personEnabled ? PII_POLICY_VERSION : PII_CONTACT_POLICY_VERSION)) throw new Error();
      if (sanitized.texts.length !== texts.length || sanitized.texts.some((text) => text.includes('\u0000')) ||
        sanitized.texts.reduce((size, text) => size + text.length, 0) > 65536) throw new Error();
      return sanitized.texts;
    } catch {
      throw unavailable();
    }
  }

  /** @returns Nothing when the model and key are ready. @throws AppError PII_UNAVAILABLE. */
  async ready(): Promise<void> {
    const health = await this.request('/health', {});
    if (!health || typeof health !== 'object' || !('status' in health) || health.status !== 'ok') throw unavailable();
    if ('policyVersion' in health && health.policyVersion !== (this.settings.personEnabled ? PII_POLICY_VERSION : PII_CONTACT_POLICY_VERSION)) throw unavailable();
  }

  /** @param path Fixed internal route. @param init Fetch options. @returns Bounded JSON. @throws AppError PII_UNAVAILABLE; no raw error escapes. */
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetch(`${this.settings.url}${path}`, { ...init, signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 524288) { await reader.cancel(); throw new Error(); }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw unavailable();
    } finally { clearTimeout(timer); }
  }
}

/** Coordinates content-only sanitation and a conservative legacy-record boundary. */
@Injectable()
export class PiiService {
  /** @param settings Feature configuration. @param sanitizer Internal detection port. */
  constructor(
    @InjectConfig(piiConfig) private readonly settings: PiiConfig,
    @Inject(PII_SANITIZER) private readonly sanitizer: PiiSanitizer,
  ) {}

  /** @returns Persisted policy marker or null for explicitly unprotected mode. */
  policyVersion(): string | null {
    return this.settings.enabled ? (this.settings.personEnabled ? PII_POLICY_VERSION : PII_CONTACT_POLICY_VERSION) : null;
  }

  /** @param version Record marker. @returns Whether content is eligible for this runtime. */
  permits(version: string | null | undefined): boolean {
    return !this.settings.enabled || version === this.policyVersion();
  }

  /** @param version Record marker. @throws AppError PII_LEGACY_RECORD; no legacy content returned or forwarded. */
  assertProtected(version: string | null | undefined): void {
    if (!this.permits(version)) throw new AppError(ErrorCode.PiiLegacyRecord, 409,
      'This record predates content protection. Create a new analysis with synthetic or reviewed content.');
  }

  /** @returns Nothing when the enabled detector is reachable. @throws AppError PII_UNAVAILABLE. */
  async ready(): Promise<void> { if (this.settings.enabled) await this.sanitizer.ready(); }

  /** @param text Content only, never account email. @param ownerId Authenticated owner. @param analysisId Incident scope. @param signal Cancellation. @returns Sanitized content, or original only in explicitly disabled mode. @throws AppError PII_UNAVAILABLE/CONTEXT_LIMIT. */
  async sanitizeText(text: string, ownerId: string, analysisId: string, signal: AbortSignal): Promise<string> {
    if (!this.settings.enabled) return text;
    return (await this.sanitizer.sanitize([text], `${ownerId}:${analysisId}`, signal))[0];
  }

  /** Sanitizes generated narrative leaves, preserving exact quotes already grounded in the protected source. @param result Output validated against the protected source. @param ownerId Owner. @param analysisId Incident. @param signal Cancellation. @returns Copy ready for grounding/schema revalidation. @throws AppError PII_UNAVAILABLE. */
  async sanitizeResult<T extends AnalysisResult | QuestionResult>(result: T, ownerId: string, analysisId: string, signal: AbortSignal): Promise<T> {
    if (!this.settings.enabled) return result;
    const copy = structuredClone(result);
    const texts = [copy.summary, copy.uncertainty, ...copy.missingInformation,
      ...copy.evidence.map((evidence) => evidence.note),
      ...copy.hypotheses.map((hypothesis) => hypothesis.statement)];
    if ('answer' in copy) texts.push(copy.answer);
    const sanitized = await this.sanitizer.sanitize(texts, `${ownerId}:${analysisId}`, signal);
    let index = 0;
    copy.summary = sanitized[index++];
    copy.uncertainty = sanitized[index++];
    copy.missingInformation = copy.missingInformation.map(() => sanitized[index++]);
    // Quotes are exact copies of the already-protected source, not newly generated narrative.
    for (const evidence of copy.evidence) evidence.note = sanitized[index++];
    for (const hypothesis of copy.hypotheses) hypothesis.statement = sanitized[index++];
    if ('answer' in copy) copy.answer = sanitized[index++];
    return copy;
  }
}

/** @returns A closed dependency error with no source text, network URL or provider payload. */
function unavailable(): AppError {
  return new AppError(ErrorCode.PiiUnavailable, 503, 'Content protection is unavailable. The request could not complete safely. Please retry.');
}
