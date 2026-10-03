import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const startedAt = new Date().toISOString();
const directory = resolve(root, 'qa-artifacts/local-pii', startedAt.replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const evidence = resolve(root, 'qa/pii-comparison/evidence');
mkdirSync(evidence, { recursive: true });
const stages = [];
const env = { ...process.env, DATABASE_URL: 'postgres://app:app@localhost:5432/incident_assistant_test',
  LLM_PROVIDER: 'mock', PII_PERSON_ENABLED: 'true', SOURCE_TEXT_MAX: '8000', QUESTION_MAX: '1000',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long', PII_QA_RUN_ID: startedAt.replaceAll(':', '-') };
const compose = ['compose', '-f', 'docker-compose.yml'];
if (existsSync(resolve(root, 'qa/local/docker-extra-ca.pem'))) compose.push('-f', 'docker-compose.extra-ca.yml');
compose.push('-f', 'qa/t22/compose.qa.yml');
const browserOnly = process.argv.includes('--browser-only');

/** @param id Stable stage name. @param command Executable. @param args Arguments. @param extraEnv Synthetic overrides. @returns Success; all logs stay in ignored QA artifacts. */
function run(id, command, args, extraEnv = {}) {
  console.log(`RUN: ${id}`);
  const start = Date.now();
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8',
    shell: process.platform === 'win32' && ['npm', 'npx'].includes(command), maxBuffer: 20 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`;
  writeFileSync(resolve(directory, `${id}.log`), output);
  const stage = { id, status: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status,
    durationMs: Date.now() - start, log: `${id}.log` };
  stages.push(stage);
  console.log(`${stage.status}: ${id} (${(stage.durationMs / 1000).toFixed(1)}s)`);
  return stage.status === 'PASS';
}

const dockerReady = run('docker-preflight', 'docker', ['info', '--format', '{{.ServerVersion}}']);
if (dockerReady) {
  run('hmac-key', 'npm', ['run', 'pii:init-key']);
  run('postgres-start', 'docker', [...compose, 'up', '-d', '--no-build', 'postgres']);
  if (!browserOnly) {
    run('typecheck', 'npm', ['run', 'typecheck']);
    run('lint', 'npm', ['run', 'lint']);
    run('build', 'npm', ['run', 'build']);
    run('web-docs', 'npm', ['run', 'check:web-docs']);
    run('api-coverage', 'npm', ['run', 'test:coverage']);
    run('web-tests', 'npm', ['run', 'test:web']);
    run('mock-evaluation', 'npm', ['run', 'qa:eval']);
    run('browser-regression', 'npx', ['playwright', 'test', '--config=playwright.regression.config.ts', '--project=flows']);
    run('browser-limits', 'npm', ['run', 'qa:e2e:flows:limits']);
    run('proxy-timeouts', 'npm', ['run', 'qa:docker:timeouts']);
    run('docker-build', 'docker', [...compose, 'build', 'api', 'web', 'pii']);
    const mounts = ['--mount', `type=bind,source=${resolve(root, 'services/pii/tests')},target=/tests,readonly`];
    run('python-contracts', 'docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:size=64m',
      '--cpus', '1', '--memory', '4g', ...mounts, '--entrypoint', 'python', 'ai-incident-assistant-pii:latest',
      '-m', 'pytest', '/tests', '-q', '-p', 'no:cacheprovider']);
    run('real-model-quality', 'docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:size=64m',
      '--cpus', '1', '--memory', '4g', '--memory-swap', '4g',
      '--mount', `type=bind,source=${resolve(root, 'qa/pii-spike')},target=/baseline,readonly`,
      '--mount', `type=bind,source=${resolve(root, 'qa/pii-comparison')},target=/comparison,readonly`,
      '--mount', `type=bind,source=${evidence},target=/evidence`,
      '--entrypoint', 'python', 'ai-incident-assistant-pii:latest', '/comparison/compare.py', '--production-only', '--profile-limit', '1000']);
    run('quality-rubric-verifier', 'node', ['qa/pii-comparison/verify-evidence.mjs']);
  }
  for (const mode of ['full', 'contacts', 'disabled']) {
    const configuration = mode === 'full' ? compose : [...compose, '-f', `qa/t22/${mode}.yml`];
    if (run(`${mode}-startup`, 'docker', [...configuration, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'pii', 'api', 'web'])) {
      run(`${mode}-browser`, 'npx', ['playwright', 'test', '--config=playwright.pii.config.ts'], { PII_QA_MODE: mode });
      if (mode === 'full') {
        const hostConfiguration = [...compose, '-f', 'docker-compose.pii-dev.yml'];
        if (run('host-profile-startup', 'docker', [...hostConfiguration, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'pii', 'api', 'web'])) {
          run('actual-nest-adapter', 'npm', ['run', 'test', '-w', '@app/api', '--',
            '--testPathPatterns=pii-contract.unit', '--testNamePattern=optional.*actual.*detector'], { PII_REAL_URL: 'http://127.0.0.1:18080' });
        }
        run('restore-internal-topology', 'docker', [...compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'pii', 'api', 'web']);
        run('runtime-storage-logs', 'node', ['qa/pii-comparison/verify-runtime.mjs', ...compose]);
        run('compose-regression', 'npm', ['run', 'qa:e2e:compose']);
        if (run('detector-stop', 'docker', [...compose, 'stop', 'pii'])) {
          run('unavailable-browser', 'npx', ['playwright', 'test', '--config=playwright.pii.config.ts'], { PII_QA_MODE: 'unavailable' });
        }
      }
    }
  }
  // Never leave the demo silently downgraded after the contacts/off tests.
  run('restore-full-demo', 'docker', [...compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'pii', 'api', 'web']);
}
const summary = { startedAt, finishedAt: new Date().toISOString(), timezone: 'America/Buenos_Aires',
  branch: 'dev', syntheticOnly: true, externalProviderCalls: 0, browserOnly,
  stages, passed: stages.filter(stage => stage.status === 'PASS').length,
  failed: stages.filter(stage => stage.status === 'FAIL').length };
writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`Evidence: ${directory}`);
console.log(`Result: ${summary.passed} PASS / ${summary.failed} FAIL. Real model quality is distinct from software regression.`);
process.exitCode = summary.failed ? 1 : 0;
