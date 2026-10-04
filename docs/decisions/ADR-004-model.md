# ADR-004: Model integration

Date: 2026-09-29. Status: accepted.

## Decision

An `LlmProvider` contract with three implementations: `mock`, `openai` and `openrouter` (compatible API at `https://openrouter.ai/api/v1`). Prompts `incident-analysis.v3` and `incident-question.v4`. User content is sent in data blocks bound to a random per-request id. Output goes through Zod and a quote check. The official OpenAI SDK is configured with `maxRetries: 0`. The application retries at most once if the error is an attempt timeout, 429, 5xx or network error, and only if at least 3 s of `LLM_DEADLINE_MS` remain (half an attempt when `LLM_ATTEMPT_TIMEOUT_MS` is shorter). Defaults: 20 s deadline, 18 s per attempt.

## Reason

The flow is a single call returning JSON. An orchestration framework adds nothing at this scope. Keeping retries in one place avoids multiplying them with the SDK's own.

## Alternative

Accepting any well-formed JSON would show invented quotes as evidence. Retrying schema errors would spend another call with no guarantee of a correct result.

## Limit

No streaming. Cancelling the `AbortSignal` does not undo a request the provider has already processed. The mock does not measure model quality. `gpt-4o-mini` is the default for cost and JSON output; there is no measured comparison against another model.
