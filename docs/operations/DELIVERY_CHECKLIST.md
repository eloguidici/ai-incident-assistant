# Delivery checklist and publication policy


Reviewed 2026-10-04, America/Buenos_Aires, against `dev` at `ed4e2f0` and documentation-only changes. This is submission preparation, not a new application regression, fresh installation or production certification. Spanish documents were relocated intact to ignored study storage and removed from the submitted index; no content was discarded.

## What the assessment asks to receive

A GitHub/GitLab repository and a README covering architecture decisions, AI design choices, trade-offs/known limitations and clear local run instructions. The [documentation index](../README.md) maps each explanation in parts 1, 2 and 3 to its public source; the [requirements matrix](../requirements/ASSESSMENT.md) maps functionality.

The original hiring PDF, private interview notes, AI-agent skills and internal task history are not required deliverables. Keep them locally. Do not publish private conversations or real customer data. Optional extras do not become mandatory because this project includes some of them.

## What belongs in the submitted checkout

| Material | Publication rule |
|---|---|
| `apps/`, `services/pii/` | Source, migrations, tests and current offline detector; no local models/caches or credentials. |
| Root README and public `docs/` | English current explanations, contracts, decisions, operational instructions and dated QA summaries. Preserve known FAIL/NO-GO outcomes. |
| `infra/`, Compose, Dockerfiles, `.github/` | Reproducible configuration and the undeployed AWS definition/CI workflow; secret values supplied externally. |
| `scripts/`, public `qa/` | Runners, synthetic fixtures and reproducible historical experiments. `qa/pii-spike` is not the current detector. |
| `.env.example` | Nonsecret template with empty provider keys and explicitly synthetic demo credentials; never an operational secret. Generate a real JWT secret locally. |
| `package-lock.json`, requirements/model locks, `.terraform.lock.hcl` | Publish reproducibility metadata. A lockfile is not Terraform state or downloaded model weights. |

## What stays local

| Material | Existing home or ignore boundary |
|---|---|
| Provider/JWT values, PII HMAC key, certificates | `.env`, other `.env.*` except `.env.example`, `.local/`, private key/certificate export extensions. |
| PDF, extraction, Spanish translations, study guides, defense Q&A, working process | `docs/internal/`; Spanish reference copies are under `docs/internal/estudio/referencia/` and all `*.es.md` are ignored. Existing English-source links remain public. |
| Agent instructions/skills/editor notes | `AGENTS.md`, `.agents/`, `.ai/`, `.cursor/`, local process/tasks. |
| Raw model outputs, private QA notes, traces/videos/screenshots | `qa/local/`, `qa-artifacts/`, comparison evidence, Playwright reports, `output/`, test-results and HAR/log files. Public synthetic fixtures/summaries remain in Git. |
| Dependencies, generated builds, caches/coverage | `node_modules/`, `dist/`, Python caches, coverage and generated TypeScript metadata. |
| Terraform runtime data and database exports | `.terraform/`, state/tfvars/plan files, dump/backup exports. SQL migrations and `infra/docker/init-test-db.sql` remain public. |

Ignoring preserves the file on disk. It does not encrypt it, back it up, prevent `git add -f`, remove an already tracked file or erase an earlier commit. New public certificates/templates need explicit review before an exception is added. Never distribute the whole working folder as a ZIP: it contains ignored private files.

Git and Docker have independent boundaries: root and PII/prototype build contexts also exclude local env files and private certificate/key exports through their `.dockerignore` files. Docs are excluded from application images. This policy review is not a new image build or inspection of existing image layers.

## Git history and a possible clean main delivery

The current tracked tree excludes internal process/agent files and Spanish translations. However, some existed in older commits reachable from the local Git refs. Sharing this repository's history can expose that evolution and those translations even though those paths are ignored now. The bounded credential scan found only the explicit synthetic provider key in a test; this is not exhaustive secret certification or a remote leak audit.

Options, none executed by this organization task:

1. Keep the current repository/history. This preserves provenance and accepts that old process material is visible.
2. Recommended when only the final snapshot should be shared: create a separate delivery repository with one initial commit from reviewed public files. Preserve this development repository and all local material separately. Recheck templates, links, locks and setup in the new checkout. Record the source revision privately.
3. Rewrite the existing repository with a clean root and replace remote refs. This needs explicit authorization, coordination and a force push. A squash merge into an existing `main` alone does not erase its prior history or the commits retained by `dev`, tags or other refs. No operation can guarantee retrieval of copies already obtained by someone else.

The recorded software/model failures still belong in the delivery's dated public summaries; reducing Git history must not turn historical results into invented current PASS claims.

## Status and remaining submission gates

| Area | Status at this review |
|---|---|
| Required explanations | Mapped to public documentation; no mandatory explanatory topic found missing. This is a documentary conclusion, not evaluator approval. |
| Runtime profiles | Base 1,000/500, script 4,000/500 and recorded demo 8,000/1,000 are distinguished. Choose the documented script profile for reproducible handoff; no latency promise for larger inputs. |
| AI/PII limits | Accepted for a synthetic, human-reviewed demonstration only; injection, unsupported claims and partial-name limits remain. No new mitigation requested. |
| Application verification | Dated evidence retained. No fresh full regression, new real-provider calls or first-install run in this documentation task. |
| Infrastructure | Terraform definition and validation procedure delivered; no AWS plan/apply/deployment. |
| Manual acceptance | Procedure available; owner's final personal acceptance is not recorded by this review. |
| Publication | At audit start, remote `dev` matched `ed4e2f0`. These organization changes are not committed/pushed by this task; final target/history choice remains explicit. Remote CI not inspected. |

Before submission:

- [ ] Choose the reviewed final commit and repository/branch/history option. If using this repo, ensure the evaluator opens the intended branch.
- [ ] Review exactly the staged files with `git diff --cached --name-status` and `git diff --cached --check`. Do not force-add ignored files or share local env/key files.
- [ ] Inspect `git ls-files -ci --exclude-standard`; unexpected tracked-but-ignored files need review, not silent removal. Scan secrets in both intended files and reachable history for the chosen repository.
- [ ] Test the selected public checkout's local instructions with new private secrets and synthetic accounts. Do not reset the existing database to simulate installation.
- [ ] Run the documented software checks in an isolated test environment and record the final commit/profile/results. API integration/browser tests can reset test data; real-provider commands can incur charges and require separate intentional execution.
- [ ] Complete personal manual acceptance and verify the CI outcome for the submitted revision. Mocks/valid JSON do not certify real-model fidelity or PII completeness.
- [ ] Commit/push only after review. Do not include application secrets in screenshots, logs or delivery messages.

See root [verification commands](../../README.md#verification) and [manual acceptance](../qa/MANUAL_ACCEPTANCE.md). These are procedures, not newly executed results.
