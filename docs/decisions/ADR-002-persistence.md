# ADR-002 — Persistencia
Fecha: 2026-09-29. Estado: sustituido por ADR-006 (2026-09-30).
## Decisión (histórica)
PostgreSQL 16 y Drizzle ORM sobre el driver `pg`. Las migraciones son SQL explícito (`001_init` / `001_down`), no un volcado generado en cada arranque. La aplicación las aplica al iniciar, con un lock de sesión para no correrlas dos veces.
## Motivo
Hacen falta usuarios, análisis, mensajes y ejecuciones con integridad y borrado en cascada. Drizzle tipa las consultas sin un runtime aparte. El SQL queda visible para el rollback.
## Alternativa
Un ORM más grande habría agregado migraciones implícitas. Consultas SQL sueltas sin tipos habrían repetido el mapeo en cada caso de uso.
## Límite
Hay una sola migración. El rollback está probado en la base de test y rechazado en cualquier base cuyo nombre no contenga `test`.
