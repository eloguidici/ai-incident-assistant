import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MockFaultTag } from '../src/ai/mock-fault-tags';
import { ANALYSIS_PROMPT_VERSION, QUESTION_PROMPT_VERSION, type AnalysisResult } from '../src/ai/contracts';
import { AuditAction } from '../src/domain/audit-action';
import { createApplication } from '../src/main';
import { ErrorCode } from '../src/common/constants/error-code';
import { CsrfHeaderName, SessionCookieName } from '../src/common/constants/http';
import { loadAppConfig } from '../src/config/env';
import { authConfig, databaseConfig } from '../src/config/slices';
import { RunStatus } from '../src/domain/run-status';
import { migrationPool } from '../src/db/database-bootstrap';
import { applyMigrations, rollbackLatest, truncateDomain } from '../src/db/migrate';
import { seedDemoUsers } from '../src/db/seed';
import { ANALYSIS_REPOSITORY, USER_REPOSITORY } from '../src/db/repositories/tokens';
import type { AnalysisRepository } from '../src/db/repositories/analysis.repository';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { AnalysesService } from '../src/analyses/analyses.service';
import { resetMockState } from '../src/ai/mock.provider';

const password = 'local-demo-password';
const userA = 'analyst.a@example.test';
const userB = 'analyst.b@example.test';
const incident =
  'On 2026-09-29 at 10:15 UTC the payments service returned HTTP 503 for 12 minutes. The load balancer showed unhealthy tasks. There was no deployment in that window.';

