# Documentation


These documents support the root [README](../README.md), which already answers each assessment question. They are part of the repository, not of the published application.

## Suggested reading

2. [Rationale](architecture/RATIONALE.md): main decisions and their cost.
3. [Design](architecture/DESIGN.md): modules, AI responsibilities, data and security.
4. [Product and business rules](business/PRODUCT.md).
5. [MVP contracts](features/MVP.md): output schema, API and limits.
6. [Data policy](security/DATA_POLICY.md): stored data, retention, PII, logs and audit.
7. [Runbook](operations/RUNBOOK.md): local operation, secrets, recovery and limits.
8. [Requirements matrix](requirements/ASSESSMENT.md): each assessment requirement and how it is met.
9. Decision records: [ADR-001 stack](decisions/ADR-001-stack.md), [ADR-002 persistence (historical)](decisions/ADR-002-persistence.md), [ADR-003 session](decisions/ADR-003-session.md), [ADR-004 model](decisions/ADR-004-model.md), [ADR-005 AWS](decisions/ADR-005-aws.md), [ADR-006 TypeORM](decisions/ADR-006-typeorm-repository.md).
10. QA: [regression catalog](qa/REGRESSION_CATALOG.md) and [browser cases](qa/BROWSER_CASES.md).

Infrastructure: [Terraform guide](../infra/terraform/README.md). Development process material (tasks, status notes, dated QA runs): [process/](../process/README.md).

## Outside the deployment

`docs/`, `process/`, `.agents/` and `.ai/` are excluded from the runtime images. The frontend publishes only its build, and `npm run check:web-docs` verifies that these documents are not in it.
