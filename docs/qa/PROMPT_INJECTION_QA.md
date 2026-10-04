# Prompt-injection observation QA

Latest real-provider follow-up: [paid GPT via OpenAI and OpenRouter](PROMPT_SECURITY_GPT.md), 15 shared attempts, quality FAIL. Initial local software results below were not rerun during that comparison.

Date: 2026-10-02 (Buenos Aires). Baseline: `dev` / `c167cd2` plus the uncommitted observer changes. Result: **PASS WITH KNOWN RISK for the initial local software regression**. The subsequent [advanced live evaluation](PROMPT_SECURITY_LIVE.md) **FAILED** on the current configured model. No branch switch, commit, push, secret change or cloud deployment.

## Executed verification

| Command / surface | New result |
|---|---|
| `npm run lint` | PASS, API/tests and frontend |
| `npm run typecheck` | PASS, API and frontend/test configuration |
| `npm run build` | PASS, API and React |
| `npm run test:coverage -- --silent` | 140/140, 13 suites; lines 90.28%, branches 68.96%; detector 100% measured code coverage, not detection accuracy |
| `npm run qa:security:signals -- --silent` | 53/53, three suites, included in the 140 above |
| `npm run test:web` | 14/14 |
| `npm run qa:eval` | 5/5 deterministic mock fixtures |
| `npm run check:web-docs` | PASS, three built assets; no internal docs/secret markers |
| `npm run qa:e2e` | 3/3 Chrome smoke flows |
| `npm run qa:e2e:flows` | 41/41 Chrome workflows, including mobile, ownership, retries and invalid output |
| `npm run qa:e2e:flows:limits` | 6/6 across session (2), analysis quota (1), question quota (1), context (1), pagination (1) |
| Docker build API/web with the existing CA overlay | PASS; production dependency install reported zero vulnerabilities; build/dev install reported two moderate findings |
| `npm run qa:e2e:compose` | 6/6 nginx/API/PostgreSQL/React flows, including two new adversarial scenarios |
| `npm run qa:docker:timeouts` | PASS, three Node test results including 35-second success and controlled JSON error at 45 seconds; synthetic upstream, no paid call |
| Container configuration / logs | Confirmed `mock`, `incident_assistant_test`, compiled detector; 25 security events covered all six rules and incident/question/history; no matched excerpts in those events |
| Study-guide Mermaid | Both diagrams parsed/rendered in Chrome at 1440/390 pixels, nonblank, no document horizontal overflow; desktop screenshot inspected |
| Documentation / whitespace | Local targets and bilingual structure checked; `git diff --check` PASS |
| Real provider, remote CI, Terraform/cloud | NOT_RUN during this initial local phase; subsequent real-provider results are in the separate live report; CI/IaC remain historical |

The database was real PostgreSQL 16.10, not an in-memory substitute. Model behavior was a deterministic mock. Docker started with an ignored local QA override pointing only at `incident_assistant_test` and `mock`; the development database/volume were preserved. To reproduce container QA, build with the documented CA overlay if needed and use an equivalent test-only environment before running the Compose tests. Repeated runs should use a fresh mock API process because its quotas are process-local.

## Adversarial coverage

The [fixture catalog](../../apps/api/test/fixtures/prompt-injection.cases.ts) contains 21 attacks, four ordinary inputs, two legitimate reports quoting attacks and six declared evasions. It covers Unicode compatibility/zero-width/accents, whitespace/case, role and delimiter spoofing, prompt disclosure, credential extraction, fabricated grounding and a combined HTML payload. Additional unit checks cover stable deduplication, payload-sized tail scanning, repeated near-matches and closed log metadata.

Nine [API/PostgreSQL scenarios](../../apps/api/test/prompt-injection-api.spec.ts) verify creation, manual retry, follow-up, selected user/assistant history, failed/truncated context exclusion, unchanged provider input, printed-log privacy, no observation before validation/CSRF/ownership rejection, continued output validation and fail-open logging transport. The original prompt-boundary tests remain in the 53-case targeted suite. During test development, incorrect HTTP-status expectations and the mock fault counter's per-prompt behavior were corrected to the established contract; no application contract was changed to make tests pass.

Two new [container browser cases](../../qa/e2e/compose-stack.spec.ts) preserve an invisible-character attack report across reload and exercise layered instructions plus two follow-ups. They check persisted raw text/messages, one attempt per each of three mock executions, no injected script/image DOM, no browser request to the synthetic collector, and retain a synthetic screenshot. They do not prove that a real model resists those instructions.

## Limits and next check

Observation intentionally accepts quoted attack reports and does not stop malicious instructions. Six tests assert known misses (base64, homoglyphs, semantic reformulation, output manipulation, HTML entities, over-bounded gaps); passing them is not successful prevention. Structural/exact quote validation does not certify semantic truth. No representative accuracy rate, false-positive rate, immutable audit, alerting, PII stripping or classifier/LLM judge is implemented. See [current controls and future alternatives](../security/PROMPT_INJECTION.md).

Test output included unsuppressed `MaxListenersExceededWarning` in the API/Supertest run and color-environment warnings in Playwright; exit codes and assertions passed. The listener warning was not diagnosed as a production defect in this scoped change. No dependency upgrades were attempted; two moderate development audit findings remain visible. The authorized follow-up executed 14 real attempts over 13 requests, including a retry: accepted semantic injection and legitimate URL false rejection were found. See the [new live report](PROMPT_SECURITY_LIVE.md). Remediation and a fresh comparison remain pending; review/commit and remote CI are separate. The previous [live sample](LIVE_SUITE.md) remains historical.
