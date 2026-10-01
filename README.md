# AI Incident Assistant


An authenticated analyst submits incident text, receives a structured analysis, asks follow-up questions and returns to saved results. The output separates evidence (exact quotes from the text), hypotheses and missing information. The application does not execute remediation in external systems.

## Assessment coverage

| Assessment section | Where it is answered |
|---|---|
| 1.1 Problem statement | This README; [product scope](docs/business/PRODUCT.md) |
| 1.2 Backend (AI-first) | [Architecture and AI design](#architecture-and-ai-design); [prompt injection](#prompt-injection-and-unsafe-input); [costs and rate limits](#costs-and-rate-limits-in-production) |
| 1.3 Frontend (AI-aware UX) | [AI-aware user experience](#ai-aware-user-experience) |
| 2.1 Data flow and storage | [Data, retention, PII, logging and audit](#data-retention-pii-logging-and-audit); [data policy](docs/security/DATA_POLICY.md) |
| 2.2 AI evaluation and reliability | [Evaluation and reliability](#evaluation-and-reliability) |
| 3.1 Cloud and runtime | [Secrets, rotation and bursty usage](#secrets-rotation-and-bursty-usage); [Terraform guide](infra/terraform/README.md) |
| 3.2 Containerization | [Scaling constraints of AI workloads](#scaling-constraints-of-ai-workloads); `infra/docker/` |
| Bonus | [Cost estimate for 1k / 10k / 100k requests](#cost-estimate-for-1k--10k--100k-requests); per-user data isolation |

## Architecture and AI design

NestJS/TypeScript modular monolith, React frontend and PostgreSQL with TypeORM repositories. Read handlers (list, detail) are separate from commands (create, retry, question) through CommandBus/QueryBus, without event sourcing or separate databases. Repository operations own transactional state changes.

The model path has one responsibility per step:

1. **Prompt construction** (`apps/api/src/ai/prompt.ts`): versioned prompts `incident-analysis.v1` and `incident-question.v2`.
2. **Model invocation** (`apps/api/src/ai/gateway.ts` and the providers): a deterministic mock, OpenAI and OpenRouter implement the same `LlmProvider` contract, selected with `LLM_PROVIDER`. SDK retries are disabled; the gateway owns deadlines and at most one retry.
3. **Response post-processing** (`apps/api/src/ai/validate.ts`): Zod schema validation, quote grounding and URL checks before anything is stored as a result.

The prompt version, provider, model, attempts, latency and token counts are stored with every execution. No database transaction is held open during the model call.

More detail: [architecture rationale](docs/architecture/RATIONALE.md), [design](docs/architecture/DESIGN.md), [API contracts](docs/features/MVP.md) and [decision records](docs/decisions/).

## Assessment answers

### Prompt injection and unsafe input

- **Data is never mixed with instructions.** Incident, conversation and question are sent inside data blocks whose markers carry a random id generated per request. The system message names that id and tells the model that any other marker is data. Pasting `INCIDENT>>>` into the text cannot close the block early, because the attacker does not know the id (`apps/api/test/prompt-injection.spec.ts`).
- **The model has no tools.** There is no function calling and the application never executes actions based on model output, so an injected instruction has nothing to trigger.
- **Output is validated, not trusted.** A strict schema rejects unexpected fields. Every quote must appear verbatim in the incident, and a URL is accepted only if it already appears in the text. Output that fails is stored as a failed execution, never shown as a result.
- **Input is bounded.** Incident text 1–8,000 characters, question 1–1,000, request body 32 KB, and a context budget of 12,000 characters checked before the model is called.
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
| Deadline per request / retries | 20 s / at most 1 retry, only for timeout, 429, 5xx or network |

Token usage is recorded per execution, which is the basis for cost reporting. For production I would add: a shared quota store (Redis or PostgreSQL) so limits hold across replicas; a monthly budget per user or tenant with an alert and a hard stop; provider spend alerts; and a cheaper default model with an explicit, logged upgrade path. A timeout does not prove the provider did not charge for the request.

### Data, retention, PII, logging and audit

- **Stored:** user email and password hash; incident text, validated result, questions and answers; execution metadata (prompt version, model, attempts, latency, tokens); audit events (who, what, which resource, result, correlation id).
- **Not stored:** plain passwords, provider keys, the raw model response, the full prompt, cookies or authorization headers.
- **Retention:** analyses and everything attached to them expire after `RETENTION_DAYS` (30 by default); a purge runs at startup and every hour. The provider's own retention is outside this application's control.
- **PII:** incident text may contain personal data pasted by the user. It is kept until expiry and sent to the provider in real mode. There is no automatic PII detector; the demo uses synthetic data only.
- **Logging:** logs accept only an allowlist of fields (status, latency, error code, ids, model, prompt version). An integration test sends a marker in the incident text and checks it never reaches the logs.
- **Audit:** audit events answer who did what and with which result; they never contain the incident text.

Details: [data policy](docs/security/DATA_POLICY.md).

### Evaluation and reliability

- **Measuring output quality:** `npm run qa:eval` scores five fixtures (clear outage, insufficient text, injection attempt, HTML, contradictory report) against a rubric: non-empty summary, quotes present in the source, no invented URLs, uncertainty when evidence is missing, no claimed actions after an injection attempt. `npm run qa:ai:live` runs the same rubric against a real model.
- **Detecting regressions:** every execution stores the prompt version and model, so results can be compared per version. A prompt or model change should pass the mock rubric in CI and a live sample before release; the live pass rate and schema-failure rate are the signals to compare.
- **When the AI gives a wrong answer in production:** the answer shows its quotes and uncertainty so the analyst can check it against the text; invalid output is rejected and can be retried; the prompt version identifies which executions are affected, and a prompt or model can be rolled back by configuration. A feedback button and a curated set of real failure cases would be the next step; they are not implemented.
- **Limit:** mock results do not certify a real model's accuracy, latency or cost.

### Secrets, rotation and bursty usage

- **Where AI keys live:** locally in `.env` (git-ignored). On AWS, in Secrets Manager, injected into the ECS task at start. They are never in the image, the frontend bundle, Terraform variables or logs.
- **Rotation:** create a new secret version, then replace the ECS tasks so they read it. Running containers do not reload secrets. Rotating the JWT secret invalidates existing sessions.
- **Bursty usage:** the concurrency cap and per-user limits shed load early with 429 responses; the gateway honours the provider's `Retry-After` within the deadline and never retries indefinitely. More ECS tasks do not raise the provider quota, so bursts beyond it need a queue (see below).

Details: [Terraform guide](infra/terraform/README.md) and [runbook](docs/operations/RUNBOOK.md).

### Scaling constraints of AI workloads

- Requests are long (seconds, not milliseconds), so each one holds a connection and a concurrency slot; nginx, ALB and application timeouts must be aligned (30 s proxy, 20 s model deadline).
- The real bottleneck is the provider's quota and tokens per minute, not CPU. Adding replicas multiplies per-process limits, which is why quotas must be shared before scaling out.
- PostgreSQL connections limit the number of replicas.
- For higher volume I would move model calls to a queue with workers (the API returns 202 and the client polls), which smooths bursts and makes retries and cost control central.

### AI-aware user experience

- Pages: login, new analysis, history, detail with conversation.
- Loading, error and empty states on every page; the analysis shows a "processing" state while the model runs.
- The analyst can ask follow-up questions and retry a failed analysis; a retry never deletes an existing result.
- Uncertainty is part of the output: evidence is shown as quotes, hypotheses carry a confidence level, and missing information is listed. There is no token streaming, so there are no partial results.

## Cost estimate for 1k / 10k / 100k requests

Assumptions: `gpt-4o-mini` at the list price of USD 0.15 per million input tokens and USD 0.60 per million output tokens (check [current pricing](https://openai.com/api/pricing/) before relying on it). The typical case uses a measured live analysis (278 input and 285 output tokens). The worst case uses the full context budget (about 3,300 input tokens) and the 4,096-token output cap.

| Requests | Typical (~USD 0.0002 each) | Worst case (~USD 0.003 each) |
|---|---|---|
| 1,000 | ~USD 0.21 | ~USD 2.95 |
| 10,000 | ~USD 2.13 | ~USD 29.50 |
| 100,000 | ~USD 21.30 | ~USD 295 |

Follow-up questions resend the incident and recent conversation, so they cost more than a first analysis. At these volumes the fixed AWS cost (load balancer, NAT gateway, RDS) is larger than the model cost.

## Scope and time

The assessment suggests 6–10 hours. This project took longer because I added failure recovery, concurrency controls, tests with PostgreSQL and several review passes. Deliberately out of scope: document upload, RAG, streaming, tool calling and background workers. Text input is allowed by the assessment and keeps the focus on the AI boundary, data handling and reliability. The commands under [Verification](#verification) reproduce the checks.

## Local setup

Use Node.js 22 and Docker for PostgreSQL. Copy the example configuration and use only synthetic incident data for the demo.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm ci
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal:

```powershell
npm run dev:web
```

The example uses API port 3001 and frontend http://127.0.0.1:5173. OpenAPI is at http://127.0.0.1:3001/api/docs, with JSON at `/api/docs-json`.

Local demo users are `analyst.a@example.test` and `analyst.b@example.test`, password `local-demo-password`. These are synthetic local credentials; production demo seeding is disabled.

For a real model, set `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY`, or `LLM_PROVIDER=openai` with `OPENAI_API_KEY`. Optional model overrides are `OPENROUTER_MODEL` and `OPENAI_MODEL`. Never commit `.env` or keys. On Windows, see the [runbook](docs/operations/RUNBOOK.md) for TLS troubleshooting; do not disable certificate verification.

For the complete local stack:

```powershell
docker compose up --build
```

The web image serves React at http://localhost:8080 and proxies `/api/` to the API. It renders its nginx template using `API_UPSTREAM`, defaulting to `api:3000` in Compose. Rebuild the image after configuration changes.

## Verification

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
| `npm run qa:demo` | Browser demonstration with video artifacts |
| `npm run qa:ai:live` | OpenAI sample using a local key |
| `npm run qa:ai:live-openrouter` | OpenRouter sample using a local key |
| `npm run check:web-docs` | Verify internal documents are absent from the React build |

Integration tests require an isolated PostgreSQL database with `test` in its name; they truncate data and test migration rollback. CI runs lint, typecheck, tests with coverage, the mock evaluation, the build and `terraform validate` on every push.

## Infrastructure proposal

The [Terraform guide](infra/terraform/README.md) describes an HTTPS ALB, a Fargate task with web and API containers, private RDS, secrets and logs. It supports OpenAI or OpenRouter, requires real image references and defaults to zero ECS tasks until secrets and deployment prerequisites are prepared. No AWS deployment is claimed; `fmt`, `init -backend=false` and `validate` are the validation path.

## Deliberate limits

- Text input only; no document extraction, RAG, voice or tools with external effects.
- Session JWT in an HttpOnly cookie, with a CSRF cookie/header for mutations. Data access is scoped to its owner.
- Rate and concurrency limits are process-local; horizontal scaling requires shared quotas.
- Default retention is 30 days with periodic purge. Expiry is not instantaneous physical deletion; provider retention is separate.
- Recovery of interrupted runs is eventual after the database becomes available. A minimal failure closure may omit audit or message details if their full transaction failed.
- Mocks do not certify real-model accuracy, latency, spend or provider privacy.
