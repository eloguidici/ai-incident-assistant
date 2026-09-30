# Negocio y alcance
## Problema y actores
Analista técnico necesita ordenar información incompleta de un incidente. Usuario autenticado es dueño de su contenido; IA propone análisis, humano verifica. Evaluador debe reproducir el flujo.

## Alcance MVP
Login, pegar texto, generar análisis estructurado, consultar historial/detalle y hacer preguntas/refinamientos sobre ese mismo contenido.
No carga PDF/OCR inicialmente; el assessment admite texto. No voz, scraping, herramientas con efectos, monitoreo real, RAG ni múltiples agentes obligatorios.

## Reglas
B01: cada análisis y mensaje pertenece a un usuario; servidor deriva identidad de sesión.
B02: sólo propietario lee, modifica o pregunta sobre análisis; listados tampoco filtran datos ajenos.
B03: entrada validada y tamaño/contexto limitados antes de llamar modelo.
B04: hechos/evidencias separados de hipótesis; texto insuficiente produce incertidumbre explícita.
B05: salida debe validar contra esquema; salida inválida no se muestra como éxito.
B06: fallos visibles y recuperables; reintento explícito no borra resultado previo.
B07: proveedor/modelo/promptVersion se registran por ejecución; logs operativos no contienen texto completo.
B08: no ejecutar acciones sobre sistemas externos.

## Flujos
F01 login -> sesión -> acceso.
F02 texto -> validación -> ejecución -> resultado persistido o fallo visible.
F03 historial propio -> detalle -> recuperación tras reinicio.
F04 pregunta -> contexto acotado y propio -> respuesta -> historial.
F05 fallo proveedor -> mensaje seguro -> reintento controlado.
F06 usuario ajeno intenta acceso -> denegación consistente sin filtrar contenido.

## Resultado propuesto
summary, category, suggestedSeverity, evidence, hypotheses, missingInformation y uncertainty. Las citas tienen que existir en el texto. El esquema cerrado está en docs/features/MVP.md.
## Datos sensibles
Usar fixtures sintéticos. Definir política de envío al proveedor, retención/borrado y logs en T02/T08 antes de afirmar privacidad implementada.
## Éxito
Evaluador levanta aplicación con instrucciones, analiza contenido, pregunta, conserva historial y comprueba aislamiento y errores. No se promete diagnóstico correcto automático.
