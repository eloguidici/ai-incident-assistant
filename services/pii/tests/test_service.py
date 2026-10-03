"""Focused contract/security checks; model quality is measured separately."""

import asyncio
import json
import os
import threading
from unittest.mock import patch

import httpx
import pytest

from app import MAX_BODY_BYTES, PiiApp
from sanitizer import (
    ENGINE_VERSION, POLICY_VERSION, LABEL, MAX_TEXT_CHARS, GlinerPersonDetector,
    Sanitizer, SanitizationError, Span, deterministic_spans, label_for, load_key,
    select_spans, PERSON_NER_LABEL,
    ContactsOnlyDetector, CONTACT_POLICY_VERSION, CONTACT_ENGINE_VERSION, person_layer_enabled,
    model_thread_count,
)

KEY = b"synthetic-unit-key-not-production-0123456789"
SCOPE = "synthetic-user/incident-1"


@pytest.mark.parametrize('value,expected', [('1', 1), ('2', 2), ('4', 4)])
def test_bounded_model_threads(value, expected):
    """Accept only measured thread profiles without changing the detector policy."""
    with patch.dict(os.environ, {'PII_TORCH_THREADS': value}):
        assert model_thread_count() == expected


@pytest.mark.parametrize('value', ['0', '3', '8', 'auto', '', '1.0'])
def test_invalid_model_threads_fail_closed(value):
    """Reject oversubscription/invalid settings without silently falling back."""
    with patch.dict(os.environ, {'PII_TORCH_THREADS': value}), pytest.raises(SanitizationError):
        model_thread_count()


def test_model_threads_default_to_one():
    """Keep conservative base behavior when the operator has no override."""
    with patch.dict(os.environ, {}, clear=True):
        assert model_thread_count() == 1


class NoPersons:
    """Isolate HTTP/replacement behavior from real model quality."""

    def detect(self, text):
        """Return no person spans for the synthetic contract tests."""
        return []


def request(app, path="/sanitize", payload=None, **kwargs):
    """Exercise the ASGI boundary synchronously; return one synthetic response."""
    async def execute():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pii") as client:
            return await client.post(path, content=json.dumps(payload, ensure_ascii=True).encode(), headers={"content-type": "application/json"}, **kwargs)
    return asyncio.run(execute())


@pytest.fixture
def app():
    """Return a ready injected contract engine, without claiming model integration."""
    return PiiApp(Sanitizer(NoPersons(), KEY))


def test_empty_and_versions(app):
    response = request(app, payload={"text": "", "scope": SCOPE})
    assert response.status_code == 200
    assert response.json() == {"text": "", "policyVersion": POLICY_VERSION, "engineVersion": ENGINE_VERSION, "entityCounts": {}}


def test_batch_atomic_counts_and_labels(app):
    response = request(app, "/sanitize-batch", {"texts": ["help@example.com", "Email help@example.com; phone +1 202-555-0147.", ""], "scope": SCOPE})
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"texts", "policyVersion", "engineVersion", "entityCounts"}
    assert payload["entityCounts"] == {"EMAIL_ADDRESS": 2, "PHONE_NUMBER": 1}
    assert payload["texts"][0] in payload["texts"][1]
    assert "example.com" not in json.dumps(payload)


@pytest.mark.parametrize("payload", [
    {"text": 12, "scope": SCOPE}, {"text": "x", "scope": " "},
    {"text": "x", "scope": "s" * 513}, {"text": "x", "scope": SCOPE, "extra": "private"},
    {"text": "x" * (MAX_TEXT_CHARS + 1), "scope": SCOPE},
    {"text": "\ud800", "scope": SCOPE}, {"text": "x", "scope": None},
])
def test_invalid_request_never_echoes(app, payload):
    response = request(app, payload=payload)
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_REQUEST"}


@pytest.mark.parametrize("texts", [[""] * 65, ["x" * 32768, "x" * 32768, "x"], ["x" * 32769], [1], "text"])
def test_batch_bounds(app, texts):
    assert request(app, "/sanitize-batch", {"texts": texts, "scope": SCOPE}).status_code == 400


def test_exact_batch_limits_and_empty_batch(app):
    for texts in ([""], [], [""] * 64, ["x" * 32768, "x" * 32768]):
        response = request(app, "/sanitize-batch", {"texts": texts, "scope": SCOPE})
        assert response.status_code == 200
        assert response.json()["texts"] == texts


def test_preserves_existing_tokens(app):
    text = "[PERSON_" + "a" * 32 + "] [EMAIL_ADDRESS_" + "b" * 32 + "] [PHONE_NUMBER_" + "c" * 32 + "]"
    assert request(app, payload={"text": text, "scope": SCOPE}).json()["text"] == text


