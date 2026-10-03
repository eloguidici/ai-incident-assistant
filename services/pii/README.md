# Local PII service (T22)

Independent Python service for detected PERSON, EMAIL_ADDRESS and PHONE_NUMBER.
No T21/spaCy import, provider call, reversible map, raw-span HTTP response or content log.
Model quality is a separate gate: implementation does not approve the detector.

## Internal Contract

`POST /sanitize` with exactly `{ "text": "...", "scope": "..." }` returns
`{ "text": "...", "policyVersion": "pii-local-v1", "engineVersion": "...", "entityCounts": {} }`.

`POST /sanitize-batch` with exactly `{ "texts": ["..."], "scope": "..." }` returns
`{ "texts": ["..."], "policyVersion": "pii-local-v1", "engineVersion": "...", "entityCounts": {} }`.
Order is preserved. Counts include every replaced occurrence, aggregated across leaves;
zero-count entity types are omitted. Empty text and an empty batch are accepted.
Nest supplies a scope containing both authenticated user ID and incident ID, preferably
an unambiguous serialized pair. Nest should send schema-validated narrative string leaves
to the batch route and reconstruct the validated schema itself; keys/enums are not NER input.

Bounds: 32,768 Unicode code points per text; 64 texts per batch; 65,536 code points total;
512 code points per nonblank scope; 524,288 request bytes, including chunked uploads;
524,288 returned code points total. JSON escaping means byte sizes can exceed character sizes.
The service rejects nonstrings, unknown/duplicate keys, unpaired surrogates and compressed requests.
Request receipt has a 10-second deadline. Nest owns its inference/HTTP timeout and returned-byte bound.

`GET /health` returns HTTP 200 with `{ "status": "ok", "policyVersion": "pii-local-v1", "engineVersion": "..." }`
only after the model and key load. Missing assets/key return 503 with `status: unavailable`.
Health never acquires the inference lock. Errors contain only a fixed `error` code:
400 `INVALID_REQUEST`; 408 `REQUEST_TIMEOUT`; 413 `REQUEST_TOO_LARGE`;
415 `UNSUPPORTED_MEDIA_TYPE`; 503 `PII_BUSY`, `PII_UNAVAILABLE` or `PII_FAILED`.
No partial batch response or original fallback is possible. One shared nonblocking slot covers both
POST routes; a disconnected/cancelled request retains the slot until its worker finishes.

## Detection Policy

