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
#
# Defaults tightened (previously 650 / 3.2x / +220 / 450ms) after reports of
# background noise (fan/AC hum, distant TV/voices) being picked up as
# speech. Two changes: (1) the floor and adaptive multiplier/margin are all
# raised, so it takes a clearly-louder-than-ambient sound to cross the
# threshold at all; (2) VAD_MAX_NOISE_FLOOR caps how far continuous loud
# background noise can drag the adaptive threshold up, so a noisy room
# doesn't eventually swallow normal speech too. Energy-based VAD still can't
# distinguish "your voice" from "another voice/TV at similar volume" --
# that needs OS/mic-level noise suppression or a directional mic, not
# threshold tuning.
VAD_ENERGY_THRESHOLD = float(os.environ.get("STT_VAD_ENERGY_THRESHOLD", "500"))
VAD_SILENCE_MS = float(os.environ.get("STT_VAD_SILENCE_MS", "650"))
VAD_MIN_SPEECH_MS = float(os.environ.get("STT_VAD_MIN_SPEECH_MS", "300"))
VAD_CALIBRATION_MS = float(os.environ.get("STT_VAD_CALIBRATION_MS", "500"))
VAD_NOISE_MULTIPLIER = float(os.environ.get("STT_VAD_NOISE_MULTIPLIER", "3.0"))
VAD_NOISE_MARGIN = float(os.environ.get("STT_VAD_NOISE_MARGIN", "250"))
VAD_MAX_NOISE_FLOOR = float(os.environ.get("STT_VAD_MAX_NOISE_FLOOR", "1200"))
VAD_DEBUG = True


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
        self._observed_ms = 0.0
        self._noise_floor = None
        self._candidate_audio = bytearray()

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
        self._observed_ms += frame_ms

        # Learn the room level while the mic opens and continue adapting
        # slowly whenever no speech is active. A fixed threshold alone makes
        # fans, traffic and laptop hum look like continuous speech.
        if self._noise_floor is None:
            self._noise_floor = energy
        elif not self._speaking and self._speech_ms == 0:
            self._noise_floor = self._noise_floor * 0.95 + energy * 0.05
        adaptive_threshold = max(
            VAD_ENERGY_THRESHOLD,
            self._noise_floor * VAD_NOISE_MULTIPLIER + VAD_NOISE_MARGIN,
        )

        if VAD_DEBUG:
            import sys
            bar = "#" * min(int(energy / 50), 60)
            print(f"\r[vad] energy={energy:7.1f} noise={self._noise_floor:7.1f} thresh={adaptive_threshold:.0f} speaking={self._speaking} {bar}", end="", file=sys.stderr, flush=True)

        if self._observed_ms < VAD_CALIBRATION_MS:
            self._candidate_audio.clear()
            return

        if energy >= adaptive_threshold:
            self._silence_ms = 0.0
            self._speech_ms += frame_ms
            if not self._speaking:
                self._candidate_audio.extend(pcm_bytes)
                if self._speech_ms >= VAD_MIN_SPEECH_MS:
                    self._speaking = True
                    await self._append(bytes(self._candidate_audio))
                    self._candidate_audio.clear()
                    await self._events.put({"type": "speech_started"})
            else:
                await self._append(pcm_bytes)
            return

        # Quiet frame.
        self._speech_ms = 0.0
        if not self._speaking:
            self._candidate_audio.clear()
            return  # nothing buffered yet, no point sending silence

        await self._append(pcm_bytes)
        self._silence_ms += frame_ms
        if self._silence_ms >= VAD_SILENCE_MS:
            self._speaking = False
            self._silence_ms = 0.0
            self._candidate_audio.clear()
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
