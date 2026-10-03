"""Deterministic contract tests, separate from real-model corpus evaluation."""

import unittest
from unittest.mock import Mock

from presidio_analyzer import RecognizerResult

from sanitizer import LABEL, PrototypeSanitizer, SanitizationError, Span, label_for, select_spans

TEST_KEY = b"qa-only-fixed-key-not-for-production-123456"


class ReplacementContractTests(unittest.TestCase):
    """Check scoped replacement/overlap/failure behavior without claiming NLP accuracy."""

    def test_scope_and_restart(self):
        """Same entity/scope/key survives a new instance; different scopes and keys differ."""
        first = label_for("Alice Morgan", "PERSON", "user-a/incident-1", TEST_KEY)
        self.assertEqual(first, label_for("Alice Morgan", "PERSON", "user-a/incident-1", bytes(TEST_KEY)))
        self.assertNotEqual(first, label_for("Alice Morgan", "PERSON", "user-b/incident-1", TEST_KEY))
        self.assertNotEqual(first, label_for("Alice Morgan", "PERSON", "user-a/incident-2", TEST_KEY))
        self.assertNotEqual(first, label_for("Alice Morgan", "PERSON", "user-a/incident-1", b"another-qa-only-key-not-production-123"))
        self.assertIsNotNone(LABEL.fullmatch(first))

    def test_normalization_and_identity_limits(self):
        """NFC/spacing stabilize labels without merging short/full names or national formats."""
        self.assertEqual(label_for("Mari\u0301a Go\u0301mez", "PERSON", "a", TEST_KEY), label_for("María Gómez", "PERSON", "a", TEST_KEY))
        self.assertEqual(label_for("Alice  Morgan", "PERSON", "a", TEST_KEY), label_for("alice morgan", "PERSON", "a", TEST_KEY))
        self.assertNotEqual(label_for("Alice", "PERSON", "a", TEST_KEY), label_for("Alice Morgan", "PERSON", "a", TEST_KEY))
        self.assertEqual(label_for("+1 202-555-0147", "PHONE_NUMBER", "a", TEST_KEY), label_for("+12025550147", "PHONE_NUMBER", "a", TEST_KEY))
        self.assertNotEqual(label_for("2025550147", "PHONE_NUMBER", "a", TEST_KEY), label_for("+12025550147", "PHONE_NUMBER", "a", TEST_KEY))

    def test_collision_sample(self):
        """Verify distinctness in a fixed 1000-label sample, not universal collision freedom."""
        labels = {label_for(f"synthetic-{index}@example.com", "EMAIL_ADDRESS", "a", TEST_KEY) for index in range(1000)}
        self.assertEqual(len(labels), 1000)

    def test_overlap_and_input_order(self):
        """Email takes precedence over contained NER, duplicates and order are deterministic."""
        candidates = [Span("PERSON", 0, 5, 0.85), Span("EMAIL_ADDRESS", 0, 17, 0.5), Span("EMAIL_ADDRESS", 0, 17, 0.9)]
        expected = [Span("EMAIL_ADDRESS", 0, 17, 0.9)]
        self.assertEqual(select_spans(candidates, 17, []), expected)
        self.assertEqual(select_spans(list(reversed(candidates)), 17, []), expected)

    def test_protected_labels(self):
        """An existing opaque label is preserved even if the NLP emits an overlapping span."""
        self.assertEqual(select_spans([Span("PERSON", 0, 10, 0.85)], 45, [(0, 42)]), [])

    def test_invalid_spans(self):
        """Invalid detector offsets/types fail rather than returning original text."""
        for candidate in [Span("PERSON", -1, 4, 0.5), Span("PERSON", 0, 99, 0.5), Span("PERSON", 1, 1, 0.5), Span("OTHER", 0, 2, 0.5), Span("PERSON", 0, 2, 1.5)]:
            with self.assertRaises(SanitizationError):
                select_spans([candidate], 10, [])

    def test_repeated_entities_and_existing_labels(self):
        """The actual anonymizer reuses scoped labels and does not process labels again."""
        analyzer = Mock()
        analyzer.analyze.return_value = [RecognizerResult("PERSON", 0, 12, 0.85), RecognizerResult("PERSON", 14, 26, 0.85)]
        prototype = PrototypeSanitizer(analyzer, TEST_KEY)
        text, spans = prototype.sanitize("Alice Morgan; Alice Morgan", "a")
        self.assertEqual(len(spans), 2)
        self.assertNotIn("Alice", text)
        self.assertEqual(LABEL.findall(text)[0], LABEL.findall(text)[1])
        analyzer.analyze.return_value = []
        self.assertEqual(prototype.sanitize(text, "a")[0], text)

    def test_safe_failure(self):
        """A dependency exception is converted to a closed error, not text fallback."""
        analyzer = Mock()
        analyzer.analyze.side_effect = RuntimeError("synthetic-private-sentinel")
        with self.assertRaises(SanitizationError) as caught:
            PrototypeSanitizer(analyzer, TEST_KEY).sanitize("synthetic-private-sentinel", "a")
        self.assertNotIn("synthetic-private-sentinel", str(caught.exception))

    def test_adjacent_names_are_not_merged(self):
        """Different detected people must keep separate HMAC labels despite whitespace."""
        analyzer = Mock()
        analyzer.analyze.return_value = [RecognizerResult("PERSON", 0, 12, 0.85), RecognizerResult("PERSON", 13, 26, 0.85)]
        text, _ = PrototypeSanitizer(analyzer, TEST_KEY).sanitize("Alice Morgan Robert Taylor", "a")
        self.assertEqual(LABEL.findall(text), [label_for("Alice Morgan", "PERSON", "a", TEST_KEY), label_for("Robert Taylor", "PERSON", "a", TEST_KEY)])

    def test_request_boundaries(self):
        """Empty text works, 8001 characters/configuration errors fail before analysis."""
        analyzer = Mock()
        prototype = PrototypeSanitizer(analyzer, TEST_KEY)
        self.assertEqual(prototype.sanitize("", "a"), ("", []))
        for kwargs in [{"text": "x" * 8001, "scope": "a"}, {"text": "x", "scope": ""}, {"text": "x", "scope": "a", "languages": ("fr",)}, {"text": "x", "scope": "a", "threshold": -1}]:
            with self.assertRaises(SanitizationError):
                prototype.sanitize(**kwargs)
        analyzer.analyze.assert_not_called()
        with self.assertRaises(SanitizationError):
            PrototypeSanitizer(analyzer, b"short")


if __name__ == "__main__":
    unittest.main()
