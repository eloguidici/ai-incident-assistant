# AWS infrastructure proposal

This is an infrastructure definition for assessment section 3.1, which allows AWS or a simulated proposal. It has not been deployed. Local application verification remains separate from cloud validation.

AWS is the hosting platform; Terraform is the tool used to describe the desired
resources and their relationships in reviewable, version-controlled files. Applying
that definition would provision infrastructure through AWS APIs. This is not a
secret store or a replacement for application images, deployment prerequisites
and runtime checks. See [Terraform's introduction](https://developer.hashicorp.com/terraform/intro).

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

## Container deployment choice

Assessment 3.2 is optional; this delivery includes Docker images for the API,
React/nginx and local PII detector, with Compose and PostgreSQL for local operation.
An image packages the runtime; a container is a running instance. These files help
reproduce the environment, not guarantee identical behavior or latency on all hosts.

The chosen AWS proposal is ECS Fargate with HTTPS ALB ingress and private RDS,
matching the current container-based application. Web/API/PII share one task and
scale together. Kubernetes was not selected because no assessed requirement
justifies operating a cluster. EKS or a serverless-function design are alternatives,
not required parallel deployments or impossible choices; the latter would need an
explicit design for the current HTTP, migration, retention and local detector work.
Neither alternative is implemented or evaluated here.

Docker defines how services run; Terraform describes the infrastructure and its
connections. Recorded local execution and Terraform validation have separate
scopes: neither establishes a working AWS deployment or production availability.
Images, certificates/DNS, secret values, first-user provisioning and runtime/resource
checks remain [deployment prerequisites](#prerequisites-for-a-future-deployment).
Even zero ECS tasks would not make a future apply free of other resource charges.

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

### Provider Key Delivery

The [definition](main.tf) creates a named secret container, not an OpenAI/OpenRouter
credential or its value. An authorized operator would obtain the provider key and
populate a secret version outside Terraform. The ECS definition names
`OPENAI_API_KEY` or `OPENROUTER_API_KEY` and references that secret's ARN; the
execution role permits retrieval. ECS would resolve the value when starting the
container, and the API would consume it through the same environment-based
configuration used locally. There is no runtime Secrets Manager fetch in each AI
request. See [ECS secret environment injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

Locally, values can come from a private `.env` or operator-supplied process
environment. Git ignore does not encrypt that file. Environment values are still
available inside the running process and to authorized inspection/debugging tools;
avoid environment dumps and protect operator access. Do not treat this definition
as proof that no credential can ever leak. State/plan files also remain private.

### Proposed Provider Key Rotation

1. Generate a replacement credential through the provider's approved process.
   Keep the old credential temporarily only if the provider permits overlap and
   it is not suspected compromised; do not assume all providers share a lifecycle.
2. Store the replacement in a new secret version outside Terraform.
3. Replace ECS tasks so new instances load the updated value. Locally, update the
   private environment and restart Node or recreate the Compose API container;
   merely editing `.env` or restarting an existing Compose container does not
   reconfigure its injected environment. No application/image rebuild is needed
   solely for an environment-supplied key change. See
   [Compose restart behavior](https://docs.docker.com/reference/cli/docker/compose/restart/).
4. Verify a real provider call with the new instances and check that no running
   instance still depends on the old credential, accounting for in-flight work.
5. Revoke the old credential at the provider and verify that ordinary requests
   continue using the replacement without logging either credential.

Changing a stored secret does not update running containers or automatically
revoke the provider's previous key. A suspected compromise prioritizes immediate
revocation and incident handling even if availability is affected; a planned
overlap is not appropriate for a known compromised key. See
[OWASP secret lifecycle guidance](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).
This procedure is documented, not automated or executed in AWS, and makes no
zero-downtime guarantee. No rotation, provider call or deployment was performed
for this documentation update.

For the database, coordinate credential rotation with the URL update and task
replacement; automatic synchronization is not implemented. Rotating the sole JWT
signing key invalidates existing sessions; overlapping signing-key rotation is
not implemented.

HMAC rotation changes newly generated incident labels; stored labels are preserved, with no reversible map or automatic relabeling. Plan continuity for retained incidents before replacing that key. Secret containers have no values supplied by Terraform; `desired_count = 0` still prevents task startup by default.

## Configuration versus code

The task definition uses `environment` for nonsecret parameters and `secrets` for
secret ARN references resolved at container startup. The API maps/validates that
environment with the same typed configuration used locally; prompts and system
rules stay versioned in code. Parameter changes do not imply hot reload or prove
provider access. See the [canonical configuration explanation and proposed
improvements](../../docs/operations/RUNBOOK.md#configuration-and-code).
Parameter Store/AppConfig, effective-profile tracking and further cross-component
validation are proposals, not resources or behavior added to these files.

## Scaling and trade-offs

This small proposal co-locates web, API and PII; they scale together. The local model adds CPU/memory demand and another startup/failure dependency. There is one NAT gateway and no claim of production high availability. Autoscaling and distributed quotas are not implemented.

More ECS tasks do not increase the LLM provider quota. Each process has its own concurrency and rate limits; aggregate detector capacity, PostgreSQL connections, provider 429s, latency and spend need coordination before scaling. Nginx uses 30 s and the default request deadline is 20 s, including protection overhead; the 10 s internal PII timeout is not an extra guaranteed allowance. Revise proxy/ALB timeouts together if the request budget increases.

### Current Admission Boundaries

API defaults are `MAX_INFLIGHT_LLM=4`, `RATE_LIMIT_ANALYSES_PER_HOUR=20` and
`RATE_LIMIT_QUESTIONS_PER_HOUR=40`; the actual environment may override them.
The first applies to the gateway's model-stage work per process, not all users or
HTTP requests. The hourly limits use owner-keyed sliding windows held in memory.
An additional API replica has independent counters, so a user reaching different
replicas may exceed an intended aggregate quota. Gateway/rate-limit admission
can reject with 429; provider attempts/retry waits stay within the deadline.
See [configuration](../../apps/api/src/config/slices.ts),
[limiters](../../apps/api/src/common/limiters.ts) and
[gateway](../../apps/api/src/ai/gateway.ts).

The [PII service](../../services/pii/app.py) separately serializes sanitation
requests/batches through one shared slot and bounded in-memory waiting. This is
not durable job storage, a background business worker or a guarantee that a request
will finish before the API deadline. Saturation/timeouts can fail protection;
the API does not automatically bypass protection. Model-stage admission does not
bound all earlier PII work. Existing database processing guards also do not make
the process-local rate/concurrency counters distributed.

### Proposed Burst Handling

1. Measure concurrent workflow behavior, provider quotas/429s, latency/spend,
   detector CPU/memory/slot waits and database connection/transaction capacity.
   Local samples and Terraform validation do not certify production burst load.
2. Coordinate owner/tenant quotas, global concurrency and budgets across replicas
   with an appropriate shared store and atomic admission; these are not current
   distributed controls. Adding replicas does not increase the provider's quota.
3. If measurements justify asynchronous work, propose bounded durable jobs and
   workers, 202 acceptance and result polling. Limit backlog/wait, handle expiry,
   cancellation, idempotency and retries, and preserve ownership/protection.
   A queue smooths arrivals but does not create model capacity or unlimited storage.
4. Scale admitted work within the measured provider/detector/database envelope;
   observe saturation and reject excess work instead of accumulating it forever.
   Web/API/PII currently share the proposed task, so more tasks scale them together;
   separating components would be a later measured design decision.

Shared quotas/budgets, durable jobs/workers, polling and autoscaling are proposed,
not implemented or deployed. No load test, provider call, replica change or cloud
command ran for this documentary update. Known AI/PII quality limits are unchanged.

Local Terraform validation checks configuration syntax/schema. It does not certify model quality, task health, secret accessibility, image startup, shared-network isolation or AWS capacity. Actual T22 evidence belongs in the planned [integration report](../../docs/qa/LOCAL_PII_INTEGRATION.md).

## References

- [Terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [ECS local networking and same-task localhost](https://aws.amazon.com/blogs/compute/a-guide-to-locally-testing-containers-with-amazon-ecs-local-endpoints-and-docker-compose/)
- [ECS sensitive data](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [Official nginx image templates](https://hub.docker.com/_/nginx)
