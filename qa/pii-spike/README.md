# Bilingual PII feasibility experiment

QA only. No production service, endpoint, database migration or LLM call. Synthetic fixed corpus; a failed quality gate is intentional evidence, not a passing sanitizer. See [measured results](../../docs/qa/PII_SPIKE.md) and [implementation plan](../../docs/security/PII_IMPLEMENTATION_PLAN.md).

Build from the repository root:

```powershell
docker build -t ai-incident-assistant-pii-spike:local qa/pii-spike
```

For a Windows environment requiring the existing exported CA, add `--secret id=extra_ca_cert,src=qa/local/docker-extra-ca.pem`. TLS verification remains enabled. The image/base, packages and models are pinned; requirements.lock.txt snapshots resolved transitive versions and model-wheel hashes. Model licenses are distinct from Presidio's license and require review before redistribution.

Run deterministic tests and a real missing-model check with no network:

```powershell
docker run --rm --network none --cpus 1 --memory 1536m --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --entrypoint python ai-incident-assistant-pii-spike:local -m unittest -v
docker run --rm --network none --cpus 1 --memory 1536m --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m ai-incident-assistant-pii-spike:local --check-missing-models
```

Run the real corpus, mounting only an ignored evidence directory, not .env, credentials or the application database:

```powershell
New-Item -ItemType Directory -Force qa-artifacts/pii-spike | Out-Null
docker run --rm --network none --cpus 1 --memory 1536m --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --mount "type=bind,source=$((Get-Location).Path)\qa-artifacts\pii-spike,target=/evidence" ai-incident-assistant-pii-spike:local --repeats 3 --long-repeats 20
```

The runner writes a unique results.json, prints only aggregate metadata and exits 2 when the core quality/continuity gate fails. PowerShell/tool wrappers may expose nonzero status as 1; inspect Docker's actual exit status when diagnosing. Exit failure must not be ignored when deciding to integrate. Only annotated synthetic fixtures are appropriate here; saved sanitized results can contain intentionally measured misses and are not approved redacted customer data.

For independent evidence reconstruction and current application grounding checks, build the API first, then run:

```powershell
npm run build -w @app/api
node qa/pii-spike/verify-evidence.mjs qa-artifacts/pii-spike/NEW_RUN/results.json qa-artifacts/pii-spike/PREVIOUS_RUN/results.json
```

This verifier checks consistency/reproduction, not a claim of NLP accuracy. The public report keeps the failing integration decision separate. Fixed QA HMAC keys are public test constants, never production keys. Labels are typed, scope-specific pseudonyms; exact spelling/NFC/whitespace stability is not real-world identity resolution, and changing the key changes the labels. Unicode coordinates are Python code points, not JavaScript UTF-16 offsets; any future HTTP contract must avoid exposing offsets or specify conversions.
