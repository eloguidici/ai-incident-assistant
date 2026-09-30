import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFiles } from '../config/dotenv';
import { envSearchRoots, loadAppConfig } from '../config/env';
import { llmConfig } from '../config/slices';
import { buildAnalysisPrompt } from '../ai/prompt';
import { OutputValidationError, validateAnalysis } from '../ai/validate';
import OpenAI from 'openai';
import { OpenAiProvider } from '../ai/openai.provider';
import { OpenRouterProvider } from '../ai/openrouter.provider';
import type { LlmProvider } from '../ai/gateway';
import { findTlsTrustDetail, formatCauseChain } from '../ai/network-cause';
import { ProviderRequestError } from '../ai/contracts';
import { FIXTURES } from './fixtures';
import { RubricOutcome, rubricOutcomeOf, scoreAnalysis } from './rubric';

type LiveProviderKind = 'openai' | 'openrouter';

/**
 * Parses `--provider openai|openrouter` from argv. Defaults to openai.
 * @returns The provider to exercise in this live run.
 */
function parseLiveProviderArg(): LiveProviderKind {
  const index = process.argv.indexOf('--provider');
  if (index === -1 || index + 1 >= process.argv.length) return 'openai';
  const value = process.argv[index + 1];
  if (value === 'openrouter') return 'openrouter';
  return 'openai';
}

function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

/**
 * Prints nested `error.cause` messages without credentials.
 * @param error Root failure from the live run.
 */
function logErrorChain(error: unknown): void {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    console.error(`  cause[${depth}]: ${redactSecrets(current.message)}`);
    current = current.cause;
  }
}

/**
 * Runs one clear-outage fixture against a real LLM provider and writes qa-artifacts/live/REPORT.md.
 * Exits with 2 when the provider API key is missing, 1 when the rubric fails, and 0 when it passes.
 * @returns Nothing. The process exits with the rubric outcome.
 */
async function main(): Promise<void> {
  const liveProvider = parseLiveProviderArg();
  loadEnvFiles({ searchRoots: envSearchRoots() });
  const keyEnv = liveProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  if (!process.env[keyEnv]) {
    console.error(`BLOCKED: ${keyEnv} is missing. The real provider was not called.`);
    process.exit(2);
  }
  process.env.LLM_PROVIDER = liveProvider;
  const llmSettings = loadAppConfig().get(llmConfig);
  const provider: LlmProvider =
    liveProvider === 'openrouter' ? new OpenRouterProvider(llmSettings) : new OpenAiProvider(llmSettings);
  const fixture = FIXTURES.find((candidate) => candidate.id === 'clear-outage');
  if (!fixture) throw new Error('The clear-outage fixture is missing.');
  const started = Date.now();
  const prompt = buildAnalysisPrompt(fixture.source);
  const response = await provider.complete({ ...prompt, model: llmSettings.model }, AbortSignal.timeout(llmSettings.deadlineMs));
  let outcome = RubricOutcome.Fail;
  let detail = 'The output failed validation.';
  try {
    const result = validateAnalysis(response.rawText, fixture.source);
    const score = scoreAnalysis(fixture, result);
    outcome = rubricOutcomeOf(score.pass);
    detail = score.checks.map((check) => `${check.name}=${rubricOutcomeOf(check.pass)}`).join(', ');
    if (!score.pass) {
      const failed = score.checks.filter((check) => !check.pass).map((check) => check.name);
      console.error(`Rubric failed checks: ${failed.join(', ')}`);
    }
  } catch (error: unknown) {
    outcome = RubricOutcome.Fail;
    if (error instanceof OutputValidationError) {
      detail = `validation: ${error.message}`;
      console.error(`Validation: ${error.message}`);
    } else if (error instanceof Error) {
      detail = `error: ${redactSecrets(error.message)}`;
      console.error(`Unexpected: ${redactSecrets(error.message)}`);
    }
  }
  const report = [
    '# Live sample',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Provider: ${liveProvider}`,
    `- Model: ${response.model}`,
    `- Prompt: ${prompt.promptVersion}`,
    `- Latency ms: ${Date.now() - started}`,
    `- Input tokens: ${response.inputTokens ?? 'not reported'}`,
    `- Output tokens: ${response.outputTokens ?? 'not reported'}`,
    `- Rubric: ${outcome}`,
    `- Checks: ${detail}`,
    '',
    'A single sample does not measure general accuracy. The key and the full text were not stored in this report.',
  ].join('\n');
  const directory = path.resolve(process.cwd(), '../../qa-artifacts/live');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'REPORT.md'), report, 'utf8');
  console.log(report);
  process.exit(outcome === RubricOutcome.Pass ? 0 : 1);
}

main().catch((error: unknown) => {
  const liveProvider = parseLiveProviderArg();
  console.error('FAIL: the live sample could not be completed. The credential is not printed.');
  if (error instanceof ProviderRequestError) {
    console.error(`Provider: kind=${error.kind} attempts=${error.attempts ?? 'n/a'} status=${error.status ?? 'n/a'}`);
    console.error(`  detail: ${redactSecrets(error.message)}`);
    if (error.kind === 'network') {
      const host = liveProvider === 'openrouter' ? 'openrouter.ai' : 'api.openai.com';
      console.error(
        `  hint: Node could not complete HTTPS to ${host} (often TLS/CA, VPN, or antivirus). ` +
          'If curl returns 200 but this fails, fix trust store or remove a bad NODE_EXTRA_CA_CERTS.',
      );
    }
    if (error.kind === 'auth') {
      const keyName = liveProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
      console.error(`  hint: Regenerate ${keyName} in the provider dashboard and update .env (not committed).`);
    }
    logErrorChain(error);
    if (error.kind === 'network' || findTlsTrustDetail(error)) {
      printTlsOperatorHints(findTlsTrustDetail(error));
    }
  } else if (error instanceof OpenAI.APIError) {
    console.error(`OpenAI: ${error.constructor.name} status=${error.status ?? 'n/a'}`);
    if (error instanceof Error) {
      console.error(`  detail: ${redactSecrets(error.message)}`);
      logErrorChain(error);
    }
  } else if (error instanceof Error) {
    console.error(`Error: ${error.constructor.name} — ${redactSecrets(error.message)}`);
    logErrorChain(error);
    const tlsDetail = findTlsTrustDetail(error);
    if (tlsDetail) {
      printTlsOperatorHints(tlsDetail);
    }
  }
  const chain = formatCauseChain(error);
  if (chain) {
    console.error(`Cause chain: ${chain}`);
  }
  process.exit(1);
});

/**
 * Prints Windows-friendly TLS hints when Node cannot verify the provider host but curl often still works.
 * @param tlsDetail Optional detail from {@link findTlsTrustDetail}.
 */
function printTlsOperatorHints(tlsDetail?: string): void {
  if (tlsDetail) {
    console.error(`TLS detail: ${tlsDetail}`);
  }
  const extraCa = process.env.NODE_EXTRA_CA_CERTS;
  console.error(
    `TLS env: NODE_EXTRA_CA_CERTS=${extraCa ? 'SET (check the file matches your HTTPS inspector)' : 'unset'}, NODE_OPTIONS=${process.env.NODE_OPTIONS ?? 'unset'}`,
  );
  console.error(
    'If curl reaches the provider but Node fails on certificates, use npm run qa:ai:live (node --use-system-ca) or NODE_OPTIONS=--use-system-ca for dev:api. Remove or fix a wrong NODE_EXTRA_CA_CERTS.',
  );
}
