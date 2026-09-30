import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFiles } from '../config/dotenv';
import { envSearchRoots, loadAppConfig } from '../config/env';
import { llmConfig } from '../config/slices';
import { buildAnalysisPrompt } from '../ai/prompt';
import { validateAnalysis } from '../ai/validate';
import { OpenAiProvider } from '../ai/openai.provider';
import { FIXTURES } from './fixtures';
import { RubricOutcome, rubricOutcomeOf, scoreAnalysis } from './rubric';

/**
 * Runs one clear-outage fixture against the real OpenAI provider and writes qa-artifacts/live/REPORT.md.
 * Exits with 2 when OPENAI_API_KEY is missing, 1 when the rubric fails, and 0 when it passes.
 * @returns Nothing. The process exits with the rubric outcome.
 */
async function main(): Promise<void> {
  loadEnvFiles({ searchRoots: envSearchRoots() });
  if (!process.env.OPENAI_API_KEY) {
    console.error('BLOCKED: OPENAI_API_KEY is missing. The real provider was not called.');
    process.exit(2);
  }
  process.env.LLM_PROVIDER = 'openai';
  const llmSettings = loadAppConfig().get(llmConfig);
  const provider = new OpenAiProvider(llmSettings);
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
  } catch {
    outcome = RubricOutcome.Fail;
  }
  const report = [
    '# Live sample',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Provider: openai`,
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

main().catch(() => {
  console.error('FAIL: the live sample could not be completed. The credential is not printed.');
  process.exit(1);
});