def test_protected_person_retains_neutral_context_and_exact_offsets():
    token = label_for("Synthetic Identity", "PERSON", SCOPE, KEY)
    text = "La analista " + token + " confirmed HTTP 502."

    class ContextProbe:
        def detect(self, masked):
            """Assert the private model mask and simulate recognizing the neutral reference."""
            assert len(masked) == len(text)
            assert token not in masked
            assert "Synthetic Identity" not in masked
            start = masked.index("person")
            assert masked.startswith("La analista person")
            return [Span("PERSON", start, start + len("person"), .99)]

    assert Sanitizer(ContextProbe(), KEY).sanitize_batch([text], SCOPE)["texts"] == [text]


def test_hmac_scope_restart_normalization():
    label = label_for("Nora Vega", "PERSON", SCOPE, KEY)
    assert LABEL.fullmatch(label)
    assert label_for("nora  vega", "PERSON", SCOPE, bytes(KEY)) == label
    assert label_for("Nora Vega", "PERSON", "other-user/incident-1", KEY) != label
    assert label_for("Nora Vega", "PERSON", "synthetic-user/incident-2", KEY) != label
    assert label_for("Nora Vega", "PERSON", SCOPE, b"a" * 32) != label
    assert label_for("Mari\u0301a", "PERSON", SCOPE, KEY) == label_for("María", "PERSON", SCOPE, KEY)


def test_validated_phone_canonicalization():
    sanitizer = Sanitizer(NoPersons(), KEY)
    formatted = sanitizer.sanitize_batch(["phone +1 202-555-0147", "phone +12025550147", "phone (202) 555-0147"], SCOPE)["texts"]
    assert len({LABEL.findall(text)[0] for text in formatted}) == 1


def test_no_numeric_technical_false_positives():
    text = "IP 192.0.2.15:443; 2026-10-02; INC-2048; UUID 550e8400-e29b-41d4-a716-446655440000; 1234567890123456789012"
    assert deterministic_spans(text) == []


def test_email_invalid_and_plus_alias():
    assert deterministic_spans("bad..local@example.com") == []
    assert deterministic_spans("person@exam\u200bple.com") == []
    assert deterministic_spans("support+case@example.com.")[0].end == 24


def test_reserved_test_email_is_sanitized(app):
    response = request(app, payload={"text": "Email lucia.exampleperson@example.test", "scope": SCOPE})
    assert response.status_code == 200
    assert response.json()["entityCounts"] == {"EMAIL_ADDRESS": 1}
    assert "example.test" not in response.json()["text"]


def test_overlap_priority_and_adjacent_names():
    selected = select_spans([Span("PERSON", 0, 20, .9), Span("EMAIL_ADDRESS", 4, 20, 1), Span("PERSON", 22, 25, .9), Span("PERSON", 26, 30, .9)], 30, [])
    assert [(span.entity_type, span.start, span.end) for span in selected] == [("EMAIL_ADDRESS", 4, 20), ("PERSON", 22, 25), ("PERSON", 26, 30)]
    with pytest.raises(SanitizationError):
        select_spans([Span("PERSON", 0, 31, .9)], 30, [])


def test_fail_closed_inference_and_no_partial_batch():
    class Fails:
        def detect(self, text):
            """Raise a deliberately sensitive exception to test error containment."""
            raise RuntimeError("private-user@example.com")
    response = request(PiiApp(Sanitizer(Fails(), KEY)), "/sanitize-batch", {"texts": ["", "Contact private-user@example.com"], "scope": SCOPE})

    assert response.status_code == 503
    assert response.json() == {"error": "PII_FAILED"}


def test_unavailable_and_busy_share_both_routes(app):
    app.slot.acquire()
    try:
        for route, field in (("/sanitize", "text"), ("/sanitize-batch", "texts")):
            assert request(app, route, {field: "private", "scope": SCOPE}).json() == {"error": "PII_BUSY"}
            assert request(PiiApp(), route, {field: "private", "scope": SCOPE}).status_code == 503
    finally:
        app.slot.release()


def test_cancelled_request_keeps_slot_until_inference_finishes():
    started, release = threading.Event(), threading.Event()
    class Slow:
        def detect(self, text):
            """Hold synthetic inference until the cancellation probe releases it."""
            started.set()
            release.wait(5)
            return []
    app = PiiApp(Sanitizer(Slow(), KEY))
    async def execute():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pii") as client:
            pending = asyncio.create_task(client.post("/sanitize", json={"text": "hello", "scope": SCOPE}))
            await asyncio.to_thread(started.wait, 5)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert app.slot.locked()
            response = await client.post("/sanitize-batch", json={"texts": ["hello"], "scope": SCOPE})
            assert response.status_code == 503
            release.set()
            await asyncio.to_thread(lambda: release.wait(1))
            for _ in range(50):
                if not app.slot.locked():
                    break
                await asyncio.sleep(.01)
            assert not app.slot.locked()
    asyncio.run(execute())


