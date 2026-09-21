"""
test_llm_retry.py
-----------------
_stream_chat_completion retries transient OpenAI errors (429/5xx) and turns a persistent
outage into a friendly message; a 4xx is not retried.
"""

import asyncio
from unittest.mock import patch

import httpx
import pytest

from agent import agent as agent_mod

_real_sleep = asyncio.sleep


def _status_error(code):
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    return httpx.HTTPStatusError(f"{code}", request=req, response=httpx.Response(code, request=req))


class _FakeResponse:
    def __init__(self, status, lines):
        self.status, self.lines = status, lines

    def raise_for_status(self):
        if self.status >= 400:
            raise _status_error(self.status)

    async def aiter_lines(self):
        for line in self.lines:
            yield line


class _FakeStream:
    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        return self.resp

    async def __aexit__(self, *exc):
        return False


def _fake_client(statuses):
    calls = {"n": 0}
    ok_lines = ['data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}', "data: [DONE]"]

    class FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): return False

        def stream(self, *a, **k):
            status = statuses[min(calls["n"], len(statuses) - 1)]
            calls["n"] += 1
            return _FakeStream(_FakeResponse(status, ok_lines if status < 400 else []))

    return FakeClient, calls


async def _drain(gen):
    return [e async for e in gen]


def _run(statuses):
    client, calls = _fake_client(statuses)
    with patch.object(agent_mod.httpx, "AsyncClient", client), \
         patch.object(agent_mod.asyncio, "sleep", lambda *_: _real_sleep(0)), \
         patch.object(agent_mod.state, "assistant", type("A", (), {"llm": type("L", (), {"temperature": 0})()})()):
        return calls, asyncio.run(_drain(agent_mod._stream_chat_completion([])))


def test_503_then_success_is_retried():
    calls, events = _run([503, 503, 200])
    assert calls["n"] == 3
    assert any(e.get("type") == "token" and e["text"] == "hi" for e in events)


def test_persistent_503_gives_friendly_message():
    with pytest.raises(RuntimeError, match="busy right now"):
        _run([503])


def test_4xx_is_not_retried():
    client, calls = _fake_client([400])
    with patch.object(agent_mod.httpx, "AsyncClient", client), \
         patch.object(agent_mod.state, "assistant", type("A", (), {"llm": type("L", (), {"temperature": 0})()})()):
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(_drain(agent_mod._stream_chat_completion([])))
    assert calls["n"] == 1