GLiNER 0.2.27 CPU, `urchade/gliner_multi-v2.1` at
`443d26d654e0324125a96bebd8e796c14ff2efe6`, retrieved from the
[official model API](https://huggingface.co/api/models/urchade/gliner_multi-v2.1).
Tokenizer/architecture `microsoft/mdeberta-v3-base` at
`a0484667b22365f84929a935b5e50a51f71f159d`, from its
[official API](https://huggingface.co/api/models/microsoft/mdeberta-v3-base).
The [model card](https://huggingface.co/urchade/gliner_multi-v2.1) describes multilingual NER and Apache-2.0 licensing.

The measured candidate uses labels `person name`, `software component`, `organization`, `JSON field name`
at threshold 0.55; only `person name` spans are replaced. Context labels offer general alternatives
for technical entities; no known-name lists or fixture exceptions. These labels are not
authorization to enable the feature if the measured quality gate fails.
Offset-preserving windows contain at most 1,000 characters, 256 GLiNER words and 440 tokenizer subtokens,
with up to 32 words of overlap; inference truncation warnings fail closed.
Very large indivisible tokens may be rejected instead of silently losing coverage.

Email validation is local (`email-validator`, no DNS), with syntactically valid `.test`
domains permitted through the documented `test_environment` option. It does not require deliverability.
Telephone candidates use
`phonenumbers` VALID checks with AR/US/ES/GB domestic regions; explicit international
prefixes are parsed normally. Domestic candidates require nearby contact terminology.
Dates/IPs/identifier substrings and email contents are excluded from telephone candidates.
Plain emails only in the initial candidate; obfuscated/zero-width addresses are measurable limitations.

Existing canonical placeholders use offset-preserving neutral masks before detection and remain literal in output.
The person mask is `person`; contact masks are `[EMAIL]` and `[PHONE]`. Only the detector sees these masks.
Validated contact spans are masked before NER. Windows from narrative leaves are packed up to 1,000 characters
and inferred in batches of up to eight. Cross-leaf person predictions fail the whole batch.
Email > phone > person controls overlapping spans;
longest within a type then score/offset/canonical value breaks ties deterministically.
No adjacency merging or propagation to other name occurrences is performed.

Labels are `[PERSON_<32hex>]`, `[EMAIL_ADDRESS_<32hex>]`, `[PHONE_NUMBER_<32hex>]`.
HMAC-SHA256 is domain-separated by policy, exact scope and entity type; 128 bits are displayed.
Person/email input uses NFC, case folding and whitespace normalization. Telephone identity uses E.164.
Stable spans/key/scope yield stable labels across requests/restarts, including punctuation variants of phones.
NER boundary differences and alias identity remain limits; no universal anonymization claim.

## Operator Modes

`PII_PERSON_ENABLED=true` (default) loads the offline name model and uses `pii-local-v1`.
Explicit `false` skips importing/loading its weights and uses only email/phone validators with
`pii-contacts-v1`. Names remain visible in this faster mode. The health and sanitation contracts
return the effective policy/engine, not the full-mode versions shown in the examples above.
Invalid flag values fail closed; timeouts never switch modes automatically.
Nest's separate `PII_ENABLED=false` bypasses all content sanitation and explicitly allows raw content.
That flag does not remove the service from the standard Compose topology.
Cross-policy historical records are blocked while protection is enabled; do not silently change their marker.

## Build And Runtime

From the repository root:

```powershell
docker build --secret id=extra_ca_cert,src=qa/local/docker-extra-ca.pem -t ai-incident-pii:t22 services/pii
```

Omit `--secret` on hosts that do not require the additional CA. It is a build-only secret;
TLS verification remains enabled. No CA secret, key or credentials are copied to the final image.
Dependencies use `requirements.lock.txt` with SHA256 verification and the base image is digest-pinned.
The CPU wheel targets Linux x86_64 / CPython 3.12. Regenerate with pip-tools 7.4.1 and
`pip-compile --allow-unsafe --generate-hashes --strip-extras requirements.in` in that environment.
The explicit setuptools release hashes come from official PyPI.
Model assets download during build at fixed revisions; the installed manifest records asset hashes.

Mount an existing secret read-only at `/run/secrets/pii_hmac_key` and set
`PII_HMAC_KEY_FILE=/run/secrets/pii_hmac_key`. A UTF-8 `PII_HMAC_KEY` is the alternative;
the file takes precedence and a bad file never falls back to the environment.
Key size is 32..4096 bytes. Do not bake it into the image. Preserve the key for incident continuity;
rotating it changes future labels and requires coordination with Nest's policy/history boundary.

The image runs UID/GID 65532, one uvicorn worker, one Torch intra/inter-op thread, internal port 8000,
no access logs, `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`. Installed assets are root-owned;
use `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=16m`, `--cap-drop ALL`,
`--security-opt no-new-privileges` and an internal Docker network. PyTorch imports generate
temporary module files in the volatile tmpfs; model caches/assets stay read-only.
Do not publish port 8000 in the normal Compose/QA topology.
The optional host-development overlay publishes loopback 18080 through an extra default-bridge attachment;
it permits egress and is not the network-isolated normal QA/runtime topology.
Provisional resources: 1 CPU / 4 GiB, to be replaced by measured results in the comparison report.
No runtime cache writes/downloads are required.

## Verification

Unit tests live in `tests/test_service.py`; run in the built image with tests mounted read-only:

```powershell
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --mount 'type=bind,source=C:/Users/Practical Tecno/Documents/GitHub/ai-incident-assistant/services/pii/tests,target=/tests,readonly' --entrypoint python ai-incident-pii:t22 -m pytest -q -p no:cacheprovider /tests
```

Quote the entire `--mount` argument containing a space in PowerShell. See
`qa/pii-comparison` for unchanged-baseline and holdout quality/resource evidence and rerun commands.
Only synthetic QA evidence contains internal offsets; they never leave the service API.
Nest, DB, Compose, browser and default feature gate are owned by the integrating agent.

The complete reusable Windows battery is `scripts\qa-local-pii.bat` (or `npm run qa:pii`).
It uses real local inference, synthetic inputs, a test database and a mock downstream provider;
it makes no paid LLM calls. See [integration evidence](../../docs/qa/LOCAL_PII_INTEGRATION.md).
