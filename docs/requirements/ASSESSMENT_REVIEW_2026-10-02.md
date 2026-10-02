# Assessment compliance review — 2026-10-02


Branch: dev. Code reviewed: dcfc0f9b5b9d18538ff097fdcb30d8fc84a3ce26.
Commit 42e0c362ee553db01857c749b2df0c6ceb590a49 adds the PII plan and links only.
Source: original Full Stack AI Engineer Assessment PDF. Method: reading the PDF, source, contracts, CI and existing reports. No new tests, paid calls, browser runs, Terraform plan/apply or deployments were executed in this review.

## Conclusion

Core functional requirements are implemented and design explanations exist. Full delivery approval remains premature: adversarial real-model verification after remediation is pending, sensitive-data handling needs closure and final operational evidence must match the delivered commit.

File upload, voice, RAG, streaming, tools, queues, organizations and agent frameworks are not mandatory. The PDF permits text or documents and a small scoped application. Six to ten hours is an effort expectation; one week is the deadline.

## Complete coverage

| Section | Requirement | Observed implementation and limits |
|---|---|---|
| 1.1 | Content, interaction and structured output | Single incident text, questions and history. No cross-incident search/comparison; explicitly scoped and permitted. |
| 1.2 platform | Node/Java, API, AI endpoint, storage, authentication | Nest/Node, REST/OpenAPI, PostgreSQL, HttpOnly JWT cookie and CSRF; real providers and mock. |
| 1.2 AI boundaries | Prompt, invocation, post-processing | Separate prompt.ts, gateway/providers and validate.ts; CQRS commands and repositories. |
| 1.2 flexibility | Provider switching and prompt version/config | Mock/OpenAI/OpenRouter contract; prompts v4/v5 and execution metadata. OpenRouter is not required by the PDF. |
| 1.2 safety | Explain injection and unsafe-input controls | Random data-block boundaries, limits, no tools, schema/quote/URL validation and lexical impossible-action checks. Signal detector observes only. Live revalidation pending; no semantic truth guarantee. |
| 1.2 costs/rates | Explain production controls | Per-user quotas, concurrency, input/output budget, deadline and bounded retry. Shared quotas and monetary budgets are proposed, not implemented. |
| 1.3 UI | React, two pages, form and readable response | Login, submission, history and detail with conversation. |
| 1.3 states | Loading/error/empty and model status | Present; no partial results because output is validated before display. Streaming optional. |
| 1.3 refinement | Re-ask and uncertainty | Questions/retry, quotes, hypotheses/confidence and missing information. Exact quotes do not certify conclusions. |
| 2.1 | Storage, retention, PII, logging and audit | Explained with partial implemented controls; details below. Sanitizer is planned only. |
| 2.2 | Quality, regression and wrong-answer handling | Fixtures/rubric, manual live suites and review/rollback explanation. No live approval after latest fix; feedback feature absent. |
| 3.1 IaC | AWS or mock; Terraform/CloudFormation | HTTPS ALB, ECS/Fargate, RDS, IAM, secrets and logs proposal. Not deployed; validate is not runtime certification. |
| 3.1 secrets | Secure keys/config; location and rotation | Environment configuration, local secrets outside git, proposed Secrets Manager injection. Rotation replaces tasks; no reload or overlapping JWT keys. |
| 3.1 bursts | Explain scaling | Early rejection/429, concurrency, quotas and provider constraints documented. No autoscaling/shared quotas implementation. |
| 3.2 optional | Docker, deployment proposal, AI constraints | API/web/Compose plus Fargate proposal. Recent rebuild reported; post-remediation Compose suites still pending. |
| Bonuses | Pick any | Cost estimates at 1k/10k/100k, per-user isolation and Docker. User isolation is not complete organizational multi-tenancy. |
| Delivery | Repo/README, decisions, limitations, local run | English/Spanish docs outside runtime. Final clean-checkout walkthrough still needed. |

