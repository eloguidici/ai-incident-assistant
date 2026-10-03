# Local PII implementation guide


Initial decision: 2026-10-02; updated: 2026-10-03, Buenos Aires. Scoped T22 synthetic-demo acceptance has measured quality/resources/integration and retained failures in the [report](../qa/LOCAL_PII_INTEGRATION.md), not universal privacy approval. [T25 closure](../qa/ASSESSMENT_CLOSURE.md) separates software regression from semantic FAIL.

Current decision 2026-10-03: the owner accepts observed limitations for the synthetic assessment/demo and
closes T22's scoped implementation. This does not certify complete privacy or confidential real-data use.
Original FAIL results/assertions remain in the [report](../qa/LOCAL_PII_INTEGRATION.md).

## Accepted Limitation And Evolution

The verified integration works, but name detection can leave a partial surname and change on a second
sanitation. Obfuscated contacts and unsupported entities also remain. These are observed boundary cases;
the synthetic sample does not establish their real-world frequency. A label proves replacement of a
detected fragment, not absence of all PII.

Additional layers are deferred by scope/budget choice. Costs include tokens for another LLM, local
CPU/memory, latency, integration and evaluation. No quotes or comparative trials were performed;
we do not claim alternatives are unaffordable, superior or guaranteed to solve the observed case.

| Future option, not implemented | Intended benefit and cost to validate |
|---|---|
| Bounded local second check or recognizer adaptation | Evaluate remaining fragments/stability without new external egress; measure false positives, cycles, CPU and deadlines |
| Specialized PII service, such as Azure Language | Evaluate managed detection/redaction; review consumption, latency, data contract, categories/languages and preserve scoped labels |
| Local or hosted LLM reviewer | Evaluate difficult context against the same rubric; hosted review exposes residual undetected data to another provider and does not guarantee privacy |
| Guard library, such as LLM Guard | Evaluate detectors/rules, not a magic fix. Its anonymization scanner uses Presidio/recognizers; it does not necessarily require another LLM call or correct the historical T21 NO-GO |

