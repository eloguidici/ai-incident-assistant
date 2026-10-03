import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AnalysisResult, QuestionResult } from '../src/ai/contracts';
import { AppError } from '../src/common/http';
import { ErrorCode } from '../src/common/constants/error-code';
import { loadConfig } from '../src/config/core';
import { piiConfig, type PiiConfig } from '../src/config/slices';
import { HttpPiiSanitizer, PII_POLICY_VERSION, PII_CONTACT_POLICY_VERSION, PiiService, type PiiSanitizer } from '../src/pii/pii.service';

const syntheticEmail = 'contract.person@example.test';
const scope = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
const settings: PiiConfig = { enabled: true, personEnabled: true, url: 'http://127.0.0.1:1', timeoutMs: 150 };

/** @param texts Ordered synthetic texts. @returns A valid fake detector envelope; not detector quality evidence. */
function envelope(texts: string[]) {
  return { texts, policyVersion: PII_POLICY_VERSION, engineVersion: 'synthetic-contract-only.v1', entityCounts: {} };
}

describe('PII HTTP contracts (ephemeral synthetic server; no detector quality certification)', () => {
  let server: Server;
  let adapter: HttpPiiSanitizer;
  let handle: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    adapter = new HttpPiiSanitizer({ ...settings, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  afterEach(() => jest.restoreAllMocks());

  /** @param response JSON envelope or deliberately invalid payload. @param status HTTP response code. @returns Nothing. */
  function respond(response: unknown, status = 200): void {
    handle = (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    };
  }

  /** @param work Adapter operation. @returns The bounded application error. @throws Assertion failure if raw details escape. */
  async function expectClosedError(work: Promise<unknown>): Promise<AppError> {
    const error: unknown = await work.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ errorCode: ErrorCode.PiiUnavailable, status: 503 });
    expect((error as AppError).message.length).toBeLessThan(200);
    expect(JSON.stringify(error)).not.toContain(syntheticEmail);
    expect((error as AppError).message).not.toMatch(/127\.0\.0\.1|sanitize-batch|stack|ECONN/);
    return error as AppError;
  }

  it('sends only texts and incident scope to the fixed POST route and preserves order', async () => {
    let received: unknown;
    let route: string | undefined;
    let method: string | undefined;
    handle = (req, res) => {
      route = req.url;
      method = req.method;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        res.end(JSON.stringify(envelope(['[EMAIL_ADDRESS_0123456789ab]', 'HTTP 503'])));
      });
    };
    const signal = new AbortController().signal;
    expect(await adapter.sanitize([syntheticEmail, 'HTTP 503'], scope, signal))
      .toEqual(['[EMAIL_ADDRESS_0123456789ab]', 'HTTP 503']);
    expect(received).toEqual({ texts: [syntheticEmail, 'HTTP 503'], scope });
    expect(route).toBe('/sanitize-batch');
    expect(method).toBe('POST');
  });

  it.each([
    ['missing texts', { policyVersion: PII_POLICY_VERSION, engineVersion: 'fake', entityCounts: {} }],
    ['wrong count', envelope([])],
    ['non-string text', { ...envelope(['safe']), texts: [1] }],
    ['unsupported policy', { ...envelope(['safe']), policyVersion: 'pii-other-v1' }],
    ['missing policy', { texts: ['safe'], engineVersion: 'fake', entityCounts: {} }],
    ['extra originals field', { ...envelope(['safe']), originals: [syntheticEmail] }],
    ['unknown count type', { ...envelope(['safe']), entityCounts: { SECRET: 1 } }],
    ['negative count', { ...envelope(['safe']), entityCounts: { PERSON: -1 } }],
    ['fractional count', { ...envelope(['safe']), entityCounts: { PERSON: 0.5 } }],
    ['unsafe engine metadata', { ...envelope(['safe']), engineVersion: `raw ${syntheticEmail}` }],
    ['NUL text', envelope(['safe\u0000text'])],
    ['oversized text', envelope(['a'.repeat(65_537)])],
  ])('rejects %s without exposing the dependency payload', async (_name, response) => {
    respond(response);
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, new AbortController().signal));
  });

  it('bounds total text characters even when individual strings satisfy the schema', async () => {
    respond(envelope(['a'.repeat(40_000), 'b'.repeat(40_000)]));
    await expectClosedError(adapter.sanitize(['one', 'two'], scope, new AbortController().signal));
  });

  it.each([400, 429, 500, 503])('closes HTTP %s without logging its echoed content', async (status) => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    respond({ error: syntheticEmail }, status);
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, new AbortController().signal));
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain(syntheticEmail);
  });

  it('rejects redirects before the synthetic content can reach another endpoint', async () => {
    let destinationCalls = 0;
    handle = (req, res) => {
      if (req.url === '/redirect-target') destinationCalls++;
      res.writeHead(307, { Location: '/redirect-target' });
      res.end(syntheticEmail);
    };
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, new AbortController().signal));
    expect(destinationCalls).toBe(0);
  });

  it.each(['invalid JSON', 'empty body', 'body over byte limit'])('rejects %s', async (mode) => {
    handle = (_req, res) => res.end(mode === 'invalid JSON' ? `{${syntheticEmail}` : mode === 'empty body' ? '' : 'a'.repeat(524_289));
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, new AbortController().signal));
  });

  it.each(['before headers', 'during body'])('enforces a bounded timeout %s', async (mode) => {
    handle = (_req, res) => {
      if (mode === 'during body') { res.writeHead(200); res.write('{"texts":['); }
    };
    const started = Date.now();
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, new AbortController().signal));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('honors caller cancellation without exposing the abort reason', async () => {
    handle = () => undefined;
    const controller = new AbortController();
    controller.abort(new Error(syntheticEmail));
    await expectClosedError(adapter.sanitize([syntheticEmail], scope, controller.signal));
  });

  it('closes a network connection failure', async () => {
    const offline = new HttpPiiSanitizer(settings);
    await expectClosedError(offline.sanitize([syntheticEmail], scope, new AbortController().signal));
  });

  it('uses health for readiness and requires an explicit ok status', async () => {
    let route: string | undefined;
    handle = (req, res) => { route = req.url; res.end(JSON.stringify({ status: 'ok' })); };
    await expect(adapter.ready()).resolves.toBeUndefined();
    expect(route).toBe('/health');
    for (const invalid of [null, {}, { status: 'loading', detail: syntheticEmail }]) {
      respond(invalid);
      await expectClosedError(adapter.ready());
    }
  });
});

