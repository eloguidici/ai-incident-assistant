# Runbook local
## Subir
1. `docker compose up -d postgres` publica PostgreSQL 16.10 en el puerto host 5432, con volumen `pgdata` y healthcheck.
2. Copiá `.env.example` a `.env`.
3. `npm run db:migrate` aplica `001_init`. `npm run db:rollback` solo corre si el nombre de la base contiene `test`.
4. `npm run dev:api` compila y escucha en el puerto de `PORT` (3001 en el ejemplo). `npm run dev:web` sirve React en 5173 y proxea `/api`.

## Persistencia
El volumen sobrevive a `docker restart` del contenedor. El 2026-09-29 se insertó `persist-check@example.test` en `incident_assistant_test`, se reinició el contenedor y la fila seguía ahí.

## Secretos
Locales: `.env`, gitignored. En el diseño AWS, Secrets Manager para `DATABASE_URL`, `OPENAI_API_KEY` y `JWT_SECRET`. La imagen no recibe esas claves en el Dockerfile. Rotación: crear una versión nueva del secreto y redesplegar la tarea. No está automatizada ni ejecutada.

## Picos
Más réplicas de la API no suben la cuota del proveedor ni el tope de conexiones de PostgreSQL. El proceso limita 4 llamadas simultáneas y una tasa por usuario en memoria. Ese tope no se comparte entre réplicas.

## Documentos
`docs/`, `tasks/`, `.agents/` y `.ai/` no se copian a la imagen. El build de React se revisa con `npm run check:web-docs`. Un 200 de `/docs/` en la SPA no significa que el markdown esté publicado: el cuerpo no debe contener esos archivos.

## AWS proposal

See [infra/terraform/README.md](../../infra/terraform/README.md). The definition uses an HTTPS ALB and a Fargate task with web/nginx plus API, private PostgreSQL and Secrets Manager. OpenAI/OpenRouter selection is configurable. Actual image references, an ACM certificate, DNS, secret values and first-user provisioning are prerequisites. No cloud deployment has been executed.

## Failure recovery

The scheduled sweep uses the LLM deadline plus a five-second grace window and runs every 15–60 seconds depending on that deadline. It skips overlapping sweeps in the process. Analysis/execution changes are committed together, and completion/fallback operations are scoped to their execution. Question recovery closes aged executions independently. A database outage delays recovery until a later successful sweep; there is no immediate-recovery guarantee during an outage.

A minimal fallback may close a run without its audit event or assistant failure message when the full transaction failed. Recovery marks interrupted state; it cannot recreate a model response or metadata that was never persisted. Monitor the failure/recovery logs and let the analyst retry explicitly.

## In-memory limits

Each limiter tracks at most 10,000 keys and sweeps at most 16 entries on each request. At capacity it rejects new keys instead of evicting an active quota. Idle processes remain memory-bounded; cleanup progresses with subsequent traffic. Quotas are process-local and are not a distributed rate limit.
