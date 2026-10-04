"""Small internal ASGI boundary: bounded bodies, one worker, closed errors."""

import asyncio
import json
import logging
import os
import threading
import time
import warnings

from sanitizer import ENGINE_VERSION, POLICY_VERSION, ContactsOnlyDetector, GlinerPersonDetector, Sanitizer, load_key, person_layer_enabled, validate_batch

MAX_BODY_BYTES = 524288


def configured_slot_wait() -> float:
    """Seconds a busy request may wait for the single inference slot. Invalid values use 20."""
    raw = os.environ.get("PII_SLOT_WAIT_SECONDS", "20").strip()
    try:
        wait = float(raw)
    except ValueError:
        return 20.0
    if not 0 <= wait <= 60:
        return 20.0
    return wait


async def respond(send, status: int, payload: dict) -> None:
    """Send fixed JSON metadata/sanitized output; propagate transport errors only."""
    body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode()
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"cache-control", b"no-store")]})
    await send({"type": "http.response.body", "body": body})


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    """Parse one JSON object; reject duplicate keys without echoing request content."""
    parsed = {}
    for key, value in pairs:
        if key in parsed:
            raise ValueError
        parsed[key] = value
    return parsed


class PiiApp:
    """A single shared slot spans body receipt, validation and all batch inference."""

    def __init__(self, sanitizer: Sanitizer | None = None, slot_wait_seconds: float | None = None):
        """Create the request slot; optionally inject a test engine and a bounded wait."""
        self.sanitizer = sanitizer
        self.slot = threading.Lock()
        self.slot_wait_seconds = configured_slot_wait() if slot_wait_seconds is None else slot_wait_seconds

    async def wait_for_slot(self) -> bool:
        """Take the inference slot, waiting until it frees or the wait expires.

        @returns True when this request owns the slot.
        """
        if self.slot.acquire(blocking=False):
            return True
        deadline = time.monotonic() + self.slot_wait_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            await asyncio.sleep(min(0.05, remaining))
            if self.slot.acquire(blocking=False):
                return True

    async def __call__(self, scope, receive, send) -> None:
        """Handle lifespan/readiness/sanitization; never return raw input or exception details."""
        if scope["type"] == "lifespan":
            await self.lifespan(receive, send)
            return
        if scope["type"] != "http":
            return
        path, method = scope["path"], scope["method"]
        if path == "/health" and method == "GET":
            ready = self.sanitizer is not None
            await respond(send, 200 if ready else 503, {"status": "ok" if ready else "unavailable",
                "policyVersion": self.sanitizer.policy_version if ready else POLICY_VERSION,
                "engineVersion": self.sanitizer.engine_version if ready else ENGINE_VERSION})
            return
        if path not in ("/sanitize", "/sanitize-batch"):
            await respond(send, 404, {"error": "NOT_FOUND"})
            return
        if method != "POST":
            await respond(send, 405, {"error": "METHOD_NOT_ALLOWED"})
            return
        if self.sanitizer is None:
            await respond(send, 503, {"error": "PII_UNAVAILABLE"})
            return
        if not await self.wait_for_slot():
            await respond(send, 503, {"error": "PII_BUSY"})
            return
        worker_owns_slot = False
        try:
            headers = dict(scope.get("headers", []))
            if headers.get(b"content-type", b"").split(b";")[0].strip().lower() != b"application/json" or headers.get(b"content-encoding", b"identity") != b"identity":
                await respond(send, 415, {"error": "UNSUPPORTED_MEDIA_TYPE"})
                return
            length = headers.get(b"content-length")
            if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
                await respond(send, 413, {"error": "REQUEST_TOO_LARGE"})
                return
            body = bytearray()
            # A slow upload cannot reserve the one model indefinitely.
            async with asyncio.timeout(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > MAX_BODY_BYTES:
                        await respond(send, 413, {"error": "REQUEST_TOO_LARGE"})
                        return
                    if not message.get("more_body", False):
                        break
            payload = json.loads(body, object_pairs_hook=unique_object)
            field = "text" if path == "/sanitize" else "texts"
            if not isinstance(payload, dict) or set(payload) != {field, "scope"}:
                raise ValueError
            texts = [payload[field]] if field == "text" else payload[field]
            validate_batch(texts, payload["scope"])
            worker_owns_slot = True
            # The worker releases the slot, even when the client cancels its await.
            future = asyncio.create_task(asyncio.to_thread(self.execute, texts, payload["scope"]))
            try:
                result = await asyncio.shield(future)
            except asyncio.CancelledError:
                future.add_done_callback(lambda finished: finished.exception() if not finished.cancelled() else None)
                raise
            if field == "text":
                result["text"] = result.pop("texts")[0]
            await respond(send, 200, result)
        except (ValueError, UnicodeError, RecursionError):
            await respond(send, 400, {"error": "INVALID_REQUEST"})
        except TimeoutError:
            await respond(send, 408, {"error": "REQUEST_TIMEOUT"})
        except asyncio.CancelledError:
            raise
        except Exception:
            await respond(send, 503, {"error": "PII_FAILED"})
        finally:
            if not worker_owns_slot:
                self.slot.release()

    def execute(self, texts: list[str], scope: str) -> dict:
        """Run atomic synchronous inference; release the slot on every success/failure."""
        try:
            return self.sanitizer.sanitize_batch(texts, scope)
        finally:
            self.slot.release()

    async def lifespan(self, receive, send) -> None:
        """Load key/model once; keep readiness closed if unavailable, without exception logging."""
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                logging.disable(logging.CRITICAL)
                warnings.filterwarnings("ignore")
                if self.sanitizer is None:
                    try:
                        key = load_key()
                        person_enabled = person_layer_enabled()
                        detector = await asyncio.to_thread(GlinerPersonDetector) if person_enabled else ContactsOnlyDetector()
                        self.sanitizer = Sanitizer(detector, key, person_enabled)
                    except Exception:
                        self.sanitizer = None
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return


app = PiiApp()
