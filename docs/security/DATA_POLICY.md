# Data policy


Status: implemented in the application. The external provider's retention is not implemented here because this application does not control it.

## What is stored

| Data | Where | Purpose | Retention |
|---|---|---|---|
| Email and password hash | `users` | Identity | Until the user is deleted. There is no account deletion in the MVP. |
| Incident text | `analyses.source_text` | Reopen the analysis and ask again | `RETENTION_DAYS` (30) from creation |
| Validated result | `analyses.result` | Show the report | Same period |
| Questions and answers | `messages` | Analysis thread | Deleted with the analysis |
| Model, prompt version, attempts, latency, tokens when the provider reports them | `ai_executions` | Technical audit without the text | Deleted with the analysis |
| Actor, action, resource, result and correlation id | `audit_events` | Who did what | Does not include the incident text. It has no purge of its own. |

## What is not stored

Plain passwords, provider keys, the raw body returned by the model, the full prompt, cookies and the `Authorization` header. Logs accept only a closed list of fields (`msg`, `status`, `correlationId`, `latencyMs`, `provider`, `model`, `promptVersion`, `attempts`, `errorCode`, ids). An integration test sends a text with a marker and checks that it does not appear in `console.log`.

## Provider

With `LLM_PROVIDER=openai` or `openrouter`, the incident leaves the process towards the configured API. That copy follows the provider's policy, not `RETENTION_DAYS`. Free OpenRouter routes may log or use prompts; use a paid route with data retention disabled for real data. With `mock` there is no external call.

## Deletion

`AnalysesService.purgeExpired` runs at startup and every hour. It can also be triggered in tests. The integration case sets `expires_at` in the past and checks the 404 that follows. It is not a cloud job.

## Audit and logs

The audit trail answers who performed which action, on which id, with which result and correlation id. The technical log answers HTTP status, duration and error code. They are not the same record.

## PII

The incident may contain personal data because the user pastes it. It is stored until expiry and sent to the provider in real mode. There is no detector that promises to remove it.
