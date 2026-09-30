# Casos de navegador y API
Fecha: 2026-09-29. Automatización: Playwright con Chrome instalado, más Jest contra PostgreSQL. No se descargó el Chromium de Playwright por un fallo TLS del entorno.

| ID | Caso | Resultado | Dónde |
|---|---|---|---|
| B01 | Login válido | PASS | `qa/e2e/smoke.spec.ts` |
| B02 | Login inválido | PASS | el mismo archivo. Sesión vencida: PASS en Jest, no en el navegador |
| B03 | Historial vacío | PASS | e2e, después de reset de la base de test |
| B04 | Incidente válido y resultado | PASS | e2e y Jest |
| B05 | Vacío y texto largo | PASS en API. En la UI el botón queda deshabilitado y el textarea tiene `maxLength` |
| B06 | Evidencias, hipótesis, faltantes | PASS | e2e muestra evidencias e incertidumbre |
| B07 | Pregunta | PASS | e2e y Jest |
| B08 | Recarga del historial | PASS | e2e hace reload |
| B09 | Reinicio de Postgres | PASS | fila presente después de `docker restart`. No se repitió desde el navegador |
| B10 | Usuario B no abre el análisis de A | PASS | e2e y Jest |
| B11 | Timeout | PASS en API con `[MOCK:timeout]`, deadline de test 2,5 s. No se filmó en el navegador |
| B12 | 429/5xx | PASS en API para 500 y auth. 429 del proveedor no tiene un caso de navegador |
| B13 | JSON o esquema inválido | PASS en API |
| B14 | Doble envío concurrente | PASS en API: 409 y 504. No hay un doble click de UI automatizado |
| B15 | Contexto sobre el presupuesto | Cubierto por test unitario de `selectContext`. No hay caso HTTP con el presupuesto bajo en la suite actual |
| B16 | HTML/script visible como texto | PASS | e2e comprueba el texto y que no aparece `window.__xss` |
| B17 | Teclado y viewport chico | NOT_RUN como caso dedicado. Los controles son nativos y el CSS tiene un corte a 720 px |
| B18 | Cancelación al desconectar | NOT_RUN de punta a punta. El servidor aborta si la respuesta se cierra antes de terminar |
| B19 | Dos preguntas simultáneas | El índice único responde 409. No hay un test que dispare las dos preguntas a la vez |
| B20 | Logs sin secreto ni texto | PASS en Jest |
| B21 | `/docs/` no publica el markdown | PASS parcial: `check:web-docs` no encuentra los documentos en `apps/web/dist`. No se inspeccionó la imagen nginx |
| B22 | Proveedor real | BLOCKED | sin clave |
| B23 | Fallo de base después del modelo | NOT_RUN. El código marca `DATA_NOT_SAVED` si la escritura falla; no se inyectó esa falla en la suite |
| B24 | Retención | PASS en Jest: un análisis vencido desaparece y el resto del mecanismo horario queda en el proceso |

Un video de `qa:demo` se pidió en esta sesión. Si el comando no figura como PASS en el reporte, el video no se certificó.
