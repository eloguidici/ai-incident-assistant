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

`docs/`, `process/`, `.agents/` and `.ai/` are not copied into the images. The React build is checked with `npm run check:web-docs`. A 200 for `/docs/` from the SPA does not mean the markdown is published: the body must not contain those files.

## TLS problems on Windows

If a live-provider sample fails with a certificate error while `curl` succeeds, Node is not using the system trust store. The live scripts run with `node --use-system-ca`. Remove a stale `NODE_EXTRA_CA_CERTS` if one is set. Do not disable certificate verification.

## AWS proposal

See the [Terraform guide](../../infra/terraform/README.md). The definition uses an HTTPS ALB and a Fargate task with web/nginx plus the API, private PostgreSQL and Secrets Manager. OpenAI or OpenRouter is configurable. Real image references, an ACM certificate, DNS, secret values and first-user provisioning are prerequisites. No cloud deployment has been executed.

## Failure recovery

The scheduled sweep uses the LLM deadline plus a five-second grace window and runs every 15–60 seconds depending on that deadline. It skips overlapping sweeps in the same process. Analysis and execution changes are committed together, and completion and fallback operations are scoped to their execution. Question recovery closes aged executions independently. A database outage delays recovery until a later successful sweep; there is no immediate-recovery guarantee during an outage.

A minimal fallback may close a run without its audit event or assistant failure message when the full transaction failed. Recovery marks the interrupted state; it cannot recreate a model response or metadata that was never persisted. Monitor the failure and recovery logs and let the analyst retry explicitly.

## In-memory limits

Each limiter tracks at most 10,000 keys and sweeps at most 16 entries on each request. At capacity it rejects new keys instead of evicting an active quota. Idle processes stay memory-bounded; cleanup progresses with later traffic. Quotas are process-local, not a distributed rate limit.
