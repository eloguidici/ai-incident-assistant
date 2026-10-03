"""Predeclared baseline-only semantic-label trial; no holdout loading or name exceptions."""

import dataclasses
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import resource
import sys
import time
import warnings

sys.path.insert(0, "/app")
sys.path.insert(0, "/comparison")
from compare import BASELINE_SHA256, TEST_KEY, original_rubric
from sanitizer import GlinerPersonDetector, Sanitizer, SanitizationError, Span

TRIALS = (
    ("person-name-only-050", ("person name",), "person name", .5),
    ("person-name-context-050", ("person name", "software component", "organization"), "person name", .5),
    ("person-name-structured-context-050", ("person name", "software component", "organization", "JSON field name"), "person name", .5),
    ("individual-name-context-050", ("individual person's name", "software component", "organization", "JSON field name"), "individual person's name", .5),
)


class TrialDetector:
    """Use the same window/model instance with explicitly enumerated alternative labels."""

    def __init__(self, engine, labels, person_label, threshold):
        """Set one predeclared trial configuration; no fixture text is an input to policy."""
        self.engine, self.labels, self.person_label, self.threshold = engine, labels, person_label, threshold

    def detect(self, text):
        """Infer PERSON candidates using trial labels; raise on inference/truncation failures."""
        import torch
        spans = []
        with torch.inference_mode(), warnings.catch_warnings():
            warnings.filterwarnings("error", message=".*truncat.*", category=UserWarning)
            for offset, window in self.engine.windows(text):
                for entity in self.engine.model.predict_entities(window, list(self.labels), threshold=self.threshold):
                    if entity["label"] == self.person_label:
                        spans.append(Span("PERSON", offset + entity["start"], offset + entity["end"], float(entity["score"])))
        return spans


def main():
    """Compare exact original baseline rubric, retaining all trial defects and latency."""
    rubric, rubric_hash = original_rubric()
    raw = Path("/baseline/fixtures.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == BASELINE_SHA256
    fixtures = json.loads(raw)
    start = time.perf_counter()
    engine = GlinerPersonDetector()
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "baselineSha256": BASELINE_SHA256, "rubricSha256": rubric_hash, "holdoutUsed": False, "providerCalls": 0, "startupMs": round((time.perf_counter() - start) * 1000, 3), "trials": []}
    for name, labels, person_label, threshold in TRIALS:
        sanitizer = Sanitizer(TrialDetector(engine, labels, person_label, threshold), TEST_KEY)
        cases, durations = [], []
        for fixture in fixtures:
            start = time.perf_counter()
            sanitized, spans = sanitizer.sanitize_with_spans(fixture["text"], "synthetic-user/incident-1")
            durations.append((time.perf_counter() - start) * 1000)
            cases.append({"id": fixture["id"], "tier": fixture["tier"], "sanitized": sanitized, "spans": [dataclasses.asdict(span) for span in spans], "metrics": rubric["evaluate"](fixture, sanitized, spans)})
        outcome = {"name": name, "labels": labels, "threshold": threshold, "cases": cases, "aggregate": rubric["aggregate"](cases), "core": rubric["aggregate"]([case for case in cases if case["tier"] == "core"]), "p50Ms": rubric["percentile"](durations, .5), "p95Ms": rubric["percentile"](durations, .95)}
        report["trials"].append(outcome)
        print(json.dumps({"name": name, "core": outcome["core"], "p95Ms": outcome["p95Ms"]}), flush=True)
    report["peakRssMiB"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 3)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    path = Path("/evidence") / ("development-" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ") + ".json")
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"evidence": str(path), "holdoutUsed": False}), flush=True)


if __name__ == "__main__":
    main()