Azure documents [PII detection/redaction](https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/overview)
and [language support](https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/language-support),
including English/Spanish. LLM Guard describes its [Anonymize scanner](https://github.com/protectai/llm-guard/blob/main/docs/input_scanners/anonymize.md).
These are evaluation references, not integrations tested here or deployment recommendations.

Defense narrative: "I chose a local first layer to reduce exposure without another provider call. I tested
it, found detection limits and kept them visible. We accept that coverage for a synthetic-data exercise.
Sensitive real-data requirements would require evaluating another layer and human review, measuring
accuracy, privacy, latency and cost before enabling that use." PII and prompt-injection protection are
different problems; T20's hosted-model retest remains separate.

## Goal and decision

Reduce exposure of detected personal data before incident content or questions reach PostgreSQL or the configured model provider. Assessment section 2.1 requires explaining PII, retention and logging; this bounded improvement does not add a new platform or agent workflow.

T21's real Presidio/spaCy bilingual union remains **NO-GO**: false positives removed technical facts, name boundaries were unstable and the 512 MiB startup failed. Preserve its original [experiment and measurements](../qa/PII_SPIKE.md). They do not measure the replacement service.

[ADR-007](../decisions/ADR-007-local-pii.md) records the approved candidate: a local Python service with multilingual GLiNER for `PERSON`, dedicated offline email validation and phone recognition for `EMAIL_ADDRESS` and `PHONE_NUMBER`. Addresses, identity documents, cards, organizations and locations are outside this candidate's declared entity scope.

## Implementation boundary

Nest retains authentication, ownership, light CQRS, repository transactions and direct LLM provider adapters. `PiiService` depends on the `PiiSanitizer` port; `HttpPiiSanitizer` validates the bounded HTTP response. `services/pii` returns sanitized strings, policy/engine versions and entity counts, without original spans or an identity map.

The model is `urchade/gliner_multi-v2.1` at revision `443d26d654e0324125a96bebd8e796c14ff2efe6`; its tokenizer is pinned separately in `services/pii/model-lock.json`. The engine version includes that full hash. GLiNER 0.2.27 runs directly behind a minimal local recognizer contract; Presidio is not required. Assets are downloaded at image build, loaded locally at runtime with offline flags, and processed on CPU. The service is a local detection guard, with no external LLM. English, Spanish and mixed-text quality must still be measured.

Email checks disable deliverability/DNS lookup. Phone recognition uses AR/US/ES/GB parsing regions; non-international formats require nearby phone context. These are implementation rules, not proven coverage of every regional format.

The current development candidate uses `person name` alongside `software component`, `organization` and `JSON field name` as GLiNER context labels; only person-name detections become `PERSON`. Window/narrative-leaf inference is batched in groups of up to eight. These changes remain under corpus/holdout and latency evaluation. The INT8 comparison was discarded as NO-GO after lower quality; partial development results do not approve the FP32 candidate.

## Processing flow

1. Authenticate, validate input limits and enforce ownership where applicable.
2. Generate an incident UUID in memory and scope sanitation to owner plus incident.
3. Sanitize source text before reserving its analysis/execution rows. Sanitize each question before inserting its execution or messages. Recheck the protected context budget because labels expand the text.
4. Reject unavailable, timed-out or malformed sanitation with `PII_UNAVAILABLE` (503). There is no raw fallback. Early failure creates no incident/question content writes and makes no provider call; ownership reads may already have occurred.
5. Persist the sanitized source with `pii_policy_version = pii-local-v1`. Prompts use that source and the protected conversation history. Retries reuse the stored protected source.
6. Validate the provider response's schema and grounding. Sanitize narrative leaves: summary, uncertainty, missing information, evidence quote/note, hypothesis statement and question answer; keep enums and structural fields intact.
7. Reject privacy tokens absent from the actual protected model context, then revalidate schema, exact quotes and grounding against the same sanitized source before committing results/messages. Changed quotes that no longer match are rejected.

An output-sanitation failure happens **after** the provider has been called with sanitized input. The call can be charged; the raw response is not persisted or returned as a successful result. Failure metadata may be written. Do not describe this as zero provider calls.

Account login email is unchanged: it belongs to account identity, outside incident-content sanitation.

## Labels and rendering

Literal labels are `[PERSON_<32 lowercase hex>]`, `[EMAIL_ADDRESS_<32 lowercase hex>]` and `[PHONE_NUMBER_<32 lowercase hex>]`. HMAC-SHA256 is truncated to 32 hexadecimal characters and includes policy, owner/incident scope, entity type and normalized detected text. Phone recognition may use its canonical E.164 value.

Labels remain stable across requests/restarts given the same key, scope and detected text/boundaries. This is not identity resolution: short/full names or changing model boundaries can produce different labels. Existing valid labels are preserved; there is no reversible original map or restoration.

React colors the literal token by entity type in source, history, chat, results and quotes, using safe text nodes. It does not replace tokens with aliases. Previews/context truncate without cutting valid tokens; mock quotes retain complete protected tokens. Exact quote text remains the stored sanitized text; color does not alter grounding. Current prompts `incident-analysis.v6`/`incident-question.v7` instruct exact preservation, no identity guesses and no invented labels. Historical T20 v4/v5 evidence does not certify their live quality. T22/T25 exercised browser layers, waiting states, labels and desktop/mobile layout; universal accessibility is not certified.

## Configuration and operation

| Setting | Candidate behavior |
|---|---|
| `PII_ENABLED` | Defaults to `true`; explicit `false` is unprotected mode, never automatic failure recovery |
| `PII_PERSON_ENABLED` | Defaults to `true`; explicit `false` skips the name model and protects email/phone only under `pii-contacts-v1` |
| `PII_SERVICE_URL` | Host setup: `http://127.0.0.1:18080` in the example; Compose: `http://pii:8000`; ECS proposal: same-task `http://127.0.0.1:8000` |
| `PII_TIMEOUT_MS` | 10,000 ms per internal HTTP request by default and at most; not a measured endpoint SLA |
| `SOURCE_TEXT_MAX` / `QUESTION_MAX` | 1,000 / 500 trimmed characters by default; effective API settings also drive React |
| `PII_HMAC_KEY_PATH` | Compose secret file; default `.local/pii-hmac.key` |
| `npm run pii:init-key` | Creates the key once with requested mode 0600; does not overwrite an existing key |

The script generates 48 raw random bytes. The service accepts a 32–4,096-byte binary secret file or a UTF-8 environment value. Review Windows ACLs separately; POSIX mode is not a Windows ACL guarantee. Keep the effective key private and stable for retained incidents. Rotation changes newly generated labels; there is no automatic relabeling or compatibility map.

The authenticated `GET /api/analyses/limits` returns `sourceTextMax`, `questionMax`, `contentProtectionEnabled` and `personProtectionEnabled`, without secrets. React loads them at runtime, disables submission while they are unavailable, and preserves over-limit drafts with an inline error instead of truncating them. Server validation remains authoritative. Restart/recreate the affected services and reload the page after configuration changes; no frontend build is needed. Existing `.env` values may override new Compose defaults and require explicit operator review.

The page declares full coverage, contacts-only coverage (names are not protected), or disabled protection. Pending text combines protection and analysis/answer preparation; it does not invent independent completion stages. Operators change layers explicitly. No automatic downgrade occurs on a slow or failed request. Both enabled modes use distinct stored policy markers and reject cross-policy historical records. Standard Compose still provisions a healthy PII service even when API protection is disabled.

The controller's overall default 20 s request deadline also covers protection through its abort signal. The 10 s service timeout is per HTTP request, not a guaranteed extension. General tests with short 2.5 s deadlines explicitly bypass PII; they do not measure the actual protected flow.

Preliminary CPU measurements showed the former 8,000-character source cap and sequential narrative batches could exceed request budgets. The 1,000/500 defaults are a conditional starting envelope, not a latency guarantee. Batching and new NER context labels require final retesting of inputs, multi-leaf outputs, quality and resources before approval. Raising limits also requires checking protected-text expansion, context/service bounds and the 32 KB HTTP body.

Compose attaches PII only to an internal network, mounts the key as a secret, runs with a read-only root, drops capabilities and uses no-new-privileges. Its 4 GiB / 1 CPU limit is provisional. The optional `docker-compose.pii-dev.yml` exposes only loopback port 18080 for host Node development.

The extra-CA overlay supplies PII's optional build secret for verified dependency/model downloads, plus the existing API/web build configuration and API runtime trust mount. Runtime PII inference does not require provider credentials or model downloads. See the [runbook](../operations/RUNBOOK.md).

Terraform now proposes a 4 GiB / 1 vCPU task with a 3,072 MiB PII sidecar, `pii_container_image` and a dedicated HMAC secret. `source_text_max`/`question_max` default to 1,000/500 and feed API/React runtime limits; the adapter timeout is 10 s. This is a different resource envelope from Compose. `desired_count = 0` remains. T25 reran `fmt` and `validate` with Terraform 1.9.8 in Linux/cached providers: PASS. Windows CLI failed on the local plugin certificate; TLS was not disabled. AWS runtime and model resource certification remain pending.

## Existing records, retention and logs

Migration `002_pii_policy` adds a nullable marker. It does not sanitize, delete or migrate old content. With protection enabled, detail, questions and retries reject null/other policy markers with `PII_LEGACY_RECORD` (409); lists retain metadata but hide source excerpts, summaries and severity. A marker identifies the applied pipeline, not detector accuracy.

Incident retention/cascades remain. Accounts, audit, collectors and backups need their own policy. API request logs use server-generated UUIDs and route templates (or `unmatched`); nginx raw request/access/error logging is disabled in the supplied template. These scoped changes do not certify every dependency, proxy or external logging sink. See the [data policy](DATA_POLICY.md).

## Verification And Accepted Scope

The [local integration report](../qa/LOCAL_PII_INTEGRATION.md) records actual results and the owner's risk acceptance for the synthetic demo. The following catalog describes verification, not universal guarantees. General offline API/browser regressions explicitly disable PII and do not certify the detector.

- Compare the real offline model on the unchanged T21 corpus plus separate EN/ES/mixed holdouts: misses, false positives, technical losses, repeat boundaries and phone/email formats.
- Measure startup/RSS, CPU and p50/p95 latency on short and configured-maximum sources/questions and multi-leaf output batches. Verify the 10 s adapter timeout, overall deadline and proposed resource envelopes after the batching/label changes.
- Verify the authenticated limits endpoint, runtime changes without a web build, preserved over-limit drafts, inline errors, submission controls and server-side rejection for both inputs.
- Verify stable labels with the retained key, restart behavior, incident/user separation, preserved labels and absence of originals from provider payloads, PostgreSQL and reviewed logs.
- Exercise unavailable/timeout/malformed service before writes/calls, output failure after a clean-input call, invalid quotes after sanitation and legacy detail/question/retry/list behavior.
- Run affected API/PostgreSQL, frontend, mock and real-service Compose/browser flows, including literal colored labels at desktop/mobile sizes; record the exact tested revision.

PII-0 retains its historical NO-GO. T22 closes implementation, documented verification and accepted limitations for the synthetic assessment/demo; it does not certify universal detector coverage or sensitive real-data use. FAIL results remain FAIL and the battery may return a nonzero exit code for the known case.

Detected PII replacement is pseudonymization, not universal anonymization. A detector may miss data and context may identify a person. Paid provider routing is not a privacy guarantee; provider policy and retention remain separate.
