# Local bilingual PII spike


2026-10-02, Buenos Aires, dev baseline 2e476c3 plus local QA changes. **Experiment completed; configuration NOT APPROVED for production integration.** No production/API/database change, paid LLM call or deployment. [Plan](../security/PII_IMPLEMENTATION_PLAN.md), [runner](../../qa/pii-spike/README.md).

## Experiment

Python 3.12.12, Presidio analyzer/anonymizer 2.2.364, spaCy 3.8.7, en_core_web_md/es_core_news_md 3.8.0. Base image pinned by digest, 55 resolved Python packages pinned, model wheels pinned by hash. Explicit EN/ES PERSON, EMAIL_ADDRESS and PHONE_NUMBER recognizers; phone regions AR/ES/US/GB. Packaged suffix snapshot prevents email-validation downloads. Addresses, DNI and bank accounts are not configured coverage. Presidio needs language models and recognizers, not merely a language argument: [official language configuration](https://microsoft.github.io/presidio/tutorial/05_languages/), [entities](https://microsoft.github.io/presidio/supported_entities/).

The [fixed synthetic corpus](../../qa/pii-spike/fixtures.json) has 38 fixtures: 28 core, six challenge, four exploratory; 11 EN, 13 ES, 14 mixed. All repeated occurrences are annotated, and technical fragments are protected. Expectations were fixed before running and not weakened. SHA-256: `ccb67967392af1be05bd8bedf4c520451ca9f6e81cbf3218558b9c5134964c96`.

Three modes over the same entire corpus (English only, Spanish only, union of both), thresholds 0.35/0.50: 228 outcomes per run. Single-language modes deliberately also receive other-language text as comparison baselines, not claimed support. Full coverage means a correctly typed span contains the entire expected entity; exact coverage also requires correct boundaries. Extra spans or lost protected text fail the case even if the personal data is covered.

## Quality

| Mode / threshold | Core cases passed | Exact / expected | Fully covered | Extra spans | Protected losses |
|---|---:|---:|---:|---:|---:|
| English / 0.35 | 20/28 | 33/36 | 35/36 | 11 | 5 |
| Spanish / 0.35 | 23/28 | 32/36 | 32/36 | 1 | 1 |
| Dual / 0.35 | 20/28 | 34/36 | 36/36 | 12 | 6 |
| English / 0.50 | 17/28 | 29/36 | 31/36 | 12 | 5 |
| Spanish / 0.50 | 22/28 | 30/36 | 30/36 | 1 | 1 |
| Dual / 0.50 | 20/28 | 34/36 | 36/36 | 12 | 6 |

Passed-case count alone is misleading: Spanish misses English people; dual improves coverage but overmasks. Dual core failures: es-question, repeated-name, es-spain-phone, benign-es, benign-ip, technical-names, es-accented-name, mixed-two-names. English NER on Spanish labeled phrases such as “recibió la”, a date-containing clause and “Teléfono de contacto” as PERSON. An IPv6 fragment and technical component names were removed. Raising the threshold did not fix these spans (score 0.85 is not a calibrated correctness probability).

Dual challenge: 2/6 complete cases, 3/6 exact entities, 4/6 fully covered. Obfuscated/zero-width emails missed; some name boundaries overexpanded. Exploratory: 0/4 correctly typed entities; addresses/DNI/bank accounts remain unsupported. A DNI partly removed as PERSON is not successful document recognition. This curated set is not a population sensitivity/precision estimate.

## Replacement and conversation

Typed 128-bit truncated HMAC labels use synthetic user/incident scope without a reversible map. Public fixed QA key is never production configuration. NFC/spacing/case normalization and digit-based phone labels stabilize selected spellings, not short/full-name identity or national/international equivalence. Key rotation changes labels and needs a production lifetime/version policy.

Disabled Presidio's default whitespace-adjacent merging and added a regression; original v1 evidence retained. v2 keeps separately detected people separate. Four real conversation probes preserve existing labels and distinguish users/incidents. Three keep all occurrences stable; the repeated Spanish name fails because one detection includes the following clause. HMAC cannot fix inconsistent detected boundaries.

14/14 deterministic contract/rubric tests PASS: invalid requests/spans, closed errors, overlap, adjacent names, normalization and a 1000-label collision sample. Real missing-model probe rejects before initialization/download. Two independent offline v2 processes reproduced all 228 outcomes; Node independently reconstructed the metrics. Three checks with the current application validator accept sanitized quotes and reject raw quotes/foreign-scope labels. These do not certify future HTTP/DB integration, output protection, every log sink or timeout policy.

## Resources

Docker Desktop Linux on Windows; measured quota one CPU, 1536 MiB memory, no network, read-only root, 64 MiB tmpfs, non-root UID; no secrets/database mounted. Final v2 run: startup 2910.814 ms, peak process RSS 617.465 MiB. Image 610,454,206 bytes; image size and RSS are different measurements. Both models remain loaded even in single-language mode, so no single-model memory comparison is claimed.

| Mode | Short p50 / p95 ms | 8000-char p50 / p95 ms |
|---|---:|---:|
| English | 5.883 / 7.839 | 213.201 / 225.754 |
| Spanish | 5.524 / 6.773 | 184.191 / 191.879 |
| Dual | 11.734 / 14.664 | 398.782 / 416.185 |

114 short samples per mode: 38 fixtures, three warm repeats, max 122 chars. Twenty repeats of one 8000-char synthetic incident per mode. Sequential timings exclude HTTP/database/LLM/queueing/production load; empirical quantiles on a small corpus are not an SLO. Separate 512 MiB/no-swap startup probe: OOMKilled=true, exit 137. Do not add this configuration to the proposed 512 MiB application task; measure optimization/sizing before IaC changes. No AWS runtime is certified.

## Evidence and Decision

Ignored local evidence: `qa-artifacts/pii-spike/2026-10-02T21-10-00-153993Z/` contains results.json, verification.json, memory-probe.json. Reproduction used independent `21-07-12-164668Z`; original v1 `21-02-47-932506Z` unchanged. Only public synthetic samples, including measured unsanitized misses; these are not approved redacted customer records.

Repository checks: lint, typecheck, API build, mock evaluation 5/5 and web-doc exclusion PASS; runtime unchanged, demo Docker services healthy. No new full API/browser/Compose suite, live LLM, CI or Terraform validation claimed for this QA-only change. Prior results remain historical.

**NO-GO for blanket dual-language integration.** Next bounded experiment: language/segment-aware or alternative local multilingual NER, preserving this baseline and adding a separate holdout corpus. Resolve precision, name boundaries/continuity and resources before PII-1. Do not patch fixture-specific names, discard failures or send original text to another hosted LLM to solve privacy. Future integration must cover HTTP/errors/timeouts, key lifecycle, expanded-label size/context budgets, Python-code-point versus JavaScript-UTF-16 handling, original-free persistence/history/output and real-service QA. The application does not yet sanitize PII.
