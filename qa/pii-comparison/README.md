# T22 Local GLiNER Comparison

This QA directory is separate from the unchanged T21 spike. All cases are synthetic.
The original 38 fixtures must retain SHA256
`ccb67967392af1be05bd8bedf4c520451ca9f6e81cbf3218558b9c5134964c96`.
The comparison executes the original `expected_spans`, `evaluate`, `aggregate`, and `percentile`
function ASTs directly from read-only `qa/pii-spike/run.py`, without its spaCy/Presidio imports.
There is no rubric relaxation, fixture edit or production dependency on QA code.

The separate holdout has 21 preannotated cases (15 core, five challenge, one exploratory).
It was written before any model-quality run, including a `.test` email requested by integration review.
Three fixed configurations compare person-only 0.50, general context 0.50 and context 0.65.
The initial predeclared candidate was context 0.50 and failed exact quality checks. Later calibration
added `person name` and `JSON field name`, threshold 0.55, packed 1,000-character FP32 inference and
neutral placeholder masks. Those corpus/holdout runs are development evidence, not untouched validation.
Three additional reserved and three final preannotated cases are reported separately; once examined,
they must not be described as still unseen. No fixture-specific identity exceptions are used.
An exact-span or technical-preservation failure remains FAIL even when text is partially covered.
Street addresses/identifiers remain unsupported, with their exploratory misses explicitly retained.

## Commands

From the repository root, build `ai-incident-pii:t22` with the optional CA secret as described in
`services/pii/README.md`. Create only the new evidence directory, then run:

```powershell
New-Item -ItemType Directory -Force qa/pii-comparison/evidence
docker run --rm --network none --read-only --cpus 1 --memory 4g --memory-swap 4g --cap-drop ALL --security-opt no-new-privileges --mount 'type=bind,source=C:/Users/Practical Tecno/Documents/GitHub/ai-incident-assistant/qa/pii-spike,target=/baseline,readonly' --mount 'type=bind,source=C:/Users/Practical Tecno/Documents/GitHub/ai-incident-assistant/qa/pii-comparison,target=/comparison,readonly' --mount 'type=bind,source=C:/Users/Practical Tecno/Documents/GitHub/ai-incident-assistant/qa/pii-comparison/evidence,target=/evidence' --entrypoint python ai-incident-pii:t22 /comparison/compare.py
node qa/pii-comparison/verify-evidence.mjs
```

Comparison exit 2 means the quality gate failed, with complete evidence still written.
The production battery uses `--production-only --profile-limit 1000`; it includes configured-limit
latency, exact core spans, preservation, existing-label idempotence and incident/user isolation.
The default 8k/32k stress remains available and historical failures are retained, not reclassified.
Use a fresh process for the repeat run. The Node verifier independently reconstructs exact spans,
coverage, extras, preservation losses and aggregates; it compares fresh-process detector outputs.
Only comparison QA includes offsets; the HTTP service never exposes them.

`http_probe.py` runs inside an isolated service container with `/comparison` mounted read-only.
It covers 14 real synthetic quality cases, batch leaves/counts, bounds, overload, readiness during
real inference, duplicate keys, empty inputs and blocked outbound network. HTTP quality absence
checks supplement the exact original-rubric comparison; they do not replace it.

Measurements include model/tokenizer asset hashes, dependency versions, cgroup CPU/memory quota,
startup, peak RSS, short-case p50/p95, 8k/32k text windows/time/technical preservation and repetition.
These exclude Nest/DB/LLM/browser unless explicitly reported by the integrating agent.
No paid calls, external messages, environment edits, commits, pushes or deployments are part of this slice.

Measured results and remaining gates are recorded in [the integration report](../../docs/qa/LOCAL_PII_INTEGRATION.md).
