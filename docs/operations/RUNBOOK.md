# Runbook


## Start locally

1. `docker compose up -d postgres` publishes PostgreSQL 16 on host port 5432, with the `pgdata` volume and a healthcheck.
2. Copy `.env.example` to `.env`.
3. `npm run db:migrate` applies `001_init`. `npm run db:rollback` runs only if the database name contains `test`.
4. `npm run dev:api` compiles and listens on `PORT` (3001 in the example). `npm run dev:web` serves React on 5173 and proxies `/api`.

## Persistence

The volume survives a `docker restart` of the container. On 2026-09-29 a row was inserted in `incident_assistant_test`, the container was restarted and the row was still there.

## Secrets

Locally: `.env`, git-ignored. In the AWS design: Secrets Manager for the database URL, the provider key and the JWT secret. The Dockerfiles do not receive those values. Rotation: create a new secret version and replace the ECS tasks. It is not automated.

## Bursts

More API replicas do not raise the provider's quota or PostgreSQL's connection limit. Each process allows 4 concurrent model calls and a per-user rate, in memory. That limit is not shared between replicas.

## Documents

`docs/` and internal development notes are not copied into the images. The React build is checked with `npm run check:web-docs`. A 200 for `/docs/` from the SPA does not mean the markdown is published: the body must not contain those files.

## TLS problems on Windows

If a live-provider sample fails with a certificate error while `curl` succeeds, Node is not using the system trust store. The live scripts run with `node --use-system-ca`. Remove a stale `NODE_EXTRA_CA_CERTS` if one is set. Do not disable certificate verification.

Antivirus HTTPS scanning (for example Avast Web Shield) re-signs traffic with its own root certificate. Windows trusts that root, but Docker containers do not, so `npm ci` inside an image build and the API container's calls to the provider fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Either exclude the registry and provider hosts from HTTPS scanning, or run `npm run docker:export-ca` and use `docker-compose.extra-ca.yml`: a BuildKit secret for image builds and, for the API service, a read-only bind mount at `/run/ssl/extra-ca.pem` with `NODE_EXTRA_CA_CERTS` pointing at that file. Verification stays on in both cases; do not commit the certificate.

## Request timeouts

The nginx image defaults `API_PROXY_READ_TIMEOUT` to `30s`, above the default 20 s API deadline. The local OpenRouter overlay uses a 45 s deadline, 20 s attempts and a `60s` proxy timeout. Keep the proxy timeout above the full API deadline with time for database writes and JSON error serialization; align the ALB timeout too for a future deployment. Rebuild after nginx template changes and recreate web containers after environment changes. After building the web image, `npm run qa:docker:timeouts` checks a 35 s success and a JSON timeout response at the API deadline using isolated containers and a synthetic upstream. It does not call a paid provider.

## AWS proposal

See the [Terraform guide](../../infra/terraform/README.md). The definition uses an HTTPS ALB and a Fargate task with web/nginx plus the API, private PostgreSQL and Secrets Manager. OpenAI or OpenRouter is configurable. Real image references, an ACM certificate, DNS, secret values and first-user provisioning are prerequisites. No cloud deployment has been executed.

## Failure recovery

The scheduled sweep uses the LLM deadline plus a five-second grace window and runs every 15–60 seconds depending on that deadline. It skips overlapping sweeps in the same process. Analysis and execution changes are committed together, and completion and fallback operations are scoped to their execution. Question recovery closes aged executions independently. A database outage delays recovery until a later successful sweep; there is no immediate-recovery guarantee during an outage.

A minimal fallback may close a run without its audit event or assistant failure message when the full transaction failed. Recovery marks the interrupted state; it cannot recreate a model response or metadata that was never persisted. Monitor the failure and recovery logs and let the analyst retry explicitly.

## In-memory limits

Each limiter tracks at most 10,000 keys and sweeps at most 16 entries on each request. At capacity it rejects new keys instead of evicting an active quota. Idle processes stay memory-bounded; cleanup progresses with later traffic. Quotas are process-local, not a distributed rate limit.
