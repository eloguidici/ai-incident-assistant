# Prompt-security remediation checkpoint


Date: 2026-10-02 (Buenos Aires). Branch: dev. Implementation/local verification checkpoint, **not real-model approval**. User requested commit/push and continuation later before the new paid run.

## Changes

- Prompts v4/v5 explicitly separate authorized work from rubrics, encoded attachments, asserted authority and conversation history; correlation alone does not warrant high causal confidence.
- Complete grounded URL comparison handles prose quotes/unmatched closing parentheses without accepting foreign paths, queries, ports, hostname suffixes or shorter substrings.
- A shared lexical rule rejects selected impossible completed external actions explicitly attributed to this no-tools assistant, including passive restoration. Denials, reported attacks, third-party actions and exact source quotes are preserved. Other formulations and unsupported factual claims can still evade it.
- Original source, API/DB contracts, observation-only scanner and seven public adversarial baseline cases are unchanged. No production reviewer, agents, extra SDK/dependency or secret changes.

## New verification

API/PostgreSQL: `npm run test:coverage`, **184/184**, 14 suites, 90.53% lines, 70.01% branches. New tests cover narrative fields, valid quotes accompanying false actions, local negations/reporting, punctuation and foreign URL suffixes; API checks verify rejection preserves the prior analysis and legitimate URL acceptance persists.

Frontend 14/14; mock evaluation 5/5; lint/typecheck/build PASS. Browser flows **41/41** on isolated ports 3011/5183, compiled mock API plus PostgreSQL. Initial default-port attempt could not start because Docker occupied 3001; an initial local override lacked the repository working directory; both setup errors were corrected before the successful run. Supertest listener and Playwright color warnings remain visible.

Offline replay against unmodified archived Liquid/GPT outputs: both wrongly rejected URLs now accepted, both explicit false restorations rejected, and the GPT counterfactual with a valid quote rejected. Zero external calls. Historical evidence remains [Liquid FAIL](PROMPT_SECURITY_LIVE.md) and [GPT FAIL](PROMPT_SECURITY_GPT.md); do not relabel those results as new success.

Docker API/web rebuilt successfully with the local CA/test-database override; PostgreSQL volume retained and demo remains mock at localhost:8080. Compose browser/limits/proxy suites were **not rerun after remediation**; their previous results remain historical. New real-provider run: **NOT_RUN**, preflight only validated the 45s total/20s attempt profile and hard 15-attempt budget. No new cost incurred in this phase.

## Resume

Run unchanged advanced cases through the production API against the paid real model with a fresh cap of 15 actual attempts including retries; review full outputs, causal confidence and attachment-authority claims manually. If failures remain, compare a QA-only reviewer on bad candidates and benign controls with at most five additional calls. Measure false acceptance/rejection and latency before proposing production integration. No general security guarantee, current CI result or deployed cloud environment is certified here.
