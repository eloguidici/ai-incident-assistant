import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AnalysisResult, QuestionResult } from '../src/ai/contracts';
import type { LlmProvider } from '../src/ai/gateway';
import { MockFaultTag } from '../src/ai/mock-fault-tags';
import { resetMockState } from '../src/ai/mock.provider';
import { AppLogger } from '../src/common/app-logger';
import { ErrorCode } from '../src/common/constants/error-code';
import { CorrelationIdHeaderName, CsrfHeaderName } from '../src/common/constants/http';
import { LogEvent } from '../src/common/constants/log-event';
import { assertTestDatabase, loadAppConfig } from '../src/config/env';
import { authConfig, databaseConfig, llmConfig } from '../src/config/slices';
import { migrationPool } from '../src/db/database-bootstrap';
import { applyMigrations, truncateDomain } from '../src/db/migrate';
import { ANALYSIS_REPOSITORY, USER_REPOSITORY } from '../src/db/repositories/tokens';
import type { AnalysisRepository } from '../src/db/repositories/analysis.repository';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { seedDemoUsers } from '../src/db/seed';
import { RunStatus } from '../src/domain/run-status';
import { HttpPiiSanitizer, PII_POLICY_VERSION, PII_SANITIZER, PiiService, type PiiSanitizer } from '../src/pii/pii.service';

const technicalFact = 'Payments returned HTTP 503 for twelve minutes.';
const person = 'Alicia Exampleperson';
const email = 'alicia.exampleperson@example.test';
const phone = '+54 11 5555 0123';
const outputPerson = 'Marco Fictionperson';
const outputEmail = 'marco.fictionperson@example.test';
const source = `${technicalFact} ${person} reported it from ${email}, phone ${phone}. Cause is unconfirmed.`;
const sentinels = [person, email, phone, outputPerson, outputEmail];
const syntheticEntities = [
  [person, 'PERSON'], [email, 'EMAIL_ADDRESS'], [phone, 'PHONE_NUMBER'],
  [outputPerson, 'PERSON'], [outputEmail, 'EMAIL_ADDRESS'],
] as const;
type DetectorMode = 'ok' | 'unavailable' | 'timeout' | 'malformed' | 'output-unavailable' | 'bad-grounding' | 'bad-schema' | 'quote-context';
type Batch = { texts: string[]; scope: string };
type Session = { agent: ReturnType<typeof request.agent>; csrf: string; ownerId: string };

/** @param text Synthetic fixture only. @param scope Incident scope. @returns Deterministic fake labels; this is not a NER quality test. */
function syntheticSanitize(text: string, scope: string): string {
  for (const [value, type] of syntheticEntities) {
    const label = createHmac('sha256', 'public-synthetic-contract-test-key').update(`${scope}:${type}:${value}`).digest('hex').slice(0, 32);
    text = text.replaceAll(value, `[${type}_${label}]`);
  }
  return text;
}

/**
 * Builds a synthetic provider response with exact evidence and narrative PII.
 * @param question Whether to include an answer.
 * @param known Whether the synthetic identity exists in the source.
 * @param contactScope Protects the contact as the provider would see it; names stay raw to exercise output sanitation.
 * @returns A schema-valid analysis or question fixture, not a detector-quality assertion.
 */
function outputWithPii(question = false, known = false, contactScope?: string): AnalysisResult | QuestionResult {
  const resultPerson = known ? person : outputPerson;
  const originalEmail = known ? email : outputEmail;
  const resultEmail = contactScope ? syntheticSanitize(originalEmail, contactScope) : originalEmail;
  const result: AnalysisResult = {
    summary: `${resultPerson} reported a payments symptom.`, category: 'availability', suggestedSeverity: 'high',
    evidence: [{ quote: technicalFact, note: `Contact ${resultEmail} for metrics.` }],
    hypotheses: [{ statement: `${resultPerson} may have additional evidence; cause is unconfirmed.`, confidence: 'low' }],
    missingInformation: [`Metrics from ${resultEmail}.`], uncertainty: `${resultPerson} has not confirmed the cause.`,
  };
  return question ? { ...result, answer: `${resultPerson} could supply metrics via ${resultEmail}; cause remains unconfirmed.` } : result;
}

