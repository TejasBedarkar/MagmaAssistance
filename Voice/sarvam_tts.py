"""
Sarvam Text-to-Speech service.

Uses the REST endpoint (POST /text-to-speech) with bulbul:v3 model.
Returns raw WAV audio bytes.

PERFORMANCE: Uses a persistent module-level httpx.AsyncClient with
connection pooling and keep-alive. This eliminates the ~100-200ms
TCP handshake overhead that occurred when creating a new client per request.
"""

import base64
import httpx
import logging
import atexit

import os

logger = logging.getLogger(__name__)

# ── Persistent HTTP client ─────────────────────────────────────────────────
# Shared across all TTS requests in this process. Connection pooling keeps
# the TCP connection to Sarvam warm between requests.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Return (or lazily create) the shared TTS HTTP client."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
            limits=httpx.Limits(
                max_keepalive_connections=5,
                max_connections=10,
                keepalive_expiry=30.0,
            ),
            http2=False,  # Sarvam doesn't advertise H2, avoid negotiation overhead
        )
        logger.info("[TTS] Persistent HTTP client created")
    return _client


async def close_client() -> None:
    """Gracefully close the shared client (call on app shutdown)."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
        logger.info("[TTS] HTTP client closed")

# Default speaker per language — used when no specific speaker is selected.
SPEAKERS = {
    "hi-IN": "shubh",
    "en-IN": "shreya",
    "ta-IN": "kavitha",
    "te-IN": "shruti",
    "kn-IN": "roopa",
    "ml-IN": "arya",
    "bn-IN": "manisha",
    "gu-IN": "tanya",
    "mr-IN": "suhani",
    "pa-IN": "simran",
    "or-IN": "vidya",
}

DEFAULT_SPEAKER = "shreya"
DEFAULT_LANGUAGE = "en-IN"

# Full speaker list per language — used by /api/voices to enumerate selectable voices.
# Covers all 37 Sarvam Bulbul v3 voices across all supported languages.
SPEAKER_LIST = {
    "hi-IN": [
        # ── Male ──────────────────────────────────
        {"id": "shubh",     "name": "Shubh"},
        {"id": "aditya",    "name": "Aditya"},
        {"id": "rahul",     "name": "Rahul"},
        {"id": "rohan",     "name": "Rohan"},
        {"id": "amit",      "name": "Amit"},
        {"id": "dev",       "name": "Dev"},
        {"id": "ratan",     "name": "Ratan"},
        {"id": "varun",     "name": "Varun"},
        {"id": "manan",     "name": "Manan"},
        {"id": "sumit",     "name": "Sumit"},
        {"id": "kabir",     "name": "Kabir"},
        {"id": "aayan",     "name": "Aayan"},
        {"id": "ashutosh",  "name": "Ashutosh"},
        {"id": "advait",    "name": "Advait"},
        {"id": "anand",     "name": "Anand"},
        {"id": "tarun",     "name": "Tarun"},
        {"id": "sunny",     "name": "Sunny"},
        {"id": "mani",      "name": "Mani"},
        {"id": "gokul",     "name": "Gokul"},
        {"id": "vijay",     "name": "Vijay"},
        {"id": "mohit",     "name": "Mohit"},
        {"id": "rehan",     "name": "Rehan"},
        {"id": "soham",     "name": "Soham"},
        # ── Female ────────────────────────────────
        {"id": "ritu",      "name": "Ritu"},
        {"id": "priya",     "name": "Priya"},
        {"id": "neha",      "name": "Neha"},
        {"id": "pooja",     "name": "Pooja"},
        {"id": "simran",    "name": "Simran"},
        {"id": "kavya",     "name": "Kavya"},
        {"id": "ishita",    "name": "Ishita"},
        {"id": "shreya",    "name": "Shreya"},
        {"id": "roopa",     "name": "Roopa"},
        {"id": "tanya",     "name": "Tanya"},
        {"id": "shruti",    "name": "Shruti"},
        {"id": "suhani",    "name": "Suhani"},
        {"id": "kavitha",   "name": "Kavitha"},
        {"id": "rupali",    "name": "Rupali"},
    ],
    "en-IN": [
        {"id": "shubh",     "name": "Shubh"},
        {"id": "aditya",    "name": "Aditya"},
        {"id": "dev",       "name": "Dev"},
        {"id": "manan",     "name": "Manan"},
        {"id": "aayan",     "name": "Aayan"},
        {"id": "sunny",     "name": "Sunny"},
        {"id": "rehan",     "name": "Rehan"},
        {"id": "priya",     "name": "Priya"},
        {"id": "neha",      "name": "Neha"},
        {"id": "ishita",    "name": "Ishita"},
        {"id": "shreya",    "name": "Shreya"},
    ],
    "ta-IN": [
        {"id": "mani",      "name": "Mani"},
        {"id": "gokul",     "name": "Gokul"},
        {"id": "shruti",    "name": "Shruti"},
        {"id": "kavitha",   "name": "Kavitha"},
    ],
    "te-IN": [
        {"id": "gokul",     "name": "Gokul"},
        {"id": "shruti",    "name": "Shruti"},
    ],
    "kn-IN": [
        {"id": "kavya",     "name": "Kavya"},
        {"id": "roopa",     "name": "Roopa"},
    ],
    "ml-IN": [
        {"id": "roopa",     "name": "Roopa"},
    ],
    "bn-IN": [
        {"id": "neha",      "name": "Neha"},
    ],
    "gu-IN": [
        {"id": "tanya",     "name": "Tanya"},
    ],
    "mr-IN": [
        {"id": "suhani",    "name": "Suhani"},
    ],
    "pa-IN": [
        {"id": "simran",    "name": "Simran"},
    ],
    "or-IN": [
        {"id": "suhani",    "name": "Suhani"},
    ],
}


def _build_wav_header(pcm_length: int, sample_rate: int = 24000) -> bytes:
    """Build a minimal WAV header for raw PCM data."""
    import struct
    channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    data_size = pcm_length
    file_size = 36 + data_size

    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", file_size, b"WAVE", b"fmt ", 16, 1, channels,
        sample_rate, byte_rate, block_align, bits_per_sample, b"data", data_size
    )

async def synthesize(
    text: str,
    language_code: str = "en-IN",
    speaker: str | None = None,
) -> bytes:
    """
    Synthesize speech from text using Sarvam TTS REST API.

    Args:
        text: The text to convert to speech.
        language_code: Target language (e.g. "hi-IN").
        speaker: Voice name. If None, picks default for the language.

    Returns:
        Raw WAV audio bytes ready for playback.
    """
    

    if not speaker:
        speaker = SPEAKERS.get(language_code, DEFAULT_SPEAKER)

    payload = {
        "inputs": [text],
        "model": "bulbul:v3",
        "target_language_code": language_code,
        "speaker": speaker,
    }

    headers = {
        "api-subscription-key": os.environ.get('SARVAM_API_KEY'),
        "Content-Type": "application/json",
    }

    client = _get_client()
    response = await client.post(
        os.environ.get('SARVAM_TTS_URL', 'https://api.sarvam.ai/text-to-speech'),
        headers=headers,
        json=payload,
    )

    if response.status_code != 200:
        logger.error("Sarvam TTS error %d: %s", response.status_code, response.text)
        raise RuntimeError(f"Sarvam TTS failed: {response.status_code} — {response.text}")

    data = response.json()
    audios = data.get("audios", [])

    if not audios:
        raise RuntimeError("Sarvam TTS returned no audio data")

    # Decode base64 audio → raw WAV bytes
    audio_bytes = base64.b64decode(audios[0])

    # Sarvam sometimes returns raw PCM without a WAV header.
    # If missing, add a 24kHz mono 16-bit WAV header so browsers can decode it.
    if len(audio_bytes) > 0 and audio_bytes[:4] != b"RIFF":
        logger.info("TTS audio missing RIFF header, prepending WAV header (24kHz)")
        audio_bytes = _build_wav_header(len(audio_bytes), 24000) + audio_bytes

    logger.info(
        "TTS synthesized %d bytes for [%s] text: %s",
        len(audio_bytes),
        language_code,
        text[:60],
    )

    return audio_bytes