describe('API with PostgreSQL', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    await truncateDomain(dataSource);
    const registry = loadAppConfig();
    await seedDemoUsers(app.get<UserRepository>(USER_REPOSITORY), registry.get(authConfig), registry.get(databaseConfig).url);
  });

  beforeEach(() => resetMockState());

  afterAll(async () => {
    await app.close();
  });

  async function asUser(email: string) {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/auth/login').send({ email, password });
    expect(login.ok).toBe(true);
    return { agent, csrf: login.body.csrfToken as string, userId: login.body.user.id as string };
  }

  it('Q01 accepts a valid login, rejects an invalid one, and expires a session', async () => {
    const bad = await request(app.getHttpServer()).post('/api/auth/login').send({ email: userA, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe(ErrorCode.InvalidCredentials);
    const { agent } = await asUser(userA);
    const session = await agent.get('/api/auth/session');
    expect(session.body.user.email).toBe(userA);
    const expired = jwt.sign(
      { email: userA, sub: '11111111-1111-4111-8111-111111111111', exp: 1 },
      process.env.JWT_SECRET ?? '',
    );
    const stale = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', [`${SessionCookieName}=${expired}`]);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe(ErrorCode.SessionExpired);
  });

  it('returns 413 when the JSON body exceeds the 32KB limit', async () => {
    const { agent, csrf } = await asUser(userA);
    const oversized = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .set('Content-Type', 'application/json')
      .send(`{"sourceText":"${'a'.repeat(40_000)}"}`);
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe(ErrorCode.PayloadTooLarge);
  });

  it('Q02 Q03 creates an analysis and rejects invalid input without treating it as success', async () => {
    const { agent, csrf } = await asUser(userA);
    const empty = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: '   ' });
    expect(empty.status).toBe(400);
    const extra = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident, extra: true });
    expect(extra.status).toBe(400);
    const huge = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: 'a'.repeat(8001) });
    expect(huge.status).toBe(400);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    expect(created.ok).toBe(true);
    expect(created.body.status).toBe(RunStatus.Completed);
    expect(created.body.result.evidence[0].quote.length).toBeGreaterThan(10);
    expect(created.body.promptVersion).toBe(ANALYSIS_PROMPT_VERSION);
    expect(created.body.provider).toBe('mock');
    const missing = await agent.post('/api/analyses').send({ sourceText: incident });
    expect(missing.status).toBe(403);
  });

  it('Q04 isolates lists, detail, and questions', async () => {
    const a = await asUser(userA);
    const created = await a.agent.post('/api/analyses').set(CsrfHeaderName, a.csrf).send({ sourceText: `${incident} Isolation case.` });
    const b = await asUser(userB);
    const foreign = await b.agent.get(`/api/analyses/${created.body.id}`);
    expect(foreign.status).toBe(404);
    const listed = await b.agent.get('/api/analyses');
    expect(listed.body.items.map((analysis: { id: string }) => analysis.id)).not.toContain(created.body.id);
    const question = await b.agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, b.csrf)
      .send({ question: 'What failed?' });
    expect(question.status).toBe(404);
  });

  it('Q06 stores the question in order and does not overwrite the analysis when the model fails', async () => {
    const { agent, csrf } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    const asked = await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: 'What information is missing to confirm the cause?' });
    expect(asked.ok).toBe(true);
    expect(asked.body.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant']);
    expect(asked.body.result.summary.length).toBeGreaterThan(0);
    const broken = await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: `Review this case ${MockFaultTag.InvalidJson}` });
    expect(broken.status).toBe(422);
    const reloaded = await agent.get(`/api/analyses/${created.body.id}`);
    expect(reloaded.body.status).toBe(RunStatus.Completed);
    expect(reloaded.body.result.evidence.length).toBeGreaterThan(0);
    expect(reloaded.body.messages.at(-1).status).toBe(RunStatus.Failed);
  });

  it('Q07 timeout, 500, invalid JSON, and an ungrounded quote stay failed', async () => {
    const { agent, csrf } = await asUser(userA);
    const cases = [
      { marker: MockFaultTag.InvalidJson, status: 422 },
      { marker: MockFaultTag.Ungrounded, status: 422 },
      { marker: MockFaultTag.Auth, status: 502 },
      { marker: MockFaultTag.Server, status: 502 },
    ];
    for (const failureCase of cases) {
      const response = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({
        sourceText: `${incident} ${failureCase.marker}`,
      });
      expect(response.status).toBe(failureCase.status);
      const stored = await agent.get(`/api/analyses/${response.body.error.analysisId}`);
      expect(stored.body.status).toBe(RunStatus.Failed);
      expect(stored.body.result).toBeNull();
    }
  });

  it('Q10 retry does not delete a successful result and a failure can be retried', async () => {
    const { agent, csrf } = await asUser(userA);
    const ok = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    const blocked = await agent.post(`/api/analyses/${ok.body.id}/retry`).set(CsrfHeaderName, csrf).send({});
    expect(blocked.status).toBe(409);
    const failed = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .send({ sourceText: `${incident} ${MockFaultTag.ServerOnce}` });
    expect(failed.ok).toBe(true);
    expect(failed.body.executions[0].attemptCount).toBe(2);
    const again = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .send({ sourceText: `${incident} ${MockFaultTag.ServerTwice}` });
    expect(again.status).toBe(502);
    const retried = await agent.post(`/api/analyses/${again.body.error.analysisId}/retry`).set(CsrfHeaderName, csrf).send({});
    expect(retried.ok).toBe(true);
    expect(retried.body.status).toBe(RunStatus.Completed);
  });

  async function countProcessingExecutions(dataSource: DataSource): Promise<number> {
    const rows = await dataSource.query<{ count: string }[]>(
      `select count(*)::text as count from ai_executions where status = 'processing'`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  it('R02 F04 exposes execution ids and closes the reserved row on retry', async () => {
    const { agent, csrf } = await asUser(userA);
    const failed = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .send({ sourceText: `${incident} ${MockFaultTag.ServerTwice}` });
    expect(failed.status).toBe(502);
    const analysisId = failed.body.error.analysisId as string;
    const beforeRetry = await agent.get(`/api/analyses/${analysisId}`);
    expect(beforeRetry.body.executions).toHaveLength(1);
    expect(beforeRetry.body.executions[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(beforeRetry.body.executions[0].status).toBe(RunStatus.Failed);
    const retried = await agent.post(`/api/analyses/${analysisId}/retry`).set(CsrfHeaderName, csrf).send({});
    expect(retried.ok).toBe(true);
    expect(retried.body.executions).toHaveLength(2);
    const ids = retried.body.executions.map((execution: { id: string }) => execution.id);
    expect(new Set(ids).size).toBe(2);
    expect(retried.body.executions.every((execution: { status: string }) => execution.status !== RunStatus.Processing)).toBe(true);
  });

  it('R02 F05 leaves no processing executions after a failed question', async () => {
    const { agent, csrf } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: `Review this case ${MockFaultTag.InvalidJson}` });
    const dataSource = app.get(DataSource);
    expect(await countProcessingExecutions(dataSource)).toBe(0);
  });

  it('R02 F05b persists provider attempt count on a failed question', async () => {
    const { agent, csrf } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    const failed = await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: `What happened? ${MockFaultTag.ServerTwice}` });
    expect(failed.status).toBe(502);
    const detail = await agent.get(`/api/analyses/${created.body.id}`);
    const questionExecution = detail.body.executions.find((execution: { kind: string }) => execution.kind === 'question');
    expect(questionExecution).toBeDefined();
    expect(questionExecution.attemptCount).toBe(2);
    expect(questionExecution.status).toBe(RunStatus.Failed);
  });

  it('R02 F06 retry compare-and-set blocks a second reservation while processing', async () => {
    const { agent, csrf, userId } = await asUser(userA);
    const failed = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .send({ sourceText: `${incident} ${MockFaultTag.Server}` });
    expect(failed.status).toBe(502);
    const analysisId = failed.body.error.analysisId as string;
    const repo = app.get<AnalysisRepository>(ANALYSIS_REPOSITORY);
    const first = await repo.reserveRetryWithExecution({
      ownerId: userId,
      analysisId,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      provider: 'mock',
      model: 'mock-incident-v1',
      correlationId: 'r02-cas-first',
    });
    expect(first.ok).toBe(true);
    const second = await repo.reserveRetryWithExecution({
      ownerId: userId,
      analysisId,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      provider: 'mock',
      model: 'mock-incident-v1',
      correlationId: 'r02-cas-second',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('in_progress');
    if (!first.ok) throw new Error('expected first retry reservation to succeed');
    await repo.finishExecution({
      executionId: first.executionId,
      ownerId: userId,
      status: RunStatus.Failed,
      errorCode: 'PROVIDER_ERROR',
      attemptCount: 1,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      provider: 'mock',
      model: 'mock-incident-v1',
    });
    const dataSource = app.get(DataSource);
    await dataSource.query(`update analyses set status = 'failed' where id = $1`, [analysisId]);
    expect(await countProcessingExecutions(dataSource)).toBe(0);
  });

  it('two simultaneous analyses do not create two executions', async () => {
    const { agent, csrf } = await asUser(userA);
    const [first, second] = await Promise.all([
      agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} ${MockFaultTag.Timeout} one` }),
      agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} ${MockFaultTag.Timeout} two` }),
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([409, 504]);
  });

  it('Q09 does not write the incident or the password to the logs', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const { agent, csrf } = await asUser(userA);
    const sentinel = 'TOKEN-PII-998877';
    await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} Referencia ${sentinel}.` });
    spy.mockRestore();
    const loggedOutput = lines.join('\n');
    expect(loggedOutput).not.toContain(sentinel);
    expect(loggedOutput).not.toContain(password);
    expect(loggedOutput).not.toContain(process.env.JWT_SECRET);
  });

  it('B24 deletes expired analyses and keeps the rest', async () => {
    const { agent, csrf } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} retention` });
    const dataSource = app.get(DataSource);
    await dataSource.query(`update analyses set expires_at = now() - interval '1 day' where id = $1`, [created.body.id]);
    const deleted = await app.get(AnalysesService).purgeExpired();
    expect(deleted).toBeGreaterThan(0);
    const missing = await agent.get(`/api/analyses/${created.body.id}`);
    expect(missing.status).toBe(404);
  });

  const sampleResult: AnalysisResult = {
    summary: 'Payments outage',
    category: 'availability',
    suggestedSeverity: 'high',
    evidence: [{ quote: 'payments service returned HTTP 503', note: 'Observed in the incident text.' }],
    hypotheses: [{ statement: 'Load balancer health checks failed.', confidence: 'medium' }],
    missingInformation: ['Deployment timeline'],
    uncertainty: 'Root cause not confirmed.',
  };

  it('N05 recovers a stuck question execution after a failed failure commit', async () => {
    const { agent, csrf, userId } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
    const analysisId = created.body.id as string;
    const repo = app.get<AnalysisRepository>(ANALYSIS_REPOSITORY);
    const reserved = await repo.insertExecution({
      analysisId,
      ownerId: userId,
      kind: 'question',
      status: RunStatus.Processing,
      promptVersion: QUESTION_PROMPT_VERSION,
      provider: 'mock',
      model: 'mock-incident-v1',
      correlationId: 'n05-stuck-question',
    });
    await expect(
      repo.commitQuestionFailure({
        ownerId: userId,
        analysisId,
        executionId: reserved.id,
        question: 'Probe question for rollback',
        userMessageStored: false,
        errorCode: 'PROVIDER_ERROR',
        errorMessage: 'Simulated provider failure',
        attemptCount: 2,
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
        provider: 'mock',
        model: 'mock-incident-v1',
        audit: {
          actorId: userId,
          action: AuditAction.QuestionAdd,
          resourceType: 'analysis',
          resourceId: analysisId,
          result: RunStatus.Failed,
          correlationId: 'n05-stuck-question',
        },
        injectMidTransactionFailure: true,
      }),
    ).rejects.toThrow('injected-write-failure');
    const dataSource = app.get(DataSource);
    expect(await countProcessingExecutions(dataSource)).toBe(1);
    await dataSource.query(`update ai_executions set created_at = now() - interval '1 hour' where id = $1`, [reserved.id]);
    await repo.recoverStuckExecutions(new Date());
    expect(await countProcessingExecutions(dataSource)).toBe(0);
    const followUp = await agent
      .post(`/api/analyses/${analysisId}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: 'Can we retry after recovery?' });
    expect(followUp.ok).toBe(true);
    const audits = await dataSource.query<{ count: string }[]>(
      `select count(*)::text as count from audit_events where resource_id = $1 and action = $2`,
      [analysisId, AuditAction.QuestionAdd],
    );
    expect(Number(audits[0]?.count ?? 0)).toBe(1);
  });

  it('N01 rolls back a mid-transaction commit without marking the analysis completed', async () => {
    const { userId } = await asUser(userA);
    const repo = app.get<AnalysisRepository>(ANALYSIS_REPOSITORY);
    const reserved = await repo.reserveProcessingAnalysisWithExecution({
      ownerId: userId,
      sourceText: `${incident} rollback probe`,
      expiresAt: new Date(Date.now() + 86400000),
      kind: 'analysis',
      promptVersion: ANALYSIS_PROMPT_VERSION,
      provider: 'mock',
      model: 'mock-incident-v1',
      correlationId: 'n01-rollback',
    });
    await expect(
      repo.commitAnalysisSuccess({
        ownerId: userId,
        analysisId: reserved.analysisId,
        executionId: reserved.executionId,
        result: sampleResult,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: 'mock',
        model: 'mock-incident-v1',
        attemptCount: 1,
        latencyMs: 10,
        inputTokens: 1,
        outputTokens: 1,
        audit: {
          actorId: userId,
          action: 'analysis.create',
          resourceType: 'analysis',
          resourceId: reserved.analysisId,
          result: RunStatus.Completed,
          correlationId: 'n01-rollback',
        },
        injectMidTransactionFailure: true,
      }),
    ).rejects.toThrow('injected-write-failure');
    const dataSource = app.get(DataSource);
    const rows = await dataSource.query<{ status: string; result: unknown }[]>(
      `select status, result from analyses where id = $1`,
      [reserved.analysisId],
    );
    expect(rows[0]?.status).toBe(RunStatus.Processing);
    expect(rows[0]?.result).toBeNull();
    expect(await countProcessingExecutions(dataSource)).toBeGreaterThanOrEqual(1);
  });

  it('N03 stale execution commit does not overwrite a newer completed analysis', async () => {
    const { agent, csrf, userId } = await asUser(userB);
    const failed = await agent
      .post('/api/analyses')
      .set(CsrfHeaderName, csrf)
      .send({ sourceText: `${incident} stale-run ${MockFaultTag.ServerTwice}` });
    expect(failed.status).toBe(502);
    const analysisId = failed.body.error.analysisId as string;
    const beforeRetry = await agent.get(`/api/analyses/${analysisId}`);
    const staleExecutionId = beforeRetry.body.executions[0].id as string;
    const retried = await agent.post(`/api/analyses/${analysisId}/retry`).set(CsrfHeaderName, csrf).send({});
    expect(retried.ok).toBe(true);
    expect(retried.body.status).toBe(RunStatus.Completed);
    const repo = app.get<AnalysisRepository>(ANALYSIS_REPOSITORY);
    const staleCommit = await repo.commitAnalysisSuccess({
      ownerId: userId,
      analysisId,
      executionId: staleExecutionId,
      result: { ...sampleResult, summary: 'Stale overwrite attempt' },
      promptVersion: ANALYSIS_PROMPT_VERSION,
      provider: 'mock',
      model: 'mock-incident-v1',
      attemptCount: 1,
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      audit: {
        actorId: userId,
        action: 'analysis.create',
        resourceType: 'analysis',
        resourceId: analysisId,
        result: RunStatus.Completed,
        correlationId: 'n03-stale',
      },
    });
    expect(staleCommit).toBe('stale');
    const reloaded = await agent.get(`/api/analyses/${analysisId}`);
    expect(reloaded.body.result.summary).not.toBe('Stale overwrite attempt');
    expect(reloaded.body.status).toBe(RunStatus.Completed);
  });

  it('N04 rejects part of a concurrent login burst before password work', async () => {
    const attempts = Array.from({ length: 12 }, () =>
      request(app.getHttpServer()).post('/api/auth/login').send({ email: userA, password: 'wrong-password' }),
    );
    const responses = await Promise.all(attempts);
    const rateLimited = responses.filter((response) => response.status === 429);
    const unauthorized = responses.filter((response) => response.status === 401);
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(unauthorized.length).toBeGreaterThan(0);
    expect(rateLimited.length + unauthorized.length).toBe(12);
  });

  it('rolls back the test migration and applies it again', async () => {
    const dataSource = app.get(DataSource);
    const pool = migrationPool(dataSource);
    await rollbackLatest(pool);
    await expect(dataSource.query('select 1 from users')).rejects.toBeTruthy();
    await applyMigrations(pool);
    await dataSource.query('select 1 from users');
    const registry = loadAppConfig();
    await seedDemoUsers(app.get<UserRepository>(USER_REPOSITORY), registry.get(authConfig), registry.get(databaseConfig).url);
  });
});
