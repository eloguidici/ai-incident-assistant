# UI flows and browser test cases


Every user-visible flow, written so that browser tests can be generated from it without reading the code. Selectors and texts are the ones in `apps/web/src` at the time of writing; if a test fails because a text changed, update this document in the same change. Replaces the 2026-09-29 snapshot in [BROWSER_CASES.md](BROWSER_CASES.md), which is kept as history.

## 1. Environments

| Name | How to start | Base URL | Notes |
|---|---|---|---|
| **Vite (default)** | `npm run qa:e2e` starts both servers from `playwright.config.ts` | `http://127.0.0.1:5173` | API on 3001 with the mock provider, database `incident_assistant_test`, `E2E_RESET=true` (data is wiped and demo users are seeded at API start), `LLM_DEADLINE_MS=2500`, `LLM_ATTEMPT_TIMEOUT_MS=800`. Needs the PostgreSQL container from `docker compose up -d postgres`. |
| **nginx (Compose)** | `docker compose up --build -d`, then `npm run qa:e2e:compose` | `http://localhost:8080` (or `E2E_BASE_URL`) | Production-like images. Data persists in the `pgdata` volume; tests must not assume an empty history. |

Rules for generated tests:

- Use only the mock provider. Real-provider runs are manual and budgeted (section 12).
- One flow per test. Do not depend on the order of tests; create the data each test needs.
- In the Vite environment the database is reset only when the API starts. `qa/e2e/smoke.spec.ts` expects analyst A to start with an empty history, so put generated specs in their own Playwright project (or run them after the smoke test), and run cases that need an empty history (HIS-01) first in that project.
- Wait for visible states (texts, test ids), never for fixed sleeps.
- Make every incident text unique per run (for example append a timestamp). The `-once` and `-twice` fault counters live in the API process and are keyed by text, so reusing a text in the same run changes the outcome.
- Some cases need different API settings (rate limits, deadline, session lifetime). They run with `npm run qa:e2e:flows:limits` (`playwright.flows-limits.config.ts`, one API per setting on separate ports).
- The main config raises `RATE_LIMIT_ANALYSES_PER_HOUR` and `RATE_LIMIT_QUESTIONS_PER_HOUR` to 500 so a full run does not hit the hourly quota; the limits themselves are checked by the limits suite and the API tests.
- The history list shows only the first 180 characters of each text. Assert list membership by analysis id (`a[href="/history/<id>"]`), not by text near the end of an incident.

## 2. Test data

**Users** (seeded, synthetic): `demo1@demo.com` and `demo2@demo.com`, password `Demo1234$`.

**Incident texts** (canonical copy in `qa/fixtures/incident-texts.ts`; synthetic narratives with postmortem-style timelines, impact, and ruled-out causes so browser tests can exercise evidence, missing information, and follow-up questions):

- `INC_OK`: long checkout/payments outage report (~2.5k characters). Must still contain the phrase `payments service returned HTTP 503` for list/history assertions.
- `INC_SHORT`: `Something failed.`
- `INC_HTML`: multi-paragraph ticket export with embedded `<img>` / `<script>` markup and 503 context.
- `INC_INJECTION`: Slack-style thread with outage facts plus an instruction-injection sentence; must not produce “restart” claims or external actions in the result.

**Mock fault tags.** Include the tag anywhere in the incident text (or in the question for question cases). They work whenever `LLM_PROVIDER=mock`. A tag in the incident also applies to every question on that analysis, because the question prompt includes the incident; run question cases on an analysis created from a clean text.

