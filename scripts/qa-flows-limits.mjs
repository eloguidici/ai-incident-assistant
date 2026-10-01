import { spawnSync } from 'node:child_process';

const suites = ['session', 'analyses-2', 'questions-2', 'context', 'pagination'];

for (const suite of suites) {
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--config=playwright.flows-limits.config.ts'],
    {
      env: { ...process.env, FLOWS_LIMITS_SUITE: suite },
      stdio: 'inherit',
      shell: true,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
