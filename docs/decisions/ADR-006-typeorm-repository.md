# ADR-006 — TypeORM y patrón Repository
Fecha: 2026-09-30. Estado: aceptado.
## Decisión
PostgreSQL 16 sigue siendo la base. Drizzle se reemplaza por **TypeORM** (`@nestjs/typeorm`) con `synchronize: false`. El acceso a datos pasa por **repositorios** inyectables: `UserRepository` y `AnalysisRepository` (este último agrupa análisis, mensajes, ejecuciones y auditoría relacionada). Las migraciones siguen siendo SQL explícito (`001_init` / `001_down`) aplicado al arranque y en CLI con lock advisory, igual que ADR-002.
## Motivo
Emiliano pidió TypeORM y Repository para alinear el stack con convenciones Nest y encapsular SQL/ORM fuera de los servicios de aplicación.
## Consecuencias
- Servicios (`AnalysesService`, `AuthService`, `StartupService`, `HealthController`, CLI) no importan Drizzle.
- Entidades TypeORM en `apps/api/src/db/entities/` deben coincidir con `001_init.sql`.
- Códigos de dominio, cookies, headers y eventos de log viven en módulos de constantes bajo `common/constants/` y `domain/`.
## Alternativa rechazada
Mantener Drizzle: descartada por requisito explícito del product owner.