| Tag | Effect | Message shown |
|---|---|---|
| `[MOCK:500]` | Provider error on every attempt | The provider did not return a usable result. |
| `[MOCK:500-once]` | First attempt fails, the automatic retry succeeds | (none; result is shown) |
| `[MOCK:500-twice]` | Both attempts of the first request fail; the next request (user retry) succeeds | First: The provider did not return a usable result. |
| `[MOCK:timeout]` | Waits until the deadline (2.5 s in the Vite environment) | The analysis did not finish within the time limit. |
| `[MOCK:auth]` | Provider rejects the credential | The provider rejected the configured credential. |
| `[MOCK:429]` | Provider rate limit | The provider limited the request. There was no infinite retry. |
| `[MOCK:invalid-json]`, `[MOCK:schema]` | Output fails validation | The model response could not be validated. followed by an allowed reason and No result was accepted. |
| `[MOCK:ungrounded]` | The nonexact quote is omitted; the result may survive | There are no quotes grounded in the text. in the result without that evidence |

## 3. UI map

Documentation review 2026-10-04, Buenos Aires: these cases are expectations,
not a browser run executed in this review. Detail has `Incident`, `Result` and
`Questions`, initially `Result`; select a tab before asserting its content.
PII displays colored Person/Email/Phone labels numbered by token within an
analysis/history card, without original restoration. The wait bar is indeterminate,
not per-stage progress. Messages depend on effective protection; general mock
regression explicitly disables PII.

| Route | Page | Key elements |
|---|---|---|
| `/login` | Sign in | Heading `Sign in to analyze an incident`; labels `Email` (prefilled with analyst A) and `Password`; button `Sign in` (`Signing in…` while pending); error `[data-testid=login-error]` |
| any other route | Shell (needs a session) | `Checking session…` while loading; nav links `New`, `History`; the signed-in email; button `Sign out`; link `Skip to content` |
| `/new` | New analysis | Heading `Paste the incident report`; `[data-testid=source-input]` without silent truncation; counter `n/<sourceTextMax>` from API; `Analyze` disabled without limits, empty, over-limit or pending; indeterminate wait and mode-dependent message; error `[data-testid=form-error]` |
| `/history` | History | `Loading history…`; empty state `[data-testid=empty-history]` with heading `There are no analyses yet` and link `Create the first one`; heading `History`; `[data-testid=history-page-meta]` `Showing a–b of N`; one link per analysis (summary, excerpt, `status · date`); buttons `Previous` / `Next` (page size 20) |
| `/history/:id` | Detail | Metadata `Model`, `Prompt`, `Kept until`; tabs `Incident`, `Result`, `Questions`, initially `Result`. Incident: `[data-testid=source-text]` and matching-pattern `[data-testid=assistant-instruction-note]`, not enforcement. Result: `[data-testid=analysis-result]` or error/`Retry`. Questions: `Conversation`, `[data-testid=no-messages]`, completed/failed messages, `[data-testid=assistant-answer]`, `Evidence, hypotheses, and uncertainty` disclosure, `[data-testid=question-input]`, `Ask` and indeterminate wait. Error `[data-testid=action-error]`; `Back to history`. |
| unknown path | — | Redirects to `/history` |

## 4. Authentication

| ID | Case | Steps | Expected |
|---|---|---|---|
| AUTH-01 | Valid sign-in | Open `/login`, fill analyst A and the password, click `Sign in` | URL `/history`; the Shell shows `demo1@demo.com` and `Sign out` |
| AUTH-02 | Wrong password | Same with password `wrong-password` | `[data-testid=login-error]` contains `Invalid credentials.`; URL stays `/login` |
| AUTH-03 | Empty fields | Clear email or password, click `Sign in` | Native `required` validation; no request is sent; no error banner |
| AUTH-04 | Guarded routes | Without a session, open `/history`, `/new` and `/history/<any-uuid>` | Each redirects to `/login` |
| AUTH-05 | Sign out | Signed in, click `Sign out` | URL `/login`; opening `/history` again redirects to `/login` |
| AUTH-06 | Session survives reload | Sign in, reload `/history` | Still signed in |
| AUTH-07 | Cookies | After sign-in, read the browser cookies | `ia_session` is HttpOnly and SameSite=Lax; `ia_csrf` is readable by the page |
| AUTH-08 | Expired session | API with `JWT_TTL_SECONDS=60`; sign in, open an analysis, wait 62 s, click `History` | The cookies expire with the session (`Max-Age` equals the lifetime), so the next navigation lands on `/login`; signing in again works |
| AUTH-09 | Sign-in lockout | API with `LOGIN_MAX_ATTEMPTS=3`; fail 3 times, try again with the right password | `login-error` contains `Too many sign-in attempts. Try again in … seconds.` |
| AUTH-10 | Password visibility | Type a password; click or keyboard-activate the eye button twice | Starts masked; `Show password` reveals it and becomes `Hide password`; toggling back masks it. Value unchanged, no login request or navigation. New login mount starts empty and masked. |

