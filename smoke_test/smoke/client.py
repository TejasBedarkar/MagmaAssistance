"""
smoke.client

Small, dependency-free HTTP client used by every module under test/.
Deliberately built on urllib (stdlib) instead of requests, so the smoke
suite has zero install step beyond the optional websocket-client used
by test_voice.py.
"""

import json
import mimetypes
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class TestResult:
    name: str
    passed: bool
    detail: str = ""
    skipped: bool = False
    duration_s: float = 0.0


class ClientError(Exception):
    """Raised for connection-level failures (server not running, DNS, etc)
    and for HTTP error responses -- for the latter, the message includes
    the server's JSON {"detail": ...} body (e.g. FastAPI's
    HTTPException(detail=str(exc))) when present, instead of just
    urllib's generic "HTTP Error 500: Internal Server Error", which on
    its own throws away the one piece of information that actually says
    what broke server-side."""


def _raise_with_body(exc: "urllib.error.URLError") -> None:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            raw = exc.read()
            body = raw.decode(errors="replace") if raw else ""
        except Exception:
            body = ""
        detail = body
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict) and "detail" in parsed:
                detail = parsed["detail"]
        except (json.JSONDecodeError, TypeError):
            pass
        suffix = f" -- {detail}" if detail else ""
        raise ClientError(f"HTTP Error {exc.code}: {exc.reason}{suffix}") from exc
    raise ClientError(str(exc)) from exc


class Client:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    # -- raw HTTP -----------------------------------------------------

    def get(self, path: str, timeout: int = 10):
        try:
            return urllib.request.urlopen(f"{self.base_url}{path}", timeout=timeout)
        except urllib.error.URLError as exc:
            _raise_with_body(exc)

    def post_json(self, path: str, payload: dict, timeout: int = 60):
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.URLError as exc:
            _raise_with_body(exc)

    def post_multipart(self, path: str, fields: dict, files: dict, timeout: int = 60):
        """
        fields: {field_name: value}
        files:  {field_name: (filename, bytes_content)}
        """
        boundary = uuid.uuid4().hex
        lines = []

        for key, value in fields.items():
            lines.append(f"--{boundary}".encode())
            lines.append(f'Content-Disposition: form-data; name="{key}"'.encode())
            lines.append(b"")
            lines.append(str(value).encode())

        for key, (filename, content) in files.items():
            ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            lines.append(f"--{boundary}".encode())
            lines.append(
                f'Content-Disposition: form-data; name="{key}"; filename="{filename}"'.encode()
            )
            lines.append(f"Content-Type: {ctype}".encode())
            lines.append(b"")
            lines.append(content)

        lines.append(f"--{boundary}--".encode())
        lines.append(b"")
        body = b"\r\n".join(lines)

        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.URLError as exc:
            _raise_with_body(exc)

    # -- SSE helper -----------------------------------------------------

    def stream_events(self, path: str, payload: dict, timeout: int = 60) -> list[dict]:
        """POSTs to an SSE endpoint (e.g. /api/chat/stream) and returns the
        parsed `data:` events in order, including a synthetic {"type":
        "done"} for the terminal [DONE] sentinel."""
        resp = self.post_json(path, payload, timeout=timeout)
        events: list[dict[str, Any]] = []
        for raw_line in resp:
            line = raw_line.decode(errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                events.append({"type": "done"})
                break
            try:
                events.append(json.loads(data))
            except json.JSONDecodeError:
                events.append({"type": "unparsed", "raw": data})
        return events


def timed(name: str, fn, *args, **kwargs) -> TestResult:
    """Run fn(*args, **kwargs) -> TestResult, filling in duration_s and
    converting any uncaught exception into a FAIL instead of crashing
    the whole suite."""
    start = time.monotonic()
    try:
        result = fn(*args, **kwargs)
        result.duration_s = time.monotonic() - start
        return result
    except Exception as exc:  # noqa: BLE001
        return TestResult(name=name, passed=False, detail=f"{type(exc).__name__}: {exc}",
                           duration_s=time.monotonic() - start)
