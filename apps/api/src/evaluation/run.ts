import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildAnalysisPrompt } from '../ai/prompt';
import { validateAnalysis } from '../ai/validate';
import { MockProvider, resetMockState } from '../ai/mock.provider';
import { FIXTURES } from './fixtures';
import { rubricOutcomeOf, scoreAnalysis } from './rubric';

/**
 * Scores every fixture against the mock provider and writes qa-artifacts/eval/REPORT.md.
 * Exits with 1 when any fixture fails the rubric.
 * @returns Nothing. The process exits non-zero on a failed fixture.
 */
async function main(): Promise<void> {
  resetMockState();
  const provider = new MockProvider();
  const scores = [];
  for (const fixture of FIXTURES) {
    const prompt = buildAnalysisPrompt(fixture.source);
    const response = await provider.complete({ ...prompt, model: 'mock-incident-v1' }, new AbortController().signal);
    const result = validateAnalysis(response.rawText, fixture.source);
    scores.push(scoreAnalysis(fixture, result));
  }
  const report = [
    '# Evaluation with the mock provider',
    '',
    'This measures the contract and the rubric against the deterministic double. It does not certify real-model quality.',
    '',
    ...scores.flatMap((score) => [
      `## ${score.id}`,
      `Result: ${rubricOutcomeOf(score.pass)}`,
      ...score.checks.map((check) => `- ${check.name}: ${rubricOutcomeOf(check.pass)}`),
      '',
    ]),
  ].join('\n');
  const directory = path.resolve(process.cwd(), '../../qa-artifacts/eval');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'REPORT.md'), report, 'utf8');
  console.log(report);
  if (scores.some((score) => !score.pass)) process.exit(1);
}

main().catch(() => {
  console.error('The mock evaluation could not be completed.');
  process.exit(1);
});