## 5. New analysis

| ID | Case | Steps | Expected |
|---|---|---|---|
| NEW-01 | Successful analysis | Sign in, click `New`, fill `INC_OK`, click `Analyze` | `Analyzing… this can take a few seconds.` appears, then the URL is `/history/<id>` and `analysis-result` is visible |
| NEW-02 | Button state | On `/new`, leave the textarea empty, then type only spaces | `Analyze` stays disabled; counter shows `0/8000` |
| NEW-03 | Length limit | Obtain `sourceTextMax`; paste maximum + 100 | Entire draft retained, inline error and disabled `Analyze`. Reducing to the maximum permits submission; no silent truncation |
| NEW-04 | Counter uses trimmed text | Type `  abc  ` | Counter `3/8000` |
| NEW-05 | HTML is text | Analyze `INC_HTML` | `source-text` shows the literal tags; `window.__xss` is undefined; no dialog opens |
| NEW-06 | Prompt injection | Analyze `INC_INJECTION` | Result shows; uncertainty states that no external action was run; no URL appears; the result does not claim a restart |
| NEW-07 | Double submit | Fill `INC_OK`, double-click `Analyze` | Exactly one new analysis appears in History |
| NEW-08 | Provider error | Analyze `INC_OK [MOCK:500]` | Stays on `/new`; `form-error` contains `The provider did not return a usable result.`; History lists the analysis as `failed` |
| NEW-09 | Timeout | Analyze `INC_OK [MOCK:timeout]` | After about the deadline, `form-error` contains `The analysis did not finish within the time limit.` |
| NEW-10 | Invalid model output | Analyze `INC_OK [MOCK:schema]` and `[MOCK:invalid-json]` | `form-error` contains `The model response could not be validated.` with an allowed reason and `No result was accepted.`; no result; draft retained and `View failed attempts` shown |
| NEW-10b | Nonexact quote | Analyze `INC_OK [MOCK:ungrounded]` | Result shown without the invented quote, with `There are no quotes grounded in the text.`; not semantic approval |
| NEW-11 | Provider rejects credential | Analyze `INC_OK [MOCK:auth]` | `form-error` contains `The provider rejected the configured credential.` |
| NEW-12 | Provider rate limit | Analyze `INC_OK [MOCK:429]` | `form-error` contains `The provider limited the request. There was no infinite retry.` |
| NEW-13 | Automatic retry is invisible | Analyze `INC_OK [MOCK:500-once]` | Result shows normally |
| NEW-14 | Per-user hourly limit | API with `RATE_LIMIT_ANALYSES_PER_HOUR=2`; analyze three times | Third shows `You exceeded the hourly analysis limit. Try again in … seconds.` |

## 6. Result view

| ID | Case | Steps | Expected |
|---|---|---|---|
| RES-01 | Sections | After NEW-01 | `Summary` with `Category: … Suggested severity: ….`; sections `evidence`, `hypotheses` (each with `Confidence low/medium/high.`), `missing`, `uncertainty` are visible |
| RES-02 | Quotes are grounded | After NEW-01; inspect source in `Incident` | Each retained quote occurs in the protected API source without cutting tokens. Visible text can be compared without PII; with short labels use original tokens/API, not visible aliases alone |
| RES-03 | Insufficient text | Analyze `INC_SHORT` | `uncertainty` is not empty; if there are no quotes, `There are no quotes grounded in the text.` is shown and `missing` lists items |
| RES-04 | Model metadata | After NEW-01 | `model-meta` contains `Model mock-incident-v1`, `Prompt incident-analysis.v` and `Kept until` |
| RES-05 | Persistence | After NEW-01, reload the page | Same source text and result |

