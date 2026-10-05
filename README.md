# AI Incident Assistant

[Documentation index](docs/README.md) | [Delivery checklist](docs/operations/DELIVERY_CHECKLIST.md) | [Verification evidence](docs/qa/README.md)

An authenticated analyst submits incident text, receives a structured analysis, asks follow-up questions and returns to saved results. The output separates evidence (exact quotes from the text), hypotheses and missing information. The application does not execute remediation in external systems.

The current local detector and its scoped acceptance are described in the [integration report](docs/qa/LOCAL_PII_INTEGRATION.md), [implementation guide](docs/security/PII_IMPLEMENTATION_PLAN.md) and [ADR-007](docs/decisions/ADR-007-local-pii.md). The earlier [Presidio/spaCy experiment](docs/qa/PII_SPIKE.md) remains NO-GO and is not the application runtime. Start with the [latest handoff verification](docs/qa/HANDOFF_RECHECK_2026-10-05.md); older reports retain their dates and limits.

Decision, 2026-10-03: the owner accepts scoped local PII for the synthetic assessment/demo with known
limitations. Software/browser and core corpus passed; the partial-surname/non-idempotence test remains FAIL.
This is not complete privacy certification. See the [accepted limitation](docs/qa/LOCAL_PII_INTEGRATION.md#accepted-limitation)
and [future options](docs/security/PII_IMPLEMENTATION_PLAN.md#accepted-limitation-and-evolution); costs/effectiveness were not compared.

## Assessment coverage

**Delivery acceptance, 2026-10-03:** the owner accepts known injection, unsupported
conclusion and partial-name limits for the assessment/synthetic, human-reviewed
demo. No further mitigation is planned in this stage; measured FAIL results remain.
The owner subsequently reported personal manual acceptance complete on 2026-10-05;
independent checks are in the dated handoff report.
[Decision and rationale](docs/security/AI_RISK_DECISIONS.md#demonstration-risk-acceptance).
This does not authorize confidential data or production use; additional technologies
are outside evaluated scope, not declared impossible because execution is local.

Historical assessment validation, 2026-10-03: both real providers and one correction iteration executed;
**semantic quality FAIL**, while the manual workflow operates. [Dated results](docs/qa/ASSESSMENT_CLOSURE.md).
Later v7/v9 [recorded demo samples](docs/qa/DEMO_CASES.md) are separate evidence, not a new full-regression approval. See the [delivery gates](docs/operations/DELIVERY_CHECKLIST.md#status-and-remaining-submission-gates).
[Manual OpenAI testing](docs/qa/MANUAL_ACCEPTANCE.md): synthetic data, full protection
and 4,000/500 limits. Accepted output is not a verified root cause.

| Assessment section | Where it is answered |
|---|---|
| 1.1 Problem statement | This README; [product scope](docs/business/PRODUCT.md) |
| 1.2 Backend (AI-first) | [Architecture and AI design](#architecture-and-ai-design); [prompt injection](#prompt-injection-and-unsafe-input); [costs and rate limits](#costs-and-rate-limits-in-production); [provider selection and switching](#real-provider-demo-powershell) |
| 1.3 Frontend (AI-aware UX) | [AI-aware user experience](#ai-aware-user-experience) |
| 2.1 Data flow and storage | [Data, retention, PII, logging and audit](#data-retention-pii-logging-and-audit); [data policy](docs/security/DATA_POLICY.md) |
| 2.2 AI evaluation and reliability | [Evaluation and reliability](#evaluation-and-reliability) |
| 3.1 Cloud and runtime | [Secrets, rotation and bursty usage](#secrets-rotation-and-bursty-usage); [Terraform guide](infra/terraform/README.md) |
| 3.2 Containerization (optional, included) | [Container deployment choice](infra/terraform/README.md#container-deployment-choice); [scaling constraints of AI workloads](#scaling-constraints-of-ai-workloads); `infra/docker/` |
| Bonus | [Cost estimate for 1k / 10k / 100k requests](#cost-estimate-for-1k--10k--100k-requests); [per-user data isolation](#per-user-data-isolation); [bonus sections not chosen](#bonus-sections-not-chosen) |

## Architecture and AI design

NestJS/TypeScript modular monolith, React frontend and PostgreSQL with TypeORM repositories. Read handlers (list, detail) are separate from commands (create, retry, question) through CommandBus/QueryBus, without event sourcing or separate databases. Repository operations own transactional state changes.

The model path has one responsibility per step:

1. **Prompt construction** (`apps/api/src/ai/prompt.ts`): versioned prompts `incident-analysis.v7` and `incident-question.v9`, with exact PII-token preservation, no identity guesses and no invented labels.
2. **Model invocation** (`apps/api/src/ai/gateway.ts` and the providers): a deterministic mock, OpenAI and OpenRouter implement the same `LlmProvider` contract, selected with `LLM_PROVIDER`. SDK retries are disabled; the gateway owns deadlines and at most one retry.
3. **Response post-processing** (`apps/api/src/ai/validate.ts`): Zod schema validation, omission of nonexact quotes, a lexical rule moving selected sentences to uncertainty when their English causal expression is absent from the source, URL comparison and a bounded external-action check. Questions also check recognized contact values absent from the source. This does not verify the specific cause or semantic truth; useful facts may be removed and errors may survive. See [evaluation and limits](docs/qa/AI_EVALUATION.md).

The prompt version, provider, model, attempts, latency and token counts are stored with every execution. No database transaction is held open during the model call.

With `PII_ENABLED=true` (default), Nest calls a bounded local Python service before source/question content writes or provider invocation. The service uses GLiNER 0.2.27 directly with a pinned multilingual model, plus `email-validator` and `phonenumbers`; it is an offline detection guard, without another external LLM or orchestration framework. A schema-validated provider result then has its narrative fields sanitized and its schema/grounding revalidated against the sanitized source before persistence.

`PII_PERSON_ENABLED=true` is the full default. Explicit `false` selects contacts-only coverage without loading
the name model; names remain visible. `PII_ENABLED=false` disables all protection. React declares the effective
coverage, configured limits and combined processing state. Failures never reduce coverage automatically;
cross-policy historical records are blocked in enabled modes. See the [runbook](docs/operations/RUNBOOK.md).

More detail: [architecture rationale](docs/architecture/RATIONALE.md), [design](docs/architecture/DESIGN.md), [API contracts](docs/features/MVP.md) and [decision records](docs/decisions/).

## Assessment answers

### Prompt injection and unsafe input

- **Data and instructions have explicit boundaries.** Incident, conversation and question use data blocks with fresh random identifiers absent from the input. The system message names those identifiers and treats other markers as data. This prevents forging the expected closing marker, not semantic manipulation (`apps/api/test/prompt-injection.spec.ts`).
- **Observation-only pattern detector.** Native `RegExp` scans incident, selected history and question before invocation. It emits six closed signal identifiers without excerpts, blocking, input rewriting or an extra LLM. Known evasions and legitimate attack reports are tested; no match does not mean safe. See [behavior, use cases and future alternatives](docs/security/PROMPT_INJECTION.md). Run `npm run qa:security:signals` with the test database.
- **The model has no tools.** There is no function calling and the application never executes actions based on model output, so an injected instruction has nothing to trigger.
- **Output is validated, not trusted.** A strict schema rejects unexpected fields. Nonexact quotes or quotes cutting a privacy label are omitted; a report may survive remaining checks. Without evidence, uncertainty/missing information are required. Foreign URLs cause rejection. Remaining failures are recorded when possible rather than shown as results; a database outage may prevent that record. Quote omission does not prove the explanation correct.
- **Input is bounded and configurable.** `SOURCE_TEXT_MAX` defaults to 1,000 characters and `QUESTION_MAX` to 500; the API checks trimmed content, rejects NUL characters, limits request bodies to 32 KB and checks a 12,000-character context budget before model invocation. The authenticated `GET /api/analyses/limits` returns `sourceTextMax`, `questionMax`, `contentProtectionEnabled` and `personProtectionEnabled`. React reads them at runtime, preserves over-limit drafts, shows an inline error and disables submission; the server still enforces its own limits.
- **Rendering is safe.** React renders model output as text, never as HTML; an end-to-end test checks that injected HTML is not executed.
- **Limit:** these controls reduce risk; they do not make a language model immune to manipulation. A human reviews every analysis.

### Costs and rate limits in production

Current controls (per process):

| Control | Default |
|---|---|
| Analyses per user per hour | 20 |
| Questions per user per hour | 40 |
| Login attempts per IP (15 minutes) | 10 |
| Concurrent model calls | 4 |
| Maximum output tokens per call | 4,096 |
| Context budget | 12,000 characters |
| Deadline per request / per attempt / retries | 20 s / 18 s / at most 1 retry, only for timeout, 429, 5xx or network, and only with at least 3 s left |

Token usage is recorded per execution, which is the basis for cost reporting. For production I would add: a shared quota store (Redis or PostgreSQL) so limits hold across replicas; a monthly budget per user or tenant with an alert and a hard stop; provider spend alerts; and a cheaper default model with an explicit, logged upgrade path. A timeout does not prove the provider did not charge for the request.

### Data, retention, PII, logging and audit

Section 2.1 closed on 2026-10-03 (Buenos Aires): all five requested topics are explained here and in the linked policy. This closes assessment scope, not privacy or production certification.

- **Stored:** user login email and password hash; sanitized source, protected result/questions/answers and policy marker for new protected records; execution metadata (prompt version, model, attempts, latency, tokens); audit events (who, what, which resource, result, correlation id). Account email is unchanged.
- **Not stored in the content-pipeline database:** plain passwords, provider keys, the raw model response, the full prompt, cookies or authorization headers. Private QA artifacts may retain synthetic responses/traces for diagnosis; there is no automatic purge and operator cleanup is required.
- **Retention:** analyses, messages and executions expire after `RETENTION_DAYS` (30 by default) from creation; questions do not renew it. Purge runs at startup and hourly, not instantaneously. Account deletion and independent audit purge are not implemented. Local logs depend on operator policy; Terraform proposes CloudWatch 14 days and RDS backups 7 days, without deployment. Provider copies are not deleted by our purge.
- **PII:** detected people, emails and phones become owner/incident-scoped HMAC labels with 32 hexadecimal characters. Stability requires the same key and detected text/boundaries; name variants are not resolved. There is no reversible map or original restoration. Misses and identifying context remain possible: this is pseudonymization, not universal anonymization. A paid provider route does not guarantee privacy.
- **Modes and accepted limits:** full mode protects detected names/contacts; contacts-only leaves names visible; disabled mode stores/forwards unprotected content. These are explicit operator choices shown on the page, never automatic downgrades. Partial-surname/non-idempotence remains FAIL and is accepted only for a synthetic demo; do not submit confidential real data.
- **Failures and history:** input-sanitation service failure stops new content writes and provider calls; a detection miss may still store/forward unchanged PII. Output-sanitation failure occurs after a sanitized-input model call; no raw response is persisted as a result. Migration `002_pii_policy` leaves old records intact and unmarked: protected mode blocks detail/questions/retry and hides list content.
- **Logging:** structured logs use allowed fields; API HTTP logs use server-generated UUIDs and route templates. The supplied nginx raw request logs are disabled. Existing marker tests do not certify every log level, dependency, collector or proxy.
- **Audit:** actor/action/resource/result/correlation/timestamp, without incident text. Coverage includes `analysis.create`, `question.add` and aggregate purge; retries have no separate action. This is neither universal nor immutable auditing. Reduced database-error closes may omit events; purge records its event after deletion, outside that transaction. Operator access only, without an audit-management UI or separate reader role.

Details: [data policy](docs/security/DATA_POLICY.md).

### Evaluation and reliability

Section 2.2 explanatory scope closed on 2026-10-03 (Buenos Aires). It does not require a complete evaluation system or imply that the current model passed actual-provider revalidation.

- **Measuring output quality:** `npm run qa:eval` validates/scores five synthetic cases: clear outage, insufficient input, injection, HTML and contradictory facts. It checks contracts/quotes, uncertainty and complete URLs using runtime extraction; the rubric injection check is an English-phrase heuristic, not universal semantic verification. `npm run qa:ai:live` uses a real model. Use human review of all responses against expected facts, including rejected ones, to measure usefulness/fidelity rather than equate valid JSON/quotes with correct causes. Compare false rejections, accepted attacks, latency/tokens/cost and repeated-run variation; there is no automatic dashboard for these measures.
- **Detecting regressions:** stored version/provider/model supports comparison of identical cases before/after; fix limits/deadlines and protection mode too. Changes require software checks and a comparable real sample, reviewing contracts, fidelity, confidence, latency and consumption. Defined CI runs mock evaluation, not paid requests or semantic certification. Different provider matrices are not equivalent comparisons.
- **When the AI gives a wrong answer in production:** distinguish technical failure from an incorrect answer that passed its contract. Previous tests reduce risk, current checks reject selected invalid output, and protected accepted content plus execution/audit metadata support investigation; full raw provider transcripts are not stored and failure records are not guaranteed. The proposed process uses human review, privacy-controlled diagnosis, a regression case and controlled code/configuration rollback with retesting. Feedback, semantic alerts, a dedicated switch to suspend new AI requests and automatic rollback are not implemented. Provider/model changes require restart/recreation; prompt rollback requires the corresponding code/deployment. See the [before/during/after procedure](docs/qa/AI_EVALUATION.md#3-responding-to-wrong-answers-in-production).
- **Limit:** general offline regression disables PII; mocks do not certify detector quality/resources. Detector integration and assessment reviews retain accepted historical synthetic-demo failures, including a GPT-4.1-mini injection. [Later v7/v9 samples](docs/qa/DEMO_CASES.md) completed 13 analyses on each GPT route without observed compliance with the reviewed attacks, but with a generic answer and PII false positives; Liquid had errors/rejections. This is not semantic approval, immunity or full current regression. See [historical assessment closure](docs/qa/ASSESSMENT_CLOSURE.md).

Details/evidence: [AI evaluation and reliability](docs/qa/AI_EVALUATION.md). Rubric correction reproduced before/after, 30 new cases and unit regression passed; historical provider FAIL outcomes are unchanged.

[Decisions on the three AI limitations](docs/security/AI_RISK_DECISIONS.md): injection, unsupported conclusions and partial names; route/model examples and primary-sourced local/managed alternatives. Research, not an implemented extra layer or comparative effectiveness evidence.

### Secrets, rotation and bursty usage

- **AWS versus Terraform:** AWS would host the application; Terraform describes the desired resources, connections and permissions as version-controlled infrastructure code. The proposal defines Fargate containers, private RDS PostgreSQL, HTTPS ingress and secret references. Recorded validation is not a deployment: no `plan` or `apply` ran. See the [infrastructure guide](infra/terraform/README.md).
- **Where AI keys live:** the backend reads `OPENAI_API_KEY` or `OPENROUTER_API_KEY` from its environment. A local private `.env` is Git-ignored but not encrypted by that rule. The AWS proposal defines Secrets Manager containers/references and ECS startup injection; an authorized operator would supply actual values outside Terraform. The supplied setup keeps these values out of source, images and React. Environment variables remain accessible to the process and authorized runtime/debugging access; a secret manager does not remove that boundary.
- **Rotation:** generate a replacement provider credential, update the private environment/secret version, restart Node or recreate Compose API containers (replace ECS tasks in AWS), verify a real call and revoke the old credential after checking that no instance still depends on it. Overlap depends on provider support; a suspected compromise prioritizes revocation even if availability is affected. Running containers do not reload secrets. This is a proposed manual procedure, not automatic rotation or an AWS-tested zero-downtime guarantee. No code/image rebuild is needed solely to change an environment-supplied key. Rotating the JWT secret invalidates existing sessions.
- **PII key:** `npm run pii:init-key` creates a private 48-byte binary file once at `.local/pii-hmac.key`, requesting mode 0600 and preserving existing files. Review Windows ACLs separately. Keep the key stable for retained incidents; rotation changes new labels without automatically relabeling stored content.
- **Bursty usage:** defaults allow four simultaneous model-stage gateway calls per API process and 20 analyses / 40 questions per owner per rolling hour. These are configurable, process-local counters, not a four-user or whole-HTTP-request limit; PII has a separate single request slot with bounded waiting, not a durable queue. Gateway/rate-limit rejection can return 429; retries remain bounded by the deadline. More replicas neither raise provider quota nor share these counters. Proposed scaling first measures provider, detector and database capacity, coordinates quotas/budgets across replicas and, if justified, adds a bounded queue with workers. Distributed quotas, durable jobs, polling and autoscaling are not implemented or production-load certified. See the [scaling procedure and boundaries](infra/terraform/README.md#proposed-burst-handling).

Details: [Terraform guide](infra/terraform/README.md) and [runbook](docs/operations/RUNBOOK.md).

### Configuration versus code

Provider/model, limits, deadlines, retention and service addresses come from startup
environment configuration, mapped to typed settings and validated with Joi. System
rules and prompts remain versioned in code; credentials have separate handling.
Validation checks shape/presence and some relationships, not provider access or
every cross-service combination. Parameter changes need a Node restart or Compose
container recreation; there is no hot reload. Production improvements would first
consolidate profiles/precedence and extend coherence checks, then identify approved
nonsecret profiles and consider controlled central configuration. Parameter Store
and AppConfig are alternatives, not integrations. See the [current mechanism and
proposed improvements](docs/operations/RUNBOOK.md#configuration-and-code).

### Scaling constraints of AI workloads

- **Waiting and deadlines:** synchronous requests keep an HTTP connection and request state alive while waiting; this does not mean Node uses all its CPU continuously. The model stage additionally occupies a gateway concurrency slot, not a slot covering all earlier PII work or all logged-in users. Align nginx, ALB and application deadlines for the chosen profile (base defaults: 30 s proxy, 20 s overall API deadline, including protection overhead).
- **Provider quota:** adding API replicas does not increase the provider's quota. Current counters are per process; shared quota/budget admission would be needed to enforce aggregate limits across replicas.
- **Local protection capacity:** PII has a single shared request slot and uses CPU/memory. It can saturate before model invocation; its bounded waiting is not a durable queue. Preliminary timings do not certify production load or every input size. Raising limits requires measurements, not automatic protection bypass.
- **Consumption:** source/context size, output and retries affect token use, waiting and spend. Execution token metadata supports diagnosis/reporting, not an implemented monetary budget. A timeout does not prove that the provider made no charge.
- **Database capacity:** replicas also share finite PostgreSQL connection capacity. The application reserves processing state and commits completion in short repository transactions; the provider call runs between them, not inside an open database transaction. This avoids holding transaction locks throughout that wait, without making the database and provider one atomic operation.
- If measured volume justified it, I would propose durable queued jobs with workers (202 acceptance and result polling), bounded admission, shared quotas and controlled retries. A queue delays work; it does not increase provider capacity or guarantee completion. This workflow is not implemented.

The current AWS proposal scales web/API/PII together. Neither autoscaling nor
production burst capacity is certified. See the [current boundaries and proposed
scaling procedure](infra/terraform/README.md#proposed-burst-handling).

### AI-aware user experience

- Pages: login, new analysis, history, detail with conversation.
- Loading, error and empty states on every page; the analysis shows a "processing" state while the model runs.
- The analyst can ask follow-up questions and retry a failed analysis; a retry never deletes an existing result.
- Storage/prompts retain full 32-hex `[PERSON_hex]`, `[EMAIL_ADDRESS_hex]` and `[PHONE_NUMBER_hex]` tokens. React presents colored Person/Email/Phone labels numbered by token within an analysis/history card, not recovered identities. Previews/context preserve full tokens. Detail separates Incident, Result and Questions; question supporting detail is expandable. The wait bar is indeterminate; the injection note observes patterns without blocking or judging output.
- Uncertainty is part of the output: evidence is shown as quotes, hypotheses carry a confidence level, and missing information is listed. There is no token streaming, so there are no partial results.

## Cost estimate for 1k / 10k / 100k requests

**Model and price.** `openai/gpt-4o-mini` through OpenRouter, USD 0.15 per million input tokens and USD 0.60 per million output tokens, read from the OpenRouter models API (`https://openrouter.ai/api/v1/models`) on 2026-10-01 00:29 (Buenos Aires). Prices change; check them before relying on this table. OpenRouter credit-purchase fees are not included.

**Measured samples (historical v3/v4 prompts).** Provider-reported tokens from `npm run qa:ai:suite` with `openai/gpt-4o-mini`, prompts `incident-analysis.v3` and `incident-question.v4`, five synthetic fixtures (about 200–250 characters each), three repeats per fixture, 45 calls total, 2026-10-01 (see `docs/qa/LIVE_SUITE.md` Runs). Averages below are over all 15 analyses or all 30 questions in that run, not a single incident shape:

| Call | Average (input / output tokens) | Cost per call (at prices above) |
|---|---|---|
| First analysis | 463 / 350 | ~USD 0.00028 |
| 1st follow-up question | 591 / 364 | ~USD 0.00031 |
| 2nd follow-up question | 681 / 404 | ~USD 0.00034 |

Follow-up questions resend the incident and the recent conversation, so input grows with each turn (about +90 tokens between the first and second question in this sample). The suite mixes fixture types; long incidents cost more.

These historical costs exclude local PII resources and do not measure current v7/v9 prompts or expanded label text. The assessment review recorded full-protection token usage under its v6/v7 versions, not an invoice or current prices: [historical report](docs/qa/ASSESSMENT_CLOSURE.md).

**Historical samples (superseded prompts).** Before v3/v4, three analysis calls with `incident-analysis.v2` averaged 456 / 472 input/output tokens (~USD 0.00035 per analysis); two follow-ups with `incident-question.v3` averaged 645 / 590 (~USD 0.00045). Those five calls are not comparable one-to-one with the table above.

**Worst case (estimate, not measured):** the full 12,000-character context budget (about 3,400 input tokens including the system prompt, at roughly 4 characters per token) plus the 4,096-token output cap: ~USD 0.0030 per call.

| Requests | Analyses (measured avg) | Follow-ups (measured avg) | Worst case per call (estimate) | Worst case with one billed retry (estimate) |
|---|---|---|---|---|
| 1,000 | ~USD 0.28 | ~USD 0.33 | ~USD 2.97 | ~USD 5.94 |
| 10,000 | ~USD 2.79 | ~USD 3.25 | ~USD 29.68 | ~USD 59.35 |
| 100,000 | ~USD 27.90 | ~USD 32.54 | ~USD 296.76 | ~USD 593.52 |

A typical session of one analysis and two questions is about USD 0.00093 with the v3/v4 averages above (~USD 0.93 per 1,000 sessions). The older v2/v3 five-call sample implied about USD 0.0013 per session.

**Retries and failed calls.** The gateway retries at most once, only after a timeout, 429, 5xx or network error and only when at least 3 s of the deadline remain, so one request can be billed twice. A slow answer that uses most of the 18 s attempt is not retried, because a second attempt would have no time to finish. A timeout is not free: the provider may have processed and charged the call even though the result is discarded. Output that fails validation is billed and stored as a failed execution; a user retry is a new billed call. Requests rejected before the provider is called (input validation, per-user quota, context budget, or a local TLS failure) cost nothing.

**Infrastructure is separate.** These figures cover model calls only. The AWS proposal (ALB, Fargate task, RDS, NAT gateway, Secrets Manager, CloudWatch logs) has a fixed monthly cost that is not estimated here; use the AWS Pricing Calculator for the chosen region. At these volumes the fixed infrastructure cost is likely to exceed the model cost.

## Per-user data isolation

Every analysis belongs to the analyst who created it. The owner comes from the session cookie, never from the request body: the create and question bodies accept only `sourceText` or `question` (a body with an `ownerId` is rejected with 400), and retry takes no body. Every read and write (list, detail with its messages and executions, question, retry) filters by that owner in the repository query, and an analysis owned by someone else returns 404, the same as one that does not exist, so its existence is not revealed.

`apps/api/test/integration.spec.ts` (Q04) and `apps/api/test/edge-cases.spec.ts` check this with two users against PostgreSQL: user B cannot list, read, question or retry user A's analyses even with their ids, and A's analyses are unchanged afterwards.

Scope: this is isolation between individual users. There are no organizations, tenants, roles or shared workspaces.

## Scope and time

The assessment suggests 6–10 hours. This project took longer because I added failure recovery, concurrency controls, tests with PostgreSQL and several review passes. Deliberately out of scope: document upload, RAG, streaming, tool calling and background workers. Text input is allowed by the assessment and keeps the focus on the AI boundary, data handling and reliability. The commands under [Verification](#verification) reproduce the checks.

### Bonus sections not chosen

The assessment asks to pick any bonus. I chose the cost estimate and per-user isolation, plus containerization (section 3.2), because they reinforce the design. The others would work against it at this size:

| Bonus | Why not here | When it would make sense |
|---|---|---|
| Streaming (token by token) | Every answer is validated before it is shown (strict schema, quotes that must appear verbatim, no new URLs). Streaming would show text that may still be rejected. The wait is covered by an explicit loading state. | Long free-text answers where latency matters more; stream only the `answer` field and validate at the end. |
| Tool / function calling | The model has no tools, which is part of the prompt-injection defense: an injected instruction has nothing to trigger. The product assists an analyst and does not run remediation. | A read-only lookup (for example runbooks or recent deploys) with allowlisted, side-effect-free tools. |
| Queues and workers | The current bounded synchronous workflow keeps one request and explicit loading/error states. Local detector and output-batch performance must still be verified within its deadline. | Higher volume or bursts: the API returns 202, a worker processes, the client polls. PostgreSQL can be the queue, so no new infrastructure. |
| Vector store / RAG (section 2.1) | The user pastes one incident within the configured source/context limits (1,000 source characters by default). There is no corpus to search. | Searching runbooks or past incidents. |
| Multi-tenant isolation | Implemented as per-user isolation. Organizations and roles are not part of the product, so adding them would only serve the bonus. | Teams that share incidents under an organization with roles. |

### Delivery summary and evidence

The delivered workflow is authenticated text submission, structured analysis,
follow-up questions and persistent owner-scoped history. The modular backend
separates prompts, provider calls and validation; bounded inputs, quotas and local
PII protection support that workflow without external remediation tools.

[Recorded software/browser checks](docs/qa/DELIVERY_VERIFICATION.md) and
[real-provider samples](docs/qa/DEMO_CASES.md) have distinct dated scopes. They do
not guarantee semantic accuracy, complete PII detection or production capacity;
the accepted injection, unsupported-conclusion and partial-name limits remain
restricted to a synthetic, human-reviewed demonstration. Docker images and an
undeployed Terraform proposal are included; AWS plan/apply was not performed.

The [2026-10-05 handoff recheck](docs/qa/HANDOFF_RECHECK_2026-10-05.md) records
repeated software checks, a rebuilt full-protection stack and two OpenAI browser
analyses plus one question. Workflow success and retained over-inference
observations are reported separately, without semantic approval.

For review, select an explicit [startup/provider profile](#real-provider-demo-powershell).
Personal manual acceptance was reported complete; verify the submitted revision,
record its CI outcome separately and provide reviewer access using
the [delivery checklist](docs/operations/DELIVERY_CHECKLIST.md#status-and-remaining-submission-gates).
These procedures are not newly executed acceptance results.

## Local setup

Use Node.js 22 and Docker for PostgreSQL and the local PII service. Copy the example only for a new local configuration; preserve an existing `.env`. Configure a strong `JWT_SECRET` before startup. Use synthetic incidents only: local PII is accepted with limitations for a demo, not certified for confidential data.

The pinned PII CPU dependencies target Linux x86_64. Compose explicitly builds/runs
that service as `linux/amd64`; ARM hosts need Docker's amd64 emulation enabled.
Native ARM inference and emulated latency are not certified. The model container
needs 4 GiB of memory plus capacity for PostgreSQL/API/web; allow time and network
access for the first dependency/model download. Subsequent inference is offline.

### Prepare private local configuration

From the cloned repository root, with Node.js 22 and Docker Desktop's Linux engine
running, prepare a new configuration without replacing an existing one:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
npm ci
```

Before startup, replace the example `JWT_SECRET` with a strong private random
value of at least 32 characters; the example file includes a generation command.
For a real provider, populate the corresponding private key:

| Route | Private variable | Explicit model example |
|---|---|---|
| OpenAI direct | `OPENAI_API_KEY` | `gpt-4o-mini` |
| OpenRouter | `OPENROUTER_API_KEY` | `openai/gpt-4o-mini` |

Both keys may coexist; only the selected route is used. Model examples match
the recorded setup, not a guarantee of current availability, account access,
pricing or compatibility of arbitrary models. Real submissions may be charged.
Never commit or share `.env`, keys or resolved configuration dumps.

For a new installation, keep `PII_HMAC_KEY_PATH=./.local/pii-hmac.key` from the
example. The demo launcher initializes that file once without replacing it.
If preserving an existing custom path, make the same path available through
the process environment before initialization: the key helper itself does not
load `.env`. Do not replace a retained installation's key to simplify startup.

### Real-provider demo (PowerShell)

Choose exactly one command. Both use the existing launcher and explicit provider
and model, so the selection does not depend on different default models.
The complete stack publishes host ports 8080, 3001 and 5432; resolve conflicts
with existing services deliberately, without deleting their databases or volumes.

OpenAI direct:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-real-demo.ps1 -Provider openai -Model "gpt-4o-mini"
```

OpenRouter:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-real-demo.ps1 -Provider openrouter -Model "openai/gpt-4o-mini"
```

Use the PowerShell invocation only where permitted by your execution policy.
The launcher builds/starts the complete stack and waits up to 180 seconds for
services to become running/healthy after the build. Startup may take minutes;
this wait is not the per-request protection or model deadline. If readiness fails,
inspect service state/resources using the [runbook](docs/operations/RUNBOOK.md#start-locally)
and rerun the same selected command after resolving it; do not disable protection.

The launcher selects this profile, not just the provider:

| Setting | Selected demo value |
|---|---|
| Content protection / names | Enabled / enabled |
| Source / question | 4,000 / 500 characters |
| Detector CPU threads / CPU quota | 4 / 4 |
| Internal protection timeout | 9,500 ms |
| Overall API / model attempt / proxy | 45 s / 20 s / 60 s |

These are limits/budgets, not guaranteed response times. `-PiiThreads 1` or `2`
reduces the allocation; input overrides use `-SourceTextMax` / `-QuestionMax`.
They require their own latency review. The script restores its process overrides
after startup and does not rewrite `.env`; containers keep the selected settings.

To change provider, model or launcher parameters, rerun the corresponding explicit
command. Compose recreates services when their configuration/image changes and
preserves mounted volumes; this is not an automatic database reset. See
[Compose up behavior](https://docs.docker.com/reference/cli/docker/compose/up/).
Existing analyses keep their recorded provider/model and are not reanalyzed.
Editing `.env` or using `docker compose restart` alone does not update an existing
container's injected environment.

The script's `-Model` sets the selected model variable before Compose starts and
overrides its `.env` counterpart for that invocation. Other shell variables can
also override `.env` interpolation; review the intended environment without
printing credentials. See [Docker interpolation precedence](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
Without parameters, the launcher chooses OpenAI / `gpt-4o-mini`; OpenRouter without
`-Model` chooses `openai/gpt-4.1-mini`, unlike the direct overlay's
`openai/gpt-4o-mini` fallback. The commands above deliberately avoid this ambiguity.

After successful startup:

```powershell
docker compose ps
```

Open [the application](http://localhost:8080), sign in with a local demo account,
check the displayed coverage/input limit, then create a new synthetic analysis,
ask a follow-up and revisit history. Use the second account to check owner isolation.
Service health does not make a paid model call or certify its output; inspect
evidence, hypotheses and uncertainty yourself. See [manual acceptance](docs/qa/MANUAL_ACCEPTANCE.md).

For HTTPS-inspection certificate failures, follow the
[CA procedure](docs/operations/RUNBOOK.md#tls-problems-on-windows) first. The launcher
automatically includes the extra-CA overlay when `qa/local/docker-extra-ca.pem`
exists. Do not disable TLS verification. These are instructions, not a new
installation, provider-call or personal-acceptance result.

### Local accounts and persisted data

Local demo users are `demo1@demo.com` and `demo2@demo.com`, password `Demo1234$`.
These are synthetic local credentials; production demo seeding is disabled.
A new installation with `SEED_DEMO=true` creates both accounts with empty history.
Login suggests `demo1@demo.com`. Restarting does not duplicate accounts or overwrite
passwords; the seed only adds missing accounts. Existing history remains subject
to retention. Deleting previous data requires an explicit decision, never normal
startup. Compose uses `$$` to preserve the literal `$` in the demo password;
the Node/`.env` password is `Demo1234$`.

### Host Node development

This alternative uses the configuration prepared above, host API/Vite and
containerized PostgreSQL/PII, not the launcher's 4,000/500 demo profile:

```powershell
npm run pii:init-key
docker compose -f docker-compose.yml -f docker-compose.pii-dev.yml up --build -d postgres pii
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal:

```powershell
npm run dev:web
```

The example uses API port 3001 and frontend http://127.0.0.1:5173. OpenAPI is at http://127.0.0.1:3001/api/docs, with JSON at `/api/docs-json`.

For host Node, set `PII_ENABLED=true`, `PII_SERVICE_URL=http://127.0.0.1:18080`, `PII_TIMEOUT_MS=10000`, `SOURCE_TEXT_MAX=1000` and `QUESTION_MAX=500` as in the example. The optional overlay publishes PII on loopback only. The first image build downloads pinned model assets; inference loads them offline. See the [runbook](docs/operations/RUNBOOK.md) for readiness and failures.

Change `SOURCE_TEXT_MAX` and/or `QUESTION_MAX` in the API environment, restart/recreate the API and reload the page; no frontend build is needed. Existing `.env` or startup overrides may differ from defaults. The historical 2026-10-03 expanded demo used 8,000/1,000; the script and 2026-10-05 handoff use 4,000/500, while base API/Compose defaults remain 1,000/500. These profiles do not promise CPU latency for every input. See [configuration profiles](docs/operations/RUNBOOK.md#configuration-profiles).

For a real host-Node model, set `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY`,
or `LLM_PROVIDER=openai` with `OPENAI_API_KEY`, and choose `OPENROUTER_MODEL` or
`OPENAI_MODEL`. Restart the API after changing startup values. This is the Node
loader path, not the container launcher; base Compose still fixes its API provider
to `mock`. Never commit `.env` or keys.

### All-container mock and direct overlays

For the complete local stack (PostgreSQL, PII, API and React served by nginx), with configured `.env`, generated `JWT_SECRET` and the initialized HMAC file:

```powershell
npm run pii:init-key
docker compose up --build
```

This base Compose profile uses `mock`, even if `.env` says `LLM_PROVIDER=openai`
or `openrouter`. It makes no paid model call and does not certify model quality.
Do not use the bare command to restart a real-provider demo while expecting to
keep that provider: choose its launcher command or the intended overlay explicitly.

On Windows, if dependency/model downloads or provider HTTPS fail with a certificate error, export your HTTPS inspection root and use the optional overlay (see [runbook](docs/operations/RUNBOOK.md#tls-problems-on-windows)): `npm run docker:export-ca`, then `docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml up --build` (API/web/PII build secret plus a read-only API runtime trust mount).

Compose requires `JWT_SECRET`; no secret is written in the Compose file or baked
into an image. The API applies migrations and creates missing synthetic demo
accounts at startup. Data lives in `pgdata` and survives `docker compose down`
(not `down -v`). Direct real-provider operation uses the base file plus
`docker-compose.openai.yml` or `docker-compose.openrouter.yml`; provider key/model
and timeouts come from those overlays and interpolated values. For the selected
demo profile, use the [explicit launcher instructions](#real-provider-demo-powershell)
instead. Browser checks against this stack: `npm run qa:e2e:compose`.

The web image serves React at http://localhost:8080 and proxies `/api/` to the API. It renders its nginx template using `API_UPSTREAM`, defaulting to `api:3000` in Compose, and `API_PROXY_READ_TIMEOUT`, defaulting to `30s`. The OpenRouter overlay defaults to a 45 s API deadline only when `LLM_DEADLINE_MS` is unset; an explicit `.env` value wins. The copied example sets 20 s, so set `LLM_DEADLINE_MS=45000` to select the 45 s profile. Attempts are 20 s and the proxy defaults to 60 s. The real-demo script explicitly selects 45 s. Keep the proxy above the effective API deadline, then recreate the affected containers. Rebuild the image after template changes. React uses system fonts and makes no external font request under the supplied CSP.

Compose keeps PII on an internal network at `http://pii:8000`, with a secret mount, read-only root, dropped capabilities and provisional 4 GiB / 1 CPU. Model/key readiness precedes API startup. The controller's overall deadline includes protection overhead; 10 s is the default internal request timeout (configurable up to 60 s), not an extra guaranteed allowance.

The real-demo script selects 4,000/500 characters, four CPU threads/four CPU quota,
a 9.5 s protection timeout,
a 45 s overall API deadline and a 60 s proxy read timeout. Override input limits
with `-SourceTextMax 5000 -QuestionMax 500`; larger inputs are not latency-certified.
It preserves private `.env` settings and restores its process environment after
startup. The conservative base API/Compose defaults remain 1,000/500 and 10 s.
Before CPU tuning, one synthetic 4,000-character local protection request took 19.2 s;
earlier attempts timed out. This is not a p95 or an end-to-end model benchmark.
Protection never falls back to raw text or contacts-only mode on timeout.
Use `-PiiThreads 1` or `-PiiThreads 2` for a smaller resource allocation. The
unchanged FP32 detector produced identical protected text/spans in 67 sampled cases
at 1/2/4 threads; aggregate times were 119.1/72.6/45.5 s on a variable-load host.
Known detection limits remain; the larger CPU allocation is not a new privacy
guarantee. See the [service runtime notes](services/pii/README.md).
The protection target is under 10 seconds per internal request, not total analysis
time. CPU saturation can still cause rejection: the 9.5 s adapter deadline fails
closed with `PII_UNAVAILABLE`, never an incomplete successful result. The worker
may continue finishing its in-flight task and retaining its single slot after
the client times out. The next request waits up to `PII_SLOT_WAIT_SECONDS`
(20 s by default) for that slot and then runs; it does not start a second
inference. No universal latency guarantee or new detector approval.

For diagnosis, request logs record total HTTP `latencyMs` and a `correlationId`;
execution rows record gateway `latencyMs` (provider attempts and retry waits).
These are different measurements. Per-stage protection/validation/database timings
are not currently instrumented. `INVALID_OUTPUT` now exposes only a fixed safe
validation reason, not the provider's raw response. Older failed rows keep their
generic message; their specific original rejection reason cannot be recovered.

## Verification

[Local verification, 2026-10-04](docs/qa/DELIVERY_VERIFICATION.md): software gates
passed on the same source tree now recorded as `d2129a4`, with the corrections
included in this delivery, using an isolated checkout and database. This is not
remote CI or new real-model quality approval.
Jest and general/limits browser regression use an explicit synthetic 8,000/1,000
profile with PII disabled; protected Compose checks retain base 1,000/500 limits.

| Command | Purpose |
|---|---|
| `npm run lint` | API and frontend lint |
| `npm run typecheck` | API and frontend type checks |
| `npm run build` | Compile API and build React |
| `npm run test:coverage` | Unit and PostgreSQL integration tests |
| `npm run test:web` | React/Vitest checks (mocked HTTP) |
| `npm run qa:eval` | Deterministic mock evaluation fixtures |
| `npm run qa:e2e` | Browser workflows using the configured test environment |
| `npm run qa:e2e:compose` | Browser checks against `docker compose` nginx on :8080 |
| `npm run qa:docker:timeouts` | Isolated current nginx image with slow synthetic upstream responses; build the web image first, no paid model calls |
| `npm run qa:demo` | Browser demonstration with video artifacts |
| `npm run qa:ai:live` | OpenAI sample using a local key |
| `npm run qa:ai:live-openrouter` | OpenRouter sample using a local key |
| `npm run qa:e2e:flows` / `qa:e2e:flows:limits` | Browser cases from [UI flows](docs/qa/UI_FLOWS.md) (mock provider) |
| `npm run qa:ai:suite` | [Live quality suite](docs/qa/LIVE_SUITE.md): all fixtures, analysis plus two follow-ups, against a paid model (manual, ~USD 0.005 per run) |
| `npm run check:web-docs` | Verify internal documents are absent from the React build |
| `scripts\qa-local-pii.bat` / `npm run qa:pii` | Full synthetic battery: real local detector, three modes, outage and browser/regression evidence; mock downstream provider |

Integration tests require an isolated PostgreSQL database with `test` in its name; they truncate data and test migration rollback. CI runs lint, typecheck (including frontend test files), API tests with coverage, frontend tests, the mock evaluation, the build and `terraform validate` on every push.

The commands above are verification procedures, not additional executed results. General regression's explicit PII bypass does not certify protected operation. Real detector quality, integration, resource measurements and colored-label evidence are in the [local PII report](docs/qa/LOCAL_PII_INTEGRATION.md). Real LLM failures are separately recorded in [assessment closure](docs/qa/ASSESSMENT_CLOSURE.md).

## Infrastructure proposal

The [Terraform guide](infra/terraform/README.md) describes an HTTPS ALB, a Fargate task with web/API/PII, private RDS, secrets and logs. It proposes 4 GiB / 1 vCPU total, a 3,072 MiB PII sidecar, `pii_container_image` and a dedicated HMAC secret; `desired_count = 0` remains. Local `fmt` and `validate` passed with Terraform 1.9.8 on 2026-10-02 using cached providers, without a new `init`; the 2026-10-05 handoff repeated offline Linux validation. AWS runtime and model resource sizing remain unverified. No `plan`, `apply` or cloud deployment has been performed.

## Deliberate limits

- Text input only; no document extraction, RAG, voice or tools with external effects.
- Session JWT in an HttpOnly cookie, with a CSRF cookie/header for mutations. Data access is scoped to its owner.
- Rate and concurrency limits are process-local; horizontal scaling requires shared quotas.
- Default retention is 30 days with periodic purge. Expiry is not instantaneous physical deletion; provider retention is separate.
- Recovery of interrupted runs is eventual after the database becomes available. A minimal failure closure may omit audit or message details if their full transaction failed.
- Mocks do not certify real-model accuracy, latency, spend or provider privacy.
- Local PII is accepted only for a scoped synthetic demo, with possible misses and identifying context; legacy data is retained, and explicit disabled mode provides no content protection.
