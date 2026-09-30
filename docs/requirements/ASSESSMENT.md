# Matriz de requisitos y aceptación
Fuente: PDF Full Stack AI Engineer Assessment recibido el 29/09/2026. La aplicación está implementada. La evidencia ejecutada está en docs/qa/runs/2026-09-29/REPORT.md. Lo que no se corrió figura como BLOCKED o NOT_RUN.

| ID | Exigencia | Entrega y aceptación |
|---|---|---|
| R01 | Contenido: texto o documentos | Formulario de texto; entrada vacía/excesiva rechazada. El PDF permite elegir texto sin carga de archivos. |
| R02 | Interactuar sobre el contenido | Preguntas y refinamientos vinculados al análisis; límites de contexto y ownership. |
| R03 | Resultados estructurados | Esquema validado en servidor y representación clara en React. |
| R04 | Node preferido o Java | NestJS sobre Node.js confirmado en ADR-001. |
| R05 | API REST o GraphQL | REST documentada con contratos y errores. |
| R06 | Endpoint IA | Una llamada real configurable y adaptador determinístico para tests. Mock no reemplaza la demostración real de integración. |
| R07 | PostgreSQL, MongoDB o DynamoDB | PostgreSQL seleccionado; Docker local. Probar persistencia tras reinicio. |
| R08 | Autenticación JWT o similar | Login; sesión válida/vencida; autorización por propietario. |
| R09 | Separación IA | Construcción de prompt, invocación y postprocesamiento separadas. |
| R10 | Cambio proveedor | Contrato común + real/mock; test de sustitución, sin imponer múltiples proveedores reales. |
| R11 | Versionado/config de prompt | Prompt versionado; guardar versión y modelo con resultado. |
| R12 | Seguridad de entrada y costos | Implementar límites básicos; explicar mitigación de injection, presupuestos y rate limits productivos. |
| R13 | React, dos páginas | Nueva entrada e historial/detalle, además de login; estados vacío/cargando/error. |
| R14 | Estado IA y refinamiento | Estado procesando/completado/fallido; re-preguntar. Streaming opcional, no fingir tokens. |
| R15 | Incertidumbre | Evidencias vs hipótesis; datos faltantes; no inventar certeza ni fuentes. |
| R16 | Datos y arquitectura | Qué se guarda/no, retención, PII, logs y auditoría documentados. |
| R17 | Evaluación | Calidad, regresiones y respuesta incorrecta en producción explicadas; fixtures de ejemplo recomendados. |
| R18 | AWS o mock + IaC | Terraform o CloudFormation coherente con arquitectura; documentar si no se desplegó. |
| R19 | Secretos/config | Sin claves reales en repo, imágenes, frontend o logs; ubicación/rotación/escalado explicados. |
| R20 | Repositorio y README | Decisiones, diseño IA, trade-offs, limitaciones e instrucciones locales verificadas. |

## Extras separados
RAG/vector store, streaming token a token, tool calling, colas, costos 1k/10k/100k, multitenancy y Docker no son obligatorios. Docker se propone por reproducibilidad. Aislar datos por usuario sí es parte de seguridad básica, aunque multitenancy sea bonus.

## Tiempo
Una semana es el plazo general del PDF; 6–10 horas es una expectativa de esfuerzo. No afirma que esté prohibido excederla. Registrar horas reales por fase, sin prometer una fecha aún no confirmada ni sumar features para llenar la semana.

## Preguntas abiertas
Fecha/hora de entrega, reglas de uso de IA/componentes propios y visibilidad requerida del repo. No bloquean el análisis ni la documentación.
