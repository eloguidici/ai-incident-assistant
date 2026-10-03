"""QA-only local PII prototype. Never import this module into production."""

import hashlib
import hmac
import importlib.metadata
import json
import re
import unicodedata
from dataclasses import dataclass

import tldextract
from presidio_analyzer import AnalyzerEngine, RecognizerRegistry, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import EmailRecognizer, PhoneRecognizer, SpacyRecognizer
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

POLICY_VERSION = "pii-spike-v2"
MODELS = {"en": "en_core_web_md", "es": "es_core_news_md"}
ENTITY_TYPES = ("PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER")
MAX_TEXT_CHARS = 8000
LABEL = re.compile(r"\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]")
OFFLINE_SUFFIXES = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)


class SanitizationError(ValueError):
    """Closed prototype failure; callers must never fall back to original text."""


class SnapshotEmailRecognizer(EmailRecognizer):
    """Use the packaged suffix snapshot, never network downloads during detection."""

    def validate_result(self, pattern_text: str) -> bool:
        """Validate one email candidate locally; return validity, without logging it."""
        return bool(OFFLINE_SUFFIXES(pattern_text).fqdn)


@dataclass(frozen=True)
class Span:
    """Internal QA offsets, excluded from any proposed public service response."""

    entity_type: str
    start: int
    end: int
    score: float


def create_analyzer(models: dict[str, str] | None = None) -> AnalyzerEngine:
    """Load installed EN/ES models and explicit recognizers; raise on missing models."""
    selected_models = MODELS if models is None else models
    if set(selected_models) != {"en", "es"}:
        raise SanitizationError("Both language models are required.")
    for model in selected_models.values():
        try:
            importlib.metadata.version(model)
        except importlib.metadata.PackageNotFoundError:
            raise SanitizationError("Required language model is not installed.") from None
    engine = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": language, "model_name": model} for language, model in selected_models.items()],
    }).create_engine()
    registry = RecognizerRegistry(supported_languages=["en", "es"])
    for language in ("en", "es"):
        registry.add_recognizer(SpacyRecognizer(supported_language=language, supported_entities=["PERSON"]))
        registry.add_recognizer(SnapshotEmailRecognizer(supported_language=language, context=["email", "correo"]))
        registry.add_recognizer(PhoneRecognizer(
            supported_language=language, supported_regions=["AR", "ES", "US", "GB"],
            context=["phone", "telephone", "mobile", "call"] if language == "en" else ["teléfono", "telefono", "celular", "llamar"],
        ))
    return AnalyzerEngine(nlp_engine=engine, registry=registry, supported_languages=["en", "es"])


def label_for(original: str, entity_type: str, scope: str, key: bytes) -> str:
    """Return a scoped HMAC label; reject invalid scope/type/key, never persist a map."""
    if entity_type not in ENTITY_TYPES or not scope or len(key) < 32:
        raise SanitizationError("Invalid replacement configuration.")
    normalized = unicodedata.normalize("NFC", original).strip().casefold()
    if entity_type == "PHONE_NUMBER":
        normalized = "".join(character for character in normalized if character.isdecimal())
    else:
        normalized = " ".join(normalized.split())
    message = json.dumps([POLICY_VERSION, scope, entity_type, normalized], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = hmac.new(key, message, hashlib.sha256).hexdigest()[:32]
    return f"[{entity_type}_{digest}]"


def select_spans(candidates: list[Span], text_length: int, protected: list[tuple[int, int]]) -> list[Span]:
    """Choose deterministic non-overlapping spans, protecting existing labels; reject bad offsets."""
    priority = {"EMAIL_ADDRESS": 0, "PHONE_NUMBER": 1, "PERSON": 2}
    selected: list[Span] = []
    for candidate in sorted(candidates, key=lambda span: (priority.get(span.entity_type, 3), -span.score, -(span.end - span.start), span.start, span.end)):
        if candidate.entity_type not in ENTITY_TYPES or not 0 <= candidate.start < candidate.end <= text_length or not 0 <= candidate.score <= 1:
            raise SanitizationError("Invalid detector span.")
        if any(candidate.start < end and candidate.end > start for start, end in protected):
            continue
        if any(candidate.start < other.end and candidate.end > other.start for other in selected):
            continue
        selected.append(candidate)
    return sorted(selected, key=lambda span: (span.start, span.end, span.entity_type))


class PrototypeSanitizer:
    """Local synchronous experiment, not an HTTP service or a production boundary."""

    def __init__(self, analyzer: AnalyzerEngine, key: bytes):
        """Set a real or test analyzer and scoped replacement key; reject short keys."""
        if len(key) < 32:
            raise SanitizationError("Replacement key is too short.")
        self.analyzer = analyzer
        self.key = key
        self.anonymizer = AnonymizerEngine()

    def sanitize(self, text: str, scope: str, languages: tuple[str, ...] = ("en", "es"), threshold: float = 0.35) -> tuple[str, list[Span]]:
        """Return sanitized text/internal spans; raise safely on configuration or detector failure."""
        if not isinstance(text, str) or len(text) > MAX_TEXT_CHARS or not scope or not languages or any(language not in MODELS for language in languages) or not 0 <= threshold <= 1:
            raise SanitizationError("Invalid sanitization request.")
        if not text:
            return "", []
        protected = [(match.start(), match.end()) for match in LABEL.finditer(text)]
        # Equal-length spaces preserve offsets while keeping opaque labels out of the NLP engines.
        detection_text = text
        for start, end in protected:
            detection_text = detection_text[:start] + " " * (end - start) + detection_text[end:]
        try:
            candidates = [
                Span(entity.entity_type, entity.start, entity.end, entity.score)
                for language in languages
                for entity in self.analyzer.analyze(text=detection_text, language=language, entities=list(ENTITY_TYPES), score_threshold=threshold)
            ]
            selected = select_spans(candidates, len(text), protected)
            operators = {
                entity_type: OperatorConfig("custom", {"lambda": lambda original, kind=entity_type: label_for(original, kind, scope, self.key)})
                for entity_type in ENTITY_TYPES
            }
            sanitized = self.anonymizer.anonymize(
                text=text,
                analyzer_results=[RecognizerResult(span.entity_type, span.start, span.end, span.score) for span in selected],
                operators=operators,
                merge_entities_with_spaces=False,
            ).text
            return sanitized, selected
        except SanitizationError:
            raise
        except Exception:
            raise SanitizationError("PII detection or replacement failed.") from None
