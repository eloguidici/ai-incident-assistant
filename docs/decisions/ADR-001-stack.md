# ADR-001 — Stack confirmado
Fecha: 2026-09-29. Estado: ACEPTADO para backend/frontend/base; detalles de implementación pendientes.
## Decisión vigente
NestJS sobre Node.js y TypeScript, React y PostgreSQL. PostgreSQL se levanta en Docker para desarrollo local. Integración LLM directa por SDK detrás de contrato, sin runtime adicional de agentes. CQRS liviano con misma aplicación y base.
## Razones
Nest es la opción familiar a Emiliano y cumple Node preferido por la prueba. PostgreSQL está explícitamente permitido; permite modelar usuarios, análisis, mensajes y relaciones con integridad y transacciones. Docker facilita un entorno local reproducible. React es requisito.
No se requiere extensión vectorial para el alcance actual ni una segunda base. No seleccionar versiones/ORM sin revisar compatibilidad al implementar.
## Alternativas consideradas
Express directo requiere definir más convenciones; NestJS ofrece una estructura conocida para módulos, inyección y validación. MongoDB y DynamoDB son permitidos, pero PostgreSQL encaja con relaciones e integridad del modelo. Mantener una sola base reduce complejidad. No se necesita un runtime de agentes para el flujo actual.
## Compatibilidad
PDF permite Java o Node (preferido), PostgreSQL/MongoDB/DynamoDB. La selección satisface estas opciones, sin requerir una excepción.
## Consecuencias
Mantener módulos pequeños en TypeScript/Nest y validar sus límites y dependencias. Datos durables en PostgreSQL; Memory sólo para tests. Docker Compose tendrá volumen, healthcheck, migraciones y configuración sin secretos commiteados.
Versiones fijadas, ORM, auth, retención y despliegue AWS se cierran en T01/T02/T09. No añadir frameworks de orquestación al alcance actual.
