# Delivery checklist

Updated 2026-10-05, America/Buenos_Aires. This guide helps reviewers prepare and
verify the local assessment. Start with the [root README](../../README.md#local-setup).
The [latest handoff report](../qa/HANDOFF_RECHECK_2026-10-05.md) records executed
checks; instructions below are not additional test results or production approval.

## What the assessment asks to receive

A GitHub/GitLab repository and a README covering architecture decisions, AI
design choices, trade-offs/known limitations and clear local run instructions.
The [documentation index](../README.md) maps each requested explanation; the
[requirements matrix](../requirements/ASSESSMENT.md) maps functionality.
Optional extras are identified separately and do not become required features.

## Prepare a local review

1. Clone the submitted revision and use Node.js 22 plus Docker's Linux engine.
   The detector targets Linux x86_64 and needs memory/download capacity described
   in the README; first model/dependency preparation can take several minutes.
2. Follow [private configuration setup](../../README.md#prepare-private-local-configuration):
   preserve an existing environment, generate a strong JWT secret and supply only
   the selected provider's key. Never commit credentials or share environment dumps.
3. Select an explicit [provider/model profile](../../README.md#real-provider-demo-powershell).
   The script uses full protection and 4,000/500 characters; base API/Compose
   defaults are 1,000/500. Historical 8,000/1,000 measurements are a different profile.
4. Check service readiness and sign in with the documented synthetic demo accounts.
   Use only synthetic incident data; existing volumes/history are preserved.
5. Create an analysis, ask a question, reload/history-check persistence and use the
   second account to check owner isolation. Review evidence, hypotheses and
   uncertainty rather than treating a completed request as a verified root cause.
6. Use the [verification commands](../../README.md#verification) with a separate
   test database. Integration/browser tests reset test data; real-provider QA may
   incur charges. The [runbook](RUNBOOK.md) covers readiness, failures and TLS.

## Repository contents and runtime boundary

| Material | Role |
|---|---|
| `apps/`, `services/pii/` | Application source, migrations, tests and the current local detector. |
| README and `docs/` | Assessment explanations, contracts, decisions, instructions and dated evidence. |
| `infra/`, Compose and `.github/` | Local containers, undeployed AWS definition and verification workflow. |
| `scripts/`, `qa/` | Test runners and synthetic fixtures; experiment boundaries are in the [evidence index](../qa/README.md#experiments-and-evaluation-tooling). |
| Dependency/model/provider locks | Reproducibility metadata, not downloaded models or Terraform state. |
| `.env.example` | Nonsecret configuration template with empty provider keys and explicitly synthetic accounts. |

Operational secrets, database exports, local traces, caches and generated builds
are not delivery artifacts. Git ignore is not encryption or exhaustive leak
protection. Application images exclude documentation; the frontend serves its
build, not repository files. Never distribute an entire configured working folder.

## Status and remaining submission gates

| Area | Recorded status |
|---|---|
| Required explanations | All requested topics mapped to public documentation; not evaluator approval. |
| Local installation | Separate-checkout installation recorded on 2026-10-04; later rebuilt-stack checks have their own scope. |
| Software checks | Repeated local regression passed on 2026-10-05; see exact counts and exclusions in the handoff report. |
| Browser and real model | Two OpenAI analyses, one question, persistence, PII labels and owner isolation exercised on 2026-10-05. |
| Personal manual acceptance | Owner reports completion on 2026-10-05; separate from automated checks. |
| AI/PII limitations | Injection, unsupported conclusions and partial-name limits accepted only for a synthetic, human-reviewed demo. Historical FAIL/NO-GO remains visible. |
| Infrastructure | Terraform definition and local validation delivered; no AWS plan/apply/deployment. |
| Remote CI | Not certified for the final submitted revision. Hosted-runner availability is separate from local results; inspect the exact run rather than infer success. |
| Reviewer access | Repository access/visibility must be provided by the owner before submission. |

Recorded local acceptance:

- [x] Provide the requested explanations and reproducible setup/verification instructions.
- [x] Run local software checks and record profiles, scope and known failures.
- [x] Exercise synthetic real-provider browser workflows and preserve semantic limits.
- [x] Record the owner's personal manual acceptance.
- [x] Deliver the infrastructure proposal without claiming a working AWS deployment.

Before sharing the final repository link:

- [ ] Confirm the intended published `main` revision and grant reviewer access.
- [ ] Inspect its [CI result](https://github.com/eloguidici/ai-incident-assistant/actions/workflows/ci.yml).
  If unavailable or failed before execution, state that separately; do not call it PASS.
- [ ] Recheck local behavior if application, dependencies or configuration change.
  Documentation-only edits require link/content checks, not invented new runtime results.

See [current evidence and historical reports](../qa/README.md). Local acceptance
does not certify semantic correctness, universal PII protection or production capacity.