def test_streaming_body_limit_and_bad_json(app):
    async def execute():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pii") as client:
            async def chunks():
                yield b"x" * 262144
                yield b"x" * 262145
            response = await client.post("/sanitize", content=chunks(), headers={"content-type": "application/json"})
            assert response.status_code == 413
            for body in (b'{"text":"private","text":"duplicate","scope":"s"}', b'{"text":', b'\xff'):
                response = await client.post("/sanitize", content=body, headers={"content-type": "application/json"})
                assert response.json() == {"error": "INVALID_REQUEST"}
            assert (await client.post("/sanitize", content=b"x", headers={"content-type": "text/plain"})).status_code == 415
            assert (await client.get("/health")).json()["policyVersion"] == POLICY_VERSION
    asyncio.run(execute())


def test_keys_file_precedence_and_missing(tmp_path):
    secret = tmp_path / "key"
    secret.write_bytes(b"z" * 32)
    with patch.dict(os.environ, {"PII_HMAC_KEY_FILE": str(secret), "PII_HMAC_KEY": "y" * 32}, clear=True):
        assert load_key() == b"z" * 32
        secret.write_bytes(b"too short")
        with pytest.raises(SanitizationError):
            load_key()
    with patch.dict(os.environ, {}, clear=True), pytest.raises(SanitizationError):
        load_key()


def test_missing_model_closed():
    with pytest.raises(SanitizationError, match="^PII model is unavailable.$"):
        GlinerPersonDetector("/absent-pii-model")


def test_packed_detection_maps_spans_to_each_leaf():
    class Model:
        def inference(self, texts, labels, **kwargs):
            """Return synthetic PERSON spans to verify offset mapping, not real model quality."""
            predictions = []
            for text in texts:
                start = text.find("Nora Vega")
                predictions.append([] if start < 0 else [{"label": PERSON_NER_LABEL, "start": start, "end": start + 9, "score": .9}])
            return predictions
    detector = object.__new__(GlinerPersonDetector)
    detector.model, detector.labels, detector.threshold = Model(), (PERSON_NER_LABEL,), .55
    detector.windows = lambda text: [(0, text)] if text.strip() else []
    spans = detector.detect_many(["Technical HTTP 503", "Hi Nora Vega", ""])
    assert spans[0] == [] and spans[2] == []
    assert spans[1] == [Span("PERSON", 3, 12, .9)]


def test_packed_detection_rejects_cross_leaf_person():
    class Model:
        def inference(self, texts, labels, **kwargs):
            """Simulate a name spanning the join; it must fail the entire inference batch."""
            return [[{"label": PERSON_NER_LABEL, "start": 0, "end": len(text), "score": .9}] for text in texts]
    detector = object.__new__(GlinerPersonDetector)
    detector.model, detector.labels, detector.threshold = Model(), (PERSON_NER_LABEL,), .55
    detector.windows = lambda text: [(0, text)] if text.strip() else []
    with pytest.raises(SanitizationError):
        detector.detect_many(["Nora", "Vega"])


def test_contacts_mode_declares_partial_coverage_and_preserves_names():
    app = PiiApp(Sanitizer(ContactsOnlyDetector(), KEY, person_enabled=False))
    response = request(app, payload={"text": "Nora Vega; help@example.test; phone +1 202-555-0147; HTTP 503.", "scope": SCOPE})
    payload = response.json()
    assert response.status_code == 200
    assert payload["policyVersion"] == CONTACT_POLICY_VERSION
    assert payload["engineVersion"] == CONTACT_ENGINE_VERSION
    assert payload["entityCounts"] == {"EMAIL_ADDRESS": 1, "PHONE_NUMBER": 1}
    assert "Nora Vega" in payload["text"] and "HTTP 503" in payload["text"]
    assert "help@example.test" not in payload["text"]
    assert "PERSON_" not in payload["text"]
    assert label_for("help@example.test", "EMAIL_ADDRESS", SCOPE, KEY) not in payload["text"]
    assert request(app, payload={"text": payload["text"], "scope": SCOPE}).json()["text"] == payload["text"]


def test_contacts_startup_never_loads_the_model():
    async def execute():
        app = PiiApp()
        events = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        sent = []
        async def receive():
            return next(events)
        async def send(event):
            sent.append(event)
        with patch.dict(os.environ, {"PII_PERSON_ENABLED": "false", "PII_HMAC_KEY": KEY.decode()}, clear=True), \
                patch("app.GlinerPersonDetector", side_effect=AssertionError("Model must not load")) as model:
            await app.lifespan(receive, send)
            assert app.sanitizer.policy_version == CONTACT_POLICY_VERSION
            model.assert_not_called()
        assert sent[0]["type"] == "lifespan.startup.complete"
    asyncio.run(execute())


def test_person_flag_is_explicit_not_a_failure_fallback():
    with patch.dict(os.environ, {}, clear=True):
        assert person_layer_enabled() is True
    with patch.dict(os.environ, {"PII_PERSON_ENABLED": "false"}, clear=True):
        assert person_layer_enabled() is False
    with patch.dict(os.environ, {"PII_PERSON_ENABLED": "invalid"}, clear=True), pytest.raises(SanitizationError):
        person_layer_enabled()
