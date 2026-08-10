import array
import asyncio
import base64
import json
import math
import os
import websockets

REALTIME_STT_MODEL = os.environ.get("REALTIME_STT_MODEL", "gpt-live-transcribe")
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription"

# Client-side VAD tuning. As of the current Realtime API, transcription-only
# sessions reject server-side turn_detection ("Turn detection is not
# supported for this transcription model" / must be null) -- the API now
# requires the client to detect speech/silence itself and explicitly call
# input_audio_buffer.commit. Tuned for 24kHz 16-bit mono mic input; override
# via env if a mic/room needs different sensitivity.
VAD_ENERGY_THRESHOLD = float(os.environ.get("STT_VAD_ENERGY_THRESHOLD", "500"))
VAD_SILENCE_MS = float(os.environ.get("STT_VAD_SILENCE_MS", "500"))
VAD_MIN_SPEECH_MS = float(os.environ.get("STT_VAD_MIN_SPEECH_MS", "200"))
VAD_DEBUG = os.environ.get("STT_VAD_DEBUG", "0") == "1"


def _rms(pcm_bytes: bytes) -> float:
    """Root-mean-square amplitude of 16-bit PCM audio, used as a cheap
    energy-based speech/silence detector (avoids the deprecated/removed
    audioop module)."""
    if not pcm_bytes:
        return 0.0
    usable_len = len(pcm_bytes) - (len(pcm_bytes) % 2)
    if usable_len <= 0:
        return 0.0
    samples = array.array("h")
    samples.frombytes(pcm_bytes[:usable_len])
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


class RealtimeTranscriber:
    """Proxies raw PCM16 audio to OpenAI's Realtime API transcription-only
    session -- partial and final transcripts, no LLM response generation on
    this connection (that's handled separately by stream_agent_turn).
    Chosen over composing local VAD + batch STT since the Realtime API
    already implements exactly this contract; see realtime_voice_spec.md
    for the tradeoff. Note this bills per audio second the session is open,
    not per turn, unlike the batch transcriptions endpoint TTS/STT.py uses
    for /query.

    Turn boundaries (speech_started / commit-on-silence) are detected
    client-side via simple RMS energy thresholding in send_audio(), since
    the Realtime API's transcription-session turn_detection option is no
    longer accepted for this session type (must be sent as null)."""

    def __init__(self, api_key=None, model=None, sample_rate=24000):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.model = model or REALTIME_STT_MODEL
        self.sample_rate = sample_rate
        self.ws = None
        self._events = asyncio.Queue()
        self._recv_task = None
        self._speaking = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0

    async def connect(self):
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY not found.")
        headers = {"Authorization": f"Bearer {self.api_key}"}
        self.ws = await websockets.connect(REALTIME_WS_URL, additional_headers=headers, max_size=None)
        await self.ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": self.sample_rate},
                        "transcription": {"model": self.model},
                        "turn_detection": None,
                    },
                },
            },
        }))
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def _recv_loop(self):
        try:
            async for raw in self.ws:
                try:
                    event = json.loads(raw)
                except Exception:
                    continue
                etype = event.get("type")
                if etype == "conversation.item.input_audio_transcription.delta":
                    await self._events.put({"type": "transcript_delta", "text": event.get("delta", "")})
                elif etype == "conversation.item.input_audio_transcription.completed":
                    await self._events.put({"type": "transcript_done", "text": event.get("transcript", "")})
                elif etype == "error":
                    await self._events.put({"type": "error", "error": event.get("error")})
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self._events.put(None)  # sentinel: connection ended

    async def _append(self, pcm_bytes: bytes):
        await self.ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(pcm_bytes).decode("ascii"),
        }))

    async def send_audio(self, pcm_bytes: bytes):
        if not self.ws or not pcm_bytes:
            return

        frame_ms = (len(pcm_bytes) / 2) / self.sample_rate * 1000.0
        energy = _rms(pcm_bytes)

        if VAD_DEBUG:
            import sys
            bar = "#" * min(int(energy / 50), 60)
            print(f"\r[vad] energy={energy:7.1f} thresh={VAD_ENERGY_THRESHOLD:.0f} speaking={self._speaking} {bar}", end="", file=sys.stderr, flush=True)

        if energy >= VAD_ENERGY_THRESHOLD:
            self._silence_ms = 0.0
            self._speech_ms += frame_ms
            if not self._speaking and self._speech_ms >= VAD_MIN_SPEECH_MS:
                self._speaking = True
                await self._events.put({"type": "speech_started"})
            await self._append(pcm_bytes)
            return

        # Quiet frame.
        self._speech_ms = 0.0
        if not self._speaking:
            return  # nothing buffered yet, no point sending silence

        await self._append(pcm_bytes)
        self._silence_ms += frame_ms
        if self._silence_ms >= VAD_SILENCE_MS:
            self._speaking = False
            self._silence_ms = 0.0
            await self.ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            await self._events.put({"type": "speech_stopped"})

    async def events(self):
        while True:
            event = await self._events.get()
            if event is None:
                break
            yield event

    async def close(self):
        if self._recv_task:
            self._recv_task.cancel()
            self._recv_task = None
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None