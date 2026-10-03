"""Bounded small-input/typical-batch benchmark and quick CPU INT8 pilot."""

import dataclasses
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import resource
import sys
import time

sys.path.insert(0, "/app")
sys.path.insert(0, "/comparison")
from compare import BASELINE_SHA256, TEST_KEY, original_rubric
from sanitizer import GlinerPersonDetector, Sanitizer


def timed_case(sanitizer, texts, rubric):
    """Measure two atomic batches; return actual duration/counts without hiding failures."""
    durations, outputs = [], []
    for _ in range(2):
        start = time.perf_counter()
        response = sanitizer.sanitize_batch(texts, "performance/incident-1")
        durations.append(round((time.perf_counter() - start) * 1000, 3))
        outputs.append(response)
    return {"texts": len(texts), "totalChars": sum(map(len, texts)), "maxTextChars": max(map(len, texts)), "elapsedMs": durations, "under5sBoth": all(duration < 5000 for duration in durations), "under10sBoth": all(duration < 10000 for duration in durations), "repeatEquivalent": outputs[0] == outputs[1], "entityCounts": outputs[-1]["entityCounts"]}


def measure_quality(sanitizer, rubric, fixtures):
    """Apply unchanged baseline rubric to this numeric precision; return all exact spans."""
    cases = []
    for fixture in fixtures:
        sanitized, spans = sanitizer.sanitize_with_spans(fixture["text"], "synthetic-user/incident-1")
        cases.append({"id": fixture["id"], "tier": fixture["tier"], "sanitized": sanitized, "spans": [dataclasses.asdict(span) for span in spans], "metrics": rubric["evaluate"](fixture, sanitized, spans)})
    return {"aggregate": rubric["aggregate"](cases), "core": rubric["aggregate"]([case for case in cases if case["tier"] == "core"]), "cases": cases}


def main():
    """Measure 500/1000/2000 and representative output leaves, then one general INT8 pilot."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-quantization", action="store_true")
    options = parser.parse_args()
    import hashlib
    import torch
    rubric, rubric_hash = original_rubric()
    baseline = Path("/baseline/fixtures.json").read_bytes()
    assert hashlib.sha256(baseline).hexdigest() == BASELINE_SHA256
    fixtures = json.loads(baseline)
    start = time.perf_counter()
    detector = GlinerPersonDetector()
    sanitizer = Sanitizer(detector, TEST_KEY)
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "baselineSha256": BASELINE_SHA256, "rubricSha256": rubric_hash, "providerCalls": 0, "holdoutUsed": False, "startupMs": round((time.perf_counter() - start) * 1000, 3), "cgroupCpuMax": Path('/sys/fs/cgroup/cpu.max').read_text().strip(), "cgroupMemoryMaxBytes": Path('/sys/fs/cgroup/memory.max').read_text().strip(), "modes": []}
    prefix = "HTTP 503 api-1 E_TIMEOUT; retry pending. "
    suffix = " Operator Nora Vega; email ops@example.org."
    scenarios = {str(length): [(prefix * 100)[:length - len(suffix)] + suffix] for length in (500, 1000, 2000)}
    scenarios["output-batch-6"] = ["HTTP 503 from payment-worker.", "Nora Vega observed a connection timeout.", "Redis was unavailable at 09:15 UTC.", "The cause is uncertain; inspect worker metrics.", "Contact ops@example.org about INC-9001.", "No recovery was confirmed."]
    scenarios["output-batch-25"] = ["HTTP 503; worker timeout remains unconfirmed."] * 23 + ["Nora Vega reported the incident.", "Contact ops@example.org."]
    output = Path("/evidence") / ("performance-" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ") + ".json")
    for mode in (("fp32",) if options.no_quantization else ("fp32", "dynamic-int8-linear")):
        if mode == "dynamic-int8-linear":
            started = time.perf_counter()
            try:
                detector.model.model = torch.ao.quantization.quantize_dynamic(detector.model.model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
                report["quantizationMs"] = round((time.perf_counter() - started) * 1000, 3)
            except Exception as failure:
                report["quantizationFailedClass"] = type(failure).__name__
                break
        measurements = []
        for scenario, texts in scenarios.items():
            measurement = {"scenario": scenario, **timed_case(sanitizer, texts, rubric)}
            measurements.append(measurement)
            print(json.dumps({"mode": mode, **measurement}), flush=True)
        outcome = {"mode": mode, "performance": measurements, "quality": measure_quality(sanitizer, rubric, fixtures)}
        report["modes"].append(outcome)
        report["peakRssMiB"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 3)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"mode": mode, "core": outcome["quality"]["core"], "checkpoint": str(output)}), flush=True)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
