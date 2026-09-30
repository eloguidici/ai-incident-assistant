# Política de datos
Estado: implementada en la aplicación local. La retención del proveedor externo no está implementada aquí porque no la controlamos.

## Qué se guarda
| Dato | Dónde | Para qué | Plazo |
|---|---|---|---|
| Email y hash de contraseña | `users` | Identidad | Hasta borrar el usuario. No hay baja de cuenta en el MVP. |
| Texto del incidente | `analyses.source_text` | Reabrir el análisis y volver a preguntar | `RETENTION_DAYS` (30) desde la creación |
| Resultado validado | `analyses.result` | Mostrar el informe | El mismo plazo |
| Preguntas y respuestas | `messages` | Hilo del análisis | Se borran con el análisis |
| Modelo, prompt, intentos, latencia, tokens si el proveedor los informa | `ai_executions` | Auditoría técnica sin el texto | Se borran con el análisis |
| Actor, acción, recurso, resultado y correlation id | `audit_events` | Quién hizo qué | No incluye el texto del incidente. No tiene barrido propio. |

## Qué no se guarda
Contraseña en claro, clave del proveedor, cuerpo crudo devuelto por el modelo, prompt completo, cookies y encabezado `Authorization`. Los logs solo aceptan una lista cerrada de campos (`msg`, `status`, `correlationId`, `latencyMs`, `provider`, `model`, `promptVersion`, `attempts`, `errorCode`, ids). Un test de integración envía un texto con un marcador y comprueba que no aparece en `console.log`.

## Proveedor
Con `LLM_PROVIDER=openai` o `openrouter` el incidente sale del proceso hacia la API configurada. Esa copia sigue la política del proveedor, no `RETENTION_DAYS`. Con `mock` no hay llamada externa.

## Borrado
`AnalysesService.purgeExpired` corre al iniciar y cada hora. También se puede provocar en tests. El caso de integración marca `expires_at` en el pasado y comprueba el 404 posterior. No es un job de nube.

## Auditoría y logs
La auditoría responde quién ejecutó qué acción, sobre qué id, con qué resultado y correlation id. El log técnico responde estado HTTP, duración y código de error. No son el mismo registro.

## PII
El incidente puede contener datos personales porque el usuario los pega. Se almacenan hasta el vencimiento y se envían al proveedor si el modo es real. No hay un detector que prometa quitarlos.
