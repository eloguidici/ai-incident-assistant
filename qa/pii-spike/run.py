"""Run the fixed synthetic corpus offline; retain failures instead of changing expectations."""

import argparse
import dataclasses
import hashlib
import importlib.metadata
import json
import logging
import math
import os
from pathlib import Path
import platform
import resource
import time
from datetime import datetime, timezone

from sanitizer import LABEL, MODELS, POLICY_VERSION, PrototypeSanitizer, SanitizationError, create_analyzer, label_for

TEST_KEY = b"qa-only-fixed-key-not-for-production-123456"
MODES = {"english-only": ("en",), "spanish-only": ("es",), "dual": ("en", "es")}


def expected_spans(fixture: dict) -> list[tuple[str, int, int]]:
    """Expand every annotated occurrence; raise if an annotation is absent or duplicated."""
    expected = []
    for kind, needle in fixture["expected"]:
        start = fixture["text"].find(needle)
        if start < 0 or not needle:
            raise ValueError("An expected annotation is absent.")
        while start >= 0:
            expected.append((kind, start, start + len(needle)))
            start = fixture["text"].find(needle, start + len(needle))
    if len(set(expected)) != len(expected):
        raise ValueError("Duplicate expected annotation.")
    return expected


def evaluate(fixture: dict, sanitized: str, spans: list) -> dict:
    """Measure exact spans/full coverage, extra spans and protected text preservation."""
    expected = expected_spans(fixture)
    detected = [(span.entity_type, span.start, span.end) for span in spans]
    exact = sum(annotation in detected for annotation in expected)
    covered = sum(any(kind == entity and start <= left and end >= right for entity, start, end in detected) for kind, left, right in expected)
    extras = [index for index, span in enumerate(detected) if span not in expected]
    lost = [index for index, fragment in enumerate(fixture["preserve"]) if sanitized.count(fragment) != fixture["text"].count(fragment)]
    return {"expected": len(expected), "exact": exact, "fullyCovered": covered, "missedExpected": [index for index, (kind, left, right) in enumerate(expected) if not any(kind == entity and start <= left and end >= right for entity, start, end in detected)], "extraDetected": extras, "lostProtected": lost, "pass": exact == len(expected) and not extras and not lost}


def percentile(samples: list[float], percentage: float) -> float:
    """Return nearest-rank percentile of non-empty measured samples."""
    return round(sorted(samples)[max(0, math.ceil(len(samples) * percentage) - 1)], 3)


def aggregate(cases: list[dict]) -> dict:
    """Aggregate measured outcomes without hiding misses or unsupported entities."""
    return {
        "cases": len(cases), "passedCases": sum(case["metrics"]["pass"] for case in cases),
        "expected": sum(case["metrics"]["expected"] for case in cases),
        "exact": sum(case["metrics"]["exact"] for case in cases),
        "fullyCovered": sum(case["metrics"]["fullyCovered"] for case in cases),
        "extraSpans": sum(len(case["metrics"]["extraDetected"]) for case in cases),
        "protectedViolations": sum(len(case["metrics"]["lostProtected"]) for case in cases),
        "failedIds": [case["id"] for case in cases if not case["metrics"]["pass"]],
    }


