# Data policy

T26 research: [PII limits and local/managed alternatives](AI_RISK_DECISIONS.md). Missing a name is a recognition limitation, not a necessary consequence of local execution. No new detector or additional certification.


Updated: 2026-10-03, America/Buenos_Aires. Assessment section 2.1 is closed as an explanation of implemented controls and their limits, not privacy or production-operation certification. Provider retention is outside this application's control.

Decision 2026-10-03: scoped implementation accepted for a synthetic demo, with partial-name and other
residual detection failures retained. This is not complete privacy certification; do not submit confidential
real content. See [accepted risk](../qa/LOCAL_PII_INTEGRATION.md#accepted-limitation).

## Assessment 2.1 Coverage

The PDF requests five explanations in code or README, not a complete compliance system. This policy is the canonical reference linked from the README.

| Requested topic | Answer and verifiable reference |
|---|---|
| Stored versus excluded data | Per-data inventory and exclusions below; [schema](../../apps/api/src/db/migrations/001_init.sql) and [protection marker](../../apps/api/src/db/migrations/002_pii_policy.sql) |
| AI input/output retention | Configurable 30 days from creation, startup/hourly purge and cascades; [configuration](../../apps/api/src/config/slices.ts), [scheduling](../../apps/api/src/startup.service.ts) and [purge](../../apps/api/src/analyses/analyses.service.ts) |
| PII | Local detected-entity sanitation, explicit modes and accepted misses; [application service](../../apps/api/src/pii/pii.service.ts) and [actual report](../qa/LOCAL_PII_INTEGRATION.md) |
| Logging | Allowlisted fields, server correlation and normalized routes; [filter](../../apps/api/src/common/log.ts), [HTTP](../../apps/api/src/common/http.ts) and [nginx](../../infra/docker/nginx.conf) |
| Auditability | Minimal events and execution metadata, transactions and failure limits; [actions](../../apps/api/src/domain/audit-action.ts) and [repository](../../apps/api/src/db/repositories/typeorm/analysis.typeorm-repository.ts) |

Semantic model evaluation belongs to 2.2 and still requires actual-provider revalidation after current changes. Closing this explanation does not turn a FAIL into PASS.

## Stored data and retention

| Data | Where | Purpose | Retention |
|---|---|---|---|
| Login email and password hash | `users` | Account identity; unchanged by content sanitation | Until user deletion; account deletion is not in the MVP |
| Sanitized incident text and policy marker in protected mode | `analyses.source_text`, `analyses.pii_policy_version` | Reopen and ask about the same source | `RETENTION_DAYS` (30 by default) from creation |
| Validated, sanitized and revalidated result | `analyses.result` | Display the report | Same period |
| Sanitized questions and protected answers | `messages` | Conversation | Deleted with the analysis |
| Model, prompt version, attempts, latency and provider-reported tokens | `ai_executions` | Execution metadata without prompt content | Deleted with the analysis |
| Actor, action, resource, result and correlation id | `audit_events` | Who did what, without incident text | No independent purge implemented |

These descriptions apply to new protected records. Existing unmarked records are retained as they were, and explicit `PII_ENABLED=false` stores/forwards unprotected content. The disabled mode is intended for isolated synthetic regression; it is never an automatic fallback.

## Detected PII protection

The default full mode uses `pii-local-v1`. Explicit `PII_PERSON_ENABLED=false` uses `pii-contacts-v1`:
only detected email/phone data is replaced, names remain visible, and the page declares that limitation.
No automatic mode change follows latency or outage; protected history requires the current exact policy.

The local `services/pii` candidate uses GLiNER directly for people, `email-validator` and `phonenumbers` for contact details. Presidio/spaCy belong to the historical [T21 NO-GO experiment](../qa/PII_SPIKE.md), not this runtime. Build-time pinned model assets load offline; no external LLM is used for detection.

Source and questions are sanitized before their content/execution writes and before provider calls. A validated provider response has its generated narrative fields sanitized, then schema and exact-quote grounding are checked again against the sanitized source before persistence/display. Exact evidence quotes are already copies of the protected source: they are preserved, not passed through context-dependent NER a second time. Detector misses already present in that source remain an explicit limitation.

Detected values become literal `[PERSON_<32 hex>]`, `[EMAIL_ADDRESS_<32 hex>]` or `[PHONE_NUMBER_<32 hex>]` tokens, scoped by owner/incident using HMAC. Stability requires the same key and detected text/boundaries; this does not resolve name variants. React colors those exact tokens in source, chat, results and quotes. There are no identity aliases, stored reversible maps or original restoration.

This is pseudonymization of detected entities, not universal anonymization. Misses, false positives and identifying context remain possible. Addresses, identity documents and all other personal data are not automatically covered. The actual partial-surname/non-idempotence case remains FAIL and was accepted only for the synthetic assessment/demo; do not submit confidential real content. See [out-of-scope alternatives](PII_IMPLEMENTATION_PLAN.md#accepted-limitation-and-evolution).

## Failure and existing records

If input sanitation is unavailable, times out or returns an invalid contract, `PII_UNAVAILABLE` stops new content writes and provider invocation. Ownership checks may already read the database.

This blocks service failures, not detection misses: a valid response may leave PII unchanged, which can then be stored or forwarded. A policy marker proves which pipeline ran, not that the text is PII-free.

If output sanitation fails, the provider has already received sanitized input and may charge for the call. The raw response is not persisted or returned as a successful result; closed failure/execution metadata may be stored.

Migration `002_pii_policy` only adds a nullable policy marker. It does not delete or sanitize historical sources, messages or results. With PII enabled, detail/questions/retry reject unmarked or incompatible records with `PII_LEGACY_RECORD`; the list hides their content and severity while keeping metadata. Enabling protection does not erase previously stored or externally sent data.

## Data not persisted by the content pipeline

Plain passwords, full prompts, raw model-response bodies, cookies and authorization headers are not persisted as incident data. Provider keys and the HMAC key belong to operator-managed secrets, not incident tables, frontend bundles or image layers. The local HMAC file is intentionally retained as a private secret.

Original input necessarily reaches the browser, API memory and local detector before sanitation. No original-to-label table is retained. Avoid payload traces, temporary content files and copying real data into support/QA artifacts.

Local ignored QA artifacts may retain raw responses or traces from synthetic cases for diagnosis, unlike the runtime database. They have no automatic 30-day purge. The operator must review/delete unneeded copies and backups after investigation; current failed-case evidence is deliberately retained. Git ignore is not encryption or a retention control.

## Provider and deletion

With `LLM_PROVIDER=openai` or `openrouter`, the protected prompt leaves the application for the configured API. It may still contain undetected PII or identifying context. Paid routing is not a privacy guarantee: assess the selected provider's policy, retention and routing configuration separately. With `mock` there is no external model call.

`AnalysesService.purgeExpired` runs at startup and hourly. Purge removes expired analyses and their dependent content/metadata; accounts and audit have separate lifetimes. Deleting rows does not automatically erase backups, exported logs or the provider's copy.

### Retention outside analyses

| Store | Current behavior and production boundary |
|---|---|
| Accounts | Retained without a deletion endpoint or automatic expiry; login email remains personal data. A real deployment needs a business-defined lifecycle and deletion process. |
| Audit rows | No automatic purge or analysis foreign-key cascade; identifiers remain linkable after content deletion. Define purpose, restricted access and an approved retention period before real-data operation. |
| Local logs | No application TTL for stdout/Docker/collector copies. The operator owns access, rotation and deletion; disabling supplied nginx request logs does not clear old logs. |
| Synthetic QA files | Operator-reviewed cleanup, no scheduled purge; preserve required failure evidence privately, never use real confidential payloads. |
| AWS logs/backups | Terraform proposes CloudWatch 14 days and RDS backups 7 days; not deployed or runtime-verified. These are not the 30-day content policy. |
| Provider copies | External policy/configuration, not controlled by database purge; no verified zero-data-retention contract or setting in this assessment. |

These missing production lifecycle controls are disclosed limitations, not implemented deletion promises or additional assessment requirements. For the exercise, use only synthetic demo data and keep secrets/evidence private. Before real data, approve lifetimes/access per store, provider terms and a verifiable deletion procedure including restored backups.

## Audit and logging boundary

API structured logs use an allowlist; HTTP logs use server-generated correlation UUIDs and matched route templates or `unmatched`, rather than client headers/raw URLs. The supplied nginx template disables access logs and discards request error logs. The PII HTTP service disables access logs and uses closed errors without request payloads.

Observation-only `prompt_injection_signal` logs contain closed detector/rule/input identifiers, without excerpts. They are not database audit rows and follow the collector's retention. See [prompt-injection controls](PROMPT_INJECTION.md).

These controls describe the supplied paths, not verified universal coverage of libraries, reverse proxies, collectors, tracing or deployment logs. Existing marker tests do not certify all log levels or a real detector.

### Audit coverage and access

`audit_events` stores actor, action, resource, result, correlation and timestamp. Current actions are `analysis.create`, `question.add` and aggregate `retention.purge`; executions provide provider/model/prompt-version/attempt/token metadata. Retry completion currently uses `analysis.create`, not a distinct retry audit action. The purge event has no individual actor/resource and is inserted after deletion, outside that deletion transaction; a database failure can leave deletion without the event.

Normal analysis/question completion transactions coordinate content, execution and audit. Reduced database-error closes may omit messages/audit, and a total outage can prevent any failure record. The trail does not universally record login, reads or administrative changes and is not tamper-proof storage.

The UI/API does not expose an audit-management endpoint. Database and runtime-log access belong to the operator; there is no separate audit-reader role or deployed access-control certification. Production evolution would use least-privilege operations access, an approved audit retention policy, alerts on missing writes and an independent append-only sink if required by the business. None is claimed implemented.

## Operation and evidence

Create the private HMAC file once with `npm run pii:init-key`; it generates 48 random binary bytes without overwriting an existing file, requesting mode 0600. Windows ACLs need operator review. Service key loading accepts a 32–4,096-byte binary file or a UTF-8 environment value; keep the effective key stable for retained incidents. Rotation changes new labels and does not relabel existing records.

See [ADR-007](../decisions/ADR-007-local-pii.md), the [implementation guide](PII_IMPLEMENTATION_PLAN.md) and [runbook](../operations/RUNBOOK.md). The [T22 integration report](../qa/LOCAL_PII_INTEGRATION.md) contains actual runs and accepted limitations. Offline regression with PII disabled does not certify protected operation. Documentary closure of 2.1 does not certify real-data use, current hosted-model quality, CI or cloud deployment.
