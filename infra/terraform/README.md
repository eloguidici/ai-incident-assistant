# AWS infrastructure proposal

This is an infrastructure definition for assessment section 3.1, which allows AWS or a simulated proposal. It has not been deployed. Local application verification remains separate from cloud validation.

T22 update, 2026-10-02 (Buenos Aires): local `fmt` and `validate` passed for the new configuration in the HashiCorp Terraform 1.9.8 container using cached providers; no new `init` was needed. AWS runtime, detector resource sizing and deployment remain unverified.

## What the files describe

| File | Responsibility |
|---|---|
| `versions.tf` | Terraform/provider versions and non-secret inputs |
| `network.tf` | VPC, public/private subnets, NAT and security groups |
| `main.tf` | HTTPS ALB, ECS task/service, RDS, secret containers, IAM and logs |

The public HTTPS ALB forwards to nginx on port 80 inside a Linux Fargate task. Nginx serves the React build and proxies `/api/` to NestJS on `127.0.0.1:3000` in the same task. The browser therefore uses one origin for the UI, session cookie and CSRF cookie. The API connects to private RDS PostgreSQL. Only the ALB can reach the task's HTTP port; only the task security group can reach PostgreSQL.

T22 adds an essential PII sidecar in the same task. The API waits for its healthcheck and uses `http://127.0.0.1:8000` with a 10 s adapter timeout. `pii_enabled` and `pii_person_enabled` default to true; the latter is aligned across API/sidecar. False explicitly selects contacts-only coverage without name-model loading; disabling API protection permits raw content, not outage recovery. `source_text_max`/`question_max` default to 1,000/500 and drive runtime frontend limits. The task proposes 1 vCPU / 4 GiB total; PII has a 3,072 MiB container limit and a read-only root. This is provisional sizing, different from Compose's 4 GiB limit for PII alone. No real model resource certification or AWS runtime measurement is implied.

The sidecar image builds pinned GLiNER model/tokenizer assets and performs local offline inference with dedicated email/phone recognizers; no external LLM guard. Same-task networking/offline flags are not an AWS egress-isolation certification. See [ADR-007](../../docs/decisions/ADR-007-local-pii.md).

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

1. Publish actual API, web and PII images built from `infra/docker/api.Dockerfile`, `infra/docker/web.Dockerfile` and `services/pii/Dockerfile`. Supply immutable references through `container_image`, `web_container_image` and `pii_container_image`; there is no generic image fallback. Verify the real offline model, startup/health, filesystem and CPU/memory envelope before considering task activation.
2. Provide an ACM certificate in the ALB region, a public hostname covered by that certificate, and its HTTPS origin in `web_origin`. Configure that hostname's DNS to the ALB. DNS and certificate issuance are external prerequisites, not provisioned here.
3. Select `llm_provider` (`openai` or `openrouter`) and optionally `llm_model`. ECS sets the corresponding API-key and model environment names.
4. Keep `desired_count = 0` while preparing secret versions. Secret containers are defined here, but values are supplied outside Terraform. Even with zero tasks, a future apply would create other billable resources such as RDS, ALB and NAT.
5. Prepare a controlled first-user provisioning procedure. Demo seeding is disabled in ECS; no public registration or automatic production administrator is assumed.
6. Establish encrypted, access-controlled remote state and locking before shared production operation. This proposal uses local state by default. State files, tfvars and plan files must not be committed.

Only after these prerequisites and an explicit deployment review should a nonzero task count be considered. The local demo does not require these steps.

## Secrets and rotation

The execution role can read only the four configured secret ARNs. The application task role has no additional AWS permissions. Values are not placed in Terraform variables, images or source files.

- `database-url`: a PostgreSQL connection string built from the RDS endpoint, database name and authorized database credential. RDS manages the master password separately; Terraform does not read that password into its state or automatically construct this URL. Configure certificate-verified TLS and test connectivity before deployment. For production, provision a least-privilege application role rather than using the master account for ordinary requests.
- Provider key: a secret for the selected provider. Changing the provider requires populating the newly selected secret before starting tasks.
- `jwt-secret`: a strong random signing secret satisfying the application's minimum length.
- `pii-hmac-key`: a separate private key injected as `PII_HMAC_KEY` only into the PII container. This loader treats the environment value as UTF-8 bytes (32–4,096 bytes); Compose instead uses a binary file secret. A base64 representation is not automatically decoded. Preserve the effective key across replacements if incident token continuity is required.

Rotate a secret by creating a new version through an approved secret-management process, then replace ECS tasks so they load it. Changing a stored value does not update running containers. For the database, coordinate credential rotation with the URL update and task replacement; automatic synchronization is not implemented. Rotating the sole JWT signing key invalidates existing sessions; overlapping signing-key rotation is not implemented.

HMAC rotation changes newly generated incident labels; stored labels are preserved, with no reversible map or automatic relabeling. Plan continuity for retained incidents before replacing that key. Secret containers have no values supplied by Terraform; `desired_count = 0` still prevents task startup by default.

## Scaling and trade-offs

This small proposal co-locates web, API and PII; they scale together. The local model adds CPU/memory demand and another startup/failure dependency. There is one NAT gateway and no claim of production high availability. Autoscaling and distributed quotas are not implemented.

More ECS tasks do not increase the LLM provider quota. Each process has its own concurrency and rate limits; aggregate detector capacity, PostgreSQL connections, provider 429s, latency and spend need coordination before scaling. Nginx uses 30 s and the default request deadline is 20 s, including protection overhead; the 10 s internal PII timeout is not an extra guaranteed allowance. Revise proxy/ALB timeouts together if the request budget increases.

Local Terraform validation checks configuration syntax/schema. It does not certify model quality, task health, secret accessibility, image startup, shared-network isolation or AWS capacity. Actual T22 evidence belongs in the planned [integration report](../../docs/qa/LOCAL_PII_INTEGRATION.md).

## References

- [Terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [ECS local networking and same-task localhost](https://aws.amazon.com/blogs/compute/a-guide-to-locally-testing-containers-with-amazon-ecs-local-endpoints-and-docker-compose/)
- [ECS sensitive data](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [Official nginx image templates](https://hub.docker.com/_/nginx)