describe('PII service and configuration policy', () => {
  let sanitizer: jest.Mocked<PiiSanitizer>;
  let service: PiiService;
  beforeEach(() => {
    sanitizer = { sanitize: jest.fn(), ready: jest.fn().mockResolvedValue(undefined) };
    service = new PiiService(settings, sanitizer);
  });

  it('defaults to enabled protection and only disables through explicit configuration', () => {
    const config = loadConfig({ slices: [piiConfig], source: {} });
    expect(config.get(piiConfig).enabled).toBe(true);
    expect(loadConfig({ slices: [piiConfig], source: { PII_ENABLED: 'false' } }).get(piiConfig).enabled).toBe(false);
  });

  it('uses the owner and reserved incident id as scope and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    sanitizer.sanitize.mockResolvedValue(['[EMAIL_ADDRESS_0123456789ab]']);
    const [ownerId, analysisId] = scope.split(':');
    expect(await service.sanitizeText(syntheticEmail, ownerId, analysisId, signal)).toBe('[EMAIL_ADDRESS_0123456789ab]');
    expect(sanitizer.sanitize).toHaveBeenCalledWith([syntheticEmail], scope, signal);
  });

  it.each([undefined, null, '', 'pii-local-v0', 'pii-other-v1'])('blocks legacy policy %s', (version) => {
    expect(service.permits(version)).toBe(false);
    expect(() => service.assertProtected(version)).toThrow(expect.objectContaining({ errorCode: ErrorCode.PiiLegacyRecord, status: 409 }));
  });

  it('permits only the current stored marker when enabled', () => {
    expect(service.policyVersion()).toBe(PII_POLICY_VERSION);
    expect(service.permits(PII_POLICY_VERSION)).toBe(true);
    expect(() => service.assertProtected(PII_POLICY_VERSION)).not.toThrow();
  });

  it('isolates contacts-only records from full protection instead of upgrading their marker', () => {
    const contacts = new PiiService({ ...settings, personEnabled: false }, sanitizer);
    expect(contacts.policyVersion()).toBe(PII_CONTACT_POLICY_VERSION);
    expect(contacts.permits(PII_CONTACT_POLICY_VERSION)).toBe(true);
    expect(contacts.permits(PII_POLICY_VERSION)).toBe(false);
    expect(service.permits(PII_CONTACT_POLICY_VERSION)).toBe(false);
  });

  it('sanitizes generated narrative without re-detecting protected quotes or mutating enums', async () => {
    const candidate: QuestionResult = {
      summary: `Summary ${syntheticEmail}`, category: 'security', suggestedSeverity: 'high',
      evidence: [{ quote: `Quote [EMAIL_ADDRESS_${'a'.repeat(32)}]`, note: `Note ${syntheticEmail}` }],
      hypotheses: [{ statement: `Hypothesis ${syntheticEmail}`, confidence: 'low' }],
      missingInformation: [`Missing ${syntheticEmail}`], uncertainty: `Uncertainty ${syntheticEmail}`,
      answer: `Answer ${syntheticEmail}`,
    };
    sanitizer.sanitize.mockImplementation(async (texts) => texts.map((text) => text.replaceAll(syntheticEmail, '[EMAIL_ADDRESS_0123456789ab]')));
    const sanitized = await service.sanitizeResult(candidate, 'owner', 'incident', new AbortController().signal);
    expect(sanitizer.sanitize.mock.calls[0][0]).toEqual([
      candidate.summary, candidate.uncertainty, ...candidate.missingInformation,
      candidate.evidence[0].note, candidate.hypotheses[0].statement, candidate.answer,
    ]);
    expect(JSON.stringify(sanitized)).not.toContain(syntheticEmail);
    expect(sanitized.evidence[0].quote).toBe(candidate.evidence[0].quote);
    expect(sanitized).toMatchObject({ category: 'security', suggestedSeverity: 'high', hypotheses: [{ confidence: 'low' }] });
    expect(candidate.summary).toContain(syntheticEmail);
    expect(sanitized).not.toBe(candidate);
  });

  it('never falls back to original text or result when sanitation fails', async () => {
    const error = new AppError(ErrorCode.PiiUnavailable, 503, 'Content protection is unavailable.');
    sanitizer.sanitize.mockRejectedValue(error);
    await expect(service.sanitizeText(syntheticEmail, 'owner', 'incident', new AbortController().signal)).rejects.toBe(error);
    await expect(service.sanitizeResult({ summary: syntheticEmail, uncertainty: '', missingInformation: [], evidence: [], hypotheses: [] } as unknown as AnalysisResult,
      'owner', 'incident', new AbortController().signal)).rejects.toBe(error);
  });

  it('propagates readiness failure instead of treating missing protection as ready', async () => {
    sanitizer.ready.mockRejectedValue(new AppError(ErrorCode.PiiUnavailable, 503, 'Unavailable.'));
    await expect(service.ready()).rejects.toMatchObject({ errorCode: ErrorCode.PiiUnavailable });
  });

  it('marks explicitly disabled mode unprotected and does not invoke the detector', async () => {
    service = new PiiService({ ...settings, enabled: false }, sanitizer);
    expect(service.policyVersion()).toBeNull();
    expect(service.permits(null)).toBe(true);
    await expect(service.ready()).resolves.toBeUndefined();
    expect(await service.sanitizeText(syntheticEmail, 'owner', 'incident', new AbortController().signal)).toBe(syntheticEmail);
    expect(sanitizer.ready).not.toHaveBeenCalled();
    expect(sanitizer.sanitize).not.toHaveBeenCalled();
  });
});

