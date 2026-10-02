# Bilingual PII protection implementation plan


Date: 2026-10-02. Status: proposal; implementation and verification pending.
Target branch: dev. PII review baseline: dcfc0f9b5b9d18538ff097fdcb30d8fc84a3ce26.
This plan does not certify later commits or claim implemented controls.

## Goal and requirement

Reduce exposure of personal data detected in incident content and questions before storage and model invocation, while preserving useful technical evidence.

Assessment section 2.1 asks for storage choices, retention of AI inputs/outputs, and handling of PII, logging and audit. It does not explicitly require an implemented anonymizer. This is a deliberate minimization improvement, kept proportional to the assessment.

Describe the feature as sanitization of detected PII. Context can identify people and detectors can miss entities; do not claim universal anonymization.

## Observed baseline

Source text, questions and validated results are stored in PostgreSQL and sent to the configured provider without PII sanitization. Logging uses a field allowlist, which does not detect PII inside allowed strings. Ownership and configurable incident retention exist (30 days by default). Account data, audit events and external logs need separate retention policies. The observed log-content test does not cover all levels/error paths. No new tests were executed during this review.

## Proposed architecture

Keep business rules, authentication, CQRS and repositories in Nest. A PiiSanitizationService uses a PiiSanitizer port with an HTTP adapter to a local Python container running Presidio and spaCy. Expose it only inside the Compose network.

The contract returns sanitized text, detected entity types and policy/engine version, without originals or payload logs. Nest owns the incident scope and consistent replacements.

Use presidio-analyzer for recognition and evaluate presidio-anonymizer operators for replacements. Verify APIs/model compatibility in a spike, pin reproducible versions and install models during image build. Do not download models per request.

Do not introduce another LLM, queues or an agent framework for this control. The tradeoff is an additional Python container, CPU/memory use and measurable latency.

## English, Spanish and mixed input

Explicitly configure English and Spanish spaCy models and appropriate recognizers. An environment language setting alone is insufficient.

Evaluate running both analyzers on each input and deterministically merging overlapping detections. Measure false positives and processing cost. Mixed-language support must be demonstrated, not inferred from two installed models.

Initial scope: people, email addresses, phone numbers and addresses where configured recognizers support them. Add cards or identity documents only with dedicated recognizers and fixtures. Do not indiscriminately redact all LOCATION/organization entities; operational locations may matter. Preserve dates, tickets, technical identifiers and error codes.

Document supported entities, regions and language limitations. Test accented names and regional/international phone formats.

## Processing flow

1. Authenticate, enforce ownership where applicable and validate input limits.
2. Reserve an incident ID to scope replacements without storing raw content.
3. Sanitize in memory; exclude originals from logs, traces, exceptions and metrics.
4. On sanitizer failure or timeout, return a recoverable error. Never persist or send the original as fallback.
5. Persist sanitized content and minimal sanitization metadata.
6. Build prompts from sanitized source/history, keeping instructions separate from data.
7. Validate output structure and grounding against that same sanitized source.
8. Check outputs before persistence/display: a model can introduce new personal data. If sanitation changes evidence/quotes, validate again; reject or mark according to the contract without saving the unsanitized response.
9. Sanitize every follow-up question using the same incident scope.

Do not alter the account login email through the content sanitizer; account data serves a separate purpose and needs its own controls.

## Consistent replacements

Maintain entity consistency within an incident without trivial correlation across users/incidents. Do not restore originals in answers.

Avoid global maps and plaintext original-to-placeholder tables. Numbered labels are readable but require a safe design for cross-request consistency.

In the spike, evaluate typed labels containing an opaque HMAC-derived identifier scoped to the incident. Keep keys out of logs/prompts; define stability across the incident lifetime, rotation, collision handling and restart behavior. Do not use an unkeyed hash of predictable emails/phones. Identity resolution across variants such as first name versus full name is outside MVP scope. Preserve existing placeholder tokens.

Finalize the replacement policy only after consistency and isolation tests.

## Failure, latency and observability

Set a bounded sanitizer timeout inside the endpoint budget after measuring runtime. Absence of detections is not proof of absence of PII.

Readiness verifies installed models. Limit input/output sizes and concurrency. Provide an English recoverable UI error and retry behavior.

Record duration, versions, language(s), detection types/counts and error codes without originals or detailed payloads. Review Nest, Python, proxy, tracing and dependency errors. Prefer HTTP route templates to raw paths and review untrusted correlation IDs.

Do not assume paid provider routing guarantees privacy; verify relevant configuration and policies.

## Existing records and retention

Old records remain unsanitized. For synthetic demo data, prefer an explicitly authorized test-environment reset. For retained data, design a separate migration covering sources, messages, results and evidence with revalidation. Do not forward old records through the new flow without sanitation.

Retain incident purge and cascades. Define separate policies for users, audit, logs and backups. Row deletion does not automatically remove backup copies. Do not introduce persistent originals, reversible maps or temporary payload files.

## Implementation tasks

| Task | Deliverable and completion criteria |
|---|---|
| PII-0: bilingual spike | Verified dependencies/models, English/Spanish/mixed fixtures, Docker measurements and replacement/contract decision. Reconsider the design if coverage or cost is unsuitable. |
| PII-1: local service | Typed endpoint, readiness, limits, timeout and no content logs; reproducible image. |
| PII-2: Nest adapter | Explicit signatures, DTOs, validated configuration and domain-safe errors behind a port. |
| PII-3: integration | Source, questions, history and outputs; coherent grounding; no raw fallback. |
| PII-4: data/UI/logs | Legacy-record policy, privacy notice and all logging paths reviewed. |
| PII-5: verification | Unit contracts, real Presidio integration and browser cases with evidence tied to a commit. |
| PII-6: documentation | ADR, data policy, Compose/runbook and concise defense updated to actual behavior. |

Review repository instructions and baseline differences before implementation. Record actual progress.

## Acceptance cases

Use synthetic data only:

- English, Spanish and mixed text; accented names, emails, addresses and regional phone formats.
- Repeated entities across source/questions; existing placeholders; service restart.
- Same input entity across different users/incidents does not share a correlatable substitute.
- Technical facts, dates and incident identifiers stay useful.
- Overlaps and no-PII cases; record false positives and false negatives.
- Unavailable service, timeout, malformed response or missing model: zero provider calls and no raw persistence.
- Capture actual provider-adapter payload including history with a provider spy; original sentinels must be absent.
- Inspect DB and info/warn/error logs of both services; originals must be absent.
- Simulated provider output containing new PII is sanitized/rejected and revalidated.
- Existing ownership, retention/cascades and retrieval keep working.
- Browser notice, English/Spanish analysis, follow-up, recoverable failure and retry.
- Mandatory real Presidio integration. Mocks cannot demonstrate detection quality. Measure p50/p95 latency and resources against an identified corpus/environment; do not invent results or thresholds.

Accept when declared entities meet the agreed corpus, business regression checks pass and limitations are documented. These tests do not establish universal PII coverage.

## Decision defense

Local detection reduces exposure without transmitting content to another external AI service. Sanitization precedes persistence and prompt construction; conversation and grounding use the sanitized source. English, Spanish and mixed text require demonstrated coverage. Detection complements ownership, retention and safe logging.

Final status: plan ready for review; implementation and certification pending.