## Full section 2.1 review

**Stored versus not stored.** PostgreSQL stores users (email/hash), source/results/status, messages, executions and audit events. No columns store full prompts, secrets or invalid raw responses. Validated model outputs are retained; do not say responses are never stored.

QA exception: LIVE_SUITE.md describes ignored local artifacts containing raw contract-failure responses and selected validated outputs using synthetic fixtures. Scope the no-raw-storage statement to runtime/DB; define QA artifact cleanup separately.

**Retention.** RETENTION_DAYS defaults to 30 days from incident creation. Startup/hourly purge deletes expired incidents with message/execution FK cascades. This is not immediate physical deletion; process/DB failures can delay it.

Accounts lack deletion flow. Audit events have no purge or incident cascade. Local log retention depends on a collector; the undeployed Terraform proposal does set CloudWatch to 14 days and RDS backups to 7 days. Define account/audit purpose and retention, backup handling and QA cleanup; do not apply the incident TTL to every data category.

**PII.** Current source/questions may contain personal data and reach real providers unsanitized. The bilingual Presidio plan is not implemented. Add explicit synthetic-data/privacy notice, then implement and verify the plan.

Paid routing does not by itself establish privacy. The adapter configures neither retention/ZDR nor privacy routing preferences. Verify actual provider settings/conditions or state the limitation.

**Logging.** Field allowlist and closed signal identifiers avoid payload excerpts. Raw req.path and client correlationId remain possible disclosure channels: valid characters do not establish safe content. Review Nest, Python, nginx, tracing and info/warn/error, not only happy-path console.log. UUIDs can be linkable.

**Auditability.** AI operation events record actor/action/resource/result/correlation; executions record model/version/attempts/tokens. This is a minimal trail, not comprehensive login/read/purge/admin auditing. DB-failure fallbacks can close an execution without full message/audit detail, already documented in README. Define intended coverage, access and retention without promising universal completeness.

## Current AI-quality evidence

Historical Liquid/GPT reports on 2026-10-02 are FAIL: semantic contamination/false authority, excessive causal confidence, valid-URL rejection and a timeout. Historical v3/v4 45/45 cannot certify current behavior.

PROMPT_SECURITY_REMEDIATION.md reports v4/v5 fixes, URL/action matching, offline replay and local checks (184 API, 14 frontend, 41 browser). This is software regression evidence for known cases, not a new live-model pass. Paid rerun is NOT_RUN and post-fix Compose suites were not rerun.

Code-baseline CI passed: https://github.com/eloguidici/ai-incident-assistant/actions/runs/37045616518 . It includes lint/types/API/PostgreSQL/frontend/mock/build/docs/Terraform, not browser or real models. Documentation-only 42e0c3 CI was in_progress when queried; no success claim is made.

## Closure priorities

1. P0 quality: rerun difficult and benign cases with v4/v5 and the selected model/config under an authorized budget. Review full outputs, authority and causality, not JSON only. Keep approval pending until new evidence exists.
2. P1 data: execute the EN/ES/mixed PII spike/plan; agree account/audit/log/QA/backup retention and provider-policy wording.
3. P1 logs/audit: address client-controlled fields, warn/error coverage and DB failure cases; declare audit scope.
4. P1 final evidence: clean checkout and Compose login/analysis/two questions/retry/reload/ownership, evidence tied to commit. Run mock gates before authorized paid checks.
5. P2 evaluation: improve evaluation/rubric.ts no-invented-url check, which only verifies “http” presence in the source; include Spanish/mixed cases. Runtime compares complete URLs; evaluation must not overstate its weaker heuristic.
6. P2 infrastructure: when Presidio is implemented, align Docker/IaC container/network/resources/models and measure before retaining the current 256 CPU/512 MB task. Align sanitizer/API/proxy budgets. AWS deployment is not needed to demonstrate validate.

Update behavioral documentation only after implementation. Do not add optional product scope to hide unresolved quality work.
