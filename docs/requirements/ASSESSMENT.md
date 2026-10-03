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
| R15 | Uncertainty | Evidence vs hypotheses and missing information implemented. Avoiding invented certainty/sources is the goal, not a guarantee: T25 found unsupported inferences; [quality FAIL and decisions](../security/AI_RISK_DECISIONS.md). |
| R16 | Data and architecture | Section 2.1 documentary closure on 2026-10-03: all five topics explained in the [data policy](../security/DATA_POLICY.md), with local protection and accepted synthetic-demo limits; not anonymization or production certification. |
| R17 | Evaluation | Section 2.2 explanatory closure on 2026-10-03: [quality, regressions and wrong answers](../qa/AI_EVALUATION.md), fixtures and corrected/tested rubric. T25 tested v6/v7 with OpenAI/OpenRouter; [semantic quality remains FAIL](../qa/ASSESSMENT_CLOSURE.md), not approved; no complete evaluation system is required. |
| R18 | AWS or mock + IaC | Terraform consistent with the architecture; documented as not deployed. |
| R19 | Secrets and configuration | No real keys in the repository, images, frontend or logs; location, rotation and scaling explained. |
| R20 | Repository and README | Decisions, AI design, trade-offs, limits and verified local instructions. |

## Separate extras

RAG or a vector store, token streaming, tool calling, queues, cost estimates for 1k/10k/100k requests, multi-tenancy and Docker are not mandatory. Docker is included for reproducibility, and a cost estimate is in the README. Isolating data per user is part of basic security, even though multi-tenancy is a bonus.

## Time

One week is the overall deadline; 6–10 hours is an effort expectation, not a prohibition on exceeding it. The README explains why this project took longer.