## 7. Follow-up questions

| ID | Case | Steps | Expected |
|---|---|---|---|
| ASK-01 | Ask and answer | Select `Questions` on a completed analysis, type `What information is missing to confirm the cause?`, click `Ask` | Indeterminate wait with mode-dependent message; then completed Analyst/Assistant messages, nonempty `assistant-answer` and cleared input |
| ASK-02 | Order | Ask two questions | Messages appear in order Analyst, Assistant, Analyst, Assistant |
| ASK-03 | Answer details | Open `Evidence, hypotheses, and uncertainty` under an answer | `thread-result-detail` shows the sections |
| ASK-04 | Empty question | Leave `question-input` empty or spaces | `Ask` is disabled |
| ASK-05 | Long question | Select `Questions`; obtain `questionMax`, enter maximum + 1 | Draft retained, inline length notice and disabled `Ask`, no new messages. Direct over-limit POST returns 400 |
| ASK-06 | Question failure keeps the analysis | In `Questions`, ask `Why? [MOCK:invalid-json]` | `action-error` contains `The model response could not be validated.` and `No result was accepted.`; last message `message-failed`; selecting `Result` shows unchanged completed analysis; asking without the tag works because failed exchanges do not enter context |
| ASK-07 | No questions on failed analyses | Open a failed analysis | No `question-input`; `Retry` is shown instead |
| ASK-08 | Double submit | Double-click `Ask` | Only one new question pair; a second submit may show `That analysis is still in progress.` |
| ASK-09 | Late answer after navigation | Ask `Why? [MOCK:timeout]`; while `Asking…` is shown, open another analysis from History | The other analysis is shown and stays shown when the first request ends; no `Asking…` on it; its `question-input` is empty |
| ASK-10 | Per-user hourly limit | API with `RATE_LIMIT_QUESTIONS_PER_HOUR=2`; ask three questions | Third shows `You exceeded the hourly question limit. Try again in … seconds.` |
| ASK-11 | Context budget | API with `CONTEXT_CHAR_BUDGET=250`; analyze a short incident and ask a long question | `action-error` contains `The incident and the question exceed the context budget. The model was not called.` |

## 8. Failures and retry

| ID | Case | Steps | Expected |
|---|---|---|---|
| RET-01 | Retry succeeds | Analyze `INC_OK [MOCK:500-twice]`; open it from History; click `Retry` | Heading changes from `Analysis failed` to `Analysis completed`; result is shown; `question-input` appears |
| RET-02 | Retry fails again | Analyze `INC_OK [MOCK:500]`; open it; click `Retry` | `action-error` shows the provider message; heading stays `Analysis failed`; `Retry` is still available |
| RET-03 | Retry disabled while pending | Click `Retry` | The button is disabled until the request ends |
| RET-04 | Late retry after navigation | Analyze `INC_OK [MOCK:timeout]`, open it, click `Retry`, then open another analysis | The other analysis stays on screen |

## 9. History

