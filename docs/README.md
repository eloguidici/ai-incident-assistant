# Documentación técnica
Esta carpeta forma parte del repositorio entregado al evaluador, pero no de la aplicación publicada.


## Lectura breve
1. [Explicación de decisiones](architecture/RATIONALE.md)
2. [Stack y alternativas](decisions/ADR-001-stack.md)
3. [Diseño](architecture/DESIGN.md)
4. [Negocio](business/PRODUCT.md)
5. [Requisitos](requirements/ASSESSMENT.md)
6. [Regresión](qa/REGRESSION_CATALOG.md)

El README raíz conserva resumen de arquitectura, diseño IA, trade-offs, limitaciones y comandos reales. Los enlaces amplían la explicación, no reemplazan instrucciones mínimas.

## Qué documentar al implementar
Por decisión: problema, elección, alternativa, motivo, costo/límite y evidencia. Por tarea: qué cambió y cómo se verificó. No escribir en pasado una implementación futura ni simular una explicación personal que Emiliano todavía no revisó.

## Fuera del despliegue
T09 debe excluir docs/, tasks/, .agents/ y .ai/ de los artefactos runtime. No colocarlos en public/ ni configurar rutas estáticas para servirlos.
En Docker usar copia explícita/multistage de artefactos y dependencias runtime; revisar .dockerignore por contexto. No copiar todo el repositorio a la imagen final.
En frontend publicar sólo el resultado del build; comprobar que /docs/ no sirve estos archivos. Un fallback SPA con HTTP 200 no prueba exposición: inspeccionar contenido.
Mantener prompts/config necesarios en rutas runtime separadas; no hacer que la aplicación dependa de docs/.
T10 inspecciona imagen/build y URLs representativas. Esto es un requisito planificado, no exclusión ya comprobada.
