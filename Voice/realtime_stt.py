"""
OpenAI Realtime transcription-only STT for /ws/voice.

Turn cuts use server_vad. Replies still come from stream_agent_turn, not this
connection. Config lives in config.py (same pattern as other MagmaAssistance knobs).
"""

from __future__ import annotations

import base64
import re
from typing import AsyncIterator, Optional

from openai import AsyncOpenAI

from config import (
    REALTIME_STT_LANGUAGE,
    REALTIME_STT_MIN_WORDS,
    REALTIME_STT_MODEL,
    REALTIME_STT_PREFIX_PADDING_MS,
    REALTIME_STT_PROMPT,
    REALTIME_STT_SAMPLE_RATE,
    REALTIME_STT_SILENCE_MS,
    REALTIME_STT_VAD_THRESHOLD,
)

# Reuse one client across voice sessions (avoids TLS handshake per connect).
_openai_client: Optional[AsyncOpenAI] = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI()
    return _openai_client

# Short confirms/stops that still count under the min-word filter.
_CONFIRM_OR_STOP_RE = re.compile(
    r"^(yes|no|ok|okay|sure|correct|right|cancel|stop|go ahead)([.,!?]\s*)?$",
    re.IGNORECASE,
)


def is_actionable_transcript(text: str, min_words: Optional[int] = None) -> bool:
    """True if a final transcript should start an agent turn."""
    t = (text or "").strip()
    if not t or not re.search(r"[A-Za-z0-9]", t):
        return False
    if _CONFIRM_OR_STOP_RE.match(t):
        return True
    words = re.findall(r"[A-Za-z0-9']+", t)
    need = REALTIME_STT_MIN_WORDS if min_words is None else min_words
    return len(words) >= need


class RealtimeTranscriber:
    """One voice WebSocket → PCM in, speech/transcript events out."""

    def __init__(self, model: Optional[str] = None, sample_rate: int = REALTIME_STT_SAMPLE_RATE):
        self.model = model or REALTIME_STT_MODEL
        self.sample_rate = sample_rate
        self._client = _get_openai_client()
        self._cm = None
        self.connection = None

    async def connect(self) -> None:
        self._cm = self._client.realtime.connect(extra_query={"intent": "transcription"})
        self.connection = await self._cm.__aenter__()
        await self.connection.session.update(session={
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": self.sample_rate},
                    "transcription": {
                        "model": self.model,
                        "language": REALTIME_STT_LANGUAGE,
                        "prompt": REALTIME_STT_PROMPT,
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": REALTIME_STT_VAD_THRESHOLD,
                        "prefix_padding_ms": REALTIME_STT_PREFIX_PADDING_MS,
                        "silence_duration_ms": REALTIME_STT_SILENCE_MS,
                        "create_response": False,
                    },
                }
            },
        })

    async def send_audio(self, pcm_bytes: bytes) -> None:
        if not self.connection or not pcm_bytes:
            return
        await self.connection.input_audio_buffer.append(
            audio=base64.b64encode(pcm_bytes).decode("ascii")
        )

    async def flush(self) -> None:
        """End the current utterance after mic mute (VAD needs trailing silence)."""
        if not self.connection:
            return
        try:
            await self.connection.input_audio_buffer.commit()
            return
        except Exception:
            pass
        # server_vad may reject commit — push ~800ms of silence instead.
        chunk = b"\x00\x00" * int(self.sample_rate * 0.05)
        for _ in range(16):
            await self.send_audio(chunk)

    async def events(self) -> AsyncIterator[dict]:
        async for event in self.connection:
            etype = event.type
            if etype == "input_audio_buffer.speech_started":
                yield {"type": "speech_started"}
            elif etype == "input_audio_buffer.speech_stopped":
                yield {"type": "speech_stopped"}
            elif etype == "conversation.item.input_audio_transcription.delta":
                yield {"type": "transcript_delta", "text": event.delta or ""}
            elif etype == "conversation.item.input_audio_transcription.completed":
                yield {"type": "transcript_done", "text": event.transcript or ""}
            elif etype == "error":
                # Muting right as server_vad already closed the turn commits an
                # empty buffer -- normal, not worth surfacing to the user.
                if getattr(event.error, "code", None) == "input_audio_buffer_commit_empty":
                    continue
                yield {"type": "error", "error": str(event.error)}

    async def close(self) -> None:
        if self._cm:
            try:
                await self._cm.__aexit__(None, None, None)
            except Exception:
                pass
            self._cm = None
            self.connection = None
