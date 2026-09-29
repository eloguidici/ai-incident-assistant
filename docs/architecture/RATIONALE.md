# Explicación de las decisiones
Estado: diseño inicial. Actualizar contra código y evidencia al cerrar cada tarea.
## Qué se entendió de la consigna
Construir una aplicación pequeña que recibe contenido, permite conversar sobre él y muestra salida estructurada. La evaluación incluye backend/frontend, datos, seguridad, confiabilidad e infraestructura, además de justificar compromisos.

## Por qué este caso
El análisis de incidentes permite resumir y clasificar texto, separar evidencia de hipótesis y pedir información faltante. Cubre los tres comportamientos sin OCR ni carga de documentos. Texto es una entrada admitida por el PDF.

| Decisión | Motivo | Costo o límite |
|---|---|---|
| NestJS/TypeScript | Node está permitido; módulos, DI y validación conocidos | Evitar capas/decoradores innecesarios |
| React | Requisito y flujo claro de entrada/resultados | Estados de error/carga deben integrarse realmente |
| PostgreSQL | Opción admitida; relaciones y consistencia de usuarios/análisis/mensajes | Migraciones e índices deben mantenerse |
| Monolito modular | Un despliegue y límites claros para un caso pequeño | No ofrece aislamiento operativo por módulo |
| CQRS liviano | Separar lectura de orquestación de escrituras y pruebas | Más archivos; no justificar event sourcing ni dos DB |
| SDK detrás de contrato | Hacer visible la invocación y permitir sustitución | Implementar límites/errores explícitos |
| Prompt versionado y schema | Poder rastrear cambios y rechazar formato inválido | Formato válido no garantiza veracidad |
| Evidencias e incertidumbre | Facilitar revisión humana | No elimina alucinaciones ni valida causalidad |
| Docker local | Reproducir API/base y persistencia | Docker solo no satisface IaC AWS |

## Alcance deliberado
Sin RAG, voz, scraping, herramientas con efectos ni multiagentes obligatorios. No se necesitan para este caso y el PDF los omite o trata como bonus. Mostrar estado real de procesamiento; no simular streaming ni pasos internos de razonamiento.

## Datos y límites de IA
T02/T08 concretan qué se guarda y qué no, plazos de conservación, PII, envío a proveedor y borrado. Auditoría responde quién hizo qué/cuándo/con qué resultado; logs describen salud técnica. Ambos pueden usar correlation ID y excluir payload sensible.
La calidad se mide con casos/rúbrica y muestras reales; mocks validan contratos. Cambios de prompt/modelo se comparan antes de publicar; errores del modelo requieren feedback, investigación y posible rollback.

## Operación
T09 describe claves en runtime, rotación, IAM y respuesta ante picos. Las cuotas del proveedor y las conexiones DB limitan el escalado. El backend Docker tendrá propuesta de despliegue ECS o serverless coherente con IaC; no se necesita ejecutar infraestructura paga para afirmar que se definió.

## Evidencia y decisiones pendientes
No hay código ni pruebas de aplicación todavía. ORM/versiones, sesión, límites cuantificados, retención y destino cloud se cierran en tareas. Añadir aquí enlaces a resultados reales, no afirmaciones anticipadas.
