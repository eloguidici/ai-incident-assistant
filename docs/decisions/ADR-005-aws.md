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



## 2026-09-30 amendment — executable proposal boundaries

The proposed Linux Fargate task now contains the API and the React/nginx container. The HTTPS ALB forwards to nginx, which proxies `/api/` to the API within the task; the browser uses one origin. HTTP redirects to HTTPS and an externally prepared ACM certificate is required. Actual application image references are mandatory.

Provider selection supports OpenAI or OpenRouter. Secret containers have no values in Terraform, and the task count defaults to zero until deployment prerequisites are prepared. This does not make an AWS apply free: ALB, NAT and RDS would still be created.

This supersedes the earlier HTTP-only limitation and API-only topology. It is a small assessment proposal, not a claim that this is the cheapest possible AWS architecture. No plan or apply has been performed. See [Terraform guide](../../infra/terraform/README.md) for validation, secrets, rotation, networking and known limits.
