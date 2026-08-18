"""
Sarvam Speech-to-Text service.

Uses the REST endpoint (POST /speech-to-text) for batch transcription.
Accepts raw PCM audio bytes (16-bit signed, 16kHz, mono).
Returns transcription text and detected language code.

PERFORMANCE: Uses a persistent module-level httpx.AsyncClient with
connection pooling and keep-alive. This eliminates the ~100-200ms
TCP handshake overhead that occurred when creating a new client per request.
"""

import base64
import httpx
import logging

import os

logger = logging.getLogger(__name__)

# ── Persistent HTTP client ─────────────────────────────────────────────────
# Shared across all STT requests in this process.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Return (or lazily create) the shared STT HTTP client."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0),
            limits=httpx.Limits(
                max_keepalive_connections=5,
                max_connections=10,
                keepalive_expiry=30.0,
            ),
            http2=False,
        )
        logger.info("[STT] Persistent HTTP client created")
    return _client


async def close_client() -> None:
    """Gracefully close the shared client (call on app shutdown)."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
        logger.info("[STT] HTTP client closed")

# Language codes returned by Sarvam STT
LANGUAGE_NAMES = {
    "hi-IN": "Hindi",
    "en-IN": "English",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "bn-IN": "Bengali",
    "gu-IN": "Gujarati",
    "mr-IN": "Marathi",
    "pa-IN": "Punjabi",
    "or-IN": "Odia",
    "as-IN": "Assamese",
    "ur-IN": "Urdu",
}

# Default fallback
DEFAULT_LANGUAGE = "en-IN"


def _build_wav_header(pcm_length: int, sample_rate: int = 16000) -> bytes:
    """Build a minimal WAV header for raw PCM data."""
    import struct

    channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    data_size = pcm_length
    file_size = 36 + data_size

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        file_size,
        b"WAVE",
        b"fmt ",
        16,               # chunk size
        1,                # PCM format
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header


async def transcribe(audio_bytes: bytes, language_code: str | None = None) -> dict:
    """
    Transcribe audio using Sarvam REST API.

    Args:
        audio_bytes: Raw PCM audio (16-bit signed, 16kHz, mono)
        language_code: Optional language hint (e.g. "hi-IN"). If None, auto-detect.

    Returns:
        {
            "transcript": str,
            "language_code": str,
            "language_name": str,
        }
    """
    

    # Wrap PCM in WAV container — Sarvam REST expects a file upload
    wav_header = _build_wav_header(len(audio_bytes))
    wav_data = wav_header + audio_bytes

    headers = {
        "api-subscription-key": os.environ.get("SARVAM_API_KEY"),
    }

    # Build form data
    form_data = {
        "model": "saarika:v1",
    }
    if language_code:
        form_data["language_code"] = language_code

    files = {
        "file": ("audio.wav", wav_data, "audio/wav"),
    }

    client = _get_client()
    response = await client.post(
        os.environ.get("SARVAM_STT_URL", "https://api.sarvam.ai/speech-to-text"),
        headers=headers,
        data=form_data,
        files=files,
    )

    if response.status_code != 200:
        logger.error("Sarvam STT error %d: %s", response.status_code, response.text)
        try:
            with open("stt_error_debug.txt", "w") as f:
                f.write(response.text)
        except Exception:
            pass
        raise RuntimeError(f"Sarvam STT failed: {response.status_code} — {response.text}")

    data = response.json()

    transcript = data.get("transcript", "")
    detected_lang = data.get("language_code", DEFAULT_LANGUAGE)
    lang_name = LANGUAGE_NAMES.get(detected_lang, detected_lang)

    logger.info("STT result [%s]: %s", detected_lang, transcript[:80])

    return {
        "transcript": transcript,
        "language_code": detected_lang,
        "language_name": lang_name,
    }