def main() -> int:
    """Execute isolated corpus/timing or missing-model probe; write only synthetic evidence."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="/evidence")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--long-repeats", type=int, default=20)
    parser.add_argument("--check-missing-models", action="store_true")
    options = parser.parse_args()
    logging.basicConfig(level=logging.ERROR)
    if options.check_missing_models:
        try:
            create_analyzer({"en": "absent_spike_en_model", "es": "absent_spike_es_model"})
        except SanitizationError:
            print(json.dumps({"missingModels": "PASS: rejected before engine/download", "providerCalls": 0}))
            return 0
        raise RuntimeError("Missing-model preflight unexpectedly succeeded.")
    if not 1 <= options.repeats <= 10 or not 1 <= options.long_repeats <= 50:
        raise ValueError("Invalid repeat count.")
    raw_fixtures = Path(__file__).with_name("fixtures.json").read_bytes()
    fixtures = json.loads(raw_fixtures)
    if len({fixture["id"] for fixture in fixtures}) != len(fixtures):
        raise ValueError("Duplicate fixture id.")
    for fixture in fixtures:
        expected_spans(fixture)
        if any(fragment not in fixture["text"] for fragment in fixture["preserve"]):
            raise ValueError("Protected annotation is absent.")
    started = time.perf_counter()
    prototype = PrototypeSanitizer(create_analyzer(), TEST_KEY)
    startup_ms = round((time.perf_counter() - started) * 1000, 3)
    report = {
        "startedAt": datetime.now(timezone.utc).isoformat(), "timezone": "America/Buenos_Aires", "productionIntegrated": False,
        "policyVersion": POLICY_VERSION, "corpusSha256": hashlib.sha256(raw_fixtures).hexdigest(), "syntheticOnly": True,
        "python": platform.python_version(), "platform": platform.platform(), "cpuCountVisible": os.cpu_count(),
        "versions": {package: importlib.metadata.version(package) for package in ("presidio-analyzer", "presidio-anonymizer", "spacy", *MODELS.values())},
        "startupMs": startup_ms, "providerCalls": 0, "evaluations": [], "performance": [],
        "cgroupCpuMax": Path("/sys/fs/cgroup/cpu.max").read_text().strip(),
        "cgroupMemoryMaxBytes": Path("/sys/fs/cgroup/memory.max").read_text().strip(),
        "resolvedDependencies": {distribution.metadata["Name"]: distribution.version for distribution in importlib.metadata.distributions()},
    }
    for threshold in (0.35, 0.5):
        for mode, languages in MODES.items():
            outcomes = []
            for fixture in fixtures:
                sanitized, spans = prototype.sanitize(fixture["text"], "synthetic-user-a/incident-1", languages, threshold)
                outcomes.append({"id": fixture["id"], "language": fixture["language"], "tier": fixture["tier"], "sanitized": sanitized, "spans": [dataclasses.asdict(span) for span in spans], "metrics": evaluate(fixture, sanitized, spans)})
            report["evaluations"].append({"mode": mode, "threshold": threshold, "aggregate": aggregate(outcomes), "byTier": {tier: aggregate([case for case in outcomes if case["tier"] == tier]) for tier in ("core", "challenge", "exploratory")}, "byLanguage": {language: aggregate([case for case in outcomes if case["language"] == language]) for language in ("en", "es", "mixed")}, "cases": outcomes})
    report["conversationChecks"] = []
    for kind, entity, source, question in (
        ("PERSON", "Alice Morgan", "Operator Alice Morgan reported HTTP 503.", "Did Alice Morgan confirm recovery?"),
        ("PERSON", "María Gómez", "María Gómez abrió el ticket.", "María Gómez confirmó el fallo."),
        ("PERSON", "María Gómez", "María Gómez abrió el ticket. María Gómez confirmó el fallo; maria.gomez@example.com sigue disponible.", "¿Confirmó María Gómez la recuperación?"),
        ("EMAIL_ADDRESS", "alice.morgan@example.com", "Email alice.morgan@example.com.", "¿Recibió alice.morgan@example.com el aviso?"),
    ):
        expected_label = label_for(entity, kind, "user-a/incident-1", TEST_KEY)
        original, _ = prototype.sanitize(source, "user-a/incident-1")
        follow_up, _ = prototype.sanitize(question, "user-a/incident-1")
        other_user, _ = prototype.sanitize(source, "user-b/incident-1")
        other_incident, _ = prototype.sanitize(source, "user-a/incident-2")
        existing, _ = prototype.sanitize(original, "user-a/incident-1")
        restarted, _ = PrototypeSanitizer(prototype.analyzer, bytes(TEST_KEY)).sanitize(source, "user-a/incident-1")
        report["conversationChecks"].append({
            "entityType": kind, "sourceLabels": LABEL.findall(original), "questionLabels": LABEL.findall(follow_up),
            "sameEntityAcrossTurns": expected_label in original and expected_label in follow_up,
            "allSourceOccurrencesStable": original.count(expected_label) == source.count(entity),
            "allQuestionOccurrencesStable": follow_up.count(expected_label) == question.count(entity),
            "isolatedUser": expected_label not in other_user and bool(LABEL.findall(other_user)),
            "isolatedIncident": expected_label not in other_incident and bool(LABEL.findall(other_incident)),
            "existingLabelsPreserved": existing == original,
            "replacementInstanceRestartEquivalent": restarted == original,
        })
    technical_prefix = "HTTP 503 api-1 ticket INC-2048 latency 120ms. "
    suffix = " Email alice.morgan@example.com; phone +1 202-555-0147."
    long_text = (technical_prefix * 200)[:8000 - len(suffix)] + suffix
    for mode, languages in MODES.items():
        for bucket, texts in (("short-corpus", [fixture["text"] for fixture in fixtures]), ("near-input-limit", [long_text])):
            prototype.sanitize(texts[0], "benchmark", languages)
            durations = []
            for _ in range(options.long_repeats if bucket == "near-input-limit" else options.repeats):
                for text in texts:
                    start = time.perf_counter()
                    prototype.sanitize(text, "benchmark", languages)
                    durations.append((time.perf_counter() - start) * 1000)
            report["performance"].append({"mode": mode, "bucket": bucket, "samples": len(durations), "maxChars": max(map(len, texts)), "p50Ms": percentile(durations, 0.5), "p95Ms": percentile(durations, 0.95), "maxMs": round(max(durations), 3)})
    report["peakRssMiB"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 3)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    directory = Path(options.output_dir) / datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    directory.mkdir(parents=True, exist_ok=False)
    report_file = directory / "results.json"
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    core = next(evaluation["byTier"]["core"] for evaluation in report["evaluations"] if evaluation["mode"] == "dual" and evaluation["threshold"] == 0.35)
    print(json.dumps({"phase": "completed", "evidence": str(report_file), "core": core, "startupMs": startup_ms, "peakRssMiB": report["peakRssMiB"], "productionIntegrated": False, "providerCalls": 0}))
    # A failed coverage gate is an experiment result, not a reason to weaken the corpus.
    return 0 if core["passedCases"] == core["cases"] and all(check["sameEntityAcrossTurns"] and check["allSourceOccurrencesStable"] and check["allQuestionOccurrencesStable"] for check in report["conversationChecks"]) else 2


if __name__ == "__main__":
    raise SystemExit(main())
