"""Offline thread comparison: unchanged FP32 policy, frozen fixtures, content-free evidence."""

import hashlib
import argparse
import json
from pathlib import Path
import resource
import sys
import time

import torch

sys.path.insert(0, '/app')
from sanitizer import GlinerPersonDetector, Sanitizer


def require_equivalent(configurations):
    """Reject missing/divergent comparisons after preserving their evidence."""
    if not configurations or not all(configuration['allEquivalent'] for configuration in configurations):
        raise SystemExit(2)


def main() -> None:
    """Compare CPU thread settings in one process; persist only timings and equivalence metadata."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--threads', type=int, choices=(1, 2, 4, 8), nargs='+', default=[1, 2, 4])
    parser.add_argument('--long-only', action='store_true')
    parser.add_argument('--output', default='thread-performance.json')
    parser.add_argument('--chars', type=int, choices=(1000, 2000, 2500, 3000, 4000, 5000), default=4000)
    options = parser.parse_args()
    if Path(options.output).name != options.output:
        raise ValueError('Evidence output must be a file name.')
    fixtures = []
    for path in ("/baseline/fixtures.json", "/comparison/holdout.json", "/comparison/optimization-holdout.json", "/comparison/final-holdout.json"):
        for fixture in json.loads(Path(path).read_text()):
            fixtures.append({**fixture, 'id': f'{Path(path).name}:{fixture["id"]}'})
    long_cases = []
    for name, sentence, suffix in (
        ("long-en", "Checkout returned HTTP 503. Cause unknown. ", " Operator Nora Vega; email ops@example.org; phone +1 202-555-0147."),
        ("long-es", "La API de pagos devolvio HTTP 503. La causa no esta confirmada. ", " La analista Maria Gomez confirmo el fallo; email ops@example.org; telefono +1 202-555-0147."),
    ):
        long_cases.append({"id": name, "text": (sentence * 150)[:options.chars - len(suffix)] + suffix})
    fixtures += long_cases
    if options.long_only:
        fixtures = long_cases
    started = time.perf_counter()
    detector = GlinerPersonDetector()
    sanitizer = Sanitizer(detector, b"synthetic-performance-key-0123456789")
    person_inference = detector.detect_many
    phase_timings = {'nerMs': 0.0}

    def measured_person_inference(texts):
        """Measure windowing/tokenization/model work only, without recording content."""
        started = time.perf_counter()
        try:
            return person_inference(texts)
        finally:
            phase_timings['nerMs'] = (time.perf_counter() - started) * 1000

    detector.detect_many = measured_person_inference
    startup_ms = round((time.perf_counter() - started) * 1000, 2)
    report = {"startupMs": startup_ms, "syntheticOnly": True, "providerCalls": 0,
              "modelChanged": False, 'referenceThreads': options.threads[0], "configurations": []}
    baseline = {}
    for threads in options.threads:
        torch.set_num_threads(threads)
        sanitizer.sanitize_batch(["Operator Nora Vega reported HTTP 503."], "performance/warmup")
        durations, cases = [], []
        for fixture in fixtures:
            started = time.perf_counter()
            protected, spans = sanitizer.sanitize_with_spans(fixture["text"], "performance/incident")
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            signature = (protected, [(span.entity_type, span.start, span.end, span.canonical) for span in spans])
            if threads == options.threads[0]:
                baseline[fixture["id"]] = signature
            equivalent = baseline[fixture["id"]] == signature
            digest = hashlib.sha256(protected.encode()).hexdigest()
            cases.append({"id": fixture["id"], "chars": len(fixture["text"]), "elapsedMs": elapsed_ms,
                          'nerMs': round(phase_timings['nerMs'], 2),
                          'contactsAndReplacementMs': round(max(0, elapsed_ms - phase_timings['nerMs']), 2),
                          "equivalent": equivalent, "outputSha256": digest, "spanCount": len(spans)})
            durations.append(elapsed_ms)
            if fixture["id"].startswith("long-"):
                print(json.dumps({"threads": threads, **cases[-1]}), flush=True)
        summary = {"threads": threads, "cases": cases, "totalMs": round(sum(durations), 2),
                   "allEquivalent": all(case["equivalent"] for case in cases)}
        report["configurations"].append(summary)
        report["peakRssMiB"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
        Path('/evidence', options.output).write_text(json.dumps(report, indent=2))
        print(json.dumps({"threads": threads, "caseCount": len(cases), "totalMs": summary["totalMs"],
                          "allEquivalent": summary["allEquivalent"], "peakRssMiB": report["peakRssMiB"]}), flush=True)
    require_equivalent(report['configurations'])


if __name__ == "__main__":
    main()
