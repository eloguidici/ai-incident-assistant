process.env.CONTEXT_CHAR_BUDGET = '250';

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createApplication } from '../src/main';
import { CsrfHeaderName } from '../src/common/constants/http';
import { loadAppConfig } from '../src/config/env';
import { authConfig, databaseConfig } from '../src/config/slices';
import { RunStatus } from '../src/domain/run-status';
import { truncateDomain } from '../src/db/migrate';
import { seedDemoUsers } from '../src/db/seed';
import { USER_REPOSITORY } from '../src/db/repositories/tokens';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { resetMockState } from '../src/ai/mock.provider';

const password = 'local-demo-password';
const userA = 'analyst.a@example.test';
const shortIncident = 'HTTP 503 on payments for 12 minutes.';

describe('N02 context budget (isolated config)', () => {
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
    return { agent, csrf: login.body.csrfToken as string };
  }

  it('returns 413 without leaving a processing question execution', async () => {
    const { agent, csrf } = await asUser(userA);
    const created = await agent.post('/api/analyses').set(CsrfHeaderName, csrf).send({ sourceText: shortIncident });
    expect(created.ok).toBe(true);
    const rejected = await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({
        question:
          'What else should we verify before closing the incident, including timelines, deployment records, and customer impact reports?',
      });
    expect(rejected.status).toBe(413);
    const dataSource = app.get(DataSource);
    const rows = await dataSource.query<{ count: string }[]>(
      `select count(*)::text as count from ai_executions where status = $1 and kind = 'question'`,
      [RunStatus.Processing],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
    const followUp = await agent
      .post(`/api/analyses/${created.body.id}/messages`)
      .set(CsrfHeaderName, csrf)
      .send({ question: 'Was there a deployment?' });
    expect(followUp.ok).toBe(true);
  });
});
