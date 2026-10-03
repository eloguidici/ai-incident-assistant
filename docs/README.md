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
8. Decision records: [ADR-001 stack](decisions/ADR-001-stack.md), [ADR-002 persistence (historical)](decisions/ADR-002-persistence.md), [ADR-003 session](decisions/ADR-003-session.md), [ADR-004 model](decisions/ADR-004-model.md), [ADR-005 AWS](decisions/ADR-005-aws.md), [ADR-006 TypeORM](decisions/ADR-006-typeorm-repository.md), [ADR-007 local PII](decisions/ADR-007-local-pii.md).
9. QA: [UI flows and browser test cases](qa/UI_FLOWS.md), [live quality suite](qa/LIVE_SUITE.md), [regression catalog](qa/REGRESSION_CATALOG.md) and the earlier [browser cases snapshot](qa/BROWSER_CASES.md).

Infrastructure: [Terraform guide](../infra/terraform/README.md).

Part 2.2: [AI evaluation and reliability](qa/AI_EVALUATION.md), all three assessment explanations, rubric correction and evidence limits. Explanatory closure, not actual-model semantic approval.

[AI risk decisions](security/AI_RISK_DECISIONS.md): three measured failures, rationale and researched alternatives; no new implementations or production acceptance.

## Outside the deployment

`docs/` is excluded from the runtime images. The frontend publishes only its build, and `npm run check:web-docs` verifies that these documents are not in it.

## Local PII and manual testing

[Local PII implementation guide](security/PII_IMPLEMENTATION_PLAN.md): T22 code/configuration, failure boundaries and literal colored HMAC labels. Scoped synthetic-demo acceptance with measured limits, not universal privacy.

[Bilingual PII spike](qa/PII_SPIKE.md): original T21 Presidio/spaCy measurements; the union remains NO-GO and is not the new runtime.

[Local PII integration report](qa/LOCAL_PII_INTEGRATION.md): actual T22 evidence. Offline general regression with PII disabled does not certify a detector.

[Current closure](qa/ASSESSMENT_CLOSURE.md): real OpenAI/OpenRouter, one correction iteration and preserved semantic failures. [Manual testing](qa/MANUAL_ACCEPTANCE.md): reproducible startup and synthetic cases; no confidential data.

[Full assessment review — 2026-10-02](requirements/ASSESSMENT_REVIEW_2026-10-02.md): historical review, evidence and priorities; it predates T22 implementation and does not certify its candidate.
