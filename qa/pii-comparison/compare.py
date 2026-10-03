"""Real offline comparison with the unchanged original rubric and separate holdouts."""

import ast
import argparse
from collections import Counter
import dataclasses
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import resource
import sys
import time

sys.path.insert(0, "/app")
from sanitizer import ENGINE_VERSION, POLICY_VERSION, LABEL, PERSON_LABELS, PERSON_THRESHOLD, GlinerPersonDetector, Sanitizer, label_for

BASELINE_SHA256 = "ccb67967392af1be05bd8bedf4c520451ca9f6e81cbf3218558b9c5134964c96"
TEST_KEY = b"comparison-only-fixed-synthetic-key-0123456789"


def original_rubric():
    """Load exact QA-only function ASTs from the original runner, with no NLP imports."""
    import math
    source = Path("/baseline/run.py").read_bytes()
    functions = [node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name in {"expected_spans", "evaluate", "aggregate", "percentile"}]
    assert len(functions) == 4
    namespace = {"math": math}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "/baseline/run.py", "exec"), namespace)
    return namespace, hashlib.sha256(source).hexdigest()


def main() -> int:
    """Measure three frozen general policies, holdouts, repetition/bounds/resources; retain FAIL."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-long", action="store_true")
    parser.add_argument("--production-only", action="store_true")
    parser.add_argument("--profile-limit", type=int, choices=(500, 1000, 8000), default=8000)
    options = parser.parse_args()
    rubric, rubric_hash = original_rubric()
    baseline_bytes = Path("/baseline/fixtures.json").read_bytes()
    assert hashlib.sha256(baseline_bytes).hexdigest() == BASELINE_SHA256
    holdout_bytes = Path("/comparison/holdout.json").read_bytes()
    suites = {"baseline": json.loads(baseline_bytes), "holdout": json.loads(holdout_bytes)}
    reserved_bytes = Path("/comparison/optimization-holdout.json").read_bytes()
    suites["reserved"] = json.loads(reserved_bytes)
    final_bytes = Path("/comparison/final-holdout.json").read_bytes()
    suites["final"] = json.loads(final_bytes)
    assert len(suites["baseline"]) == 38
    for fixtures in suites.values():
        for fixture in fixtures:
            rubric["expected_spans"](fixture)
            assert all(fragment in fixture["text"] for fragment in fixture["preserve"])
    started = time.perf_counter()
    detector = GlinerPersonDetector()
    sanitizer = Sanitizer(detector, TEST_KEY)
    startup_ms = round((time.perf_counter() - started) * 1000, 3)
    report = {
        "startedAt": datetime.now(timezone.utc).isoformat(), "timezone": "America/Buenos_Aires",
        "policyVersion": POLICY_VERSION, "engineVersion": ENGINE_VERSION,
        "baselineSha256": BASELINE_SHA256, "holdoutSha256": hashlib.sha256(holdout_bytes).hexdigest(),
        "reservedSha256": hashlib.sha256(reserved_bytes).hexdigest(),
        "finalHoldoutSha256": hashlib.sha256(final_bytes).hexdigest(), "profileInputLimit": options.profile_limit,
        "originalRubricSha256": rubric_hash, "syntheticOnly": True, "providerCalls": 0,
        "python": platform.python_version(), "startupMs": startup_ms,
        "cgroupCpuMax": Path("/sys/fs/cgroup/cpu.max").read_text().strip(),
        "cgroupMemoryMaxBytes": Path("/sys/fs/cgroup/memory.max").read_text().strip(),
        "modelManifest": json.loads(Path("/opt/model/manifest.json").read_text()),
        "resolvedDependencies": {distribution.metadata["Name"]: distribution.version for distribution in importlib.metadata.distributions()},
        "evaluations": [],
    }
    configurations = (
        ("person-only-050", ("person",), .5),
        ("selected-candidate", PERSON_LABELS, PERSON_THRESHOLD),
        ("context-065", ("person", "software component", "organization"), .65),
    )
    production_configuration = configurations[1]
    if options.production_only:
        configurations = (production_configuration,)
    for name, labels, threshold in configurations:
        detector.labels, detector.threshold = labels, threshold
        for suite, fixtures in suites.items():
            cases, durations = [], []
            for fixture in fixtures:
                start = time.perf_counter()
                sanitized, spans = sanitizer.sanitize_with_spans(fixture["text"], "synthetic-user/incident-1")
                durations.append((time.perf_counter() - start) * 1000)
                cases.append({"id": fixture["id"], "tier": fixture["tier"], "language": fixture["language"], "sanitized": sanitized, "spans": [dataclasses.asdict(span) for span in spans], "metrics": rubric["evaluate"](fixture, sanitized, spans)})
            evaluation = {"configuration": name, "labels": labels, "threshold": threshold, "suite": suite,
                "aggregate": rubric["aggregate"](cases), "byTier": {tier: rubric["aggregate"]([case for case in cases if case["tier"] == tier]) for tier in ("core", "challenge", "exploratory")},
                "p50Ms": rubric["percentile"](durations, .5), "p95Ms": rubric["percentile"](durations, .95), "cases": cases}
            report["evaluations"].append(evaluation)
            print(json.dumps({"configuration": name, "suite": suite, **evaluation["aggregate"]}), flush=True)
            # Preserve completed quality results before any optional long stress test.
            Path("/evidence/quality-checkpoint.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # Production is the predeclared contextual policy; holdout results never tune it.
    detector.labels, detector.threshold = production_configuration[1:]
    report["conversationChecks"] = []
    for kind, entity, source, question in (
        ("PERSON", "Alice Morgan", "Operator Alice Morgan reported HTTP 503.", "Did Alice Morgan confirm recovery?"),
        ("PERSON", "María Gómez", "María Gómez abrió el ticket. María Gómez confirmó el fallo; maria.gomez@example.com sigue disponible.", "¿Confirmó María Gómez la recuperación?"),
        ("PERSON", "Inés Suárez", "La analista Inés Suárez abrió INC-9001. Inés Suárez confirmó HTTP 502.", "¿Inés Suárez confirmó HTTP 502?"),
        ("EMAIL_ADDRESS", "ops@example.org", "Email ops@example.org.", "¿Recibió ops@example.org el aviso?"),
    ):
        scope = "user-a/incident-1"
        expected = label_for(entity, kind, scope, TEST_KEY)
        original, _ = sanitizer.sanitize_with_spans(source, scope)
        follow_up, _ = sanitizer.sanitize_with_spans(question, scope)
        existing, _ = sanitizer.sanitize_with_spans(original, scope)
        restarted, _ = Sanitizer(detector, bytes(TEST_KEY)).sanitize_with_spans(source, scope)
        other_user, _ = sanitizer.sanitize_with_spans(source, "user-b/incident-1")
        other_incident, _ = sanitizer.sanitize_with_spans(source, "user-a/incident-2")
        report["conversationChecks"].append({"entityType": kind, "sourceLabels": LABEL.findall(original), "questionLabels": LABEL.findall(follow_up), "sameEntityAcrossTurns": expected in original and expected in follow_up, "allSourceOccurrencesStable": original.count(expected) == source.count(entity), "allQuestionOccurrencesStable": follow_up.count(expected) == question.count(entity), "existingLabelsPreserved": existing == original, "replacementInstanceRestartEquivalent": restarted == original, "isolatedUser": expected not in other_user and bool(LABEL.findall(other_user)), "isolatedIncident": expected not in other_incident and bool(LABEL.findall(other_incident))})
    report["longTextChecks"] = []
    for length in (() if options.skip_long else ((8000, 32768) if options.profile_limit == 8000 else (options.profile_limit,))):
        prefix = "HTTP 503 api-1 INC-9001 E_TIMEOUT latency 120ms. "
        suffix = " Operator Nora Vega; email ops@example.org; phone +1 202-555-0147."
        text = (prefix * 1000)[:length - len(suffix)] + suffix
        elapsed = []
        outputs = []
        for _ in range(2):
            start = time.perf_counter()
            sanitized, spans = sanitizer.sanitize_with_spans(text, "long-test/incident-1")
            elapsed.append(round((time.perf_counter() - start) * 1000, 3))
            outputs.append(sanitized)
        expected_fixture = {"text": text, "expected": [["PERSON", "Nora Vega"], ["EMAIL_ADDRESS", "ops@example.org"], ["PHONE_NUMBER", "+1 202-555-0147"]], "preserve": ["HTTP 503", "api-1", "INC-9001", "E_TIMEOUT", "120ms"]}
        report["longTextChecks"].append({"chars": length, "windowCount": len(detector.windows(text)), "elapsedMs": elapsed, "metrics": rubric["evaluate"](expected_fixture, sanitized, spans), "repeatEquivalent": outputs[0] == outputs[1], "outputChars": len(sanitized)})
        print(json.dumps({"longText": report["longTextChecks"][-1]}), flush=True)
    report["peakRssMiB"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 3)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    selected = [evaluation for evaluation in report["evaluations"] if evaluation["configuration"] == "selected-candidate"]
    report["longStressSkipped"] = options.skip_long
    report["approved"] = all(evaluation["byTier"]["core"]["cases"] == evaluation["byTier"]["core"]["passedCases"] for evaluation in selected) and all(all(check[field] for field in ("sameEntityAcrossTurns", "allSourceOccurrencesStable", "allQuestionOccurrencesStable", "existingLabelsPreserved", "replacementInstanceRestartEquivalent", "isolatedUser", "isolatedIncident")) for check in report["conversationChecks"]) and not options.skip_long and all(check["metrics"]["pass"] and (options.profile_limit == 8000 or max(check["elapsedMs"]) < 10000) for check in report["longTextChecks"])
    filename = Path("/evidence") / (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ") + ".json")
    filename.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"evidence": str(filename), "approved": report["approved"], "startupMs": startup_ms, "peakRssMiB": report["peakRssMiB"]}), flush=True)
    return 0 if report["approved"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
