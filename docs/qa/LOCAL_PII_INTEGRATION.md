# Local PII Integration QA

Verified: 2026-10-02/2026-10-03, America/Buenos_Aires. Branch `dev`, base `2e476c3` plus uncommitted T21/T22 changes.
Status: owner accepted the scoped implementation for a synthetic assessment/demo with documented limitations. Software/browser checks passed; the additional name test remains FAIL. This is not complete privacy or project-release certification.

## Accepted Limitation

The previously skipped real-URL adapter smoke was executed separately after correcting the host profile.
Input `Lucia Exampleperson reported HTTP 503 ...` was returned with `Lucia` replaced but `Exampleperson`
still visible. A second sanitation then replaced that remainder: the operation was not idempotent and
the initial name boundary was incomplete. The original test failed; no fixture, assertion or tier was relaxed.
Core-corpus approval below is narrower and does not override this failure. On 2026-10-03 the owner accepted this limitation and closed T22 for synthetic demonstration scope; real-world failure frequency is unknown.

Do not deploy or present the full layer as privacy-certified. Contacts-only remains explicitly limited to
email/phone; disabling protection permits raw content. No automatic fallback or extra external LLM was added.
Future local checks, specialized PII services, LLM reviewers and guard libraries are outside this exercise's
scope/budget; cost and effectiveness have not been compared. See the [evolution options](../security/PII_IMPLEMENTATION_PLAN.md#accepted-limitation-and-evolution).
Risk acceptance does not turn the test into PASS or authorize confidential real data.

## Executed Results

| Check | Result |
|---|---|
| Typecheck, lint, API/web build, web-document exclusion | PASS |
| API/PostgreSQL | 266 passed, one optional real-URL test skipped in the general run; line coverage 91.43%, branches 73.75% |
| Frontend | 44/44 after updating the obsolete pending-message expectation |
| Mock evaluation | 5/5; no external provider calls |
| General browser / limits / nginx timeout scenarios | 41/41, 6/6, 3/3 |
| Real-service Compose regression | 6/6 |
| Python contracts | 34/34; separate from model quality |
| Real PII UI | Five full-mode flows, contacts, disabled and outage passed; mode-specific exclusions are deliberate |
| Runtime configuration | 1,000/500 limits, retained over-limit drafts and direct server rejection; source/question coverage in all three modes |
| Actual protected DB/log inspection | 22 full-policy analyses checked, zero tested raw sentinels in source/results/messages/error text or supplied service logs |
| Layout | Real screenshots and geometry/contrast at 1440/390/320; mobile screenshots visually reviewed |
| Terraform 1.9.8 | Final `fmt`/`validate` PASS, cached providers, no apply |
| Additional actual Nest HTTP adapter smoke | FAIL: partial synthetic surname and second-pass mutation; not part of the 14-stage browser retest |
| Host-development profile | Startup/published loopback corrected and exercised; normal internal topology restored afterward |

The full `.bat` run at `2026-10-03T02:40:31.431Z` ended **25 stages PASS / two FAIL**:
an old UI expectation and a test confusing character validation (400) with HTTP body size (413).
Failures remain recorded. Frontend retest passed 44/44; the browser-only `.bat` at
`2026-10-03T02:57:35.519Z` ended **14 PASS / zero FAIL**, plus a final full-mode question-limit test.
Subsequent host-profile checks and restored-topology checks are recorded separately; this is not a claim
that the final expanded launcher was rerun completely from the beginning.

## Measured Model Quality

Two fresh-process v5 runs: original core **28/28**, holdout core **15/15**, reserved **3/3**, final **3/3**.
That is **49/49 core cases**, 63/63 exact core entity occurrences, zero core extras/technical losses.
Across all tiers: **57/65 cases**; three obfuscated/zero-width email challenges and five unsupported
address/document/account cases still fail. Two extra detections occur outside core. No tier/fixture was relaxed.
All four conversation checks pass repeated occurrences, turns, existing-label idempotence and scope isolation.
The Node verifier reconstructed 257 outcomes from four reports and confirmed equal fresh-process v5 outputs.

CPU quota: one core; memory limit: 4 GiB. Peak model RSS: about **2,720 MiB**; startup about **18 s**.
First-run short baseline p50/p95: 612/963 ms. A 1,000-character source took **2.52-3.34 s** over four
measurements, with exact replacements and preserved technical facts. These are detector-only observations,
not endpoint percentiles, a provider SLA, or certification of the smaller AWS container budget.

## Reproducible Battery

Run `scripts\qa-local-pii.bat` or `npm run qa:pii` from the repository root. Docker Desktop and installed
Node dependencies are required. The runner uses an isolated test database, real offline local inference
and a mock downstream provider. It makes no paid provider calls, modifies no `.env`, preserves the
development volume/key and restores full protected demo mode after explicit contacts/off scenarios.
Private synthetic logs and JSON summaries are in ignored `qa-artifacts/local-pii`; exact quality reports
are in ignored `qa/pii-comparison/evidence`. Do not commit secrets or real customer content.

Checks cover type/lint/build, API/PostgreSQL coverage, frontend, mock evaluation, browser regression,
limits, proxy deadlines, Python contracts, unchanged-baseline/holdout exact quality, labels/continuity,
full/contacts/disabled UI, outage rejection and desktop/mobile token geometry/contrast.
`--browser-only` reruns only the mode/browser slice and is not a full certification.

## Evidence Boundary

T21's unchanged 38-case Presidio/spaCy baseline remains NO-GO. GLiNER calibration and examined
holdouts are development evidence, not a general accuracy estimate. Additional reserved/final cases
are reported separately. Prior INT8 and 8,000-character latency failures remain failures.
Earlier full-model idempotence failed when the placeholder mask caused a role phrase to be recognized
as a person. The original failure is retained; neutral `person` masking passed both v5 runs and browser retests.

The current candidate uses pinned GLiNER FP32, person-name/context labels at threshold 0.55,
packed 1,000-character inference and a 10 s bounded internal HTTP timeout. Recommended source/question
defaults are 1,000/500. They are configurable limits, not an SLA or coverage guarantee.

## Remaining Limits

Contact-only mode intentionally leaves names visible; disabled mode permits raw content. The UI declares
coverage and combined pending state, never fake stage completion. Failure does not downgrade coverage.
Cross-policy historical records are blocked while protection is enabled; original legacy data is retained.
Names/aliases, unsupported PII, obfuscated contacts and identifying context can remain. HMAC labels are
pseudonymization, not universal anonymization or prompt-injection prevention.

This detector battery made no hosted LLM calls. T25 tested v6/v7 with both providers: [current semantic FAIL](ASSESSMENT_CLOSURE.md). Historical T20 live
quality failures remain open. AWS resources/runtime, external logs, CI and deployment are not certified.
See [design](../decisions/ADR-007-local-pii.md) and [operating instructions](../operations/RUNBOOK.md).

## Subsequent T25 review, 2026-10-03

New full battery:30stagesPASS/1FAIL, exit1. The original real-adapter failure remains
visible and unchanged. Final API313PASS/one optional skip; protected source, real question,
reload and desktop/mobile labels were exercised with OpenAI, not mock. Exact already-
protected quotes no longer re-enter name recognition; generated narrative remains
sanitized and schema/grounding/complete-known-label validation runs afterward. Technical
terms can still produce false positives/rejections; no corpus exceptions were added.
Source misses remain misses. [Current report](ASSESSMENT_CLOSURE.md) preserves the
separate semantic FAIL and before/after evidence.
