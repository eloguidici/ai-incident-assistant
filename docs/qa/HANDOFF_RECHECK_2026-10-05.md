# Handoff recheck

2026-10-05, America/Buenos_Aires. Application source baseline: `d369559`.
This handoff adds documentation only. The owner reports personal manual acceptance
complete; the independent checks below have their own bounded scope.

## Environment and boundaries

Windows Node 22.21.0, Chrome/Playwright and Docker Linux containers. General API
and browser regression used `incident_assistant_test`, mock AI and disabled PII.
The real browser sample used the existing `incident_assistant` database through
nginx at localhost:8080, with OpenAI and the real local detector. Development
data, private environment and HMAC key were preserved; no volume reset was run.

The documented launcher rebuilt API, web and PII, selected `gpt-4o-mini`, full
protection, 4,000/500 characters, four detector threads/CPU quota, a 9.5-second
protection timeout, 45-second API deadline and 60-second proxy wait. The returned
model identifier was `gpt-4o-mini-2024-07-18`; prompts remain v7/v9. The first
uncached detector dependency/model build stage took about 993 seconds. Build and
startup time are separate from request latency; readiness completed successfully.
The old running web image still referenced an external font; the rebuilt current
image uses the already-corrected system-font source, without changing application
code or relaxing CSP.

## Executed software checks

| Check | Result and scope |
|---|---|
| Lint / types / API and web build | PASS. |
| API coverage | 20 suites; 339 PASS, one optional actual-detector HTTP smoke skipped. Line coverage 91.84%. Real protection was exercised separately below. |
| Frontend unit tests | 8 files / 54 PASS, HTTP mocked. |
| General browser regression | 45/45 PASS, isolated test database, mock provider and disabled PII. |
| Limits browser | 6/6 PASS in the final sequential run: session expiry/lockout, analysis/question quotas, context and pagination. |
| Demo browser | 1/1 PASS in the final isolated run, mock AI. |
| PII contracts | 47/47 PASS offline, current source mounted read-only into the detector image; synthetic detector doubles, not model-quality certification. |
| Proxy/platform checks | 4/4 PASS, including 35-second synthetic success and controlled deadline JSON 504. |
| Mock evaluation | Five fixtures / 30 checks PASS, not real-model semantic evaluation. |
| Dependency audit | Zero reported vulnerabilities at this run. |
| React build boundary | PASS: three build files, no internal documents or secret markers. |
| Terraform | Format PASS; validate PASS with Linux 1.9.8 and cached providers, without network, plan, apply or AWS credentials. |
| Documentation | Public local links/anchors, startup PowerShell syntax and source/wording checks passed; original bilingual private question labels unchanged. |

Initial diagnostics remain separate: the temporary browser configuration first
used an incorrect working directory; it was corrected locally before regression.
A demo/limits overlap shared a test port and consumed an analysis quota, producing
an early limits failure; evidence was retained and both suites were rerun
sequentially. No application expectation, quota or validator was weakened.
Native Windows Terraform 1.16.2 could not load the AWS plugin schema; the Linux
1.9.8 validation above passed. Browser-observer syntax/stale references and an
incorrect question-response filter were corrected or diagnosed locally; the actual
question POST returned 200 and its persisted conversation was checked after reload.

## Real browser sample

Two synthetic incident submissions and one follow-up question were sent through
the UI to OpenAI. This is not a new full quality corpus or an OpenRouter rerun.

1. **Observed outage, unknown cause and synthetic contact:** HTTP 200/completed.
   Input name/email became scoped protected tokens; the Incident tab displayed
   colored Person/Email labels without the original values. Summary retained the
   unknown cause. The follow-up completed through `/messages`, and analysis plus
   conversation persisted after reload and appeared in History.
2. **Contradictory HTTP 200/503 observations:** HTTP 200/completed. Output retained
   both observations and uncertainty instead of inventing a confirmed resolution.
3. **Second owner:** after logout/login with the other synthetic account, opening
   the first owner's detail returned 404/NOT_FOUND and showed the safe not-found
   alert without incident content.
4. **Presentation:** protected desktop source and 390-pixel mobile result were
   visually checked; mobile document width equaled viewport width, without
   horizontal overflow. Fresh normal navigation had no font/CSP error; the only
   captured console error was the expected unauthorized-owner 404.

The two measured button-click-to-response/navigation intervals were approximately
8.225 and 8.253 seconds. These are two local observations, not per-step protection
measurements, capacity certification or an under-10-second SLA.

## Quality observations and acceptance

Workflow verification passes with known synthetic-demo risks; semantic quality is
not certified. The outage response included an evidence note saying that no
deployment during the interval rules out recent deployments as a cause. That is
stronger than the supplied evidence: an earlier deployment is not ruled out.
The contradictory-input response also proposed overload/maintenance with medium
confidence without case-specific supporting evidence. Labels and uncertainty
make these hypotheses visible; they do not prove the reasoning correct.

These observations remain within the already documented unsupported-conclusion
limit, not newly repaired behavior. Injection and partial-name limitations remain
accepted only for synthetic, human-reviewed demonstration. This sample does not
approve confidential-data production use, certify injection immunity or replace
historical FAIL reports. See [risk decisions](../security/AI_RISK_DECISIONS.md).

Private guides, raw browser evidence, environment/key files and temporary runners
remain excluded from Git. Bounded publication checks found no exact operational
credential matches in intended files; explicit synthetic test credentials were
classified separately. This is not exhaustive leak certification.

## Publication verification

Commit/push and exact-reference CI are separate from these local results. Check
the submitted branch tip and its [GitHub Actions workflow](https://github.com/eloguidici/ai-incident-assistant/actions/workflows/ci.yml)
after publication. CI uses mock evaluation and validates Terraform; it does not
repeat paid model calls or deploy AWS. Repository visibility/access remains an
owner-controlled submission step.
