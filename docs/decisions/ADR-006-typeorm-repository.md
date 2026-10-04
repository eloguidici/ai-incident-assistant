# ADR-006: TypeORM and the Repository pattern

Date: 2026-09-30. Status: accepted.

## Decision

PostgreSQL 16 remains the database. Drizzle is replaced by **TypeORM** (`@nestjs/typeorm`) with `synchronize: false`. Data access goes through injectable **repositories**: `UserRepository` and `AnalysisRepository` (the latter groups analyses, messages, executions and related audit events). Migrations remain explicit SQL (`001_init` / `001_down`), applied at startup and from the CLI under an advisory lock, as in [ADR-002](ADR-002-persistence.md).

## Reason

The project owner asked for TypeORM and repositories to align the stack with Nest conventions and keep SQL and ORM details out of the application services.

## Consequences

- Services (`AnalysesService`, `AuthService`, `StartupService`, `HealthController`, CLI) do not import the ORM directly.
- TypeORM entities in `apps/api/src/db/entities/` must match `001_init.sql`.
- Domain codes, cookies, headers and log events live in constant modules under `common/constants/` and `domain/`.

## Rejected alternative

Keeping Drizzle: discarded by explicit decision of the project owner.
