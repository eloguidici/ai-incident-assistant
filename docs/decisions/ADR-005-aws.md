# ADR-005 — Forma de despliegue AWS
Fecha: 2026-09-29. Estado: propuesto, no aplicado.
## Decisión
ECS Fargate para la API, Application Load Balancer, RDS PostgreSQL 16 en subredes privadas y secretos en Secrets Manager. Es la opción más chica que cumple un contenedor ya definido sin operar un clúster Kubernetes ni reescribir la API como funciones sueltas.
## Motivo
La aplicación ya corre como un proceso Node con una base relacional. Fargate ejecuta ese contenedor. RDS coincide con PostgreSQL local. EKS sumaría un plano de control que este sistema no usa. Lambda exigiría partir el proceso que hoy migra, barre retención y atiende HTTP en el mismo servicio.
## Alternativa
EC2 con Docker Compose replica el entorno local, pero no es el servicio de contenedores que se quiere mostrar junto al Dockerfile. Serverless sin cola no encaja con una llamada al modelo que puede durar varios segundos y con el barrido en proceso.
## Límite
No se ejecutó `apply` ni se publicó una imagen. El listener del ejemplo es HTTP. La contraseña de RDS la administra AWS; la URL completa hay que cargarla en el secreto, y ese paso no está automatizado. Más tareas ECS no aumentan la cuota del proveedor de IA.
