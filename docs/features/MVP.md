# MVP contracts


Contracts closed on 2026-09-29.

## Analysis result

`summary`, `category` (`availability|performance|security|data|unknown`), `suggestedSeverity` (`low|medium|high|critical|unknown`), `evidence[]` with `quote` and `note`, `hypotheses[]` with `statement` and `confidence`, `missingInformation[]`, `uncertainty`.

`quote` must be an exact fragment of the incident. Without quotes, `uncertainty` and `missingInformation` are required. A URL in the output is accepted only if it was already in the incident.

## Question

The same object plus `answer`. The quote must still come from the original incident, not from an earlier model answer.

## API

All routes are under `/api`. The error body is `{ error: { code, message, correlationId, analysisId } }`. It never includes a stack.

| Method | Route | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/health` | no | 200 `{ status: "ok" }` | 503 if the database does not respond |
| POST | `/auth/login` | no | user and `csrfToken`; cookies `ia_session` and `ia_csrf` | 400, 401, 429 |
| GET | `/auth/session` | yes | user | 401 |
| POST | `/auth/logout` | yes + CSRF | `{ ok: true }` | 401, 403 |
| GET | `/analyses?limit&offset` | yes | own page | 400, 401 |
| POST | `/analyses` | yes + CSRF | `completed` analysis, or an error with `analysisId` | 400, 403, 409, 413, 422, 429, 502, 504 |
| GET | `/analyses/:id` | yes | own detail | 404 if it does not exist or belongs to someone else |
| POST | `/analyses/:id/messages` | yes + CSRF | detail with the thread | 404, 409, 413, 422, 429, 502 |
| POST | `/analyses/:id/retry` | yes + CSRF | new attempt if the analysis is `failed` | 404, 409 |

Statuses: `processing`, `completed`, `failed`. An interrupted run becomes `failed` with code `INTERRUPTED` if it is still in progress after the deadline plus 5 seconds.

## Limits

Prompt-injection input signals are observed, not blocked: create/retry scans the incident; follow-up scans incident, actual selected history and question. Legitimate reports quoting attacks still proceed. Input, API contracts and statuses are unchanged; no extra model call or database field is added. The output validator separately checks complete grounded URLs and selected impossible assistant-action claims. See [use cases and limitations](../security/PROMPT_INJECTION.md).

- Incident: 1 to 8,000 characters. Question: 1 to 1,000. Text with a NUL character is rejected with 400 before the model is called.
- Context: incident + question + recent messages, with a budget of 12,000 characters. If the incident and the question do not fit, the API returns 413 and the model is not called. Older messages are dropped first.
- 20 analyses and 40 questions per user per hour, in memory.
- 4 concurrent model calls per process.
- Retention: `RETENTION_DAYS` (30). `expires_at` is set at creation. The sweep deletes the analysis and, in cascade, its messages and executions.

## Data

See the [data policy](../security/DATA_POLICY.md). ORM: TypeORM on `pg`, with injectable repositories and SQL migrations in `apps/api/src/db/migrations`. The current decision is [ADR-006](../decisions/ADR-006-typeorm-repository.md).
