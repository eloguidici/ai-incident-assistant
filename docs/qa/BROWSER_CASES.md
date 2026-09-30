# Browser and API cases


Snapshot from 2026-09-29. Automation: Playwright with installed Chrome, plus Jest against PostgreSQL. Later runs are in [process/qa-runs](../../process/qa-runs/).

| ID | Case | Result | Where |
|---|---|---|---|
| B01 | Valid login | PASS | `qa/e2e/smoke.spec.ts` |
| B02 | Invalid login | PASS | Same file. Expired session: PASS in Jest, not in the browser |
| B03 | Empty history | PASS | e2e, after resetting the test database |
| B04 | Valid incident and result | PASS | e2e and Jest |
| B05 | Empty and long text | PASS in the API. In the UI the button stays disabled and the textarea has `maxLength` | |
| B06 | Evidence, hypotheses, missing information | PASS | e2e shows evidence and uncertainty |
| B07 | Question | PASS | e2e and Jest |
| B08 | History reload | PASS | e2e reloads the page |
| B09 | Postgres restart | PASS | Row present after `docker restart`. Not repeated from the browser |
| B10 | User B cannot open A's analysis | PASS | e2e and Jest |
| B11 | Timeout | PASS in the API with `[MOCK:timeout]` and a 2.5 s test deadline. Not recorded in the browser | |
| B12 | 429/5xx | PASS in the API for 500 and auth. The provider's 429 has no browser case | |
| B13 | Invalid JSON or schema | PASS in the API | |
| B14 | Concurrent double submit | PASS in the API: 409 and 504. No automated UI double click | |
| B15 | Context over budget | Covered by the `selectContext` unit test and the context-limit integration test | |
| B16 | HTML/script shown as text | PASS | e2e checks the text and that `window.__xss` does not appear |
| B17 | Keyboard and small viewport | NOT_RUN as a dedicated case. Controls are native and the CSS has a 720 px breakpoint | |
| B18 | Cancellation on disconnect | NOT_RUN end to end. The server aborts if the response closes before finishing | |
| B19 | Two simultaneous questions | The unique index returns 409 | |
| B20 | Logs without secrets or text | PASS in Jest | |
| B21 | `/docs/` does not publish the markdown | Partial PASS: `check:web-docs` finds no documents in `apps/web/dist` | |
| B22 | Real provider | BLOCKED on 2026-09-29 (no key); later live samples in process/qa-runs | |
| B23 | Database failure after the model | Covered later by rollback and failure-orchestration tests | |
| B24 | Retention | PASS in Jest: an expired analysis disappears and the rest remain | |
