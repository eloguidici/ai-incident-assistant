# AI Incident Assistant

An authenticated analyst submits incident text, receives a structured analysis, asks follow-up questions and returns to saved results. The output distinguishes evidence, hypotheses and missing information. The application does not execute remediation in external systems.

[Documentation index](docs/README.md) links the supporting decisions and business rules.

## Architecture and AI design

NestJS/TypeScript modular monolith, React frontend and PostgreSQL/TypeORM persistence. Read handlers (list/detail) are separate from commands (create/retry/question), without event sourcing or separate read/write databases. Repository operations own transactional state changes.

The model path is: use case -> versioned prompt -> provider -> output validation -> persistence. No database transaction is held during the model call. A deterministic mock, OpenAI and OpenRouter implement the same provider contract. SDK retries are disabled; the application controls bounded retries and deadlines.

Quotes must occur in the submitted text, and the structured schema requires explicit uncertainty. These checks help review; they do not establish the truth of every model claim. See [design](docs/architecture/DESIGN.md), [business rules](docs/business/PRODUCT.md) and [data policy](docs/security/DATA_POLICY.md).

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

For a real model, set `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY`, or `LLM_PROVIDER=openai` with `OPENAI_API_KEY`. Optional model overrides are `OPENROUTER_MODEL` and `OPENAI_MODEL`. Never commit `.env` or keys. On Windows, see the [runbook](docs/operations/RUNBOOK.md) and existing live-provider reports for TLS troubleshooting; do not disable certificate verification.

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
| `npm run qa:eval` | Deterministic mock evaluation fixtures |
| `npm run qa:e2e` | Browser workflows using the configured test environment |
| `npm run qa:demo` | Browser demonstration with video artifacts |
| `npm run qa:ai:live` | OpenAI sample using a local key |
| `npm run qa:ai:live-openrouter` | OpenRouter sample using a local key |
| `npm run check:web-docs` | Verify internal documents are absent from the React build |

Integration tests require an isolated PostgreSQL database with `test` in its name; they truncate data and test migration rollback. Browser tests currently use installed Chrome. Keep screenshots, videos and traces free of credentials and sensitive text.

Results are revision-specific. See [CURRENT_STATUS](CURRENT_STATUS.md) and [the verification task](tasks/T11-LOCAL-VERIFICATION.md); a prior passing run does not certify later changes.

## Infrastructure proposal

[Terraform guide](infra/terraform/README.md) describes HTTPS ALB, a Fargate task with web/API containers, private RDS, secrets and logs. The definition supports OpenAI or OpenRouter, requires actual application image references and defaults to zero ECS tasks pending preparation of secrets and deployment prerequisites.

Section 3.1 of the assessment permits AWS or a simulated proposal. The repository provides an infrastructure definition; no AWS deployment is claimed. `fmt`, `init -backend=false` and `validate` are the validation-only path. No plan/apply has been performed in the correction pass. Validation results and environment limitations are recorded in the QA report.

## Deliberate limits

- Text input only; no document extraction, RAG, voice or tools with external effects.
- Session JWT in an HttpOnly cookie, with a CSRF cookie/header for mutations. Data access is scoped to its owner.
- Default source text limit: 8,000 characters; question limit: 1,000. Default LLM deadline: 20 seconds, with at most one application retry.
- Timeouts do not prove a provider did not charge for the request.
- Rate/concurrency limits are process-local; horizontal scaling requires coordinated quotas.
- Default local retention is 30 days, with periodic purge. Expiry is not a guarantee of instantaneous physical deletion; provider retention is separate.
- Recovery is eventual after the database becomes available. Minimal failure closure may omit audit/message details if their full transaction failed.
- Mocks do not certify real-model accuracy, latency, spend or provider privacy. Full-stack and live-provider evidence must be reported separately.
