import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Executes a local Docker command without printing resolved Compose secrets.
 * @param {string[]} args Docker CLI arguments.
 * @param {Record<string, string>} environment Explicit test-profile overrides.
 * @returns {string} Standard output.
 * @throws {Error} When Docker fails; output is deliberately excluded.
 */
function docker(args, environment = {}) {
  try {
    return execFileSync('docker', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...environment } }).trim();
  } catch {
    throw new Error(`Docker ${args[0]} command failed.`);
  }
}

/**
 * Waits for the isolated proxy and upstream to be ready.
 * @param {string} baseUrl Proxy URL.
 * @returns {Promise<void>} Resolves on a healthy response.
 * @throws {Error} When startup takes more than 15 seconds.
 */
async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Containers may still be starting. */ }
    await delay(100);
  }
  throw new Error('Isolated proxy did not become healthy.');
}

test('Compose selects the locked detector platform and respects explicit API deadlines', () => {
  for (const [configuredDeadline, expectedDeadline] of [['', '45000'], ['20000', '20000']]) {
    const compose = JSON.parse(docker([
      'compose', '--env-file', '.env.example', '-p', 'ia-config-qa', '-f', 'docker-compose.yml',
      '-f', 'docker-compose.openrouter.yml', 'config', '--format', 'json',
    ], { LLM_DEADLINE_MS: configuredDeadline, API_PROXY_READ_TIMEOUT: '60s' }));
    assert.equal(compose.services.pii.platform, 'linux/amd64');
    assert.equal(compose.services.api.environment.LLM_DEADLINE_MS, expectedDeadline);
    assert.equal(compose.services.web.environment.API_PROXY_READ_TIMEOUT, '60s');
  }
});

test('OpenRouter proxy preserves slow success and the API deadline JSON error', { timeout: 90_000, concurrency: true }, async (t) => {
  const compose = JSON.parse(docker([
    'compose', '--env-file', '.env.example', '-p', 'ai-incident-assistant', '-f', 'docker-compose.yml',
    '-f', 'docker-compose.openrouter.yml', 'config', '--format', 'json',
  ], { LLM_DEADLINE_MS: '45000', API_PROXY_READ_TIMEOUT: '60s' }));
  const deadlineMs = Number(compose.services.api.environment.LLM_DEADLINE_MS);
  const proxyTimeout = compose.services.web.environment.API_PROXY_READ_TIMEOUT;
  const proxyTimeoutSeconds = Number(proxyTimeout.replace(/s$/, ''));
  assert.ok(proxyTimeoutSeconds * 1000 >= deadlineMs + 5000, 'Proxy must allow the API deadline plus response time.');

  const suffix = randomUUID().slice(0, 8);
  const network = `ia-timeout-qa-${suffix}`;
  const upstream = `${network}-upstream`;
  const proxy = `${network}-proxy`;
  const containers = [];
  docker(['network', 'create', network]);
  t.after(() => {
    for (const container of containers.reverse()) docker(['rm', '-f', container]);
    docker(['network', 'rm', network]);
  });

  docker([
    'run', '-d', '--name', upstream, '--network', network,
    '--mount', `type=bind,source=${resolve(repoRoot, 'qa/docker/slow-upstream.mjs')},target=/slow-upstream.mjs,readonly`,
    '-e', 'SUCCESS_DELAY_MS=35000', '-e', `DEADLINE_MS=${deadlineMs}`,
    '--entrypoint', 'node', 'node:22-bookworm-slim', '/slow-upstream.mjs',
  ]);
  containers.push(upstream);
  docker([
    'run', '-d', '--name', proxy, '--network', network,
    '-p', '127.0.0.1::80', '-e', `API_UPSTREAM=${upstream}:3000`,
    '-e', `API_PROXY_READ_TIMEOUT=${proxyTimeout}`, process.env.QA_WEB_IMAGE ?? `${compose.name}-web`,
  ]);
  containers.push(proxy);
  const port = JSON.parse(docker(['inspect', proxy]))[0].NetworkSettings.Ports['80/tcp'][0].HostPort;
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  await Promise.all([
    t.test('returns a successful JSON response after 35 seconds', async () => {
      const response = await fetch(`${baseUrl}/api/slow`, { signal: AbortSignal.timeout(70_000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { completed: true });
    }),
    t.test('preserves the controlled JSON 504 at the API deadline', async () => {
      const response = await fetch(`${baseUrl}/api/deadline`, { signal: AbortSignal.timeout(70_000) });
      assert.equal(response.status, 504);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await response.json(), { code: 'PROVIDER_TIMEOUT' });
    }),
  ]);
});
