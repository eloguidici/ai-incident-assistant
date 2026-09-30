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

## Despliegue AWS
`infra/terraform` propone ECS Fargate detrás de un balanceador, tareas en subredes privadas, RDS PostgreSQL cifrado y contraseña administrada por RDS. No se hizo `apply`. El listener descrito es HTTP porque no hay certificado. Antes de un despliegue real harían falta el certificado, los valores de los secretos y una imagen publicada. Escalar el servicio no elimina los límites del modelo.
