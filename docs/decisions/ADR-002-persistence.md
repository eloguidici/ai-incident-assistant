# ADR-002: Persistence (historical)

Date: 2026-09-29. Status: superseded by [ADR-006](ADR-006-typeorm-repository.md) on 2026-09-30.

## Decision (historical)

PostgreSQL 16 and Drizzle ORM on the `pg` driver. Migrations are explicit SQL (`001_init` / `001_down`), not a dump generated on every start. The application applies them at startup, with a session lock so they do not run twice.

## Reason

Users, analyses, messages and executions need integrity and cascading deletes. Drizzle types the queries without a separate runtime. The SQL stays visible for rollback.

## Alternative

A larger ORM would have added implicit migrations. Loose untyped SQL queries would have repeated the mapping in every use case.

## Limit

There is a single migration. Rollback is tested on the test database and rejected on any database whose name does not contain `test`.
