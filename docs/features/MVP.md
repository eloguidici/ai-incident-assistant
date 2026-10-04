# MVP contracts


Initial contracts dated 2026-09-29; documentation synchronized 2026-10-04, Buenos Aires, against the current dev tree. Not a new integration run.

## Analysis result

`summary`, `category` (`availability|performance|security|data|unknown`), `suggestedSeverity` (`low|medium|high|critical|unknown`), `evidence[]` with `quote` and `note`, `hypotheses[]` with `statement` and `confidence`, `missingInformation[]`, `uncertainty`.

Each retained `quote` must be an exact fragment of the protected incident without cutting labels. Nonexact quotes are omitted rather than automatically rejecting the report. Without quotes, `uncertainty` and `missingInformation` are required. Foreign URLs cause rejection. See [evaluation](../qa/AI_EVALUATION.md) for the lexical causal rule and its limits; there is no semantic judge.

## Question

The same object plus `answer`. Retained quotes come from the stored protected source, not earlier model answers. Recognized contact values absent from the source are rejected; originals are not restored. Sanitizer-introduced labels are allowed, not unknown model-invented labels.

## API

All routes are under `/api`. The error body is `{ error: { code, message, correlationId, analysisId } }`. It never includes a stack.

| Method | Route | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/health` | no | 200 `{ status: "ok" }` | 503 if the database does not respond |
| POST | `/auth/login` | no | user and `csrfToken`; cookies `ia_session` and `ia_csrf` | 400, 401, 429 |
| GET | `/auth/session` | yes | user | 401 |
| POST | `/auth/logout` | yes + CSRF | `{ ok: true }` | 401, 403 |
| GET | `/analyses?limit&offset` | yes | own page | 400, 401 |
| GET | `/analyses/limits` | yes | `sourceTextMax`, `questionMax`, `contentProtectionEnabled`, `personProtectionEnabled` | 401 |
| POST | `/analyses` | yes + CSRF | `completed` analysis, or an error with `analysisId` | 400, 403, 409, 413, 422, 429, 502, 504 |
| GET | `/analyses/:id` | yes | own detail with read-time `assistantInstructionsNoted` | 404 if absent/foreign; 409 for incompatible PII policy |
| POST | `/analyses/:id/messages` | yes + CSRF | detail with the thread | 404, 409, 413, 422, 429, 502 |
| POST | `/analyses/:id/retry` | yes + CSRF | new attempt if the analysis is `failed` | 404, 409 |

Statuses: `processing`, `completed`, `failed`. An interrupted run becomes `failed` with code `INTERRUPTED` if it is still in progress after the deadline plus 5 seconds.

Listed errors are principal cases, not exhaustive. Input/output protection failure can return `PII_UNAVAILABLE` (503); incompatible records return `PII_LEGACY_RECORD` (409). Early protection failure reserves no content and makes no model call; output failure occurs after the call and can be charged.

## Limits

Injection signals are observed, not blocked: create/retry scans the incident; questions include selected history/question. Detail adds `assistantInstructionsNoted`, computed on the stored source with the same detector; no new column or extra LLM is added. The visible note is not a verdict of a successful attack or safe output. See [cases and limits](../security/PROMPT_INJECTION.md).

- Incident/question: configurable trimmed limits. Base API/Compose defaults 1,000/500; demo script 4,000/500; latest recorded demo 8,000/1,000. React queries the API and preserves over-limit drafts without truncation. NUL returns 400 before model invocation. See [profiles](../operations/RUNBOOK.md#configuration-profiles).
- Context: incident + question + recent messages, with a budget of 12,000 characters. If the incident and the question do not fit, the API returns 413 and the model is not called. Older messages are dropped first.
- 20 analyses and 40 questions per user per hour, in memory.
- 4 concurrent model calls per process.
- Retention: `RETENTION_DAYS` (30). `expires_at` is set at creation. The sweep deletes the analysis and, in cascade, its messages and executions.

## Data

See the [data policy](../security/DATA_POLICY.md). ORM: TypeORM on `pg`, with injectable repositories and SQL migrations in `apps/api/src/db/migrations`. The current decision is [ADR-006](../decisions/ADR-006-typeorm-repository.md).
