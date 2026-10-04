# ADR-001: Stack

Date: 2026-09-29. Status: accepted.

## Decision

NestJS on Node.js and TypeScript, React and PostgreSQL. PostgreSQL runs in Docker for local development. The LLM is integrated directly through its SDK behind a contract, without an additional agent runtime. Lightweight CQRS within the same application and database.

## Reasons

NestJS is familiar to the author and satisfies the assessment's preference for Node. PostgreSQL is explicitly allowed; it models users, analyses, messages and their relations with integrity and transactions. Docker makes the local environment reproducible. React is required.

No vector extension is needed for the current scope, nor a second database.

## Alternatives considered

Plain Express would require defining more conventions; NestJS provides a known structure for modules, injection and validation. MongoDB and DynamoDB are allowed, but PostgreSQL fits the model's relations and integrity. A single database keeps complexity low. No agent runtime is needed for the current flow.

## Compatibility

The assessment allows Java or Node (preferred) and PostgreSQL, MongoDB or DynamoDB. This selection satisfies those options without an exception.

## Consequences

Keep modules small in TypeScript/Nest and validate their boundaries and dependencies. Durable data lives in PostgreSQL. Docker Compose has a volume, a healthcheck, migrations and configuration without committed secrets. No orchestration frameworks are added to the current scope.
