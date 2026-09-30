# AWS infrastructure proposal


This is an infrastructure definition for assessment section 3.1, which allows AWS or a simulated proposal. It has not been deployed. Local application verification remains separate from cloud validation.

## What the files describe

| File | Responsibility |
|---|---|
| `versions.tf` | Terraform/provider versions and non-secret inputs |
| `network.tf` | VPC, public/private subnets, NAT and security groups |
| `main.tf` | HTTPS ALB, ECS task/service, RDS, secret containers, IAM and logs |

The public HTTPS ALB forwards to nginx on port 80 inside a Linux Fargate task. Nginx serves the React build and proxies `/api/` to NestJS on `127.0.0.1:3000` in the same task. The browser therefore uses one origin for the UI, session cookie and CSRF cookie. The API connects to private RDS PostgreSQL. Only the ALB can reach the task's HTTP port; only the task security group can reach PostgreSQL.

The nginx image uses the official image's template substitution. `API_UPSTREAM` defaults to `api:3000` in Compose and is `127.0.0.1:3000` in ECS. The frontend must be rebuilt from the current Dockerfile to use this configuration.

## Validation without an AWS deployment

Install Terraform >= 1.6 from the [official installation instructions](https://developer.hashicorp.com/terraform/install). From the repository root, in PowerShell or a shell:

```powershell
terraform version
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false -input=false
terraform -chdir=infra/terraform validate
```

`init` downloads the pinned provider and checks package integrity. `validate` checks configuration and provider schema; it does not create AWS resources or prove that credentials, DNS, images or secrets work. These checks do not need application API keys. Do not disable TLS or checksum verification if a download fails.

`plan` previews changes in a concrete environment and may query AWS. `apply` performs changes and can incur charges. Neither is part of the validation-only procedure above. A successful `validate` is not a deployment certification. CI runs `fmt -check`, `init -backend=false` and `validate` on every push.

## Prerequisites for a future deployment

No deploy is authorized by this document. Before considering one:

1. Publish actual API and web images built from `infra/docker/api.Dockerfile` and `infra/docker/web.Dockerfile`. Supply their immutable references through `container_image` and `web_container_image`; there is no generic Node image fallback.
2. Provide an ACM certificate in the ALB region, a public hostname covered by that certificate, and its HTTPS origin in `web_origin`. Configure that hostname's DNS to the ALB. DNS and certificate issuance are external prerequisites, not provisioned here.
3. Select `llm_provider` (`openai` or `openrouter`) and optionally `llm_model`. ECS sets the corresponding API-key and model environment names.
4. Keep `desired_count = 0` while preparing secret versions. Secret containers are defined here, but values are supplied outside Terraform. Even with zero tasks, a future apply would create other billable resources such as RDS, ALB and NAT.
5. Prepare a controlled first-user provisioning procedure. Demo seeding is disabled in ECS; no public registration or automatic production administrator is assumed.
6. Establish encrypted, access-controlled remote state and locking before shared production operation. This proposal uses local state by default. State files, tfvars and plan files must not be committed.

Only after these prerequisites and an explicit deployment review should a nonzero task count be considered. The local demo does not require these steps.

## Secrets and rotation

The execution role can read only the three configured secret ARNs. The application task role has no additional AWS permissions. Values are not placed in Terraform variables, images or source files.

- `database-url`: a PostgreSQL connection string built from the RDS endpoint, database name and authorized database credential. RDS manages the master password separately; Terraform does not read that password into its state or automatically construct this URL. Configure certificate-verified TLS and test connectivity before deployment. For production, provision a least-privilege application role rather than using the master account for ordinary requests.
- Provider key: a secret for the selected provider. Changing the provider requires populating the newly selected secret before starting tasks.
- `jwt-secret`: a strong random signing secret satisfying the application's minimum length.

Rotate a secret by creating a new version through an approved secret-management process, then replace ECS tasks so they load it. Changing a stored value does not update running containers. For the database, coordinate credential rotation with the URL update and task replacement; automatic synchronization is not implemented. Rotating the sole JWT signing key invalidates existing sessions; overlapping signing-key rotation is not implemented.

## Scaling and trade-offs

This small proposal co-locates web and API to keep browser authentication and deployment understandable. They scale together. There is one NAT gateway and no claim of production high availability. Autoscaling and distributed quotas are not implemented.

More ECS tasks do not increase the LLM provider quota. Each process has its own concurrency and rate limits; aggregate capacity, PostgreSQL connections, provider 429s, latency and spend need coordination before scaling. The nginx timeout is 30 seconds and the default LLM deadline is 20 seconds; revise proxy/ALB timeouts together if the application deadline increases.

## References

- [Terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [ECS local networking and same-task localhost](https://aws.amazon.com/blogs/compute/a-guide-to-locally-testing-containers-with-amazon-ecs-local-endpoints-and-docker-compose/)
- [ECS sensitive data](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [Official nginx image templates](https://hub.docker.com/_/nginx)
