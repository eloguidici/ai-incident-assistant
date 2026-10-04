"""Independent local PII detection and scoped one-way replacement."""

from collections import Counter
from dataclasses import dataclass
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import unicodedata
from typing import Protocol
import warnings

from email_validator import EmailNotValidError, validate_email
import phonenumbers

POLICY_VERSION = "pii-local-v1"
CONTACT_POLICY_VERSION = "pii-contacts-v1"
CONTACT_ENGINE_VERSION = "contacts/email-validator-2.2.0/phonenumbers-9.0.7/patterns-v1"
ENGINE_VERSION = "gliner-0.2.27/multi-v2.1@443d26d654e0324125a96bebd8e796c14ff2efe6/person-name-v5/packed1000-fp32/patterns-v1"
MAX_TEXT_CHARS = 32768
MAX_BATCH_TEXTS = 64
MAX_BATCH_CHARS = 65536
MAX_OUTPUT_CHARS = 524288
MAX_SCOPE_CHARS = 512
ENTITY_TYPES = ("PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER")
LABEL = re.compile(r"\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]")
EMAIL_CANDIDATE = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w\u200b\u200c\u200d.-]+", re.UNICODE)
PHONE_CONTEXT = re.compile(r"\b(?:phone|telephone|mobile|call|contact|tel[eé]fono|tel|celular|llamar|contacto)\b", re.I)
PHONE_REGIONS = ("AR", "US", "ES", "GB")
PERSON_NER_LABEL = "person name"
PERSON_LABELS = (PERSON_NER_LABEL, "software component", "organization", "JSON field name")
PERSON_THRESHOLD = 0.55
ROLE_WORDS = frozenset({"analyst", "analista", "engineer", "tenant", "operator", "sre"})
ROLE_FILLER = frozenset({"the", "a", "an", "el", "la", "los", "las", "un", "una", "on", "call"})
MODEL_BATCH_SIZE = 8
MODEL_CHUNK_CHARS = 1000


class SanitizationError(RuntimeError):
    """A fixed-message failure; never expose input or detector exceptions."""


@dataclass(frozen=True)
class Span:
    """Internal code-point offsets, never returned by the HTTP contract."""

    entity_type: str
    start: int
    end: int
    score: float
    canonical: str | None = None


class PersonDetector(Protocol):
    """Small local model contract with no business orchestration."""

    def detect(self, text: str) -> list[Span]:
        """Return PERSON spans for text; raise on inference or bounds failure."""
        ...


def load_key() -> bytes:
    """Read secret file (preferred) or UTF-8 env key; reject absent/short/oversize keys."""
    try:
        filename = os.environ.get("PII_HMAC_KEY_FILE")
        if filename:
            with open(filename, "rb") as secret:
                key = secret.read(4097)
        else:
            key = os.environ.get("PII_HMAC_KEY", "").encode("utf-8")
        if not 32 <= len(key) <= 4096:
            raise ValueError
        return key
    except Exception:
        raise SanitizationError("PII key is unavailable.") from None


def label_for(original: str, kind: str, scope: str, key: bytes, policy_version: str = POLICY_VERSION) -> str:
    """Return a 128-bit scoped HMAC label; reject invalid type/scope/key."""
    if policy_version not in (POLICY_VERSION, CONTACT_POLICY_VERSION) or kind not in ENTITY_TYPES or not isinstance(scope, str) or not scope.strip() or len(scope) > MAX_SCOPE_CHARS or len(key) < 32:
        raise SanitizationError("Invalid replacement configuration.")
    normalized = " ".join(unicodedata.normalize("NFC", original).casefold().split())
    payload = json.dumps([policy_version, scope, kind, normalized], ensure_ascii=True, separators=(",", ":")).encode()
    digest = hmac.new(key, payload, hashlib.sha256).hexdigest()[:32]
    return f"[{kind}_{digest}]"