describe('T22 protected API + PostgreSQL + synthetic HTTP detector (not detector quality certification)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;
  let mode: DetectorMode = 'ok';
  let batches: Batch[] = [];
  let provider: jest.SpyInstance;
  let adapter: jest.SpyInstance;
  let repository: AnalysisRepository;
  let a: Session;
  let b: Session;
  let logs: jest.SpyInstance[];
  let consoleLogs: jest.SpyInstance[];
  const environmentKeys = ['PII_ENABLED', 'PII_SERVICE_URL', 'PII_TIMEOUT_MS', 'RATE_LIMIT_ANALYSES_PER_HOUR', 'RATE_LIMIT_QUESTIONS_PER_HOUR'] as const;
  const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    const config = loadAppConfig();
    assertTestDatabase(config.get(databaseConfig).url);
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(mode === 'unavailable' ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: mode === 'unavailable' ? 'loading' : 'ok' }));
        return;
      }
      if (req.url !== '/sanitize-batch' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const batch = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Batch;
        batches.push(batch);
        if (mode === 'timeout') return;
        const isOutput = batch.texts.length > 1;
        if (mode === 'unavailable' || (mode === 'output-unavailable' && isOutput)) {
          res.writeHead(503); res.end(JSON.stringify({ error: `${person} ${email}` })); return;
        }
        if (mode === 'malformed') { res.end(JSON.stringify({ texts: batch.texts, originals: [email] })); return; }
        const texts = batch.texts.map((text) => syntheticSanitize(text, batch.scope));
        if (mode === 'quote-context' && isOutput) {
          const quoteIndex = texts.indexOf(technicalFact);
          if (quoteIndex >= 0) texts[quoteIndex] = 'Invented evidence absent from the protected source.';
        }
        if (mode === 'bad-grounding' && isOutput) texts[0] += ' See https://foreign.example.test.';
        if (mode === 'bad-schema' && isOutput) texts[0] = '';
        res.end(JSON.stringify({ texts, policyVersion: PII_POLICY_VERSION, engineVersion: 'synthetic-contract-only.v1', entityCounts: {} }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, {
      PII_ENABLED: 'true', PII_SERVICE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, PII_TIMEOUT_MS: '150',
      RATE_LIMIT_ANALYSES_PER_HOUR: '1000', RATE_LIMIT_QUESTIONS_PER_HOUR: '2000',
    });
    // Config registration captures process.env during module import, so import after the endpoint is assigned.
    const { createApplication } = await import('../src/main');
    app = await createApplication();
    await app.init();
    expect(app.get(PiiService).policyVersion()).toBe(PII_POLICY_VERSION);
    dataSource = app.get(DataSource);
    await applyMigrations(migrationPool(dataSource));
    await truncateDomain(dataSource);
    await seedDemoUsers(app.get<UserRepository>(USER_REPOSITORY), config.get(authConfig), config.get(databaseConfig).url);
    repository = app.get<AnalysisRepository>(ANALYSIS_REPOSITORY);
    a = await login('demo1@demo.com');
    b = await login('demo2@demo.com');
  });
  beforeEach(() => {
    mode = 'ok';
    batches = [];
    resetMockState();
    provider = jest.spyOn(app.get<LlmProvider>('LLM_PROVIDER'), 'complete');
    adapter = jest.spyOn(app.get<PiiSanitizer>(PII_SANITIZER) as HttpPiiSanitizer, 'sanitize');
    const logger = app.get(AppLogger);
    logs = [jest.spyOn(logger, 'info'), jest.spyOn(logger, 'warn'), jest.spyOn(logger, 'error')];
    consoleLogs = [jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined), jest.spyOn(console, 'error').mockImplementation(() => undefined)];
  });
  it('requires authentication and exposes only the effective content limits', async () => {
    await request(app.getHttpServer()).get('/api/analyses/limits').expect(401);
    const response = await a.agent.get('/api/analyses/limits').expect(200);
    const settings = loadAppConfig().get(llmConfig);
    expect(response.body).toEqual({ sourceTextMax: settings.sourceTextMax, questionMax: settings.questionMax,
      contentProtectionEnabled: true, personProtectionEnabled: true });
    expect(adapter).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    try {
      assertNoSentinels(logs.map((log) => log.mock.calls));
      assertNoSentinels(consoleLogs.map((log) => log.mock.calls));
      assertNoSentinels(provider.mock.calls.map(([payload]) => payload));
      const stored = await dataSource.query(
        `select row_to_json(a) as data from analyses a union all select row_to_json(m) from messages m
         union all select row_to_json(e) from ai_executions e union all select row_to_json(v) from audit_events v`,
      );
      assertNoSentinels(stored);
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    await app?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** @param email Account fixture, intentionally outside content sanitation. @returns Authenticated session. @throws Assertion failure on login rejection. */
  async function login(email: string): Promise<Session> {
    const agent = request.agent(app.getHttpServer());
    const response = await agent.post('/api/auth/login').send({ email, password: 'Demo1234$' });
    expect(response.status).toBe(201);
    return { agent, csrf: response.body.csrfToken as string, ownerId: response.body.user.id as string };
  }

  /** @param value Public result, logs, provider inputs or persisted rows. @returns Nothing. @throws Assertion failure on synthetic PII leakage. */
  function assertNoSentinels(value: unknown): void {
    const serialized = JSON.stringify(value);
    for (const sentinel of sentinels) expect({ sentinel, leaked: serialized.includes(sentinel) }).toEqual({ sentinel, leaked: false });
  }

  /** @param text Incident fixture. @param session Owner session. @returns Create request. */
  function create(text = source, session = a) {
    return session.agent.post('/api/analyses').set(CsrfHeaderName, session.csrf).send({ sourceText: text });
  }

  /** @param analysisId Owned incident. @param question Synthetic question. @param session Owner session. @returns Question request. */
  function ask(analysisId: string, question: string, session = a) {
    return session.agent.post(`/api/analyses/${analysisId}/messages`).set(CsrfHeaderName, session.csrf).send({ question });
  }

  /** @param candidate Validated synthetic output. @returns Nothing; overrides only one local mock provider response. */
  function nextOutput(candidate: AnalysisResult | QuestionResult): void {
    provider.mockResolvedValueOnce({ rawText: JSON.stringify(candidate), provider: 'mock', model: 'scripted-pii-contract', inputTokens: null, outputTokens: null });
  }

  /** @returns Mutation-sensitive snapshots of every domain row, excluding unchanged account fixtures. */
  async function domainSnapshot(): Promise<unknown> {
    return dataSource.query(
      `select 'analyses' as kind, row_to_json(a)::text as data from analyses a
       union all select 'messages', row_to_json(m)::text from messages m
       union all select 'executions', row_to_json(e)::text from ai_executions e
       union all select 'audits', row_to_json(v)::text from audit_events v order by kind, data`,
    );
  }

  it('reserves the UUID in memory, sanitizes before DB reservation, and sends only protected source to the provider', async () => {
    const reserve = jest.spyOn(repository, 'reserveProcessingAnalysisWithExecution');
    const response = await create();
    expect(response.status).toBe(200);
    expect(response.body.status).toBe(RunStatus.Completed);
    const analysisId = response.body.id as string;
    expect(batches[0].scope).toBe(`${a.ownerId}:${analysisId}`);
    expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);
    expect(adapter.mock.invocationCallOrder[0]).toBeLessThan(reserve.mock.invocationCallOrder[0]);
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ analysisId, piiPolicyVersion: PII_POLICY_VERSION, sourceText: syntheticSanitize(source, batches[0].scope) }));
    expect(response.body.sourceText).toBe(syntheticSanitize(source, batches[0].scope));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0].messages[1].content).toContain(response.body.sourceText);
    assertNoSentinels(response.body);
    const rows = await dataSource.query('select pii_policy_version, source_text from analyses where id = $1', [analysisId]);
    expect(rows).toEqual([{ pii_policy_version: PII_POLICY_VERSION, source_text: response.body.sourceText }]);
    for (const evidence of response.body.result.evidence) expect(response.body.sourceText).toContain(evidence.quote);
    expect((await a.agent.get('/api/auth/session')).body.user.email).toBe('demo1@demo.com');
  });

  it('sanitizes questions, known output PII and stored history before the next actual provider input', async () => {
    const created = await create();
    expect(created.status).toBe(200);
    nextOutput(outputWithPii(true, true, `${a.ownerId}:${created.body.id}`));
    const asked = await ask(created.body.id, `Did ${person} report ${email} and ${phone}?`);
    expect(asked.status).toBe(200);
    assertNoSentinels(asked.body);
    const userMessage = asked.body.messages.find((message: { role: string }) => message.role === 'user');
    expect(userMessage.content).toBe(syntheticSanitize(`Did ${person} report ${email} and ${phone}?`, `${a.ownerId}:${created.body.id}`));
    const assistant = asked.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.content).toContain('[PERSON_');
    expect(assistant.result.evidence[0].quote).toBe(technicalFact);
    expect(asked.body.result).toEqual(created.body.result);
    provider.mockClear();
    const followUp = await ask(created.body.id, 'Which metrics remain missing?');
    expect(followUp.status).toBe(200);
    expect(provider.mock.calls[0][0].messages[1].content).toContain(userMessage.content);
    expect(provider.mock.calls[0][0].messages[1].content).toContain(assistant.content);
    expect(batches.every((batch) => batch.scope === `${a.ownerId}:${created.body.id}`)).toBe(true);
  });

  it('sanitizes every analysis result narrative leaf while preserving grounded evidence and schema enums', async () => {
    nextOutput(outputWithPii(false, true));
    const response = await create();
    expect(response.status).toBe(200);
    assertNoSentinels(response.body.result);
    expect(response.body.result).toMatchObject({ category: 'availability', suggestedSeverity: 'high', hypotheses: [{ confidence: 'low' }] });
    expect(response.body.result.evidence[0].quote).toBe(technicalFact);
    expect(response.body.result.summary).toContain('[PERSON_');
    const stored = await dataSource.query('select result from analyses where id = $1', [response.body.id]);
    expect(stored[0].result).toEqual(response.body.result);
  });

  it.each(['bad-grounding', 'bad-schema'] as const)('revalidates %s after output sanitation and saves no invalid result', async (failure) => {
    mode = failure;
    nextOutput(outputWithPii(false, true));
    const response = await create();
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCode.InvalidOutput);
    const rows = await dataSource.query('select status, result from analyses where id = $1', [response.body.error.analysisId]);
    expect(rows).toEqual([{ status: RunStatus.Failed, result: null }]);
  });

  it('preserves exact already-protected quotes when detector context would change their identity', async () => {
    mode = 'quote-context';
    nextOutput(outputWithPii(false, true));
    const response = await create();
    expect(response.status).toBe(200);
    expect(response.body.result.evidence[0].quote).toBe(technicalFact);
    expect(batches[1].texts).not.toContain(technicalFact);
    assertNoSentinels(response.body);
    const stored = await a.agent.get(`/api/analyses/${response.body.id}`);
    expect(stored.body.result.evidence[0].quote).toBe(technicalFact);
  });

  it.each(['unavailable', 'timeout', 'malformed'] as const)('writes no domain rows and calls no provider when input sanitation is %s', async (failure) => {
    const before = await domainSnapshot();
    mode = failure;
    const response = await create();
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(ErrorCode.PiiUnavailable);
    assertNoSentinels(response.body);
    expect(response.body.error.message).not.toContain(process.env.PII_SERVICE_URL);
    expect(response.body.error.analysisId).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(await domainSnapshot()).toEqual(before);
    mode = 'ok';
    expect((await create()).status).toBe(200);
  });

  it.each(['unavailable', 'timeout', 'malformed'] as const)('never persists the original failed question when sanitation is %s', async (failure) => {
    const created = await create();
    expect(created.status).toBe(200);
    provider.mockClear();
    const before = await domainSnapshot();
    mode = failure;
    const response = await ask(created.body.id, `What did ${person} send to ${email}?`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(ErrorCode.PiiUnavailable);
    expect(provider).not.toHaveBeenCalled();
    expect(await domainSnapshot()).toEqual(before);
    mode = 'ok';
    expect((await ask(created.body.id, 'Can metrics clarify the cause?')).status).toBe(200);
  });

  it('never persists a raw model response when output sanitation is unavailable and permits a safe retry', async () => {
    mode = 'output-unavailable';
    nextOutput(outputWithPii());
    const failed = await create();
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe(ErrorCode.PiiUnavailable);
    const id = failed.body.error.analysisId as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await dataSource.query('select status, result from analyses where id = $1', [id]))[0]).toEqual({ status: RunStatus.Failed, result: null });
    mode = 'ok';
    const retried = await a.agent.post(`/api/analyses/${id}/retry`).set(CsrfHeaderName, a.csrf).send({});
    expect(retried.status).toBe(200);
    expect(retried.body.sourceText).toBe(syntheticSanitize(source, `${a.ownerId}:${id}`));
    expect(retried.body.executions).toHaveLength(2);
    expect(retried.body.executions.every((execution: { status: string }) => execution.status !== RunStatus.Processing)).toBe(true);
  });

  it.each(['output-unavailable', 'bad-grounding', 'bad-schema'] as const)('preserves a successful analysis when question output is %s', async (failure) => {
    const created = await create();
    expect(created.status).toBe(200);
    nextOutput(outputWithPii(true, true, `${a.ownerId}:${created.body.id}`));
    mode = failure;
    const response = await ask(created.body.id, `What did ${person} observe?`);
    expect(response.status).toBe(failure === 'output-unavailable' ? 503 : 422);
    expect(batches.at(-1)!.texts.length).toBeGreaterThan(1);
    const loaded = await a.agent.get(`/api/analyses/${created.body.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.result).toEqual(created.body.result);
    expect(loaded.body.messages.at(-1).status).toBe(RunStatus.Failed);
    assertNoSentinels(loaded.body);
    const executing = await dataSource.query("select id from ai_executions where analysis_id = $1 and status = 'processing'", [created.body.id]);
    expect(executing).toEqual([]);
  });

  it('accepts labels introduced by trusted analysis sanitation and persists only protected output', async () => {
    nextOutput(outputWithPii());
    const response = await create();
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(batches[1].texts.join('\n')).toContain(outputPerson);
    expect(batches[1].texts.join('\n')).toContain(outputEmail);
    const scope = `${a.ownerId}:${response.body.id}`;
    expect(response.body.result.summary).toContain(syntheticSanitize(outputPerson, scope));
    expect(response.body.result.missingInformation[0]).toContain(syntheticSanitize(outputEmail, scope));
    expect(response.body.sourceText).not.toContain(syntheticSanitize(outputPerson, scope));
    const stored = await dataSource.query('select status, result from analyses where id = $1', [response.body.id]);
    expect(stored).toEqual([{ status: RunStatus.Completed, result: response.body.result }]);
    assertNoSentinels(response.body);
  });

  it.each([true, false])('rejects raw question contacts before output sanitation (known identity: %s)', async (known) => {
    const created = await create();
    expect(created.status).toBe(200);
    provider.mockClear(); adapter.mockClear(); batches = [];
    nextOutput(outputWithPii(true, known));
    const response = await ask(created.body.id, `What did ${person} report?`);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCode.InvalidOutput);
    expect(response.body.error.analysisId).toBe(created.body.id);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].texts).toHaveLength(1);
    const loaded = await a.agent.get(`/api/analyses/${created.body.id}`);
    expect(loaded.body.result).toEqual(created.body.result);
    expect(loaded.body.messages.at(-1).status).toBe(RunStatus.Failed);
    assertNoSentinels(loaded.body);
  });

  it('rejects a fabricated valid privacy label even with a grounded quote', async () => {
    const fabricated = `[PERSON_${'f'.repeat(32)}]`;
    nextOutput({ ...outputWithPii(false, true), summary: `${fabricated} reported the symptom.` });
    const response = await create();
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCode.InvalidOutput);
    expect((await dataSource.query('select result from analyses where id = $1', [response.body.error.analysisId]))[0].result).toBeNull();
    expect(JSON.stringify(provider.mock.calls[0][0])).not.toContain(fabricated);
  });

  it('rejects an actual label from another owner/incident in a question response', async () => {
    const other = await create(source, b);
    const created = await create();
    expect(other.status).toBe(200); expect(created.status).toBe(200);
    const foreignLabel = other.body.sourceText.match(/\[PERSON_[a-f0-9]{32}\]/)[0] as string;
    expect(created.body.sourceText).not.toContain(foreignLabel);
    provider.mockClear();
    nextOutput({ ...outputWithPii(true, true, `${a.ownerId}:${created.body.id}`), answer: `${foreignLabel} might clarify the cause.` } as QuestionResult);
    const response = await ask(created.body.id, 'Who can clarify the metrics?');
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCode.InvalidOutput);
    expect(batches.at(-1)!.texts.length).toBeGreaterThan(1);
    expect(JSON.stringify(provider.mock.calls[0][0])).not.toContain(foreignLabel);
    const loaded = await a.agent.get(`/api/analyses/${created.body.id}`);
    expect(loaded.body.result).toEqual(created.body.result);
    expect(JSON.stringify(loaded.body.messages)).not.toContain(foreignLabel);
  });

  it('permits a protected label introduced by the current question and later selected history', async () => {
    const created = await create();
    expect(created.status).toBe(200);
    const scope = `${a.ownerId}:${created.body.id}`;
    nextOutput(outputWithPii(true, false, scope));
    const first = await ask(created.body.id, `Could ${outputPerson} supply metrics via ${outputEmail}?`);
    expect(first.status).toBe(200);
    const introducedLabel = syntheticSanitize(outputPerson, `${a.ownerId}:${created.body.id}`);
    expect(created.body.sourceText).not.toContain(introducedLabel);
    expect(first.body.messages.at(-1).content).toContain(introducedLabel);
    provider.mockClear();
    nextOutput(outputWithPii(true, false, scope));
    const second = await ask(created.body.id, 'Which metric remains unconfirmed?');
    expect(second.status).toBe(200);
    expect(provider.mock.calls[0][0].messages[1].content).toContain(introducedLabel);
    assertNoSentinels(second.body);
  });

  it('rejects labels that exist in stored history but were truncated out of the actual model context', async () => {
    const created = await create();
    expect(created.status).toBe(200);
    const hiddenLabel = `[EMAIL_ADDRESS_${'e'.repeat(32)}]`;
    await repository.appendMessage({ ownerId: a.ownerId, analysisId: created.body.id, role: 'user',
      content: `${'x'.repeat(980)}${hiddenLabel}`, status: RunStatus.Completed, result: null, errorCode: null });
    provider.mockClear();
    nextOutput({ ...outputWithPii(true, true, `${a.ownerId}:${created.body.id}`), answer: `Metrics may be held by ${hiddenLabel}.` } as QuestionResult);
    const response = await ask(created.body.id, 'Which evidence remains missing?');
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCode.InvalidOutput);
    expect(batches.at(-1)!.texts.length).toBeGreaterThan(1);
    const input = provider.mock.calls[0][0].messages[1].content as string;
    expect(input).not.toContain(hiddenLabel);
    expect(input).not.toContain(`[EMAIL_ADDRESS_${'e'.repeat(5)}`);
    expect((await a.agent.get(`/api/analyses/${created.body.id}`)).body.result).toEqual(created.body.result);
  });

  it('accepts an exact evidence quote containing complete known labels after sanitation', async () => {
    provider.mockImplementationOnce(async () => ({ rawText: JSON.stringify({ ...outputWithPii(false, true),
      evidence: [{ quote: syntheticSanitize(source, batches[0].scope), note: 'Exact protected source.' }] }),
    provider: 'mock', model: 'scripted-pii-contract', inputTokens: null, outputTokens: null }));
    const created = await create();
    expect(created.status).toBe(200);
    expect(created.body.result.evidence[0].quote).toBe(created.body.sourceText);
    expect(created.body.result.evidence[0].quote).toMatch(/\[PERSON_[a-f0-9]{32}\]/);
  });

  it('does not split a privacy label at the list excerpt boundary', async () => {
    const prefix = technicalFact.padEnd(170, ' ');
    const created = await create(`${prefix}${email} confirmed the symptom.`);
    expect(created.status).toBe(200);
    const listed = await a.agent.get('/api/analyses?limit=50');
    expect(listed.status).toBe(200);
    const item = listed.body.items.find((row: { id: string }) => row.id === created.body.id);
    expect(item.excerpt).toBe(prefix);
    expect(item.excerpt).not.toContain('[EMAIL_ADDRESS_');
  });

  it('retains incident scope across manual retry and isolates labels across incidents and owners', async () => {
    const failed = await create(`${source} ${MockFaultTag.ServerTwice}`);
    expect(failed.status).toBe(502);
    const id = failed.body.error.analysisId as string;
    const initialScope = batches[0].scope;
    const retried = await a.agent.post(`/api/analyses/${id}/retry`).set(CsrfHeaderName, a.csrf).send({});
    expect(retried.status).toBe(200);
    expect(batches.every((batch) => batch.scope === initialScope)).toBe(true);
    const second = await create();
    const other = await create(source, b);
    expect(second.status).toBe(200);
    expect(other.status).toBe(200);
    expect(second.body.sourceText).not.toBe(other.body.sourceText);
    expect(second.body.sourceText).not.toBe(syntheticSanitize(source, initialScope));
  });

  it.each([null, 'pii-other-v1'])('blocks legacy policy %s for detail/question/retry and returns a content-free owner list item', async (version) => {
    const created = await create(technicalFact);
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    const legacySentinel = 'historical.person@example.test';
    // Legacy rows deliberately contain historical data; the boundary must not expose or forward it.
    await dataSource.query("update analyses set pii_policy_version = $1, source_text = $2, result = $3::jsonb, status = 'failed' where id = $4", [
      version, `Legacy ${legacySentinel}`, JSON.stringify({ summary: legacySentinel, suggestedSeverity: 'high' }), id,
    ]);
    provider.mockClear();
    adapter.mockClear();
    const before = await domainSnapshot();
    const responses = [
      await a.agent.get(`/api/analyses/${id}`), await ask(id, 'What happened?'),
      await a.agent.post(`/api/analyses/${id}/retry`).set(CsrfHeaderName, a.csrf).send({}),
    ];
    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(ErrorCode.PiiLegacyRecord);
      expect(JSON.stringify(response.body)).not.toContain(legacySentinel);
    }
    const list = await a.agent.get('/api/analyses?limit=50');
    expect(list.status).toBe(200);
    const item = list.body.items.find((row: { id: string }) => row.id === id);
    expect(item).toBeDefined();
    expect(item.summary).toBeNull();
    expect(item.suggestedSeverity).toBeNull();
    expect(item.errorCode).toBe(ErrorCode.PiiLegacyRecord);
    expect(item.excerpt).toContain('Legacy');
    expect(JSON.stringify(list.body)).not.toContain(legacySentinel);
    const foreign = [await b.agent.get(`/api/analyses/${id}`), await ask(id, 'What happened?', b),
      await b.agent.post(`/api/analyses/${id}/retry`).set(CsrfHeaderName, b.csrf).send({})];
    expect(foreign.map((response) => response.status)).toEqual([404, 404, 404]);
    const otherList = await b.agent.get('/api/analyses?limit=50');
    expect(otherList.body.items.some((row: { id: string }) => row.id === id)).toBe(false);
    expect(provider).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
    expect(await domainSnapshot()).toEqual(before);
  });

  it('does not invoke sanitation/provider for invalid input, unauthenticated writes, absent CSRF or foreign ownership', async () => {
    const created = await create();
    expect(created.status).toBe(200);
    provider.mockClear(); adapter.mockClear();
    const before = await domainSnapshot();
    expect((await create('')).status).toBe(400);
    expect((await create('x'.repeat(8_001))).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/api/analyses').send({ sourceText: source })).status).toBe(403);
    expect((await a.agent.post('/api/analyses').send({ sourceText: source })).status).toBe(403);
    expect((await ask(created.body.id, `Ask ${person}.`, b)).status).toBe(404);
    expect(provider).not.toHaveBeenCalled(); expect(adapter).not.toHaveBeenCalled();
    expect(await domainSnapshot()).toEqual(before);
  });

  it('generates correlation ids and logs only route templates even for unmatched PII paths and queries', async () => {
    const response = await create().set(CorrelationIdHeaderName, email);
    expect(response.status).toBe(200);
    expect(response.headers[CorrelationIdHeaderName]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers[CorrelationIdHeaderName]).not.toBe(email);
    const badDetail = await a.agent.get(`/api/analyses/${encodeURIComponent(email)}?contact=${encodeURIComponent(phone)}`).set(CorrelationIdHeaderName, person);
    expect(badDetail.status).toBe(404);
    const unmatched = await a.agent.get(`/api/nonexistent/${encodeURIComponent(email)}?contact=${encodeURIComponent(phone)}`).set(CorrelationIdHeaderName, person);
    expect(unmatched.status).toBe(404);
    const printed = consoleLogs.flatMap((log) => log.mock.calls.map(([line]) => String(line)));
    const requestLogs = printed.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.msg === LogEvent.Request);
    expect(requestLogs.map((line) => line.path)).toContain('/api/analyses/:id');
    expect(requestLogs.map((line) => line.path)).toContain('unmatched');
    for (const line of requestLogs) expect(line.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(printed.join('\n')).not.toContain(encodeURIComponent(email));
    expect(printed.join('\n')).not.toContain(encodeURIComponent(phone));
    const executions = await dataSource.query('select correlation_id from ai_executions where analysis_id = $1', [response.body.id]);
    expect(executions[0].correlation_id).toBe(response.headers[CorrelationIdHeaderName]);
  });

  it('includes detector readiness in API health and recovers when the dependency is ready', async () => {
    expect((await a.agent.get('/api/health')).status).toBe(200);
    mode = 'unavailable';
    const unavailable = await a.agent.get('/api/health');
    expect(unavailable.status).toBe(503);
    assertNoSentinels(unavailable.body);
    mode = 'ok';
    expect((await a.agent.get('/api/health')).status).toBe(200);
  });
});
