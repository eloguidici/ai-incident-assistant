"""Rubric checks independent of observed NLP outcomes."""

import unittest

from run import aggregate, evaluate, expected_spans
from sanitizer import Span


class CorpusRubricTests(unittest.TestCase):
    """Keep benchmark mistakes from turning misses/overmasking into apparent success."""

    def test_partial_span_is_not_coverage(self):
        """A detected prefix of an email is a miss and extra, not a full detection."""
        fixture = {"text": "alice@example.com", "expected": [["EMAIL_ADDRESS", "alice@example.com"]], "preserve": []}
        metrics = evaluate(fixture, "[EMAIL]@example.com", [Span("EMAIL_ADDRESS", 0, 5, 0.5)])
        self.assertEqual(metrics["fullyCovered"], 0)
        self.assertEqual(metrics["missedExpected"], [0])
        self.assertFalse(metrics["pass"])

    def test_overmasking_and_preservation(self):
        """Covering a full person plus technical detail is a failed boundary, not a pass."""
        fixture = {"text": "Alice rebooted api-1", "expected": [["PERSON", "Alice"]], "preserve": ["api-1"]}
        metrics = evaluate(fixture, "[PERSON]", [Span("PERSON", 0, len(fixture["text"]), 0.85)])
        self.assertEqual(metrics["fullyCovered"], 1)
        self.assertEqual(metrics["exact"], 0)
        self.assertEqual(metrics["lostProtected"], [0])
        self.assertFalse(metrics["pass"])

    def test_annotation_validation_and_repetition(self):
        """All repeated occurrences count; nonexistent or duplicate annotations fail."""
        self.assertEqual(expected_spans({"text": "Alice; Alice", "expected": [["PERSON", "Alice"]]}), [("PERSON", 0, 5), ("PERSON", 7, 12)])
        for expected in [[["PERSON", "Bob"]], [["PERSON", "Alice"], ["PERSON", "Alice"]]]:
            with self.assertRaises(ValueError):
                expected_spans({"text": "Alice", "expected": expected})

    def test_failed_cases_remain_visible(self):
        """Aggregation retains misses and failed ids instead of ignoring them."""
        case = {"id": "synthetic", "metrics": {"pass": False, "expected": 1, "exact": 0, "fullyCovered": 0, "extraDetected": [], "lostProtected": []}}
        self.assertEqual(aggregate([case])["failedIds"], ["synthetic"])


if __name__ == "__main__":
    unittest.main()
