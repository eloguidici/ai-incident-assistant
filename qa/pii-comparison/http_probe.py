"""Read-only real HTTP/quality probes inside the isolated service container."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import socket
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000"


def call(path: str, payload: dict | None = None, body: bytes | None = None) -> tuple[int, dict, float]:
    """Return measured local status/JSON/duration; no content logging or external provider."""
    encoded = body if body is not None else json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(URL + path, data=encoded, headers={"content-type": "application/json"})
    start = time.perf_counter()
    try:
        response = urllib.request.urlopen(request, timeout=180)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read()), round((time.perf_counter() - start) * 1000, 3)


def main() -> int:
    """Exercise real quality and service behavior; retain failures as synthetic evidence."""
    checks = []
    status, health, elapsed = call("/health")
    checks.append({"id": "health-version", "pass": status == 200 and health.get("status") == "ok" and health.get("policyVersion") == "pii-local-v1", "elapsedMs": elapsed})
    fixtures = json.loads(Path("/comparison/holdout.json").read_text())[:14]
    cases = []
    for fixture in fixtures:
        status, response, elapsed = call("/sanitize", {"text": fixture["text"], "scope": "http-user/incident-1"})
        sanitized = response.get("text", "")
        missing = [index for index, (_, fragment) in enumerate(fixture["expected"]) if fragment in sanitized]
        lost = [index for index, fragment in enumerate(fixture["preserve"]) if sanitized.count(fragment) != fixture["text"].count(fragment)]
        cases.append({"id": fixture["id"], "status": status, "entityCounts": response.get("entityCounts"), "missedFragments": missing, "lostProtected": lost, "pass": status == 200 and not missing and not lost, "elapsedMs": elapsed})
    leaves = [fixture["text"] for fixture in fixtures]
    status, batch, elapsed = call("/sanitize-batch", {"texts": leaves, "scope": "http-user/incident-1"})
    checks.append({"id": "batch-14-real-leaves", "pass": status == 200 and len(batch.get("texts", [])) == 14 and set(batch) == {"texts", "policyVersion", "engineVersion", "entityCounts"}, "elapsedMs": elapsed, "entityCounts": batch.get("entityCounts")})
    for identifier, route, payload, expected_status in (
        ("empty", "/sanitize", {"text": "", "scope": "http-user/incident-1"}, 200),
        ("empty-batch", "/sanitize-batch", {"texts": [], "scope": "http-user/incident-1"}, 200),
        ("text-bound", "/sanitize", {"text": "x" * 32769, "scope": "s"}, 400),
        ("batch-count-bound", "/sanitize-batch", {"texts": [""] * 65, "scope": "s"}, 400),
        ("batch-sum-bound", "/sanitize-batch", {"texts": ["x" * 32768, "x" * 32768, "x"], "scope": "s"}, 400),
        ("scope-bound", "/sanitize", {"text": "private-sentinel", "scope": "s" * 513}, 400),
        ("closed-unknown-keys", "/sanitize", {"text": "private-sentinel", "scope": "s", "raw": "private-sentinel"}, 400),
    ):
        status, response, elapsed = call(route, payload)
        checks.append({"id": identifier, "pass": status == expected_status and "private-sentinel" not in json.dumps(response), "status": status, "elapsedMs": elapsed})
    status, response, _ = call("/sanitize", body=b"x" * 524289)
    checks.append({"id": "body-byte-bound", "pass": status == 413 and response == {"error": "REQUEST_TOO_LARGE"}})
    status, response, _ = call("/sanitize", body=b'{"text":"private-sentinel","text":"duplicate","scope":"s"}')
    checks.append({"id": "duplicate-keys-no-echo", "pass": status == 400 and response == {"error": "INVALID_REQUEST"}})
    # Long real inference leaves ample time to exercise readiness and immediate overload.
    source = ("HTTP 503 api-1 INC-9001 E_TIMEOUT. " * 300)[:8000]
    with ThreadPoolExecutor(max_workers=2) as executor:
        pending = executor.submit(call, "/sanitize", {"text": source, "scope": "load/incident-1"})
        time.sleep(.25)
        status, response, health_elapsed = call("/health")
        checks.append({"id": "health-during-inference", "pass": status == 200 and response.get("status") == "ok", "elapsedMs": health_elapsed})
        status, response, busy_elapsed = call("/sanitize-batch", {"texts": ["private-sentinel"], "scope": "s"})
        checks.append({"id": "shared-slot-busy", "pass": status == 503 and response == {"error": "PII_BUSY"}, "elapsedMs": busy_elapsed})
        first_status, _, first_elapsed = pending.result()
        checks.append({"id": "long-real-inference", "pass": first_status == 200, "elapsedMs": first_elapsed})
    network_blocked = False
    try:
        with socket.create_connection(("1.1.1.1", 443), timeout=1):
            pass
    except OSError:
        network_blocked = True
    checks.append({"id": "external-network-blocked", "pass": network_blocked})
    report = {"providerCalls": 0, "checks": checks, "qualityCases": cases, "contractPassed": sum(check["pass"] for check in checks), "contractTotal": len(checks), "qualityPassed": sum(case["pass"] for case in cases), "qualityTotal": len(cases), "processStatus": [line for line in Path("/proc/1/status").read_text().splitlines() if line.startswith(("VmRSS:", "VmHWM:", "Threads:", "Uid:"))]}
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if all(check["pass"] for check in checks) and all(case["pass"] for case in cases) else 2


if __name__ == "__main__":
    raise SystemExit(main())