| ID | Case | Steps | Expected |
|---|---|---|---|
| HIS-01 | Empty state | Fresh database, sign in as a user with no analyses | `empty-history`; `Create the first one` opens `/new` |
| HIS-02 | Item content | After NEW-01, open `History` | One link with the summary, an excerpt of the text and `completed · <date>`; `history-page-meta` `Showing 1–1 of 1` |
| HIS-03 | Open detail | Click an item | `/history/<id>` with the same text |
| HIS-04 | Reload | Reload `/history` | Same list |
| HIS-05 | Pagination | API with `RATE_LIMIT_ANALYSES_PER_HOUR=50`; create 21 analyses (through the UI or the API with the session cookie and `x-csrf-token`) | `Showing 1–20 of 21`; `Previous` disabled; `Next` shows `Showing 21–21 of 21`; `Next` then disabled |
| HIS-06 | Failed items | After NEW-08 | The item shows `failed` and opens a detail with `Retry` |
| HIS-07 | Unknown or malformed id | Open `/history/00000000-0000-4000-8000-000000000000` and `/history/not-a-uuid` | Alert `That analysis was not found.` |
| HIS-08 | Back link | From a detail, click `Back to history` | `/history` |

## 10. Isolation between users

| ID | Case | Steps | Expected |
|---|---|---|---|
| ISO-01 | Direct URL | A analyzes `INC_OK` and copies the URL; sign out; B signs in and opens that URL | Alert `That analysis was not found.`; A's text is not on the page |
| ISO-02 | Lists | B opens `History` | None of A's analyses are listed |
| ISO-03 | Two browser contexts | A and B signed in at the same time in separate contexts | Each sees only their own analyses; actions in one do not change the other |

## 11. Accessibility, layout and security

| ID | Case | Steps | Expected |
|---|---|---|---|
| A11Y-01 | Keyboard only | Sign in, analyze, ask and sign out using only Tab, Shift+Tab, Enter | All steps reachable; focus is visible; `Skip to content` is the first focusable element and activating it scrolls to `#content` |
| A11Y-02 | Small viewport | Viewport 375×740; run NEW-01 and ASK-01 | No horizontal scroll; buttons and textareas usable |
| A11Y-03 | Alerts | Trigger AUTH-02 and NEW-08 | Error elements have `role="alert"` |
| SEC-01 | Internal docs not served (nginx) | `GET /docs/requirements/ASSESSMENT.md` on the Compose stack | Returns the React shell (`<div id="root"></div>`), not the markdown |
| SEC-02 | No secrets in the bundle | `npm run check:web-docs` on the production build (runs in CI) | Does not contain `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `JWT_SECRET` or anything matching `/sk-(or|proj)-/` |

## 12. Real provider (manual, budgeted)

Only with an authorized local key and a paid low-cost model (`openai/gpt-4o-mini`), against the Compose stack with `-f docker-compose.openrouter.yml`. Confirm the effective `OPENROUTER_MODEL` in the API container before running. Run NEW-01, ASK-01 twice and NEW-06; record provider, model, prompt version, latency and tokens from the detail API. Never print or store the key.

## 13. Already automated

| Cases | File |
|---|---|
| AUTH-01, AUTH-02, NEW-01, NEW-05, ASK-01, HIS-04, ISO-01 | `qa/e2e/smoke.spec.ts` |
| AUTH-05, NEW-01, ASK-01, HIS-04, ISO-01, SEC-01 (nginx) | `qa/e2e/compose-stack.spec.ts` |
| ASK-09 and RET-04 (component level) | `apps/web/src/pages/DetailPage.test.tsx` |
| Loading, empty and error states (component level) | `apps/web/src/pages/*.test.tsx` |
| AUTH-03, 04, 06–09; NEW-02–04, 06–14; RES-01–05; ASK-02–08, 10, 11; RET-01–03; HIS-01–03, 05–08; ISO-02, 03; A11Y-01–03 | `qa/e2e/flows/*.spec.ts` (`npm run qa:e2e:flows`, and `npm run qa:e2e:flows:limits` for AUTH-08, AUTH-09, NEW-14, ASK-10, ASK-11, HIS-05) |
| SEC-02 | `scripts/check-web-build.mjs` (`npm run check:web-docs`) |
| API behaviour behind NEW-08…14, ASK-05…11, RET-01…02, HIS-07, ISO-* | `apps/api/test/integration.spec.ts`, `apps/api/test/edge-cases.spec.ts` |

Only ASK-09 and RET-04 have no browser test; they are covered at component level.
