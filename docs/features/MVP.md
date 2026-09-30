# MVP — contratos
Fecha de cierre de contratos: 2026-09-29.

## Resultado de análisis
`summary`, `category` (`availability|performance|security|data|unknown`), `suggestedSeverity` (`low|medium|high|critical|unknown`), `evidence[]` con `quote` y `note`, `hypotheses[]` con `statement` y `confidence`, `missingInformation[]`, `uncertainty`.

`quote` tiene que ser un fragmento exacto del incidente. Sin citas, `uncertainty` e `missingInformation` son obligatorios. Una URL en la salida solo se acepta si ya estaba en el incidente.

## Pregunta
El mismo objeto más `answer`. La cita sigue teniendo que salir del incidente original, no de una respuesta anterior del modelo.

## API
Todas las rutas cuelgan de `/api`. El cuerpo de error es `{ error: { code, message, correlationId, analysisId } }`. No incluye stack.

| Método | Ruta | Auth | Éxito | Errores |
|---|---|---|---|---|
| GET | `/health` | no | 200 `{ status: "ok" }` | 503 si la base no responde |
| POST | `/auth/login` | no | usuario y `csrfToken`; cookies `ia_session` y `ia_csrf` | 400, 401, 429 |
| GET | `/auth/session` | sí | usuario | 401 |
| POST | `/auth/logout` | sí + CSRF | `{ ok: true }` | 401, 403 |
| GET | `/analyses?limit&offset` | sí | página propia | 400, 401 |
| POST | `/analyses` | sí + CSRF | análisis `completed` o error con `analysisId` | 400, 403, 409, 422, 429, 502, 504 |
| GET | `/analyses/:id` | sí | detalle propio | 404 si no existe o es ajeno |
| POST | `/analyses/:id/messages` | sí + CSRF | detalle con el hilo | 404, 409, 413, 422, 429, 502 |
| POST | `/analyses/:id/retry` | sí + CSRF | nuevo intento si el análisis está `failed` | 404, 409 |

Estados: `processing`, `completed`, `failed`. Un proceso interrumpido pasa a `failed` con código `INTERRUPTED` si sigue en curso después del deadline más 5 segundos.

## Límites
- Incidente: 1 a 8000 caracteres. Pregunta: 1 a 1000.
- Contexto: incidente + pregunta + mensajes recientes, presupuesto 12000 caracteres. Si el incidente y la pregunta no entran, 413 y no hay llamada al modelo. Los mensajes viejos se descartan primero.
- 20 análisis y 40 preguntas por usuario por hora, en memoria.
- 4 llamadas de modelo en curso por proceso.
- Retención: `RETENTION_DAYS` (30). `expires_at` se calcula al crear. El barrido borra el análisis y, en cascada, mensajes y ejecuciones.

## Datos
Ver [política de datos](../security/DATA_POLICY.md). ORM: TypeORM sobre `pg`, con repositorios inyectables y migraciones SQL en `apps/api/src/db/migrations`. La decisión vigente está en ADR-006.
