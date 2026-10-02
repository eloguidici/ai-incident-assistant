# Documentation


These documents support the root [README](../README.md), which already answers each assessment question. They are part of the repository, not of the published application.

## Suggested reading

1. [Rationale](architecture/RATIONALE.md): main decisions and their cost.
2. [Design](architecture/DESIGN.md): modules, AI responsibilities, data and security.
3. [Product and business rules](business/PRODUCT.md).
4. [MVP contracts](features/MVP.md): output schema, API and limits.
5. [Data policy](security/DATA_POLICY.md): stored data, retention, PII, logs and audit.
6. [Runbook](operations/RUNBOOK.md): local operation, secrets, recovery and limits.
7. [Requirements matrix](requirements/ASSESSMENT.md): each assessment requirement and how it is met.
8. Decision records: [ADR-001 stack](decisions/ADR-001-stack.md), [ADR-002 persistence (historical)](decisions/ADR-002-persistence.md), [ADR-003 session](decisions/ADR-003-session.md), [ADR-004 model](decisions/ADR-004-model.md), [ADR-005 AWS](decisions/ADR-005-aws.md), [ADR-006 TypeORM](decisions/ADR-006-typeorm-repository.md).
9. QA: [UI flows and browser test cases](qa/UI_FLOWS.md), [live quality suite](qa/LIVE_SUITE.md), [regression catalog](qa/REGRESSION_CATALOG.md) and the earlier [browser cases snapshot](qa/BROWSER_CASES.md).

Infrastructure: [Terraform guide](../infra/terraform/README.md).

## Outside the deployment

`docs/` is excluded from the runtime images. The frontend publishes only its build, and `npm run check:web-docs` verifies that these documents are not in it.

## Pending plan

[Bilingual PII protection](security/PII_IMPLEMENTATION_PLAN.md): proposal, tasks and acceptance criteria; not implemented yet.

[Full assessment review — 2026-10-02](requirements/ASSESSMENT_REVIEW_2026-10-02.md): evidence, limits and priorities; not delivery certification.