const realDetector = process.env.PII_REAL_URL ? describe : describe.skip;
realDetector('optional actual detector HTTP integration (synthetic smoke; not corpus quality certification)', () => {
  it('removes synthetic names/email, preserves technical facts and keeps scope labels stable', async () => {
    const adapter = new HttpPiiSanitizer({ enabled: true, personEnabled: true, url: process.env.PII_REAL_URL!.replace(/\/$/, ''), timeoutMs: 10_000 });
    await adapter.ready();
    const input = 'Lucia Exampleperson reported HTTP 503 at 2026-10-02 10:15 UTC. Contact lucia.exampleperson@example.test.';
    const first = await adapter.sanitize([input], scope, new AbortController().signal);
    const repeated = await adapter.sanitize([input], scope, new AbortController().signal);
    expect(first).toEqual(repeated);
    expect(first[0]).not.toContain('Lucia Exampleperson');
    expect(first[0]).not.toContain('lucia.exampleperson@example.test');
    expect(first[0]).toContain('HTTP 503');
    expect(first[0]).toContain('2026-10-02 10:15 UTC');
    expect(await adapter.sanitize(first, scope, new AbortController().signal)).toEqual(first);
    const isolated = await adapter.sanitize([input], '11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333', new AbortController().signal);
    expect(isolated).not.toEqual(first);
  });
});