def deterministic_spans(text: str) -> list[Span]:
    """Validate email/phone candidates offline; return typed spans, without DNS or logs."""
    spans = []
    for candidate in EMAIL_CANDIDATE.finditer(text):
        address = candidate.group().rstrip(".")
        try:
            validate_email(address, check_deliverability=False, allow_smtputf8=True, test_environment=True)
        except EmailNotValidError:
            continue
        spans.append(Span("EMAIL_ADDRESS", candidate.start(), candidate.start() + len(address), 1.0))
    for region in PHONE_REGIONS:
        for candidate in phonenumbers.PhoneNumberMatcher(text, region, leniency=phonenumbers.Leniency.VALID, max_tries=MAX_TEXT_CHARS):
            start, end = candidate.start, candidate.end
            # Avoid substrings inside identifiers, addresses and numeric technical values.
            if (start and (text[start - 1].isalnum() or text[start - 1] in "_.@/:-")) or (end < len(text) and (text[end].isalnum() or text[end] in "_@/:-")):
                continue
            if any(start < span.end and end > span.start for span in spans if span.entity_type == "EMAIL_ADDRESS"):
                continue
            if not candidate.raw_string.startswith("+") and not PHONE_CONTEXT.search(text[max(0, start - 64):start]):
                continue
            canonical = phonenumbers.format_number(candidate.number, phonenumbers.PhoneNumberFormat.E164)
            spans.append(Span("PHONE_NUMBER", start, end, 1.0, canonical))
    return spans


def is_role_mention(text: str) -> bool:
    """Return whether a PERSON span is only a job title or a known role word."""
    tokens = [token for token in re.split(r"[^\w]+", text.casefold(), flags=re.UNICODE) if token]
    content = [token for token in tokens if token not in ROLE_FILLER]
    return bool(content) and all(token in ROLE_WORDS for token in content)


def select_spans(candidates: list[Span], text_length: int, protected: list[tuple[int, int]]) -> list[Span]:
    """Validate and select deterministic non-overlapping spans; reject invalid detector bounds."""
    for span in candidates:
        if span.entity_type not in ENTITY_TYPES or not 0 <= span.start < span.end <= text_length or not math.isfinite(span.score) or not 0 <= span.score <= 1:
            raise SanitizationError("Invalid detector result.")
    priority = {"EMAIL_ADDRESS": 0, "PHONE_NUMBER": 1, "PERSON": 2}
    selected = []
    for span in sorted(candidates, key=lambda candidate: (priority[candidate.entity_type], -(candidate.end - candidate.start), -candidate.score, candidate.start, candidate.end, candidate.canonical or "")):
        if any(span.start < end and span.end > start for start, end in protected):
            continue
        if any(span.start < other.end and span.end > other.start for other in selected):
            continue
        selected.append(span)
    return sorted(selected, key=lambda span: (span.start, span.end))


def validate_batch(texts: list[str], scope: str) -> None:
    """Validate strict batch/scope bounds; raise ValueError without content on bad input."""
    if not isinstance(texts, list) or len(texts) > MAX_BATCH_TEXTS or any(not isinstance(text, str) or len(text) > MAX_TEXT_CHARS for text in texts) or sum(map(len, texts)) > MAX_BATCH_CHARS:
        raise ValueError("Invalid sanitization request.")
    if not isinstance(scope, str) or not scope.strip() or len(scope) > MAX_SCOPE_CHARS:
        raise ValueError("Invalid sanitization request.")
    try:
        scope.encode("utf-8")
        for text in texts:
            text.encode("utf-8")
    except UnicodeError:
        raise ValueError("Invalid sanitization request.") from None


class ContactsOnlyDetector:
    """Explicit fast mode: no PERSON inference and no model import/load."""

    def detect(self, text: str) -> list[Span]:
        """Return no PERSON spans; names remain unchanged by this declared mode."""
        return []


def person_layer_enabled() -> bool:
    """Read the explicit operator flag; reject invalid configuration, never fallback."""
    value = os.environ.get("PII_PERSON_ENABLED", "true").strip().lower()
    if value not in ("true", "false"):
        raise SanitizationError("Invalid PII layer configuration.")
    return value == "true"


def model_thread_count() -> int:
    """Read bounded CPU parallelism; reject invalid values instead of changing coverage."""
    value = os.environ.get("PII_TORCH_THREADS", "1").strip()
    if value not in ("1", "2", "4"):
        raise SanitizationError("Invalid PII CPU configuration.")
    return int(value)


