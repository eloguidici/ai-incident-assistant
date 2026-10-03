# Design


Status: implemented. Stack in [ADR-001](../decisions/ADR-001-stack.md). Persistence, session and model in [ADR-006](../decisions/ADR-006-typeorm-repository.md), [ADR-003](../decisions/ADR-003-session.md) and [ADR-004](../decisions/ADR-004-model.md). The AWS shape is in [ADR-005](../decisions/ADR-005-aws.md) and has not been applied.

## Logical structure

Modular monolith with Auth, Analyses (including the conversation), persistence and Config/Observability support. AI and PII dependencies are composed in AnalysesModule, not a separate AiModule. NestJS/TypeScript backend, React frontend and durable PostgreSQL, with Docker for local work. The bounded local Python detector is a technical dependency, not an agent or a second LLM.

Lightweight CQRS: CreateAnalysis, RetryAnalysis and AddQuestion are commands; ListAnalyses and GetAnalysis are queries. Same database; no event sourcing or distributed infrastructure.

## AI responsibilities

Use case -> local source/question protection before content writes -> short PostgreSQL reservation -> observation-only signals + versioned prompt builder -> `LlmProvider` -> output validation -> narrative protection and revalidation -> persistence and result. The [native observer](../security/PROMPT_INJECTION.md) does not block or invoke another model; PII protection is separate and replaces detected entities with HMAC labels. [Implementation and limitations](../qa/LOCAL_PII_INTEGRATION.md).

The provider contract receives the messages, the model and an abort signal; the gateway adds the deadline, the output token cap (`LLM_MAX_OUTPUT_TOKENS`) and the retry policy. The response carries the raw text and token counts when available. The real and mock adapters are selected by configuration; there is no silent fallback to simulated data. Gateway: at most two attempts, the provider's `Retry-After` with jitter, and client cancellation aborts both the attempt and the wait.

## API

Routes under `/api`: `POST /auth/login`; authenticated `GET /analyses/limits` (limits and PII coverage); `GET /analyses` (paginated); `POST /analyses`; `GET /analyses/:id`; `POST /analyses/:id/messages`; `POST /analyses/:id/retry`. Full contracts in OpenAPI and [MVP](../features/MVP.md).

Consistent errors for validation, authentication, ownership, rate limits and provider failures; stack traces are never exposed.

## Data

PostgreSQL with explicit SQL migrations and constraints; persistent Docker volume and healthcheck. User, Analysis, Message and AI execution with versions, status and timestamps. `owner_id` is indexed and applied to every query. No database transaction is held during the model call.

Statuses: `processing`, `completed`, `failed`. Interrupted runs are recovered by a periodic sweep. Retries have explicit duplicate and cost rules (see [ADR-004](../decisions/ADR-004-model.md)).

## Security and operation

JWT in an HttpOnly cookie with CSRF protection and a CORS allowlist. Real cancellation propagation, limited concurrency, quotas, bounded input, and redacted logs and errors. Nest services use the injectable `AppLogger` (same allowlist as `logSafe`); HTTP middleware uses the static `logSafe`.

Infrastructure as code is required; Docker is provided. No secrets in the image, frontend, user data or Terraform state.

Normal Compose keeps PII on an internal network without a public port. The host profile publishes loopback and allows egress: isolation differs. Proposed ECS Fargate contains web/nginx, API and PII in one 4 GiB/1 vCPU task; PII receives 3,072 MiB and awsvpc does not isolate egress per container. They scale together; shared quotas, queues and autoscaling are future work. AWS resources have not been measured or deployed. Local `.env` is ignored, not encrypted: review permissions; demo credentials are synthetic only.

## Cost of patterns

Handlers separate use cases and tests; no empty layers or generic abstractions for every class. No full framework is imported for a single model call.
