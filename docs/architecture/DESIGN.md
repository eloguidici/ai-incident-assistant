# Diseño propuesto
Estado: implementado el 2026-09-29. Stack en ADR-001. Persistencia, sesión y modelo en ADR-002, ADR-003 y ADR-004. La forma AWS está en ADR-005 y no fue aplicada.
## Estructura lógica
Monolito modular con Auth, Analyses, Conversation, AI y soporte Config/Observability. Backend NestJS/TypeScript, frontend React y PostgreSQL durable, con Docker local.
CQRS liviano: CreateAnalysis/AddQuestion son comandos; ListAnalyses/GetAnalysis son consultas. Misma DB; sin event sourcing ni infraestructura distribuida por defecto.
## Responsabilidades IA
Caso de uso -> PromptBuilder versionado -> LlmProvider -> OutputValidator -> persistencia/resultado.
Contrato conceptual: input/context, provider/model, deadline/cancel; respuesta estructurada con metadatos de tokens si están disponibles. Adapter real y mock seleccionables; no fallback silencioso a datos simulados.
## API propuesta para cerrar en T02
POST /auth/login; GET /analyses (paginado); POST /analyses; GET /analyses/:id; POST /analyses/:id/messages.
Errores consistentes de validación, auth, ownership, rate limit y proveedor; no exponer stack traces. Polling/streaming sólo si decisión explícita.
## Datos
PostgreSQL con migraciones y constraints; volumen Docker persistente y healthcheck. Verificar persistencia tras reinicio. Fijar versión y ORM al implementar; pgvector fuera del MVP.
User, Analysis, Message, ejecución AI con versiones/estado/timestamps. ownerId indexado y aplicado a cada consulta. No mantener transacción DB durante llamada LLM.
Estados propuestos pending/processing/completed/failed; definir recuperación de proceso interrumpido. Reintentos deben tener reglas de duplicados y costos explícitas.
## Seguridad/operación
JWT o sesión similar; elegir transporte y CSRF/CORS en T02. Cancelación real propagada, concurrencia limitada, cuotas, entradas acotadas, redacción de logs/errores.
IaC requerida; Docker propuesto. No secretos en imagen, frontend, user-data ni state. Documento de AWS distingue validación local, mock y despliegue real.
## Costo de patrones
Handlers separan casos de uso y pruebas; no crear capas vacías ni abstracciones genéricas para cada clase. No importar framework entero para una llamada al modelo.
