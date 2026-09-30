# ADR-004 — Integración del modelo
Fecha: 2026-09-29. Estado: aceptado.
## Decisión
Contrato `LlmProvider` con tres implementaciones: `mock`, `openai` y `openrouter` (API compatible en `https://openrouter.ai/api/v1`). Prompts `incident-analysis.v1` e `incident-question.v1`. La salida pasa por Zod y por una comprobación de citas. El SDK oficial de OpenAI se configura con `maxRetries: 0`. La aplicación reintenta como máximo una vez si el error es timeout de intento, 429, 5xx o red, y si todavía entra en `LLM_DEADLINE_MS`.
## Motivo
El flujo es una sola llamada con JSON. Un framework de orquestación no aporta en este alcance. Dejar el reintento en un solo lugar evita multiplicarlo con el del SDK.
## Alternativa
Aceptar cualquier JSON bien formado mostraría citas inventadas como si fueran evidencia. Reintentar errores de esquema gastaría otra llamada sin garantía de corrección.
## Límite
No hay streaming. Cancelar el `AbortSignal` no deshace una solicitud que el proveedor ya haya procesado. El mock no mide calidad del modelo. `gpt-4o-mini` es el default por costo y salida JSON; no hay una comparación medida contra otro modelo.
