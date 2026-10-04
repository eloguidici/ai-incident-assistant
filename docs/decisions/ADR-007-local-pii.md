# ADR-007: Local PII protection and literal labels


Date: 2026-10-02, Buenos Aires. Decision: approved for implementation. Updated 2026-10-03: scoped T22 synthetic-demo acceptance with retained failures, not universal privacy. See integration report and T25 closure.

QA update 2026-10-03: software/browser and selected core gate passed, but an additional actual-adapter
test found incomplete surname boundaries and non-idempotence. The original test remains FAIL. Later on
2026-10-03 the owner accepted that limitation for a synthetic assessment/demo and closed scoped T22;
see the [accepted limitation](../qa/LOCAL_PII_INTEGRATION.md#accepted-limitation). This does not certify sensitive real-data use.

## Context

Incident content and questions can contain personal data. Ownership and retention do not minimize what is stored or sent to a model provider. The user approved local PII protection and colored literal labels, without original restoration.

The real T21 Presidio/spaCy bilingual union remains [NO-GO](../qa/PII_SPIKE.md). It lost technical facts, produced unstable name boundaries and failed a 512 MiB startup. Its original measurements are historical evidence, not GLiNER performance.

## Decision

Keep the Nest modular monolith, light CQRS, repository boundaries and direct provider adapters. Add one bounded internal Python detection service behind the small `PiiSanitizer` contract; no orchestration framework is required.

Use GLiNER 0.2.27 directly with `urchade/gliner_multi-v2.1`, pinned to `443d26d654e0324125a96bebd8e796c14ff2efe6`, for people. Dedicated `email-validator`/`phonenumbers` recognizers handle email and phones. Presidio/spaCy are not runtime dependencies of this design. Build model/tokenizer assets into the image; runtime loads locally with offline flags and no external LLM guard.

Policy `pii-local-v1` declares `PERSON`, `EMAIL_ADDRESS` and `PHONE_NUMBER`. The response includes a bounded engine version with the full model revision. Multilingual quality and preservation of technical facts require actual corpus/holdout verification.

Sanitize source and questions before their content/execution writes and provider calls. After schema/grounding validation, sanitize narrative and revalidate against the sanitized source; preserve enums, structure and exact quotes without another NER pass on them. From 2026-10-03 nonexact quotes are omitted and the result may survive remaining checks. Sanitizer-introduced labels are kept; model-written labels absent from context are rejected. The causal rule is lexical, not semantic proof: [evaluation](../qa/AI_EVALUATION.md).

Input-sanitation failure makes no provider call or new content write. Output-sanitation failure occurs after a clean-input provider call and can incur cost; never persist the raw response as fallback.

## Labels and historical records

HMAC-SHA256 produces a 32-hex token scoped by policy, owner/incident, entity type and normalized detected text. Phone text may use canonical E.164. The private key is not sent in prompts. The service keeps no reversible original map.

The same key, scope and detection boundaries preserve labels across requests/restarts. Variant names are not resolved to an identity. Storage/prompts retain tokens; the screen shows Person, Email or Phone with consistent numbering within an analysis/history card for distinct tokens of one type. Distinct tokens do not establish distinct people. The original is not restored. Current v7/v9 prompts preserve tokens without identity guesses or invented labels.

Migration `002_pii_policy` adds a nullable marker without deleting or sanitizing old records. Protected mode blocks legacy detail/questions/retry and hides legacy list content. The marker attests pipeline selection, not detection accuracy. Account login email is unchanged.

## Operational consequences

- PII is enabled by default; explicit disabled mode is unprotected and used by general synthetic offline regression. Failure never switches it off automatically.
- `PII_PERSON_ENABLED=false` explicitly selects email/phone-only coverage (`pii-contacts-v1`) without loading the name model. Names remain unprotected; the page declares this. Full mode remains the default. Cross-policy history is blocked, never automatically relabeled.
- Authenticated runtime limits/coverage drive the frontend: defaults source 1,000 and question 500, retained over-limit drafts and combined pending status. No fake phase completion or automatic fallback.
- The host example uses loopback 18080 via an optional Compose overlay; normal Compose uses `pii:8000` on an internal network. The default adapter timeout is 10 s; the controller's overall request deadline also covers protection overhead.
- A private HMAC file is created once with 48 random bytes and requested mode 0600; Windows ACLs need review. Preserve the key for retained incidents; rotation changes new labels without automatic relabeling.
- Compose uses a secret, read-only root, dropped capabilities and provisional 4 GiB / 1 CPU. Terraform proposes 4 GiB / 1 vCPU total and a 3,072 MiB sidecar with a dedicated secret; it remains at zero tasks and undeployed. Local Terraform 1.9.8 `fmt`/`validate` passed on 2026-10-02; AWS runtime and model resource certification remain pending.
- API HTTP logs use server-generated UUIDs and route templates; the supplied nginx raw logs are disabled. This does not certify every external logging sink.

## Alternatives and remaining gates

Do not ship the failed bilingual union. An external LLM for detection would create another content egress path. Global/unkeyed hashes and reversible identity maps conflict with the chosen minimization boundary. Original restoration and identity aliases were explicitly excluded.

The service adds image size, CPU/memory, latency and a dependency that rejects requests on failure. Detectors may miss PII, over-redact facts or leave identifying context. This is pseudonymization, not universal anonymization; paid provider routing does not guarantee privacy.

Scoped T22 is closed by documented risk acceptance with results/residual failures in the [integration report](../qa/LOCAL_PII_INTEGRATION.md). Future layers are not implemented or cost-compared. T20/T25 retain historical evidence, not v7/v9 certification. [Later samples, in Spanish](../qa/DEMO_CASOS.es.md) record false positives; [operational profiles](../operations/RUNBOOK.md#configuration-profiles) distinguish single-slot waiting, demo overrides and base/AWS defaults. No universal SLA or confidential-data authorization is established.

Implementation details: [guide](../security/PII_IMPLEMENTATION_PLAN.md), [data policy](../security/DATA_POLICY.md), [runbook](../operations/RUNBOOK.md).
