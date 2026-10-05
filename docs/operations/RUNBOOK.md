# Runbook

## Start locally

For the complete real-provider demo, follow the [canonical README recipe](../../README.md#real-provider-demo-powershell)
with an explicit provider/model. It covers private configuration, the launcher's
full profile, switching/recreation and a synthetic manual check. Host Node and
base mock Compose below remain distinct alternatives; do not mix their commands
and assume the same effective settings. No new installation or model call is
claimed by these instructions.

T22 status, 2026-10-03 (Buenos Aires): scoped synthetic-demo acceptance with known misses/false positives; not universal privacy or confidential-data certification. See the current report.

1. For a new setup, copy `.env.example` to `.env`; preserve an existing configuration. Install with `npm ci` and configure a strong `JWT_SECRET`.
2. Run `npm run pii:init-key` once. It creates 48 random binary bytes at `.local/pii-hmac.key` (or `PII_HMAC_KEY_PATH`), requesting mode 0600 without overwriting an existing file. Review Windows ACLs; do not print or commit the key.
3. For host Node, run `docker compose -f docker-compose.yml -f docker-compose.pii-dev.yml up --build -d postgres pii`. PostgreSQL uses host 5432; PII exposes only `127.0.0.1:18080`. The first build downloads pinned model assets; runtime inference loads offline.
4. Set `PII_ENABLED=true`, `PII_PERSON_ENABLED=true`, `PII_SERVICE_URL=http://127.0.0.1:18080`, `PII_TIMEOUT_MS=10000`, `SOURCE_TEXT_MAX=1000`, `QUESTION_MAX=500`. Inspect `docker compose ps` and `Invoke-RestMethod http://127.0.0.1:18080/health`; readiness is not quality certification.
5. `npm run db:migrate` applies `001_init` and `002_pii_policy`. Seed only the synthetic demo with `npm run db:seed`. Rollback is restricted to database names containing `test`.
6. `npm run dev:api` listens on `PORT` (3001 in the example); `npm run dev:web` serves React on 5173 and proxies `/api`.

For all containers, use `docker compose up --build -d` after configuring JWT and the HMAC file. React/nginx is at `http://localhost:8080`. PII has no public port in normal Compose; the API uses `http://pii:8000` and waits for its healthcheck.

PII is explicitly `linux/amd64` because its hash-locked CPU wheel targets x86_64.
ARM hosts must enable Docker amd64 emulation; native ARM and emulated inference
latency have not been certified. Allocate at least the PII 4 GiB envelope plus
space for the other services. The first build downloads dependencies/model assets.

Model readiness can also take several minutes on a loaded 1-CPU host after the
image is cached. This is startup time, not the per-request protection timeout.
Use `docker compose ps` to check readiness; for a bounded longer startup check,
use `docker compose up -d --wait --wait-timeout 600` with the same selected
overlays. A timeout still requires diagnosing logs/resources; do not disable
protection to make startup appear successful.

## Local PII operation

The optional host-development overlay also attaches PII to the default bridge so Docker Desktop can
publish loopback 18080. Offline model flags remain, but that development profile permits network egress;
it is not the isolated normal Compose/QA topology. Normal Compose leaves PII only on its internal network.

`services/pii` uses GLiNER 0.2.27 directly with the pinned multilingual model plus `email-validator`/`phonenumbers`; it does not run Presidio/spaCy or an external LLM. Normal Compose gives it only an internal network, secret file, read-only root, dropped capabilities and no-new-privileges. Its 4 GiB / 1 CPU capacity limit is provisional; T22 measured approximately 2,720 MiB RSS and 2.52–3.34 seconds for 1,000-character sources, not an SLA or AWS capacity.

Keep the HMAC key stable across rebuilds/restarts and retained incidents. The service accepts a 32–4,096-byte binary file, or a UTF-8 environment value (used by the ECS proposal). New labels change after key rotation; no relabeling, identity resolution or reversible map is implemented.

`PII_UNAVAILABLE` (503) covers unavailable, busy, timed-out or invalid sanitation responses. Check readiness, secret accessibility, installed model and resource limits without logging payloads. Input failure makes no provider call or new content write. Output failure occurs after a clean-input model call, which may be charged; its raw response is discarded and failure metadata may remain. Retry explicitly once the service is healthy.

`PII_LEGACY_RECORD` (409) blocks protected-mode detail/questions/retry for old unmarked records. Lists hide their content/severity. Migration 002 neither sanitizes nor deletes history; do not reset the development volume to silence this boundary. Create a new analysis from synthetic or reviewed content. Account login email is unchanged.

`PII_ENABLED=false` is explicitly unprotected mode, used by general isolated offline regression. It must not be used as outage fallback or detector certification. Available evidence: [local integration report](../qa/LOCAL_PII_INTEGRATION.md); details: [guide](../security/PII_IMPLEMENTATION_PLAN.md), [data policy](../security/DATA_POLICY.md).

## Protection Modes And QA

Full mode is `PII_ENABLED=true` / `PII_PERSON_ENABLED=true`. Contacts-only is `true` / `false`:
it skips model loading but leaves names unprotected. Disabled is `false`: raw content can be stored/sent.
These are operator choices, not automatic timeout recovery. Keep API and PII name flags aligned, recreate
the affected containers and reload the page; React reads limits/coverage without a rebuild.
Enabled-mode policy changes block cross-policy historical detail/questions/retry.

Run `scripts\qa-local-pii.bat` or `npm run qa:pii` for the full synthetic battery. Docker Desktop,
Node dependencies and free local QA ports are required. The runner uses `incident_assistant_test`,
real offline PII and a mock model provider; it preserves `.env`, the development volume and the HMAC key.
It saves stage logs/summary under ignored `qa-artifacts/local-pii`, exercises all three modes and an outage,
then restores full protected demo mode. `--browser-only` is a targeted rerun, not full certification.
See [results and limits](../qa/LOCAL_PII_INTEGRATION.md).

The `actual-nest-adapter` stage preserves the real partial-name/non-idempotence FAIL. A failed stage produces a nonzero exit code; synthetic-demo acceptance does not change the assertion or relabel it PASS. Detector false positives are also possible: name detection is not infallible semantic classification.

## Persistence

The volume survives a `docker restart` of the container. On 2026-09-29 a row was inserted in `incident_assistant_test`, the container was restarted and the row was still there.

## Secrets

Locally: `.env` and the private HMAC file, git-ignored; ignore rules do not encrypt
them. Compose mounts HMAC as a secret; it is not copied into an image. In the AWS
proposal: Secrets Manager for database URL, provider key, JWT and PII HMAC.
Provider rotation includes a replacement credential, startup configuration update,
a real-call check and old-key revocation; merely changing a stored secret does not
update running instances. Follow the [canonical proposed procedure](../../infra/terraform/README.md#proposed-provider-key-rotation).
It is not automated or executed in AWS. HMAC rotation changes new token generation
and must account for retained incident continuity.

## Bursts

More API replicas do not raise the provider's quota or PostgreSQL's connection
limit. Defaults are four simultaneous model-stage calls per process and 20 analyses /
40 questions per owner per rolling hour, held in memory; the effective environment
may override them. They are not shared across replicas or a four-user limit.
PII has a separate single request slot with bounded waiting, not durable jobs.
Shared quotas/budgets, queues/workers and autoscaling remain proposals; follow the
[canonical burst-handling explanation](../../infra/terraform/README.md#proposed-burst-handling).
No production burst-capacity certification or automatic protection bypass.

## Documents

`docs/` and internal development notes are not copied into the images. The React build is checked with `npm run check:web-docs`. A 200 for `/docs/` from the SPA does not mean the markdown is published: the body must not contain those files.

## TLS problems on Windows

If a live-provider sample fails with a certificate error while `curl` succeeds, Node is not using the system trust store. The live scripts run with `node --use-system-ca`. Remove a stale `NODE_EXTRA_CA_CERTS` if one is set. Do not disable certificate verification.

Antivirus HTTPS scanning (for example Avast Web Shield) re-signs traffic with its own root certificate. Windows may trust that root while containers do not. Dependency/model downloads during builds and API provider HTTPS can then fail. Export the trusted root with `npm run docker:export-ca` and use `docker-compose.extra-ca.yml`: optional BuildKit `extra_ca_cert` for API/web/PII builds and an API read-only trust mount at `/run/ssl/extra-ca.pem` with `NODE_EXTRA_CA_CERTS`. PII uses the build secret for pip/model downloads; its inference remains offline. Do not disable TLS verification or commit the certificate.

For host Node with that CA, combine both overlays: `docker compose -f docker-compose.yml -f docker-compose.pii-dev.yml -f docker-compose.extra-ca.yml up --build -d postgres pii`. For the complete stack, omit the dev overlay; add the OpenRouter overlay only when deliberately configuring a real provider.

## Configuration and code

Keep three responsibilities distinct:

- Code defines system rules, prompt construction, output validation and workflow.
  Prompts remain versioned in Git; changing their instructions is a code release.
- Startup configuration selects provider/model, limits, deadlines, retention and
  service addresses without changing that workflow.
- Secrets include provider keys, the JWT signing secret and the credential-bearing
  database URL. Private local files are not encrypted by Git ignore. See
  [secret delivery and rotation](../../infra/terraform/README.md#secrets-and-rotation).

The [loader](../../apps/api/src/config/env.ts) reads the process environment and
local environment files, then [Joi schemas and typed slices](../../apps/api/src/config/slices.ts)
validate/map settings. Existing process values win; within each search root the
file loader tries `.env.local` before `.env`, without overriding loaded values.
Roots are checked in order: process working directory, then two levels above it.
This is the Node loader's precedence, not a substitute for Compose interpolation,
overlays or demo-script choices before a container starts. Compare the already
documented [configuration profiles](#configuration-profiles) when selecting a run.

Validation includes selected-provider key requirements and the relationship
between model-attempt timeout and overall deadline. It does not prove credential
validity, model access, connectivity or all proxy/API/PII combinations. A real
provider call and deployment checks remain necessary for integration evidence.

To switch provider, set its provider/model and credential using the documented
startup path, then restart Node or recreate the Compose API container. Do not
expect an environment-file edit or `docker compose restart` to update an existing
container's injected environment. Settings/SDK clients are constructed at startup;
there is no dynamic configuration consumer or per-request secret fetch.

### Proposed configuration improvements

1. Consolidate profile selection and precedence across host Node, Compose and the
   demo script, preserving intentional differences while making the effective
   choice predictable. Existing profile documentation is not a unified mechanism.
2. Extend current validation with cross-component checks for proxy/overall budgets
   and API/detector protection settings. Some relationships are already checked;
   complete topology validation is not implemented.
3. Record an approved nonsecret profile identifier alongside existing model/prompt
   metadata to investigate which limits/deadlines applied. This is a proposal, not
   current profile tracking. Do not dump the environment or derive this identifier
   from secret-bearing configuration or credential values.
4. If operational needs justify it, centralize parameters in
   [Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
   or use [AppConfig](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html)
   for validated, gradual configuration deployments with rollback when configured
   CloudWatch alarms trigger. Neither is integrated or defined by this Terraform
   proposal. Keep credentials under dedicated secret management.

Dynamic changes would require application retrieval/consumption, revalidation and
a policy for in-flight requests and configuration versions. A central service does
not automatically refresh SDK clients, database connections or running tasks.
Some settings would still require controlled process replacement. Alarm-based
rollback responds to configured operational signals; it cannot certify the truth
of every AI answer. Prioritize profile consistency and validation before adding
another service. These are scope/operability choices, not local hardware barriers.

No profile migration, new checks, hot reload or AWS configuration service was
implemented for this explanation. The [README startup recipe](../../README.md#real-provider-demo-powershell)
now consolidates both provider paths; it does not unify the underlying profile
selection mechanisms or certify a new installation. Documentation alone does not
implement the proposed coherence checks or dynamic configuration.

## Request timeouts

### Configuration profiles

Documentation snapshot 2026-10-04, Buenos Aires, from code and recorded runs;
not a fresh container inspection or configuration change.

| Profile | Source / question | PII per request | Overall / proxy |
|---|---|---|---|
| Base API/Compose defaults | 1,000 / 500 characters | 10 s | 20 s / 30 s |
| Parameterless `scripts/start-real-demo.ps1` | 4,000 / 500 | 9.5 s | 45 s / 60 s |
| Historical expanded demo, 2026-10-03 | 8,000 / 1,000 | 30 s | 90 s / 120 s |

The historical expanded profile uses 4 CPU/4 threads and is documented in [cases](../qa/DEMO_CASES.md),
not reproduced by the parameterless script or AWS proposal. Select and verify
the effective profile when preparing the demo; React obtains limits from the API.
Timeouts do not establish measured latency or a sub-10-second SLA.

The [2026-10-05 handoff recheck](../qa/HANDOFF_RECHECK_2026-10-05.md) rebuilt and
inspected the script's 4,000/500 full-protection profile, then exercised OpenAI
through the browser. This later evidence does not change base defaults or certify
the historical larger profile. First uncached dependency/model downloads can take
substantially longer than readiness or individual request budgets.

PII shares one inference slot. `PII_SLOT_WAIT_SECONDS` defaults to 20 s (range
0–60): wait in memory, then process, or return `PII_BUSY` (503) if the slot remains
unavailable. `0` rejects immediately when busy. The service timeout/global abort
may expire first; this is not extra budget, a persistent queue or parallel
inference. There is no raw-text fallback. Cold starts, load and size require
their own measurements.

The nginx image defaults `API_PROXY_READ_TIMEOUT` to `30s`, above the default 20 s request deadline. The controller abort signal covers sanitation overhead as well as model work. Each PII HTTP request has a 10 s timeout; this is not a guaranteed extra 10 s after the overall deadline. Short 2.5 s general-test deadlines bypass PII and do not measure this real path.

The local OpenRouter overlay defaults to a 45 s deadline when `LLM_DEADLINE_MS`
is absent. Explicit shell/`.env` values win: the example sets 20 s, so set
`LLM_DEADLINE_MS=45000` to reproduce the 45 s profile. Attempts are 20 s and the
proxy defaults to `60s`; the real-demo script explicitly chooses 45 s. Keep the
proxy timeout above the effective full request budget with time for writes and
JSON errors; align ALB too. Rebuild after nginx template changes and recreate
web after environment changes. `npm run qa:docker:timeouts` uses an isolated
synthetic upstream, not a paid provider or real PII detector; it does not certify
T22 latency.

## AWS proposal

See the [Terraform guide](../../infra/terraform/README.md). T22 proposes web/API/PII in one 4 GiB / 1 vCPU Fargate task, with 3,072 MiB for PII and a separate HMAC secret. All three immutable images, ACM/DNS, secret values and first-user provisioning are prerequisites. `desired_count = 0` remains. Local `fmt`/`validate` passed with Terraform 1.9.8 on 2026-10-02; AWS runtime and detector resources remain unverified. No cloud deployment has been executed.

## Logging boundary

API HTTP logs use server-generated correlation UUIDs and route templates (or `unmatched`). The supplied nginx template disables raw access/error request logs; the PII server disables access logging and emits closed errors. Audit/structured logs omit content by contract. These settings do not certify every library, collector or external proxy. Preserve metadata for diagnosis without copying source, prompts, raw outputs or keys.

## Prompt-injection observation

`prompt_injection_signal` is a warning, not a blocked request or a finding of a successful attack. Correlate its bounded detector/rule/input identifiers with execution outcomes; a quoted security report can legitimately match. Do not copy source or credentials into operational logs. No match does not prove safety, and log transport failures do not stop processing. No automatic alerts or enforcement are configured. Rules are versioned in code, not edited through environment variables. Run `npm run qa:security:signals` with the test database before changing them; evaluate an approved synthetic sample against the actual model separately. See [behavior and future controls](../security/PROMPT_INJECTION.md).

## Failure recovery

The scheduled sweep uses the LLM deadline plus a five-second grace window and runs every 15–60 seconds depending on that deadline. It skips overlapping sweeps in the same process. Analysis and execution changes are committed together, and completion and fallback operations are scoped to their execution. Question recovery closes aged executions independently. A database outage delays recovery until a later successful sweep; there is no immediate-recovery guarantee during an outage.

A minimal fallback may close a run without its audit event or assistant failure message when the full transaction failed. Recovery marks the interrupted state; it cannot recreate a model response or metadata that was never persisted. Monitor the failure and recovery logs and let the analyst retry explicitly.

## In-memory limits

Each limiter tracks at most 10,000 keys and sweeps at most 16 entries on each request. At capacity it rejects new keys instead of evicting an active quota. Idle processes stay memory-bounded; cleanup progresses with later traffic. Quotas are process-local, not a distributed rate limit.
