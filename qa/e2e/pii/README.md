# Dedicated real PII browser battery

Run only after the main agent confirms that Compose on `http://localhost:8080` has
been rebuilt with PII enabled and the real local detector ready. This suite does
not call the candidate service on port 18080 directly or certify it in isolation.
It uses real browser/API traffic through nginx and Nest, with no HTTP mocks,
server startup, database reset, seeding, or automatic test retries.

```powershell
# Collection only: no browser, HTTP request, model invocation, or database write.
npx playwright test --config=playwright.pii.config.ts --list --reporter=list

# Execute only once the existing stack and shared QA window are ready.
npx playwright test --config=playwright.pii.config.ts
```

The four tests cover English, Spanish and mixed synthetic contacts, exact literal
PERSON/EMAIL_ADDRESS/PHONE_NUMBER labels, repeated boundaries, unchanged technical
facts and evidence, real response leak checks, result/conversation rendering,
reload/history continuity, desktop/390px/320px contrast and geometry, different
incidents/users, and denial of foreign detail/question/retry requests. They add
six synthetic incidents and three questions to the existing database. They never
delete records. The configured provider can make external requests when executed;
the suite does not select, replace or certify an LLM. Its provider/model metadata
is attached to each successful test. A generic answer without contact tokens does
not exercise assistant token coloring; returned tokens must be literal, known and
correctly colored, and raw originals are always prohibited.

Any detector miss, unstable replacement, removed technical fact, invalid output,
provider failure, leak, ownership failure or rendering defect remains a failed
test. Do not add skips, alternate accepted labels, retries or raw fallback to make
the battery pass. API/browser checks cannot certify provider payloads, database
rows, logs, restart continuity or full detector corpus quality; those need the
separate integration and detector batteries.

The `.pii.ts` suffix is deliberate: only this config discovers it. General E2E
projects discover `.spec.ts`/`.test.ts`, while flows/demo/Compose configs use their
own narrower matches. No shared root config needs to be edited to isolate these
files. Preserve this suffix if the root configs are unchanged.

Artifacts go to mode-specific `qa-artifacts/playwright-pii-<mode>` folders, with a unique run suffix
when `PII_QA_RUN_ID` is set. The full `.bat` sets that suffix so retests preserve earlier failures.
Each language flow saves mobile detail and
history screenshots via `testInfo.outputPath`; failed runs retain screenshots,
traces and videos. Content fixtures are synthetic; authentication secrets are not
attached by the test helpers.
