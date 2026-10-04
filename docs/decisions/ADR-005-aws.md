# ADR-005: AWS deployment shape

Date: 2026-09-29, amended 2026-09-30. Status: proposed, not applied.

## Decision

ECS Fargate, an Application Load Balancer with HTTPS, RDS PostgreSQL 16 in private subnets and secrets in Secrets Manager. It is the smallest option that runs an already defined container without operating a Kubernetes cluster or rewriting the API as separate functions.

The Linux Fargate task contains the API and the React/nginx container. The HTTPS ALB forwards to nginx, which proxies `/api/` to the API inside the task, so the browser uses a single origin. HTTP redirects to HTTPS and an externally prepared ACM certificate is required. Real image references are mandatory. Provider selection supports OpenAI or OpenRouter. Secret containers have no values in Terraform, and the task count defaults to zero until deployment prerequisites are ready.

## Reason

The application already runs as a Node process with a relational database. Fargate runs that container. RDS matches local PostgreSQL. EKS would add a control plane this system does not use. Lambda would require splitting the process that today migrates, sweeps retention and serves HTTP in the same service.

## Alternative

EC2 with Docker Compose would replicate the local environment, but it is not the container service meant to accompany the Dockerfile. Serverless without a queue does not fit a model call that can take several seconds or the in-process sweep.

## Limit

No `plan` or `apply` has been run and no image has been published. RDS manages its own password; the full database URL must be loaded into the secret, and that step is not automated. More ECS tasks do not increase the AI provider's quota. An apply would not be free: the ALB, NAT gateway and RDS would still be created. See the [Terraform guide](../../infra/terraform/README.md).