class GlinerPersonDetector:
    """One CPU model; token-aware overlapping windows prevent silent truncation."""

    def __init__(self, model_path: str = "/opt/model", labels: tuple[str, ...] = PERSON_LABELS, threshold: float = PERSON_THRESHOLD):
        """Load local pinned assets and policy; raise a fixed error if unavailable."""
        try:
            import torch
            from gliner import GLiNER

            if not labels or not 0 < threshold < 1:
                raise ValueError
            manifest = json.loads((Path(model_path) / "manifest.json").read_text())
            if manifest["revision"] != "443d26d654e0324125a96bebd8e796c14ff2efe6":
                raise ValueError
            torch.set_num_threads(model_thread_count())
            torch.set_num_interop_threads(1)
            self.model = GLiNER.from_pretrained(model_path, local_files_only=True, load_tokenizer=True, map_location="cpu")
            self.model.eval()
            self.labels = labels
            self.threshold = threshold
        except Exception:
            raise SanitizationError("PII model is unavailable.") from None

    def windows(self, text: str) -> list[tuple[int, str]]:
        """Return offset-preserving windows with <=256 words/440 subtokens; reject unchunkable input."""
        tokens = list(self.model.data_processor.words_splitter(text))
        windows = []
        cursor = 0
        while cursor < len(tokens):
            stop = min(cursor + 256, len(tokens))
            while stop > cursor:
                start_offset, end_offset = tokens[cursor][1], tokens[stop - 1][2]
                window = text[start_offset:end_offset]
                # Use the same pre-split word tokenization as GLiNER, including prompt budget.
                word_tokens = [token[0] for token in tokens[cursor:stop]]
                subtoken_count = len(self.model.data_processor.transformer_tokenizer(word_tokens, is_split_into_words=True, add_special_tokens=True, truncation=False)["input_ids"])
                if subtoken_count <= 440 and len(window) <= MODEL_CHUNK_CHARS:
                    break
                stop = cursor + (stop - cursor) // 2
            if stop <= cursor:
                raise SanitizationError("PII input cannot be processed safely.")
            windows.append((start_offset, window))
            if stop == len(tokens):
                break
            cursor = max(cursor + 1, stop - 32)
        return windows

    def detect(self, text: str) -> list[Span]:
        """Infer one text using the canonical batch pipeline; fail closed on inference errors."""
        return self.detect_many([text])[0]

    def detect_many(self, texts: list[str]) -> list[list[Span]]:
        """Pack <=1000-char windows, retaining leaf offsets; reject every cross-leaf PERSON span."""
        import torch

        spans_by_text = [[] for _ in texts]
        try:
            chunks, chunk, fragments = [], "", []
            for owner, text in enumerate(texts):
                for offset, window in self.windows(text):
                    if chunk and len(chunk) + 2 + len(window) > MODEL_CHUNK_CHARS:
                        chunks.append((chunk, fragments))
                        chunk, fragments = "", []
                    if chunk:
                        chunk += "\n\n"
                    start = len(chunk)
                    chunk += window
                    fragments.append((owner, offset, start, len(chunk)))
            if chunk:
                chunks.append((chunk, fragments))
            windows = [(owner, offset, window) for owner, (chunk, _) in enumerate(chunks) for offset, window in self.windows(chunk)]
            with torch.inference_mode(), warnings.catch_warnings():
                warnings.filterwarnings("error", message=".*truncat.*", category=UserWarning)
                for cursor in range(0, len(windows), MODEL_BATCH_SIZE):
                    group = windows[cursor:cursor + MODEL_BATCH_SIZE]
                    predictions = self.model.inference([window for _, _, window in group], list(self.labels), batch_size=len(group), threshold=self.threshold)
                    if len(predictions) != len(group):
                        raise ValueError
                    for (chunk_index, offset, window), entities in zip(group, predictions):
                        for entity in entities:
                            if entity["label"] == PERSON_NER_LABEL:
                                if not 0 <= entity["start"] < entity["end"] <= len(window):
                                    raise ValueError
                                left, right = offset + entity["start"], offset + entity["end"]
                                containing = [fragment for fragment in chunks[chunk_index][1] if fragment[2] <= left < right <= fragment[3]]
                                if len(containing) != 1:
                                    raise ValueError
                                owner, original_offset, start, _ = containing[0]
                                spans_by_text[owner].append(Span("PERSON", original_offset + left - start, original_offset + right - start, float(entity["score"])))
            return spans_by_text
        except Exception:
            raise SanitizationError("PII inference failed.") from None


