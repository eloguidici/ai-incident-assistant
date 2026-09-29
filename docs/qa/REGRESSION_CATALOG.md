# Catálogo QA
Todos los casos: NOT_RUN; no hay app. Preparar usuarios A/B y datos sintéticos. Evidencia en docs/qa/runs/<fecha>-<tarea>/REPORT.md.
| ID | Flujo | Prioridad | Escenario/resultado | Superficie |
|---|---|---|---|---|
| Q01 | F01 | P0 | Login válido, inválido y expirado; acceso correcto | API/browser |
| Q02 | F02 | P0 | Texto válido -> resultado validado/persistido | Integración/browser |
| Q03 | F02 | P1 | Vacío/excesivo/campos extra -> rechazo sin llamada LLM | API |
| Q04 | F03/F06 | P0 | A no lee/lista/pregunta sobre datos de B | DB real/API |
| Q05 | F03 | P0 | Reinicio conserva resultado e historial | Integración |
| Q06 | F04 | P0 | Pregunta conserva contexto propio y límites | API/browser |
| Q07 | F05 | P1 | Timeout/429/5xx/JSON inválido -> fallo seguro | Mock determinístico/API |
| Q08 | F02 | P1 | Injection/datos insuficientes -> sin acciones, incertidumbre | Evaluación real |
| Q09 | Todos | P0 | Tokens/secretos no aparecen en logs/errores/UI | Integración |
| Q10 | F05 | P1 | Reintento/duplicado no borra resultado ni dispara bucle | API |
| Q11 | UI | P1 | Carga, error, vacío, resultado y navegación teclado | Browser |
| Q12 | Operación | P0 | Arranque limpio siguiendo README y DB disponible | Smoke |

## Evaluaciones IA
Fixtures: incidente claro, insuficiente, contradictorio, injection, PII ficticia, fuera de contexto. Rúbrica de estructura, fundamento, incertidumbre y pertinencia; no exigir igualdad literal.
Mock prueba contratos, no calidad. Muestra real registra modelo/prompt/config/fecha y observaciones. No prometer precisión por un solo ejemplo.

## Cierre por tarea
Acceptance -> casos -> riesgo/blast radius -> pruebas -> regresión directa/adyacente -> smoke crítico.
Registrar commit/entorno/comandos/expected/actual/PASS-FAIL-BLOCKED-NOT_RUN y evidencia redactada. Defecto -> reproducción -> fix -> retest, sin ocultar primer fallo.
