# Delivery checklist and publication policy


Updated 2026-10-04, America/Buenos_Aires: [local software verification](../qa/DELIVERY_VERIFICATION.md)
passed against the source tree now recorded as `dev/d2129a4` and the corrections
included with this report. History cleanup preserved that source tree. Publication
does not certify remote CI, personal manual acceptance or production.
The original documentation-organization review used `ed4e2f0`; Spanish documents
were relocated intact to ignored study storage and removed from the submitted
index, without discarding their content.

2026-10-05 follow-up: the owner reports personal manual acceptance complete. The
[handoff recheck](../qa/HANDOFF_RECHECK_2026-10-05.md) records repeated local checks,
rebuilt images and a bounded OpenAI browser sample with known quality limits.
The earlier review below retains its dated scope; exact submitted-reference CI
and final repository visibility/access must still be checked after publication.

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

The current tracked tree excludes internal process/agent files and Spanish translations. On 2026-10-04, the owner authorized filtering both published branch histories: 119 historical private paths and development-session/coauthor metadata were removed. Technical commits, real owner identity/dates and public dated failures were retained. The filtered `dev` tip kept an identical source tree. A verified recovery bundle and local study material remain outside the submitted checkout. This was selective history filtering, not a fabricated single initial commit.

The bounded historical scan found no exact matches for current local secrets. This is not exhaustive secret certification or a remote leak audit. Rewriting branches does not guarantee erasure of cached old commit views, forks or copies. Never publish the recovery backup or use a mirror push from a development workspace with private refs.

Publication approaches and their differences:

1. Keep an unfiltered development history. This preserves provenance and accepts that old process material is visible.
2. Recommended when only the final snapshot should be shared: create a separate delivery repository with one initial commit from reviewed public files. Preserve this development repository and all local material separately. Recheck templates, links, locks and setup in the new checkout. Record the source revision privately.
3. Filter the existing repository history and replace the affected remote refs. This was authorized and executed for `dev` and `main`; it preserves the technical evolution but removes scoped private files/metadata. A clean root is a different, more destructive choice. A squash merge into an existing `main` alone does not erase prior history or commits retained by other refs.

The recorded software/model failures still belong in the delivery's dated public summaries; reducing Git history must not turn historical results into invented current PASS claims.

## Status and remaining submission gates

| Area | Status at this review |
|---|---|
| Required explanations | Mapped to public documentation; no mandatory explanatory topic found missing. This is a documentary conclusion, not evaluator approval. |
| Runtime profiles | Base 1,000/500, script 4,000/500 and recorded demo 8,000/1,000 are distinguished. Choose the documented script profile for reproducible handoff; no latency promise for larger inputs. |
| AI/PII limits | Accepted for a synthetic, human-reviewed demonstration only; injection, unsupported claims and partial-name limits remain. No new mitigation requested. |
| Application verification | Current isolated software regression, installation and real-PII browser/modes PASS; see the dated verification report. Real-provider/quality-corpus failures remain; no new paid calls. |
| Infrastructure | Terraform definition and validation procedure delivered; no AWS plan/apply/deployment. |
| Manual acceptance | Owner reports completion on 2026-10-05; independently exercised browser checks are in the handoff recheck, not universal quality certification. |
| Publication | Historical cleanup is complete. Public corrections accompany this delivery; the owner authorized the same final revision on `dev` and `main`. Verify actual branch tips and CI/access for the submitted reference. |

Before submission:

- [x] Choose the publication approach: selectively filtered history, with the reviewed public corrections delivered on `dev` and `main`. Verify their actual remote tips before handing over the link.
- [ ] Review exactly the staged files with `git diff --cached --name-status` and `git diff --cached --check`. Do not force-add ignored files or share local env/key files.
- [ ] Inspect `git ls-files -ci --exclude-standard`; unexpected tracked-but-ignored files need review, not silent removal. Scan secrets in both intended files and reachable history for the chosen repository.
- [x] Test local installation with new private secrets and synthetic accounts in a separate checkout/project. Existing database preserved; recheck access/installation for the final published reference.
- [x] Run local software checks in the isolated environment and record the base revision, uncommitted patch and profiles. Reverify if application/dependency/configuration changes follow; API/browser tests reset test data and paid commands require intentional execution.
- [x] Complete personal manual acceptance: reported by the owner on 2026-10-05.
- [ ] Verify the CI outcome for the submitted revision after publication. Mocks/valid JSON do not certify real-model fidelity or PII completeness.
- [ ] Verify the final publication after review. Do not include application secrets in screenshots, logs or delivery messages.

See root [verification commands](../../README.md#verification) and [manual acceptance](../qa/MANUAL_ACCEPTANCE.md). These are procedures, not newly executed results.