class Sanitizer:
    """No retained originals, entity map or per-scope mutable state."""

    def __init__(self, detector: PersonDetector, key: bytes, person_enabled: bool = True):
        """Install model and key; reject a key shorter than 32 bytes."""
        if len(key) < 32:
            raise SanitizationError("PII key is unavailable.")
        self.detector = detector
        self.key = key
        self.policy_version = POLICY_VERSION if person_enabled else CONTACT_POLICY_VERSION
        self.engine_version = ENGINE_VERSION if person_enabled else CONTACT_ENGINE_VERSION

    def sanitize_with_spans(self, text: str, scope: str) -> tuple[str, list[Span]]:
        """Return sanitized text/internal spans for QA; reject bounds or any detection failure."""
        return self.sanitize_many_with_spans([text], scope)[0]

    def sanitize_many_with_spans(self, texts: list[str], scope: str) -> list[tuple[str, list[Span]]]:
        """Sanitize independent leaves with one bounded model batch pipeline; fail atomically."""
        validate_batch(texts, scope)
        try:
            masks, patterns_by_text, protected_by_text = [], [], []
            for text in texts:
                protected = [(match.start(), match.end()) for match in LABEL.finditer(text)]
                masked = list(text)
                for start, end in protected:
                    # Preserve human context without introducing an identity or changing offsets.
                    kind = text[start + 1:end].split("_", 1)[0]
                    marker = {"PERSON": "person", "EMAIL": "[EMAIL]", "PHONE": "[PHONE]"}[kind]
                    masked[start:end] = marker.ljust(end - start)
                patterns = deterministic_spans("".join(masked))
                for span in patterns:
                    marker = "[EMAIL]" if span.entity_type == "EMAIL_ADDRESS" else "[PHONE]"
                    masked[span.start:span.end] = marker[:span.end - span.start].ljust(span.end - span.start)
                masks.append("".join(masked))
                patterns_by_text.append(patterns)
                protected_by_text.append(protected)
            if hasattr(self.detector, "detect_many"):
                people_by_text = self.detector.detect_many(masks)
            else:
                people_by_text = [self.detector.detect(mask) if mask.strip() else [] for mask in masks]
            if len(people_by_text) != len(texts):
                raise ValueError
            results = []
            for text, patterns, people, protected in zip(texts, patterns_by_text, people_by_text, protected_by_text):
                people = [span for span in people if not is_role_mention(text[span.start:span.end])]
                selected = select_spans(patterns + people, len(text), protected)
                parts, cursor = [], 0
                for span in selected:
                    parts.extend((text[cursor:span.start], label_for(span.canonical or text[span.start:span.end], span.entity_type, scope, self.key, self.policy_version)))
                    cursor = span.end
                parts.append(text[cursor:])
                results.append(("".join(parts), selected))
            if sum(len(sanitized) for sanitized, _ in results) > MAX_OUTPUT_CHARS:
                raise SanitizationError("PII output exceeds its limit.")
            return results
        except Exception:
            raise SanitizationError("PII sanitization failed.") from None

    def sanitize_batch(self, texts: list[str], scope: str) -> dict:
        """Sanitize <=64 leaves atomically; return texts/versions/counts, or a fixed failure."""
        validate_batch(texts, scope)
        sanitized_texts, counts = [], Counter()
        for sanitized, spans in self.sanitize_many_with_spans(texts, scope):
            sanitized_texts.append(sanitized)
            counts.update(span.entity_type for span in spans)
        if sum(map(len, sanitized_texts)) > MAX_OUTPUT_CHARS:
            raise SanitizationError("PII output exceeds its limit.")
        return {"texts": sanitized_texts, "policyVersion": self.policy_version, "engineVersion": self.engine_version, "entityCounts": dict(counts)}
