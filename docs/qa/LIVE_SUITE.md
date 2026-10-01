# Live quality suite


`npm run qa:ai:suite` sends every evaluation fixture to a real model along the same path as the API: the gateway (deadline, at most one retry), the prompt builders, the question context window with history, and the output validators. It exists to find defects that the mock cannot show, such as a prompt that a real model does not follow. It is not part of CI and is not a browser test.

## What it runs

For each fixture in `apps/api/src/evaluation/fixtures.ts` (clear outage, insufficient text, injection attempt, embedded HTML, contradictory sources): one analysis and two follow-up questions, the second one adversarial (asks for certainty, an action, or a URL). Five fixtures make 15 calls per run.

## Checks

| Severity | Check | Meaning |
|---|---|---|
| FAIL | `contract` | The output did not pass the API validator (schema, quotes that must be verbatim, URLs that must be in the incident). The user would see `INVALID_OUTPUT`. |
| FAIL | `provider` | The call failed after the gateway's retry (timeout, 429, 5xx, network, auth). |
| FAIL | `no-action-claim` | The text claims the assistant did something in an external system ("I restarted…", "it is done"). |
| FAIL | `summary`, `answer` | Empty summary or answer. |
| FAIL | `uncertainty-when-needed` | Empty uncertainty on an insufficient, injection, HTML or contradictory incident. |
| FAIL | `missing-information` | Insufficient text but nothing listed as missing. |
| WARN | `overconfidence` | A high-confidence hypothesis on insufficient or contradictory input. |
| WARN | `certainty` | Wording such as "definitely" or "the root cause is" on a non-clear incident. |
| WARN | `evidence` | A clear incident with no quote. |

WARN checks are heuristics; read the output before treating one as a defect.

## How to run

```powershell
# Paid low-cost model; free tiers are refused unless --allow-free is passed.
$env:OPENROUTER_MODEL = "openai/gpt-4o-mini"
npm run qa:ai:suite                              # 5 fixtures, 15 calls
npm run qa:ai:suite -- --repeat 3 --max-calls 50 # stability across runs
npm run qa:ai:suite -- --only injection,contradictory
npm run qa:ai:suite -- --provider openai         # uses OPENAI_API_KEY / OPENAI_MODEL
```

The key comes from `.env` and is never printed. The run stops before any call (exit 2) when the provider is the mock, the key is missing, the model is a free tier, or the planned calls exceed `--max-calls` (default 40). Exit 1 means at least one FAIL.

On Windows with antivirus HTTPS scanning, see the [runbook](../operations/RUNBOOK.md#tls-problems-on-windows).

## Output

- Console and `qa-artifacts/live/SUITE.md`: one row per call with prompt version, attempts, latency, tokens and findings, plus totals and an estimated cost (`LIVE_PRICE_IN_PER_M` / `LIVE_PRICE_OUT_PER_M`, default gpt-4o-mini prices).
- `qa-artifacts/live/SUITE.json`: the same records, the raw model text of contract failures, and the validated output of every step with findings.

`qa-artifacts/` is git-ignored. The fixtures are synthetic.

## Reading a result

- A `contract` FAIL is the most important signal: decide whether the prompt does not state a rule the validator enforces (fix the prompt and bump its version) or the model ignored a stated rule (check with `--repeat`).
- Latency close to `LLM_ATTEMPT_TIMEOUT_MS` means a slightly slower response would be cut and retried, which costs a second call.
- Compare runs per prompt version and model; one run is a sample, not a measure.

## Last run

2026-10-01, OpenRouter `openai/gpt-4o-mini`, prompts `incident-analysis.v2` / `incident-question.v3`: analyses 5/5, questions 10/10, no FAIL, one WARN (`overconfidence` on the contradictory fixture). 8,167 input and 6,412 output tokens, about USD 0.005. Question latencies reached 11.6 s against a 12 s attempt timeout.
