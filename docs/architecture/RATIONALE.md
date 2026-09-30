# Rationale


This document explains the main decisions and what each one costs. Test evidence is in the dated reports under [process/qa-runs](../../process/qa-runs/).

## What the assessment asks

Build a small application that receives content, lets the user converse about it and shows structured output. The evaluation covers backend and frontend, data, security, reliability and infrastructure, and asks for the trade-offs to be justified.

## Why this use case

Incident analysis requires summarizing and classifying text, separating evidence from hypotheses and asking for missing information. It covers the three suggested behaviors without OCR or document upload. Text is an accepted input in the assessment.

| Decision | Reason | Cost or limit |
|---|---|---|
| NestJS/TypeScript | Node is preferred; known modules, dependency injection and validation | Avoid unnecessary layers and decorators |
| React | Required; clear input and results flow | Error and loading states must be integrated for real |
| PostgreSQL | Allowed option; relations and consistency for users, analyses and messages | Migrations and indexes must be maintained |
| Modular monolith | One deployment and clear boundaries for a small case | No operational isolation per module |
| Lightweight CQRS | Separate reads from write orchestration and its tests | More files; does not justify event sourcing or two databases |
| SDK behind a contract | Makes the invocation visible and replaceable | Limits and errors must be implemented explicitly |
| Versioned prompt and schema | Changes can be traced and invalid formats rejected | Valid format does not guarantee truth |
| Evidence and uncertainty | Makes human review easier | Does not remove hallucinations or validate causality |
| Local Docker | Reproduce API, database and persistence | Docker alone does not satisfy AWS infrastructure as code |

## Deliberate scope

No RAG, voice, scraping, tools with side effects or multiple agents. They are not needed for this case and the assessment omits them or treats them as bonus. The UI shows the real processing state; it does not simulate streaming or internal reasoning steps.

## Data and AI limits

The [data policy](../security/DATA_POLICY.md) defines what is stored and what is not, retention, PII, what is sent to the provider and deletion. The audit trail answers who did what, when and with which result; logs describe technical health. Both use a correlation id and exclude sensitive payloads.

Quality is measured with cases, a rubric and real samples; mocks validate contracts. Prompt or model changes are compared before release; model errors call for feedback, investigation and a possible rollback.

## Operation

The [Terraform guide](../../infra/terraform/README.md) describes runtime keys, rotation, IAM and the response to bursts. Provider quotas and database connections limit scaling. The Docker images have an ECS deployment proposal consistent with the infrastructure code; paid infrastructure does not need to run to show that it was defined.

## Evidence

ORM: TypeORM and repositories, [ADR-006](../decisions/ADR-006-typeorm-repository.md) ([ADR-002](../decisions/ADR-002-persistence.md) is historical). Session: [ADR-003](../decisions/ADR-003-session.md). Limits and retention: [MVP](../features/MVP.md) and [data policy](../security/DATA_POLICY.md). Proposed cloud target: [ADR-005](../decisions/ADR-005-aws.md), not applied. Test runs, including live-model samples: [process/qa-runs](../../process/qa-runs/).
