# Delivery verification

2026-10-04, America/Buenos_Aires. Reviewed the source tree now recorded in the
cleaned history as `dev/d2129a4`, with the corrections described below. History
filtering preserved that source tree exactly; the corrections are included in
the delivery commit containing this report. This is local software verification,
not production approval, remote CI verification or new real-LLM evaluation.

## Scope and isolation

A fresh remote checkout received a mechanical copy of the corrections. It used
its own Compose project, secrets, PostgreSQL volume and ports, without resetting
the existing demonstration. Test suites reset only its separate test database.
Windows Node 22.21.0/npm 10.9.1 and Linux Docker images were exercised.
The real offline PII service was used for protected browser flows; the downstream
model was always the deterministic mock. No paid provider calls or AWS deployment.

## Corrections

- API and limits regression explicitly select 8,000/1,000-character synthetic
  fixtures. The base API/Compose limits stay 1,000/500 and have independent
  configuration coverage. General regression disables PII; it is not a larger
  real-detector latency or privacy certification.
- Password selectors identify the input exactly, preserving the accessible
  show/hide control. PII browser cases visit the current tabs and verify short
  colored labels, while still checking exact API tokens, absence of originals,
  persistence, incident/user isolation, contrast and layout at 320/390/1440 px.
  The second browser owner stays on the selected `E2E_BASE_URL` stack.
- Synthetic PII responses follow the current protected-contact and trusted-
  sanitizer-label policy. Added assertions prove which rejection stage executes;
  application validators and fail-closed behavior were not relaxed.
- Vitest is pinned to 4.1.11, fixing the development-only advisory
  [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
  Production package versions are unchanged. The audit is a dated check, not a
  permanent guarantee of absence of vulnerabilities.
- Compose selects `linux/amd64` for the locked x86_64 PII wheel. ARM emulation
  requirements are documented; native ARM/emulated latency were not tested.
- React uses system fonts without external font requests or relaxing CSP.
  Documentation and tests clarify explicit `.env` deadline precedence over the
  OpenRouter overlay's fallback. Operator overrides are preserved.

## Executed results

| Check | Result and scope |
|---|---|
| Fresh `npm ci` | PASS in the isolated checkout; primary dependency reinstall also PASS. |
| `npm audit` | Zero reported vulnerabilities, including development dependencies. |
| Lint / typecheck / build | PASS for API and React; Linux API/web/PII image build and healthy Compose startup PASS. |
| API coverage | 20 suites PASS; 339 tests PASS, one optional actual-detector HTTP smoke skipped (340 total). Real detector flows were exercised separately through Compose. Statements 89.98%, branches 75.33%, functions 90.22%, lines 91.61%. |
| Frontend | 8 files / 54 tests PASS with Vitest 4.1.11; repeated in the primary workspace. HTTP is mocked. |
| General browser | 45/45 PASS, repeated after the additional QA repairs; mock provider, PII disabled. |
| Limits browser | 6/6 PASS: expiry/lockout, analysis quota, question quota, context budget and pagination. |
| Demo browser | 1/1 PASS with synthetic data and mock provider. |
| nginx/Compose browser | 6/6 PASS with real PII and mock provider; no Google font requests or CSP console errors observed in the page-load check. |
| Real PII browser, full mode | 5 PASS / one mode-inapplicable skip: English, Spanish, mixed language, owner/incident isolation and full coverage/limits. |
| Contacts-only / disabled / outage | Each dedicated profile: one PASS / one mode-inapplicable skip. Outage leaves coverage enabled and creates no incident. Disabled mode is explicitly unprotected, not a fallback. |
| PII service contracts | 47/47 PASS offline; synthetic detector doubles do not certify model quality. |
| Proxy/platform configuration | 4/4 PASS, including 35-second synthetic success and controlled JSON 504 at the 45-second deadline. No actual OpenRouter request. |
| Mock evaluation | 5 fixtures / 30 checks PASS, not semantic evaluation of a real model. |
| React build boundary | PASS: three build files, no internal documents or secret markers. |

Initial failed runs were retained locally: the limits suite correctly rejected a
3,138-character fixture under the old 1,000-character test profile; four PII
browser checks still expected the old raw-token/always-visible interface.
Corrected reruns above do not erase these diagnostic failures or older reports.

On the loaded 1-CPU host, the first cached-model startup exceeded a 180-second
Compose wait. A longer 600-second readiness wait completed without changing
protection. Startup time is not request latency or an under-10-second guarantee;
see the [runbook](../operations/RUNBOOK.md). Terraform files are unchanged; their
Linux 1.9.8 `fmt`, `init` and `validate` passed in the preceding same-day review.
No Terraform `plan`/`apply` or AWS runtime test was performed.

## Remaining submission gates

The exercised local software gates pass. The following remain separate:

- The owner's personal manual acceptance. History cleanup and publication are
  separate from the runtime checks above; they do not count as another full
  software, detector-quality or real-provider evaluation.
- Remote CI and evaluator access for the exact published reference. Inspect its
  GitHub Actions result independently; the local results above do not imply CI PASS.
- Accepted injection, unsupported-conclusion and partial-name limitations remain
  synthetic-demo risks. This pass does not replace the retained real-model FAIL
  results or re-run the detector quality corpus. See [risk acceptance](../security/AI_RISK_DECISIONS.md#demonstration-risk-acceptance)
  and [PII limitation](LOCAL_PII_INTEGRATION.md#accepted-limitation).

Published branch history was filtered on 2026-10-04 to remove historical private
process/study paths and development-session metadata, while preserving technical
history and dated QA outcomes. A recovery backup stays outside the repository.
The bounded historical scan found no exact matches for the current local secrets;
it is not exhaustive credential certification. Existing platform caches or copies
cannot be certified erased. See the [current delivery checklist](../operations/DELIVERY_CHECKLIST.md#repository-contents-and-runtime-boundary).
