process.env.RATE_LIMIT_ANALYSES_PER_HOUR = '20';

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { MockFaultTag } from '../src/ai/mock-fault-tags';
import { resetMockState } from '../src/ai/mock.provider';
import { ErrorCode } from '../src/common/constants/error-code';
import { CsrfHeaderName, SessionCookieName } from '../src/common/constants/http';
import { loadAppConfig } from '../src/config/env';
import { authConfig, databaseConfig } from '../src/config/slices';
import { truncateDomain } from '../src/db/migrate';
import { USER_REPOSITORY } from '../src/db/repositories/tokens';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { seedDemoUsers } from '../src/db/seed';
import { createApplication } from '../src/main';

const password = 'Demo1234$';
const userA = 'demo1@demo.com';
const userB = 'demo2@demo.com';
const incident = 'On 2026-09-29 at 10:15 UTC the payments service returned HTTP 503 for 12 minutes.';

describe('API edge cases (HTTP boundary)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    await truncateDomain(app.get(DataSource));
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
    expect(login.status).toBe(201);
    const sessionCookie = (login.headers['set-cookie'] as unknown as string[]).find((cookie) => cookie.startsWith(`${SessionCookieName}=`))!;
    const sessionToken = sessionCookie.split(';')[0].slice(SessionCookieName.length + 1);
    return { agent, csrf: login.body.csrfToken as string, sessionToken, userId: login.body.user.id as string };
  }

  async function executionCount(analysisId: string): Promise<number> {
    const rows = await app.get(DataSource).query<{ count: string }[]>(
      'select count(*)::text as count from ai_executions where analysis_id = $1',
      [analysisId],
    );
    return Number(rows[0].count);
  }

  describe('authentication', () => {
    it('rejects a JWT whose payload was changed or whose algorithm is none', async () => {
      const { sessionToken } = await asUser(userA);
      const [header, payload, signature] = sessionToken.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, sub: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
      const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      for (const token of [`${header}.${forged}.${signature}`, `${none}.${payload}.`]) {
        const response = await request(app.getHttpServer()).get('/api/analyses').set('Cookie', `${SessionCookieName}=${token}`);
        expect(response.status).toBe(401);
      }
    });

    it('answers malformed JSON and non-string credentials with 400, never 5xx or a session', async () => {
      const server = app.getHttpServer();
      const malformed = await request(server).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.correlationId).toBeTruthy();
      const objectCredentials = await request(server).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
      expect(objectCredentials.status).toBe(400);
      const extraField = await request(server).post('/api/auth/login').send({ email: userA, password, admin: true });
      expect(extraField.status).toBe(400);
    });

    it("rejects another user's CSRF token even with a valid session", async () => {
      const a = await asUser(userA);
      const b = await asUser(userB);
      const response = await a.agent.post('/api/analyses').set(CsrfHeaderName, b.csrf).send({ sourceText: incident });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCode.Csrf);
    });
  });

  describe('input boundaries', () => {
    it('applies the incident length limit after trimming and counts UTF-16 units', async () => {
      const { agent, csrf } = await asUser(userA);
      const post = (sourceText: string) => agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText });
      expect((await post('x'.repeat(8000))).status).toBe(200);
      expect((await post(`  ${'x'.repeat(8000)}  `)).status).toBe(200);
      expect((await post('😀'.repeat(4000))).status).toBe(200);
      expect((await post('x'.repeat(8001))).status).toBe(400);
      expect((await post(' \n\t ')).status).toBe(400);
    });

    it('rejects a NUL character in the incident with 400 and stores nothing', async () => {
      const { agent, csrf } = await asUser(userA);
      const before = await agent.get('/api/analyses');
      const response = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} \u0000 end` });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCode.ValidationError);
      const after = await agent.get('/api/analyses');
      expect(after.body.page.total).toBe(before.body.page.total);
    });

    it('rejects a NUL character in a question before the model is called', async () => {
      const { agent, csrf } = await asUser(userA);
      const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
      const executionsBefore = await executionCount(created.body.id);
      const response = await agent
        .post(`/api/analyses/${created.body.id}/messages`)
        .set(CsrfHeaderName, csrf)
        .send({ question: `What failed? ${MockFaultTag.ShouldNotRun} \u0000` });
      expect(response.status).toBe(400);
      expect(await executionCount(created.body.id)).toBe(executionsBefore);
    });

    it('applies the question length limit at 1000 characters', async () => {
      const { agent, csrf } = await asUser(userA);
      const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
      const ask = (question: string) => agent.post(`/api/analyses/${created.body.id}/messages`).set(CsrfHeaderName, csrf).send({ question });
      expect((await ask('q'.repeat(1001))).status).toBe(400);
      expect((await ask('q'.repeat(1000))).status).toBe(200);
    });

    it.each(['limit=0', 'limit=51', 'limit=-1', 'limit=abc', 'limit=1.5', 'offset=-1', 'limit=1&limit=2', 'offset=99999999999999999999'])(
      'rejects list query %s with 400',
      async (query) => {
        const { agent } = await asUser(userA);
        const response = await agent.get(`/api/analyses?${query}`);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe(ErrorCode.ValidationError);
      },
    );
  });

  describe('state rules', () => {
    it('refuses questions on a failed analysis and retries on a completed one', async () => {
      const { agent, csrf } = await asUser(userA);
      const failed = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: `${incident} ${MockFaultTag.Server}` });
      expect(failed.status).toBe(502);
      const failedId = failed.body.error.analysisId as string;
      const question = await agent.post(`/api/analyses/${failedId}/messages`).set(CsrfHeaderName, csrf).send({ question: 'Why?' });
      expect(question.status).toBe(409);

      const completed = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
      const retry = await agent.post(`/api/analyses/${completed.body.id}/retry`).set(CsrfHeaderName, csrf);
      expect(retry.status).toBe(409);
    });

    it('answers a clean question after a failed one, without resending the failed exchange', async () => {
      const { agent, csrf } = await asUser(userA);
      const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
      const ask = (question: string) => agent.post(`/api/analyses/${created.body.id}/messages`).set(CsrfHeaderName, csrf).send({ question });
      const failed = await ask(`Why? ${MockFaultTag.InvalidJson}`);
      expect(failed.status).toBe(422);
      // The mock fails whenever the tag appears anywhere in the prompt, so this passes only if the failed pair is left out.
      const answered = await ask('What should we check first?');
      expect(answered.status).toBe(200);
      expect(answered.body.messages.map((message: { status: string }) => message.status)).toEqual([
        'completed',
        'failed',
        'completed',
        'completed',
      ]);
    });

    it('keeps message sequences gapless when questions arrive in parallel', async () => {
      const { agent, csrf } = await asUser(userA);
      const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: incident });
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          agent.post(`/api/analyses/${created.body.id}/messages`).set(CsrfHeaderName, csrf).send({ question: `Parallel question ${index}` }),
        ),
      );
      expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true);
      const accepted = responses.filter((response) => response.status === 200).length;
      expect(accepted).toBeGreaterThanOrEqual(1);
      const detail = await agent.get(`/api/analyses/${created.body.id}`);
      const sequences = detail.body.messages.map((message: { sequence: number }) => message.sequence);
      expect(sequences).toEqual(Array.from({ length: accepted * 2 }, (_, index) => index + 1));
    });
  });

  describe('per-user isolation', () => {
    it("lets user B neither read nor change user A's analyses, even with the id", async () => {
      const a = await asUser(userA);
      const b = await asUser(userB);
      const completed = await a.agent.post('/api/analyses').set(CsrfHeaderName, a.csrf).send({ sourceText: `${incident} Owned by A.` });
      await a.agent.post(`/api/analyses/${completed.body.id}/messages`).set(CsrfHeaderName, a.csrf).send({ question: 'What failed?' });
      const failed = await a.agent.post('/api/analyses').set(CsrfHeaderName, a.csrf).send({ sourceText: `${incident} ${MockFaultTag.Server}` });
      const failedId = failed.body.error.analysisId as string;
      const snapshot = async (id: string) => (await a.agent.get(`/api/analyses/${id}`)).body;
      const before = { completed: await snapshot(completed.body.id), failed: await snapshot(failedId) };

      for (const id of [completed.body.id, failedId]) {
        const detail = await b.agent.get(`/api/analyses/${id}`);
        expect(detail.status).toBe(404);
        expect(JSON.stringify(detail.body)).not.toContain('Owned by A');
      }
      const listed = await b.agent.get('/api/analyses?limit=50');
      expect(listed.body.items.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([completed.body.id]));
      expect(listed.body.items.map((item: { id: string }) => item.id)).not.toContain(failedId);
      const question = await b.agent.post(`/api/analyses/${completed.body.id}/messages`).set(CsrfHeaderName, b.csrf).send({ question: 'Leak?' });
      expect(question.status).toBe(404);
      const retry = await b.agent.post(`/api/analyses/${failedId}/retry`).set(CsrfHeaderName, b.csrf);
      expect(retry.status).toBe(404);

      expect(await snapshot(completed.body.id)).toEqual(before.completed);
      expect(await snapshot(failedId)).toEqual(before.failed);
    });

    it('takes the owner from the session and rejects an owner sent by the client', async () => {
      const a = await asUser(userA);
      const b = await asUser(userB);
      const spoofed = await a.agent
        .post('/api/analyses')
        .set(CsrfHeaderName, a.csrf)
        .send({ sourceText: incident, ownerId: b.userId });
      expect(spoofed.status).toBe(400);
      const ownedByA = await a.agent.post('/api/analyses').set(CsrfHeaderName, a.csrf).send({ sourceText: `${incident} Owned by A.` });
      expect((await b.agent.get(`/api/analyses/${ownedByA.body.id}`)).status).toBe(404);
      expect((await a.agent.get(`/api/analyses/${ownedByA.body.id}`)).status).toBe(200);
      expect((await b.agent.get('/api/analyses')).body.page.total).toBe(0);
    });
  });

  describe('quotas', () => {
    it('does not charge validation errors to the analysis quota', async () => {
      const { agent, csrf } = await asUser(userB);
      const post = (sourceText: string) => agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText });
      for (const invalid of ['   ', 'x'.repeat(8001), `bad \u0000`]) expect((await post(invalid)).status).toBe(400);
      for (let index = 0; index < 20; index += 1) expect((await post(`${incident} #${index}`)).status).toBe(200);
      const limited = await post(incident);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe(ErrorCode.RateLimited);
      const retryAfter = Number(limited.headers['retry-after']);
      expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600).toBe(true);
    });
  });

  describe('HTTP surface', () => {
    it('does not advertise the server framework', async () => {
      const response = await request(app.getHttpServer()).get('/api/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});
