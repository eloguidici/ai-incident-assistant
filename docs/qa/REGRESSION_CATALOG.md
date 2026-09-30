# QA catalog


Snapshot from 2026-09-29. Later runs, including live-model samples and the CI configuration, are recorded in [process/qa-runs](../../process/qa-runs/).

| ID | Flow | Priority | Scenario / result | Surface | Result |
|---|---|---|---|---|---|
| Q01 | F01 | P0 | Valid, invalid and expired login | API/browser | PASS in API and in Chrome |
| Q02 | F02 | P0 | Valid text -> validated, persisted result | Integration/browser | PASS |
| Q03 | F02 | P1 | Empty, oversized and extra field | API | PASS |
| Q04 | F03/F06 | P0 | A cannot read or question B's data | API/browser | PASS |
| Q05 | F03 | P0 | Restart keeps data | Postgres | PASS for one row after `docker restart` |
| Q06 | F04 | P0 | Question and thread order | API/browser | PASS |
| Q07 | F05 | P1 | Invalid JSON, ungrounded quote, 401 and 500 | Mock/API | PASS |
| Q08 | F02 | P1 | Injection and insufficient text in the mock rubric | Evaluation | PASS with mock. Real: BLOCKED on 2026-09-29; later live samples in process/qa-runs |
| Q09 | All | P0 | Secret and text kept out of logs | Integration | PASS |
| Q10 | F05 | P1 | A retry does not delete a success; a failure retries once | API | PASS |
| Q11 | UI | P1 | Loading, error, empty, result | Browser | PASS in the e2e run |
| Q12 | Operation | P0 | Startup with Postgres and migrate | Smoke | PASS for Postgres and the e2e API. Full `docker compose up` not run that day |

## AI evaluations

Five mock fixtures PASS: clear, insufficient, injection, HTML and contradictory. The rubric requires quotes present in the text and uncertainty when there is no evidence. This does not measure the real model.

## Browser cases

The B01–B24 sheet is in [BROWSER_CASES.md](BROWSER_CASES.md).
