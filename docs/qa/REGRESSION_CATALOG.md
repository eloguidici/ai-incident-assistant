# Catálogo QA
Actualizado: 2026-09-29. La evidencia detallada está en [runs/2026-09-29/REPORT.md](runs/2026-09-29/REPORT.md).

| ID | Flujo | Prioridad | Escenario/resultado | Superficie | Resultado |
|---|---|---|---|---|---|
| Q01 | F01 | P0 | Login válido, inválido y expirado | API/browser | PASS en API y en Chrome |
| Q02 | F02 | P0 | Texto válido -> resultado validado/persistido | Integración/browser | PASS |
| Q03 | F02 | P1 | Vacío, excesivo y campo extra | API | PASS |
| Q04 | F03/F06 | P0 | A no lee ni pregunta datos de B | API/browser | PASS |
| Q05 | F03 | P0 | Reinicio conserva datos | Postgres | PASS para una fila tras `docker restart` |
| Q06 | F04 | P0 | Pregunta y orden del hilo | API/browser | PASS |
| Q07 | F05 | P1 | JSON inválido, cita no fundada, 401 y 500 | Mock/API | PASS |
| Q08 | F02 | P1 | Injection e insuficiencia en la rúbrica mock | Evaluación | PASS en mock. Real: BLOCKED |
| Q09 | Todos | P0 | Secreto y texto fuera de los logs | Integración | PASS |
| Q10 | F05 | P1 | Reintento no borra un éxito; un fallo reintenta una vez | API | PASS |
| Q11 | UI | P1 | Carga, error, vacío, resultado | Browser | PASS en el recorrido e2e |
| Q12 | Operación | P0 | Arranque con Postgres y migrate | Smoke | PASS para Postgres y la API de e2e. El `docker compose up` completo no se ejecutó |

## Evaluaciones IA
Cinco fixtures mock PASS: claro, insuficiente, injection, HTML y contradictorio. La rúbrica exige citas presentes en el texto e incertidumbre cuando no hay evidencia. Eso no mide al modelo real.
`npm run qa:ai:live` terminó BLOCKED porque no había `OPENAI_API_KEY`. No se inventó una muestra.

## Casos de navegador
La ficha de B01–B24 está en [BROWSER_CASES.md](BROWSER_CASES.md).
