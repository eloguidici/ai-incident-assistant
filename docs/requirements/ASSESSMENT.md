# Requirements and acceptance matrix


Source: Full Stack AI Engineer Assessment PDF, received on 2026-09-29. The application is implemented. The checks can be reproduced with the commands in the root [README](../../README.md#verification).

| ID | Requirement | Delivery and acceptance |
|---|---|---|
| R01 | Content: text or documents | Text form; empty or oversized input rejected. The assessment allows text without file upload. |
| R02 | Interact with the content | Questions and refinements linked to the analysis; context limits and ownership. |
| R03 | Structured outputs | Schema validated on the server and shown clearly in React. |
| R04 | Node (preferred) or Java | NestJS on Node.js, confirmed in ADR-001. |
| R05 | REST or GraphQL API | Documented REST with contracts and errors (OpenAPI). |
| R06 | AI endpoint | A configurable real call and a deterministic adapter for tests. The mock does not replace a real integration sample. |
| R07 | PostgreSQL, MongoDB or DynamoDB | PostgreSQL, run locally in Docker. Persistence after restart tested. |
| R08 | JWT or similar authentication | Login; valid and expired sessions; authorization by owner. |
| R09 | AI separation | Prompt construction, invocation and post-processing separated. |
| R10 | Provider switch | Common contract with mock, OpenAI and OpenRouter implementations. |
| R11 | Prompt versioning or configuration | Versioned prompt; version and model stored with each result. |
| R12 | Input safety and costs | Basic limits and a native observation-only signal detector; injection boundaries/evasions, budgets and production rates explained in the [README](../../README.md) and [security use cases](../security/PROMPT_INJECTION.md). No guarantee of prevention or extra LLM. |
| R13 | React, two pages | New analysis and history/detail, plus login; empty, loading and error states. |
| R14 | AI status and refinement | Processing, completed and failed states; ask again and retry. Streaming is optional and tokens are not faked. |
| R15 | Uncertainty | Evidence vs hypotheses; missing information; no invented certainty or sources. |
| R16 | Data and architecture | What is stored and what is not, retention, PII, logs and audit documented. |
| R17 | Evaluation | Quality, regressions and wrong answers in production explained; example fixtures included. |
| R18 | AWS or mock + IaC | Terraform consistent with the architecture; documented as not deployed. |
| R19 | Secrets and configuration | No real keys in the repository, images, frontend or logs; location, rotation and scaling explained. |
| R20 | Repository and README | Decisions, AI design, trade-offs, limits and verified local instructions. |

## Separate extras

RAG or a vector store, token streaming, tool calling, queues, cost estimates for 1k/10k/100k requests, multi-tenancy and Docker are not mandatory. Docker is included for reproducibility, and a cost estimate is in the README. Isolating data per user is part of basic security, even though multi-tenancy is a bonus.

## Time

One week is the overall deadline; 6–10 hours is an effort expectation, not a prohibition on exceeding it. The README explains why this project took longer.
